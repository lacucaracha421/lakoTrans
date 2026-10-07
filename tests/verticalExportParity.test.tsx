/** @vitest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextWithVerticalSpacing } from "../src/renderer/src/components/VerticalTextSpacing";
import { OverlayText } from "../src/renderer/src/components/OverlayText";
import { resolveBlockTextLayout } from "../src/renderer/src/lib/overlayLayout";
import { resolveFixedVerticalTextLines } from "../src/renderer/src/lib/blockTextMeasurement";
import { DEFAULT_BLOCK_FONT_CATALOG } from "../src/renderer/src/lib/fonts";
import { batchChapter } from "./fixtures/conditionalBatch";

afterEach(() => vi.restoreAllMocks());

describe("vertical export layout at the device-scale rounding boundary", () => {
  it("preserves newlines and fixed advances in width-scaled fallback runs", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
    } as CanvasRenderingContext2D);
    const block = {
      ...batchChapter().pages[0].blocks[0],
      renderDirection: "vertical" as const,
      fontSizePx: 20,
      lineHeight: 1.2,
      autoFitText: false,
    };
    const displayText = "[width=1.2]가\n나[/width]";
    const size = { width: 1000, height: 1000 };
    const layout = {
      ...resolveBlockTextLayout(
        block,
        displayText,
        size,
        size,
        DEFAULT_BLOCK_FONT_CATALOG,
      ),
      lines: null,
    };
    const { container } = render(
      <OverlayText
        block={block}
        displayText={displayText}
        fontCatalog={DEFAULT_BLOCK_FONT_CATALOG}
        layout={layout}
        renderDirection="vertical"
      />,
    );
    const main = container.querySelector(".overlay-text-main");
    expect(main?.querySelectorAll("br")).toHaveLength(1);
    expect(main?.querySelectorAll("[data-vertical-cell]")).toHaveLength(2);
  });
  it("keeps explicit newlines outside fixed glyph cells", () => {
    const { container } = render(
      <TextWithVerticalSpacing
        direction="vertical"
        text={"가\n나"}
        spacing={{ fontSizePx: 20, lineHeight: 1.2, letterSpacingEm: 0 }}
      />,
    );
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.querySelectorAll("[data-vertical-cell]")).toHaveLength(2);
  });
  it("keeps the reported six-character column within 481px at 67px font size", () => {
    const block = {
      ...batchChapter().pages[0].blocks[0],
      renderDirection: "vertical" as const,
      fontSizePx: 67,
      lineHeight: 1.18,
      letterSpacing: 0,
      fontWidthScale: 1,
      wordBreak: "keep-all-overflow" as const,
    };
    const lines = resolveFixedVerticalTextLines(
      block,
      "제1상·전신",
      67,
      105.374,
      481.038,
      DEFAULT_BLOCK_FONT_CATALOG,
    );
    expect(
      lines?.map((line) => line.runs.map((run) => run.text).join("")),
    ).toEqual(["제1상·전신"]);
    const { container } = render(
      <TextWithVerticalSpacing
        direction="vertical"
        text="제1상·전신"
        spacing={{ fontSizePx: 67, lineHeight: 1.18, letterSpacingEm: 0 }}
      />,
    );
    const cells = [
      ...container.querySelectorAll<HTMLElement>("[data-vertical-cell]"),
    ];
    expect(cells).toHaveLength(6);
    expect(
      cells.reduce((sum, cell) => sum + parseFloat(cell.style.inlineSize), 0),
    ).toBeCloseTo(474.36);
    expect(
      cells.every((cell) => parseFloat(cell.style.letterSpacing) === 0),
    ).toBe(true);
  });

  it("preserves explicit columns, paired punctuation, spaces and dash runs", () => {
    const block = {
      ...batchChapter().pages[0].blocks[0],
      renderDirection: "vertical" as const,
      lineHeight: 1.2,
    };
    const lines = resolveFixedVerticalTextLines(
      block,
      "가!!\n나",
      20,
      100,
      200,
      DEFAULT_BLOCK_FONT_CATALOG,
    );
    expect(
      lines?.map((line) => line.runs.map((run) => run.text).join("")),
    ).toEqual(["가!!", "나"]);
    const { container } = render(
      <TextWithVerticalSpacing
        direction="vertical"
        text="가!! 나　—―"
        spacing={{ fontSizePx: 20, lineHeight: 1.2, letterSpacingEm: -0.1 }}
      />,
    );
    const cells = [
      ...container.querySelectorAll<HTMLElement>("[data-vertical-cell]"),
    ];
    expect(cells.map((cell) => parseFloat(cell.style.inlineSize))).toEqual([
      22, 22, 8, 22, 18, 44,
    ]);
    expect(
      container.querySelectorAll('[data-vertical-symbol="combine"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-vertical-presentation="dash"]'),
    ).toHaveLength(1);
  });
});
