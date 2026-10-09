import type { MangaPage } from "../../shared/libraryTypes";
import type {
  McpCompositeReviewReport,
  McpCompositeRenderEvidence,
} from "../../shared/mcpCompositeWorkflowReview";
import type { McpQualityEvidence } from "../../shared/mcpQualityEvidence";
import { inspectMcpLayout } from "../../shared/mcpLayoutReview";
import { parseRichText } from "../../shared/richTextMarkup";
import { getActiveGeneratedLettering } from "../../shared/generatedLettering";
import { hasValidGeneratedGlyphShape } from "../../shared/generatedGlyphReview";
import { generatedAssetSha256 } from "./mcpGeneratedTouchup";
import { compositeFingerprint } from "./mcpCompositeWorkflowPolicy";
import { McpEditError } from "./mcpEditPolicy";

type Input = {
  page: MangaPage;
  assessment: McpCompositeReviewReport["assessments"][number];
  evidence: McpCompositeRenderEvidence;
  sourceSha256: string;
  paletteRevision: string | null;
  readEvidence: (id: string) => Promise<McpQualityEvidence>;
};
type Detail = NonNullable<
  NonNullable<Input["assessment"]["quality"]>["detailed"]
>;
type Item = Detail["inventory"][number];
type Block = MangaPage["blocks"][number];

export async function assertDetailedTranslationPage(input: Input) {
  const detail = input.assessment.quality?.detailed;
  const layout = input.evidence.layout;
  if (!detail || !layout)
    fail(
      "Detailed completion requires source inventory, actual layout and font/glyph receipts.",
    );
  await assertSource(input, detail);
  assertInventory(
    input.page,
    detail,
    input.assessment.quality?.soundEffectScope,
  );
  const fonts = new Set<string>();
  for (const block of input.page.blocks) {
    const items = detail.inventory.filter((item) => item.blockId === block.id);
    if (items.length !== 1)
      fail("Every saved block requires exactly one source inventory item.");
    const item = items[0];
    assertRenderedBlock(block, item, layout);
    if (getActiveGeneratedLettering(block))
      await assertGlyph(input, block, item);
    else collectEditableFonts(block, item, fonts);
    assertLetteringHistory(input, item);
  }
  if (fonts.size && !input.paletteRevision)
    fail("Save a specimen-backed work palette before detailed completion.");
  for (const font of fonts) await assertFont(input, detail, font);
  assertLayout(layout, detail, input.page.height);
  assertSoundCount(input, detail);
}
function assertLayout(
  layout: NonNullable<Input["evidence"]["layout"]>,
  detail: Detail,
  pageHeight: number,
) {
  for (const warning of inspectMcpLayout(layout, pageHeight)) {
    if (warning.reasons.includes("overflow"))
      fail(
        `Actual renderer reports overflow for block ${warning.blockId}. Correct its layout and obtain a fresh render before submitting again.`,
      );
    if (!detail.exceptions.some((item) => item.blockId === warning.blockId))
      fail(
        `Review layout warning for ${warning.blockId}: ${warning.reasons.join(", ")}. Fix it or explain its intentional composition.`,
      );
  }
}
function assertSoundCount(input: Input, detail: Detail) {
  const preserved = detail.inventory.filter(
    (item) => item.role === "sound" && item.outcome === "intentional-original",
  ).length;
  if (preserved !== (input.assessment.quality?.soundEffectsPreserved ?? 0))
    fail(
      "Preserved SFX must match the original-preservation inventory and must not count as translated.",
    );
  if (
    detail.inventory.filter((item) => item.role === "sound").length !==
    input.assessment.quality?.soundEffectsFound
  )
    fail(
      "SFX counts must match the visual source inventory, including detector misses.",
    );
}
async function assertSource(input: Input, detail: Detail) {
  const source = await input.readEvidence(detail.sourceEvidenceId);
  if (
    source.kind !== "source-page" ||
    source.chapterId !== input.assessment.chapterId ||
    source.pageId !== input.page.id ||
    source.sourceSha256 !== input.sourceSha256
  )
    fail(
      "Inspect the current entire original page before completing its inventory.",
    );
  if (
    detail.paletteRevision !== input.paletteRevision ||
    input.evidence.paletteRevision !== input.paletteRevision
  )
    fail("Work palette changed; refresh its evidence and final review.");
}
function assertInventory(
  page: MangaPage,
  detail: Detail,
  soundEffectScope?: "translate" | "preserve-original",
) {
  if (
    new Set(detail.inventory.map((item) => item.itemId)).size !==
    detail.inventory.length
  )
    fail("Inventory item IDs must be distinct.");
  for (const item of detail.inventory)
    assertInventoryItem(page, item, soundEffectScope);
  if (
    detail.exceptions.some(
      (item) => !page.blocks.some((block) => block.id === item.blockId),
    )
  )
    fail("Layout exceptions must identify current saved blocks.");
}
function assertInventoryItem(
  page: MangaPage,
  item: Item,
  soundEffectScope?: "translate" | "preserve-original",
) {
  if (
    item.sourceRect.x + item.sourceRect.w > page.width ||
    item.sourceRect.y + item.sourceRect.h > page.height ||
    item.outcome === "unresolved" ||
    item.restoration === "unresolved"
  )
    fail("Source inventory contains unresolved or out-of-page text.");
  if (!item.blockId && item.outcome !== "intentional-original")
    fail("Translated source items must link to saved blocks.");
  if (item.blockId && !page.blocks.some((block) => block.id === item.blockId))
    fail("Inventory points to a missing block.");
  assertPreservedSound(item, soundEffectScope);
}
function assertPreservedSound(
  item: Item,
  soundEffectScope?: "translate" | "preserve-original",
) {
  if (
    item.role === "sound" &&
    item.outcome === "intentional-original" &&
    (soundEffectScope !== "preserve-original" ||
      item.restoration !== "not-needed")
  )
    fail("SFX cannot silently remain untranslated in detailed mode.");
}
async function assertGlyph(input: Input, block: Block, item: Item) {
  if (item.outcome !== "generated-lettering" || !item.glyphEvidenceId)
    fail(
      "Generated lettering requires independent readback of the composed pixels.",
    );
  const glyph = await input.readEvidence(item.glyphEvidenceId);
  if (
    glyph.kind !== "generated-glyphs" ||
    !glyph.passed ||
    !hasValidGeneratedGlyphShape(glyph.shape) ||
    glyph.chapterId !== input.assessment.chapterId ||
    glyph.pageId !== input.page.id ||
    glyph.blockId !== block.id ||
    glyph.revision !== input.evidence.revision ||
    glyph.assetSha256 !== generatedAssetSha256(block) ||
    glyph.compositionFingerprint !== compositeFingerprint(block)
  )
    fail(
      "Glyph evidence is stale, failed, lacks independent shape inspection, or belongs to different lettering. A correct OCR guess alone cannot certify malformed Hangul.",
    );
}
function collectEditableFonts(block: Block, item: Item, fonts: Set<string>) {
  if (item.outcome === "intentional-original") return;
  if (item.outcome === "generated-lettering")
    fail("Background erasure alone is not generated Korean lettering.");
  if (!block.fontFamily)
    fail("Choose an explicit sampled font for editable text.");
  fonts.add(block.fontFamily);
  for (const run of parseRichText(block.translatedText).runs)
    if (run.fontFamily) fonts.add(run.fontFamily);
}

