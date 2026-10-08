import { hashStableValue } from "../../shared/blockFingerprint";
import { createPageRevision } from "../../shared/pageRevision";
import type { AppPaths } from "../appPaths";
import type { SoundEffectPreparation } from "../application/mcpSoundEffectPolicy";
import { editSoundEffectBlocks } from "../application/mcpSoundEffectBlocks";
import { resolveCompletionAfterBlockMutation } from "../libraryStore/translationCompletionInvalidation";
import {
  projectSoundEffectReview,
  materializeSoundEffects,
} from "./mcpSoundEffectEdits";
import { readMcpSoundEffectSettings } from "./mcpSoundEffectSettings";
import {
  generateMcpSoundEffects,
  type SoundEffectGenerationRuntime,
} from "./mcpSoundEffectGeneration";
import type { soundEffectChanges } from "./mcpSoundEffectState";
import { McpSoundEffectCandidates } from "./mcpSoundEffectCandidates";
import { McpEditError } from "../application/mcpEditPolicy";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { verifyMcpGeneratedGlyphs } from "./mcpGeneratedGlyphVerification";

export async function prepareSoundEffectCommand(
  page: Parameters<SoundEffectPreparation>[0],
  input: Parameters<SoundEffectPreparation>[1],
  access: Parameters<SoundEffectPreparation>[2],
  paths: AppPaths,
  verify: () => Promise<void>,
  runtime?: SoundEffectGenerationRuntime,
) {
  let next = page;
  let generationCalls = 0;
  let glyphEvidenceIds: string[] | undefined;
  let exclusions: ReturnType<typeof soundEffectChanges> = [];
  switch (input.command.kind) {
    case "verify": {
      glyphEvidenceIds = await verifyMcpGeneratedGlyphs({
        page,
        input,
        paths,
        signal: access.signal ?? new AbortController().signal,
        guard: verify,
        runtime,
      });
      break;
    }
    case "candidate": {
      next = await adoptCandidates(page, input.chapterId, input.command, paths);
      break;
    }
    case "review":
      next = projectSoundEffectReview(page, input);
      break;
    case "materialize":
      next = materializeSoundEffects(
        page,
        input,
        (await readMcpSoundEffectSettings(paths)).defaults,
      );
      break;
    case "text":
    case "image-state": {
      next = editSoundEffectBlocks(page, input);
      if (hashStableValue(next.blocks) !== hashStableValue(page.blocks))
        next = {
          ...next,
          translationCompletion: resolveCompletionAfterBlockMutation(
            page.translationCompletion,
            page.blocks,
            next.blocks,
          ),
        };
      break;
    }
    case "generate": {
      const result = await generateMcpSoundEffects({
        page,
        input,
        paths,
        signal: access.signal ?? new AbortController().signal,
        guard: verify,
        runtime,
      });
      next = result.page;
      generationCalls = result.generationCalls;
      exclusions = result.exclusions;
      break;
    }
  }
  return { next, generationCalls, exclusions, glyphEvidenceIds };
}

async function adoptCandidates(
  page: Parameters<SoundEffectPreparation>[0],
  chapterId: string,
  command: Extract<
    Parameters<SoundEffectPreparation>[1]["command"],
    { kind: "candidate" }
  >,
  paths: AppPaths,
) {
  const candidateIds =
    command.candidateIds ?? (command.candidateId ? [command.candidateId] : []);
  const replacements = new Map<string, (typeof page.blocks)[number]>();
  for (const id of candidateIds) {
    const block = await adoptCandidate(page, chapterId, id, paths);
    if (replacements.has(block.id))
      throw new McpEditError(
        "invalid_edit",
        "Select only one candidate per block.",
      );
    replacements.set(block.id, block);
  }
  return {
    ...page,
    blocks: page.blocks.map((block) => replacements.get(block.id) ?? block),
  };
}

async function adoptCandidate(
  page: Parameters<SoundEffectPreparation>[0],
  chapterId: string,
  candidateId: string,
  paths: AppPaths,
) {
  const candidate = await new McpSoundEffectCandidates(paths.dataRoot).read(
    candidateId,
  );
  const current = page.blocks.find((block) => block.id === candidate.blockId);
  if (
    candidate.chapterId !== chapterId ||
    candidate.pageId !== page.id ||
    !current ||
    candidate.baseRevision !== createPageRevision(page) ||
    !candidate.block ||
    candidate.status === "refused" ||
    compositeFingerprint(current) !== candidate.baseBlockFingerprint
  )
    throw new McpEditError(
      "revision_conflict",
      "Candidate no longer matches the unchanged saved block. Reinspect before adopting it.",
    );
  return candidate.block;
}
