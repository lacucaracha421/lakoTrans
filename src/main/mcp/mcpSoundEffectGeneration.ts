import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import type {
  McpSoundEffectPrepare,
  McpSoundEffectChange,
} from "../../shared/mcpSoundEffects";
import type { AppPaths } from "../appPaths";
import { startCodexImageSession } from "../codexImageSession";
import { readImageRedactionState } from "../imageRedactionStore";
import { McpEditError } from "../application/mcpEditPolicy";
import {
  MCP_SNAPSHOT_BYTES,
  packMcpSnapshot,
} from "../application/mcpSnapshotPayload";
import { readMcpSoundEffectSettings } from "./mcpSoundEffectSettings";
import { logError } from "../logger";
import { generateSoundEffectLayer } from "./mcpSoundEffectLayer";
import { askAstraJson } from "../pipeline/codexTypesettingRequest";
import type { CodexTypesettingPorts } from "../application/codexTypesettingContracts";
import { McpSoundEffectCandidates } from "./mcpSoundEffectCandidates";
import { hashMcpOriginalImage } from "./mcpTypographySourceEvidence";
import { soundEffectCorrectionReferences } from "./mcpSoundEffectReferences";
import type { renderMcpLetteringPixels } from "./mcpGeneratedGlyphRendering";

export type SoundEffectGenerationRuntime = {
  startClient: typeof startCodexImageSession;
  startReader?: typeof startCodexImageSession;
  renderLettering?: typeof renderMcpLetteringPixels;
};
type Command = Extract<McpSoundEffectPrepare["command"], { kind: "generate" }>;
type Client = Awaited<ReturnType<typeof startCodexImageSession>>;
type Options = {
  page: MangaPage;
  input: McpSoundEffectPrepare;
  paths: AppPaths;
  signal: AbortSignal;
  guard: () => Promise<void>;
  runtime?: SoundEffectGenerationRuntime;
};
export async function generateMcpSoundEffects(options: Options) {
  const { page, input, paths, signal } = options;
  if (input.command.kind !== "generate")
    throw new McpEditError(
      "invalid_edit",
      "Expected explicit image generation.",
    );
  const command = input.command;
  if (!command.allowExternalProcessing)
    throw new McpEditError(
      "access_denied",
      "Explicit allowExternalProcessing is required for paid app image generation.",
    );
  const settings = await readMcpSoundEffectSettings(
    paths,
    command.expectedModel,
  );
  const targets = selectTargets(page, command);
  const exclusions = targets.flatMap((block) => {
    const reason = block.imageGenerationBlocked
      ? "image_generation_blocked"
      : !block.sourceText.trim() || !block.translatedText.trim()
        ? "approved_text_required"
        : block.generatedLettering && !command.replaceExisting
          ? "existing_image_requires_explicit_replacement"
          : null;
    return reason ? [excluded(page, block.id, reason)] : [];
  });
  const eligible = targets.filter(
    (block) => !exclusions.some((item) => item.id === block.id),
  );
  if (!eligible.length)
    return { page: structuredClone(page), exclusions, generationCalls: 0 };
  const check = async () => {
    signal.throwIfAborted();
    await options.guard();
    if ((await readImageRedactionState(paths.dataRoot)).enabled)
      throw new McpEditError(
        "access_denied",
        "Sound-effect image generation is blocked by redaction review.",
      );
    signal.throwIfAborted();
  };
  await check();
  return withMcpSoundEffectClient(
    options,
    settings,
    check,
    async (client, directory, ask) => {
      let generationCalls = 0;
      const transport: Client = {
        ...client,
        runEphemeralTurn: async (request) => {
          await check();
          generationCalls++;
          return client.runEphemeralTurn(request);
        },
      };
      const next = await runTargets(
        options,
        command,
        eligible,
        transport,
        directory,
        check,
        exclusions,
        ask,
      );
      return { page: next, exclusions, generationCalls };
    },
  );
}
export class SoundEffectCleanupError extends AggregateError {
  constructor(errors: unknown[]) {
    super(
      errors,
      "Sound-effect generation cleanup failed; no plan was published.",
      { cause: errors[0] },
    );
    this.name = "SoundEffectCleanupError";
  }
}
export async function withMcpSoundEffectClient<T>(
  options: Options,
  settings: Awaited<ReturnType<typeof readMcpSoundEffectSettings>>,
  check: () => Promise<void>,
  run: (
    client: Client,
    directory: string,
    ask: CodexTypesettingPorts["ask"],
  ) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "carrot-mcp-sfx-"));
  let client: Client | undefined;
  let reader: Client | undefined;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    options.signal.throwIfAborted();
    await options.guard();
    client = await (options.runtime?.startClient ?? startCodexImageSession)(
      options.paths,
      settings,
      directory,
      options.signal,
    );
    const ask: CodexTypesettingPorts["ask"] = async (stage, prompt, images) => {
      await check();
      reader ??= await (options.runtime?.startReader ?? startCodexImageSession)(
        options.paths,
        settings,
        directory,
        options.signal,
        "isolated",
      );
      const result = await askAstraJson({
        client: reader,
        model: reader.imageModel,
        effort: settings.codex.imageReasoningEffort,
        stage,
        prompt,
        images,
        cwd: directory,
        signal: options.signal,
        evidence: async (name, value) => {
          await writeFile(
            join(directory, `${name}.json`),
            JSON.stringify(value),
          );
        },
        onRetry: () => {},
      });
      await check();
      return result;
    };
    outcome = { ok: true, value: await run(client, directory, ask) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const failures: unknown[] = [];
  try {
    await reader?.dispose();
  } catch (error) {
    failures.push(error);
  }
  try {
    await client?.dispose();
  } catch (error) {
    failures.push(error);
  }
  // Stop client writers before cleaning the directory; do not mask the primary failure.
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new SoundEffectCleanupError(
      outcome.ok ? failures : [outcome.error, ...failures],
    );
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
async function runTargets(
  options: Options,
  command: Command,
  targets: TranslationBlock[],
  client: Client,
  directory: string,
  check: () => Promise<void>,
  exclusions: McpSoundEffectChange[],
  ask: CodexTypesettingPorts["ask"],
) {
  const next = structuredClone(options.page);
  const candidates = new McpSoundEffectCandidates(options.paths.dataRoot);
  const sourceSha256 = await hashMcpOriginalImage(options.page.imagePath, () =>
    options.signal.throwIfAborted(),
  );
  for (const block of targets) {
    await check();
    try {
      const references = await soundEffectCorrectionReferences(
        options.input,
        options.page,
        block,
        candidates,
        () => options.signal.throwIfAborted(),
        options.signal,
      );
      const generated = await generateSoundEffectLayer(
        options.page,
        block,
        command,
        client,
        directory,
        options.signal,
        ask,
        {
          reserve: (instructions) =>
            candidates.reserve(
              options.input.chapterId,
              options.page,
              block,
              sourceSha256,
              command.priorGenerationAttempts?.[block.id] ?? 0,
              instructions,
            ),
          save: (candidate) => candidates.save(candidate),
        },
        references,
      );
      await check();
      const candidate = next.blocks.map((item) =>
        item.id === block.id ? generated : item,
      );
      assertSnapshotSize(options.page, candidate);
      next.blocks = candidate;
      if (generated.imageGenerationBlocked)
        exclusions.push(
          excluded(options.page, block.id, "image_provider_refused"),
        );
    } catch (error) {
      await check();
      logError("MCP sound-effect generation item failed", error);
      exclusions.push(
        excluded(
          options.page,
          block.id,
          error instanceof McpEditError
            ? error.message
            : "image_generation_failed",
        ),
      );
    }
  }
  return next;
}
function selectTargets(page: MangaPage, command: Command) {
  return command.blockIds.map((id) => {
    const matches = page.blocks.filter(
      (block) => block.id === id && block.textRole === "sound",
    );
    if (matches.length !== 1)
      throw new McpEditError(
        "not_found",
        "Generation targets must be saved sound-effect blocks, not dialogue.",
      );
    return matches[0];
  });
}
function excluded(
  page: MangaPage,
  id: string,
  reason: string,
): McpSoundEffectChange {
  return {
    pageId: page.id,
    id,
    action: "generate",
    before: null,
    after: null,
    changed: false,
    excludedReason: reason,
    warnings: [
      "inspect_reviewed_change_before_applying",
      "up_to_4_generation_attempts_retained_candidates_no_implicit_fallback",
    ],
  };
}

function assertSnapshotSize(page: MangaPage, candidate: TranslationBlock[]) {
  // A saved result must remain editable/verifiable, which needs two full copies.
  const size = packMcpSnapshot([page.blocks, candidate, candidate]);
  if (
    size.metadataBytes > 3 * 1024 * 1024 ||
    size.totalBytes > MCP_SNAPSHOT_BYTES
  )
    throw new McpEditError(
      "invalid_edit",
      "Generated snapshots exceed the bounded plan budget; use fewer/smaller assets.",
    );
}
