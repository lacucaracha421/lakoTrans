import { getTextMeasureContext } from "./blockTextMeasurement";
import { createTextRunStyleResolver } from "./textStyleRunResolution";
import { resolveFontWeight } from "../../../shared/blockFontWeight";
import { parseRichText } from "../../../shared/richTextMarkup";
import type { TranslationBlock } from "../../../shared/textTypes";
import type { BlockFontCatalog } from "./fonts";

function hasVisibleInk(height: number, width: number) {
  return (
    Number.isFinite(height) && Number.isFinite(width) && height > 0 && width > 0
  );
}

/** Read-only ink measurement using the same run styles and loaded canvas fonts as production text. */
export function measureRenderedHangulInk(
  block: TranslationBlock,
  text: string,
  size: number,
  fonts: BlockFontCatalog,
) {
  // Non-canvas environments can render text but cannot certify glyph ink metrics.
  if (typeof CanvasRenderingContext2D === "undefined") return null;
  const context = getTextMeasureContext();
  const resolve = createTextRunStyleResolver(block, size, fonts);
  const heights: number[] = [],
    widths: number[] = [];
  const seen = new Set<string>();
  for (const run of parseRichText(
    text,
    Boolean(block.bold),
    Boolean(block.italic),
    block.fontWeight,
  ).runs) {
    const style = resolve(run);
    context.font = `${run.italic ? "italic " : ""}${resolveFontWeight(run)} ${style.fontSizePx}px ${style.fontFamily}`;
    for (const glyph of run.text) {
      const key = `${context.font}/${glyph}`;
      if (!/[가-힣]/u.test(glyph) || seen.has(key) || seen.size >= 64) continue;
      seen.add(key);
      const metrics = context.measureText(glyph);
      const height =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const width =
        metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
      if (hasVisibleInk(height, width)) {
        heights.push(height);
        widths.push(width);
      }
    }
  }
  if (!heights.length) return null;
  heights.sort((a, b) => a - b);
  widths.sort((a, b) => a - b);
  return {
    sampleCount: heights.length,
    medianHeight: heights[Math.floor(heights.length / 2)],
    medianWidth: widths[Math.floor(widths.length / 2)],
    minimumHeight: heights[0],
    maximumHeight: heights[heights.length - 1],
  };
}
