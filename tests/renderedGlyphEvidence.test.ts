import { expect, it, vi } from "vitest";
import { editingChapter } from "./mcpEditing.fixture";
import { DEFAULT_BLOCK_FONT_CATALOG } from "../src/renderer/src/lib/fonts";
import { measureRenderedHangulInk } from "../src/renderer/src/lib/renderedGlyphEvidence";

it("measures visible Korean ink per actual run, bounds the work and refuses unavailable/invalid metrics", () => {
  const block = editingChapter().pages[0].blocks[0];
  const measureText = vi.fn((_text: string) => ({
    actualBoundingBoxAscent: 14,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 1,
    actualBoundingBoxRight: 13,
  }));
  const context = { font: "", measureText };
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => context }),
  });
  try {
    expect(
      measureRenderedHangulInk(
        block,
        "가가 ABC 나나",
        24,
        DEFAULT_BLOCK_FONT_CATALOG,
      ),
    ).toEqual({
      sampleCount: 2,
      medianHeight: 16,
      medianWidth: 14,
      minimumHeight: 16,
      maximumHeight: 16,
    });
    expect(context.font).toContain("24px");
    const many = Array.from({ length: 90 }, (_, index) =>
      String.fromCharCode(0xac00 + index),
    ).join("");
    measureText.mockClear();
    expect(
      measureRenderedHangulInk(block, many, 24, DEFAULT_BLOCK_FONT_CATALOG)
        ?.sampleCount,
    ).toBe(64);
    expect(measureText).toHaveBeenCalledTimes(64);
    measureText.mockReturnValue({
      actualBoundingBoxAscent: NaN,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
    });
    expect(
      measureRenderedHangulInk(block, "가", 24, DEFAULT_BLOCK_FONT_CATALOG),
    ).toBeNull();
    expect(
      measureRenderedHangulInk(block, "ABC", 24, DEFAULT_BLOCK_FONT_CATALOG),
    ).toBeNull();
    vi.stubGlobal("CanvasRenderingContext2D", undefined);
    expect(
      measureRenderedHangulInk(block, "가", 24, DEFAULT_BLOCK_FONT_CATALOG),
    ).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