function assertRenderedBlock(
  block: Block,
  item: Item,
  layout: NonNullable<Input["evidence"]["layout"]>,
) {
  if (item.outcome === "intentional-original") return;
  const measurements = layout.filter((entry) => entry.blockId === block.id);
  if (measurements.length !== 1 || measurements[0].rendered === "hidden")
    fail(
      "Each translated block requires one visible final renderer measurement.",
    );
  const measurement = measurements[0];
  if (getActiveGeneratedLettering(block)) {
    if (measurement.rendered !== "generated")
      fail("Generated lettering is not visible in the final render.");
    return;
  }
  const expected = parseRichText(block.translatedText).plainText;
  if (
    measurement.rendered !== "text" ||
    parseRichText(measurement.displayText ?? "").plainText !== expected
  )
    fail(
      "The final render must display the approved translation, not source-only or hidden text.",
    );
  if (/[가-힣]/u.test(expected) && !measurement.hangulInk)
    fail("Actual Hangul glyph measurement is missing.");
}
function assertLetteringHistory(input: Input, item: Item) {
  if (!["generated-lettering", "font-fallback"].includes(item.outcome)) return;
  const history = input.assessment.quality?.imageHistory.find(
    (entry) =>
      entry.regionId === item.itemId && entry.purpose === "korean-lettering",
  );
  if (
    !history ||
    history.outcome !==
      (item.outcome === "font-fallback" ? "local-fallback" : "generated")
  )
    fail(
      `Record lettering generation separately from background restoration and disclose font substitutions. Inventory item ${item.itemId} requires imageHistory.regionId to equal this itemId (not its blockId), purpose=korean-lettering, outcome=${item.outcome === "font-fallback" ? "local-fallback" : "generated"}.`,
    );
}
async function assertFont(input: Input, detail: Detail, fontId: string) {
  const reference = detail.fontEvidence.find((item) => item.fontId === fontId);
  if (!reference) fail(`Missing actual specimen for ${fontId}.`);
  const specimen = await input.readEvidence(reference.specimenId);
  if (
    specimen.kind !== "font-specimen" ||
    specimen.fontFingerprint !== input.evidence.fontFingerprint ||
    !specimen.samples.some((item) => item.fontId === fontId)
  )
    fail(
      "Font specimen was not issued for the selected font and current font bytes.",
    );
}
function fail(message: string): never {
  throw new McpEditError("invalid_edit", message);
}
