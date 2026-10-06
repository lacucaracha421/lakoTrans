import { isAutomaticFontSize } from "./sourceFontSizeMatching";
import type { TranslationBlock } from "../../../shared/textTypes";
import { resolveFontWeight } from "../../../shared/blockFontWeight";
import { parseRichText } from "../../../shared/richTextMarkup";
import { resolveBlockFontFamily, type BlockFontCatalog } from "./fonts";
import { getTextMeasureContext } from "./blockTextMeasurement";
import {
  resolveBlockTextLayout,
  type BlockTextLayout,
  type ViewportSize,
} from "./overlayLayout";
import { resolvePageSourceFontFaceFallbacks } from "./sourceFontSizeMatching";
import { assessWrappedTextQuality } from "./bubbleTextWrapping";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    ((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) +
      (sorted[Math.floor(sorted.length / 2)] ?? 0)) /
    2
  );
}

function eligible(block: TranslationBlock): boolean {
  return (
    isAutomaticFontSize(block) &&
    block.textRole === "ordinary" &&
    block.fontRole === "dialogue" &&
    Number(block.sourceFontSizeConfidence) >= 0.5 &&
    Number(block.sourceFontFacePx) > 0 &&
    !block.curveLayout &&
    block.renderDirection !== "vertical" &&
    Boolean(block.translatedText.trim())
  );
}

function faceRatio(block: TranslationBlock, catalog: BlockFontCatalog): number {
  const context = getTextMeasureContext();
  context.font = `${block.italic ? "italic " : ""}${resolveFontWeight(block)} 100px ${resolveBlockFontFamily(block.fontFamily, catalog)}`;
  const metrics = context.measureText("가나다라마바사아자차카타파하");
  return (
    (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 100
  );
}

/** Derived automatic targets only: never turn persisted source matching into manual formatting. */
export function resolvePageDialogueFontSizes(
  blocks: readonly TranslationBlock[],
  pageSize: ViewportSize,
  catalog: BlockFontCatalog,
): ReadonlyMap<string, number> {
  const selected = blocks.filter(eligible);
  const result = new Map<string, number>();
  if (selected.length < 4) return result;
  const fallbacks = resolvePageSourceFontFaceFallbacks(blocks, pageSize);
  const measured = selected.map((block) => ({
    block,
    ratio: faceRatio(block, catalog),
    layout: resolveBlockTextLayout(
      block,
      block.translatedText,
      pageSize,
      pageSize,
      catalog,
      { sourceFontFaceFallbackPx: fallbacks.get(block.id) },
    ),
  }));
  const sourceCenter = median(selected.map((b) => Number(b.sourceFontFacePx)));
  for (const current of measured) {
    const { block, layout: before, ratio } = current;
    const source = Number(block.sourceFontFacePx);
    if (
      before.overflow ||
      !(ratio > 0) ||
      source > sourceCenter * 1.2 ||
      source < sourceCenter / 1.2
    )
      continue;
    const face = ratio * before.fontSizePx;
    const nearby = measured.filter(
      (peer) =>
        !peer.layout.overflow &&
        resolveFontWeight(peer.block) === resolveFontWeight(block) &&
        Number(peer.block.sourceFontFacePx) >= source / 1.2 &&
        Number(peer.block.sourceFontFacePx) <= source * 1.2 &&
        peer.ratio * peer.layout.fontSizePx >= face / 1.2 &&
        peer.ratio * peer.layout.fontSizePx <= face * 1.2,
    );
    if (nearby.length < 4) continue;
    const target = median(
      nearby.map((peer) => peer.ratio * peer.layout.fontSizePx),
    );
    const desired = Math.round(target / ratio);
    if (
      desired === before.fontSizePx ||
      Math.abs(desired - before.fontSizePx) >
        Math.max(2, Math.round(before.fontSizePx * 0.15))
    )
      continue;
    const after = resolveBlockTextLayout(
      block,
      block.translatedText,
      pageSize,
      pageSize,
      catalog,
      {
        sourceFontFaceFallbackPx: fallbacks.get(block.id),
        dialogueFontSizePx: desired,
      },
    );
    if (
      Math.abs(after.fontSizePx * ratio - target) < Math.abs(face - target) &&
      preservesDialogueWrapping(block, before, after)
    )
      result.set(block.id, desired);
  }
  return result;
}

function breakDamage(text: string, layout: BlockTextLayout): Set<number> {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\n/g, "");
  const damage = new Set<number>();
  let offset = 0;
  for (const [index, line] of (layout.lines ?? []).entries()) {
    const value = line.runs.map((run) => run.text).join("");
    if (
      index > 0 &&
      /^[,，、。.!?！？;:；：)）\]】」』]/u.test(value.trimStart())
    )
      damage.add(offset);
    offset += line.sourceTextLength ?? value.length;
    if (
      index < (layout.lines?.length ?? 0) - 1 &&
      ((/[\p{L}\p{N}]$/u.test(compact.slice(0, offset)) &&
        /^[\p{L}\p{N}]/u.test(compact.slice(offset))) ||
        /[（([【「『]$/u.test(value.trimEnd()))
    )
      damage.add(offset);
  }
  return damage;
}

function preservesDialogueWrapping(
  block: TranslationBlock,
  before: BlockTextLayout,
  after: BlockTextLayout,
): boolean {
  if (
    after.overflow ||
    !before.lines ||
    !after.lines ||
    after.lines.length >
      Math.min(before.lines.length + 1, before.lines.length * 1.25)
  )
    return false;
  const plain = parseRichText(
    block.translatedText,
    Boolean(block.bold),
    Boolean(block.italic),
  ).plainText;
  const priorDamage = breakDamage(plain, before);
  if ([...breakDamage(plain, after)].some((offset) => !priorDamage.has(offset)))
    return false;
  const a = assessWrappedTextQuality(plain, before.lines),
    b = assessWrappedTextQuality(plain, after.lines);
  return (
    b.intraWordSplitCount <= a.intraWordSplitCount &&
    b.orphanLineCount <= a.orphanLineCount
  );
}
