import type { McpSoundEffectPrepare } from "../../shared/mcpSoundEffects";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { stripRichTextMarkup } from "../../shared/richTextMarkup";
import { McpEditError } from "../application/mcpEditPolicy";
import { McpSoundEffectCandidates } from "./mcpSoundEffectCandidates";
import { renderMcpLetteringPixels } from "./mcpGeneratedGlyphRendering";
import { readMcpFontCatalog } from "./mcpFontCatalogAdapter";
import { renderMcpFontSamples } from "./mcpFontSamplesAdapter";

export async function soundEffectCorrectionReferences(
  input: McpSoundEffectPrepare,
  page: MangaPage,
  block: TranslationBlock,
  candidates: McpSoundEffectCandidates,
  guard: () => void,
  signal: AbortSignal,
) {
  if (input.command.kind !== "generate") return [];
  const direction = input.command.directions?.[block.id];
  const images: Array<{ label: string; dataUrl: string }> = [];
  if (direction?.previousCandidateId) {
    images.push(
      await candidateReference(
        input.chapterId,
        page,
        block,
        candidates,
        direction.previousCandidateId,
        direction.correctionInstruction,
        signal,
      ),
    );
  }
  if (direction?.glyphGuideFontId) {
    const catalog = await readMcpFontCatalog();
    guard();
    if (
      !catalog.fonts.some(
        (font) =>
          font.fontId === direction.glyphGuideFontId &&
          font.availability === "available",
      )
    )
      throw new McpEditError(
        "invalid_edit",
        "Glyph guide needs an available registered font.",
      );
    images.push(
      ...(await renderMcpFontSamples(
        [direction.glyphGuideFontId],
        stripRichTextMarkup(block.translatedText),
        guard,
      )),
    );
  }
  return images;
}

async function candidateReference(
  chapterId: string,
  page: MangaPage,
  block: TranslationBlock,
  candidates: McpSoundEffectCandidates,
  candidateId: string,
  correction: string | undefined,
  signal: AbortSignal,
) {
  if (!correction?.trim())
    throw new McpEditError(
      "invalid_edit",
      "A retry with a previous candidate requires a concrete correction instruction.",
    );
  const candidate = await candidates.read(candidateId);
  if (
    candidate.chapterId !== chapterId ||
    candidate.pageId !== page.id ||
    candidate.blockId !== block.id ||
    !candidate.block ||
    candidate.status === "refused" ||
    candidate.block.sourceText !== block.sourceText ||
    candidate.block.translatedText !== block.translatedText
  )
    throw new McpEditError(
      "invalid_edit",
      "Previous candidate must belong to this exact approved wording and region.",
    );
  return {
    label:
      "Failed candidate to repair; preserve useful texture, not wrong glyphs",
    dataUrl: await renderMcpLetteringPixels(page, candidate.block, signal),
  };
}
