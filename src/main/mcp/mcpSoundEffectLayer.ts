import { hasValidGeneratedGlyphShape } from "../../shared/generatedGlyphReview";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import type { McpSoundEffectPrepare } from "../../shared/mcpSoundEffects";
import { normalizeBboxTo1000 } from "../../shared/bboxNormalization";
import { hashStableValue } from "../../shared/blockFingerprint";
import { generatedLettering } from "../../shared/blockFormatValueSchemas";
import type { startCodexImageSession } from "../codexImageSession";
import { translatedPageReading } from "../codexImageEditing";
import { generateLetteringLayers } from "../pipeline/codexTypesettingLettering";
import { prepareExternalImageFile } from "../imageRedactionContext";
import { McpEditError } from "../application/mcpEditPolicy";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import {
  inspectGeneratedLettering,
  matchesLetteringReadback,
} from "../application/codexTypesettingReadback";
import type {
  CodexTypesettingPorts,
  TypesettingIssue,
} from "../application/codexTypesettingContracts";
import type { McpSoundEffectCandidate } from "./mcpSoundEffectCandidates";
type Command = Extract<McpSoundEffectPrepare["command"], { kind: "generate" }>;
export async function generateSoundEffectLayer(
  page: MangaPage,
  block: TranslationBlock,
  command: Command,
  client: Awaited<ReturnType<typeof startCodexImageSession>>,
  directory: string,
  signal: AbortSignal,
  ask: CodexTypesettingPorts["ask"],
  candidates?: {
    reserve: (instructions: string) => Promise<{
      candidate: McpSoundEffectCandidate;
      refuse: () => Promise<void>;
    }>;
    save: (candidate: McpSoundEffectCandidate) => Promise<void>;
  },
  correctionReferences?: Array<{ label: string; dataUrl: string }>,
) {
  const target = await soundEffectTarget(page, block);
  const context = {
    target,
    block,
    command,
    client,
    directory,
    signal,
    ask,
    candidates,
    correctionReferences,
    reading: translatedPageReading(target, "image"),
  };
  let issues: TypesettingIssue[] = [];
  const prior = command.priorGenerationAttempts?.[block.id] ?? 0;
  for (
    let step = 1;
    step <= (command.attemptsPerCall ?? 1) && prior + step <= 4;
    step++
  ) {
    const instructions = attemptInstructions(
      command.directions?.[block.id],
      issues,
      step,
    );
    const pending = await candidates?.reserve(instructions);
    const attempt = pending?.candidate.attempt ?? prior + step;
    const result = await generateAttempt(
      context,
      attempt,
      issues,
      instructions,
    );
    const output = result.page.blocks[0];
    if (output.imageGenerationBlocked) {
      await recordRefusal(context, pending);
      return projectLayer(
        block,
        output,
        target.blocks[0].renderBbox,
        command.allowRenderAdjustment,
      );
    }
    issues = await retainAndReadAttempt(context, result.page, pending, attempt);
    signal.throwIfAborted();
    if (!issues.length)
      return projectLayer(
        block,
        output,
        target.blocks[0].renderBbox,
        command.allowRenderAdjustment,
      );
  }
  throw new McpEditError(
    "invalid_edit",
    `Generated lettering needs repair. Inspect carrot_get_sound_effect_candidates, repair retained pixels or revise the prompt; four attempts total, two touchup passes per candidate. ${issues.map((issue) => issue.reason).join("; ")}`,
  );
}
type LayerContext = {
  target: Awaited<ReturnType<typeof soundEffectTarget>>;
  block: TranslationBlock;
  command: Command;
  client: Parameters<typeof generateSoundEffectLayer>[3];
  directory: string;
  signal: AbortSignal;
  ask: CodexTypesettingPorts["ask"];
  candidates: Parameters<typeof generateSoundEffectLayer>[7];
  correctionReferences: Parameters<typeof generateSoundEffectLayer>[8];
  reading: ReturnType<typeof translatedPageReading>;
};
function attemptInstructions(
  direction: NonNullable<Command["directions"]>[string] | undefined,
  issues: TypesettingIssue[],
  step: number,
) {
  const strategy = [
    "",
    "Rebuild the incorrect syllable anatomy, keeping each initial, vowel and final consonant in its correct block.",
    "Open merged counters and separate neighboring syllables; reduce distressed texture only where it hides distinguishing strokes.",
    "Use clear complete Korean syllable silhouettes first, then restore the original edge texture without obscuring the corrected vowels or final consonants.",
  ][step - 1];
  return [
    direction?.creativeBrief,
    direction?.correctionInstruction,
    ...issues.map((issue) => issue.reason),
    strategy,
  ]
    .filter(Boolean)
    .join("\n");
}
async function generateAttempt(
  context: LayerContext,
  attempt: number,
  issues: TypesettingIssue[],
  instructions: string,
) {
  const {
    target,
    reading,
    client,
    directory,
    signal,
    block,
    command,
    correctionReferences,
  } = context;
  return generateLetteringLayers(
    target,
    reading,
    (id) => id,
    client,
    directory,
    signal,
    {
      attempt,
      issues,
      invertColors: command.invertColors,
      ...(correctionReferences
        ? { correctionReferences: { [block.id]: correctionReferences } }
        : {}),
      plan: {
        groups: [
          {
            id: block.id,
            description: instructions,
            members: [{ regionId: block.id, bold: false, italic: false }],
          },
        ],
        fonts: [],
        sfxRendering: "image",
      },
    },
  );
}
async function recordRefusal(
  context: LayerContext,
  pending:
    | Awaited<ReturnType<NonNullable<LayerContext["candidates"]>["reserve"]>>
    | undefined,
) {
  if (!pending) return;
  await pending.refuse();
  await context.candidates?.save({
    ...pending.candidate,
    issues: ["Image provider refused this region."],
    status: "refused",
  });
}
async function soundEffectTarget(page: MangaPage, block: TranslationBlock) {
  const source = normalizeBboxTo1000(block.bbox, page, block.bboxSpace);
  const render = normalizeBboxTo1000(
    block.renderBbox ?? block.bbox,
    page,
    block.renderBbox
      ? (block.renderBboxSpace ?? block.bboxSpace)
      : block.bboxSpace,
  );
  const normalized = {
    ...block,
    bbox: source,
    renderBbox: render,
    bboxSpace: "normalized_1000" as const,
    renderBboxSpace: "normalized_1000" as const,
  };
  const {
    soundEffectReview: _review,
    blockOrder: _order,
    ...sourcePage
  } = page;
  return {
    ...sourcePage,
    blockOrder: [block.id],
    imagePath: await prepareExternalImageFile(page.imagePath),
    blocks: [normalized],
  };
}
function projectLayer(
  block: TranslationBlock,
  output: TranslationBlock,
  render: TranslationBlock["bbox"],
  allowAdjustment: boolean,
) {
  if (output.imageGenerationBlocked)
    return { ...block, imageGenerationBlocked: output.imageGenerationBlocked };
  const image = generatedLettering.parse(output.generatedLettering);
  if (
    image.sourceText !== block.sourceText ||
    image.translatedText !== block.translatedText
  )
    throw new McpEditError(
      "invalid_edit",
      "Generated layer metadata changed the approved text.",
    );
  const adjusted =
    hashStableValue(output.renderBbox ?? render) !== hashStableValue(render);
  if (adjusted && !allowAdjustment)
    throw new McpEditError(
      "invalid_edit",
      "Native foreground canvas requires explicit allowRenderAdjustment; existing geometry was preserved.",
    );
  return {
    ...block,
    generatedLettering: image,
    ...(adjusted
      ? {
          renderBbox: output.renderBbox,
          renderBboxSpace: "normalized_1000" as const,
        }
      : {}),
  };
}

async function retainAndReadAttempt(
  context: LayerContext,
  page: MangaPage,
  pending:
    | Awaited<ReturnType<NonNullable<LayerContext["candidates"]>["reserve"]>>
    | undefined,
  attempt: number,
) {
  // Retain usable PNGs BEFORE readback or cancellation can fail. Candidate storage is not page application.
  const retained = pending
    ? {
        ...pending.candidate,
        block: projectLayer(
          context.block,
          page.blocks[0],
          context.target.blocks[0].renderBbox,
          true,
        ),
        issues: ["Independent readback pending."],
        status: "pending-repair" as const,
      }
    : undefined;
  if (retained) await context.candidates?.save(retained);
  let readback: McpSoundEffectCandidate["readback"];
  const issues = await inspectGeneratedLettering(
    page,
    context.reading,
    attempt,
    {
      ask: context.ask,
      blockId: (id) => id,
      targetLanguage: "target-script",
      onTranscript: async (_id, readText, expectedText, _dataUrl, shape) => {
        readback = {
          readText,
          expectedText,
          compositionFingerprint: compositeFingerprint(
            retained?.block ?? page.blocks[0],
          ),
          shape,
          passed:
            matchesLetteringReadback(readText, expectedText) &&
            hasValidGeneratedGlyphShape(shape),
        };
      },
    },
  );
  if (retained)
    await context.candidates?.save({
      ...retained,
      readback,
      issues: issues.map((issue) => issue.reason),
      status: issues.length ? "pending-repair" : "readback-passed",
    });
  return issues;
}
