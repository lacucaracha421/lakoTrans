import { describe, expect, it } from "vitest";
import {
  appendLetteringPartMove,
  letteringPartMoveSchema,
  letteringPointToPage,
} from "../src/shared/generatedLetteringPartMove";
import { pagePointToLettering } from "../src/shared/generatedLetteringMask";
import { generatedLettering } from "../src/shared/blockFormatValueSchemas";
import { relocateGeneratedLettering } from "../src/shared/generatedLettering";
import { createWarpPreset } from "../src/shared/warpTransformMath";
import { createPerspectivePreset } from "../src/shared/blockTransformPresets";
import {
  detailedQualityFixture,
  generatedFixturePng,
} from "./mcpDetailedQuality.fixture";

const polygon = [
  { x: 100, y: 100 },
  { x: 350, y: 100 },
  { x: 300, y: 350 },
  { x: 100, y: 300 },
];
function fixture() {
  const f = detailedQualityFixture();
  f.block.generatedLettering = {
    version: 1,
    sourceText: f.block.sourceText,
    translatedText: f.block.translatedText,
    dataUrl: generatedFixturePng(),
  };
  return { ...f, artwork: f.block.generatedLettering };
}
describe("native non-destructive lettering part moves", () => {
  it("cuts composed brush prefixes, preserves the PNG and survives portable copies", () => {
    const { artwork } = fixture();
    const painted = {
      ...artwork,
      paintStrokes: [
        {
          color: "#000000",
          shape: "circle" as const,
          radiusX: 5,
          radiusY: 5,
          softness: 0,
          points: [{ x: 150, y: 150 }],
        },
      ],
      maskStrokes: [
        {
          space: "asset" as const,
          mode: "hide" as const,
          shape: "circle" as const,
          radiusX: 2,
          radiusY: 2,
          softness: 0,
          points: [{ x: 110, y: 110 }],
        },
      ],
    };
    const moved = appendLetteringPartMove(painted, polygon, { x: 100, y: 200 });
    expect(moved.dataUrl).toBe(artwork.dataUrl);
    expect(moved.partMoves?.[0]).toMatchObject({ paintCount: 1, maskCount: 1 });
    expect(generatedLettering.parse(moved)).toEqual(moved);
    const copy = relocateGeneratedLettering(
      moved,
      { x: 0, y: 0, w: 500, h: 500 },
      { x: 100, y: 200, w: 300, h: 400 },
    );
    expect(copy?.partMoves).toEqual(moved.partMoves);
    expect(copy?.partMoves).not.toBe(moved.partMoves);
    expect(appendLetteringPartMove(artwork, polygon, { x: 0, y: 0 })).toBe(
      artwork,
    );
  });
  it("rejects clipping, nonfinite/empty selections, out-of-order history and excessive moves", () => {
    const { artwork } = fixture();
    const moved = appendLetteringPartMove(artwork, polygon, { x: 100, y: 0 });
    const move = moved.partMoves?.[0];
    if (!move) throw new Error("Missing move");
    expect(() =>
      appendLetteringPartMove(artwork, polygon, { x: 800, y: 0 }),
    ).toThrow(/clip/);
    expect(() =>
      appendLetteringPartMove(artwork, [{ x: 0, y: 0 }], { x: 1, y: 1 }),
    ).toThrow();
    expect(
      letteringPartMoveSchema.safeParse({
        ...move,
        offset: { x: NaN, y: 0 },
      }).success,
    ).toBe(false);
    expect(
      generatedLettering.safeParse({
        ...moved,
        partMoves: [{ ...move, paintCount: 1 }],
      }).success,
    ).toBe(false);
    expect(
      generatedLettering.safeParse({
        ...moved,
        partMoves: [{ ...move, maskCount: 1 }],
      }).success,
    ).toBe(false);
    const stroke = {
      shape: "circle",
      radiusX: 2,
      radiusY: 2,
      softness: 0,
      points: [{ x: 100, y: 100 }],
    };
    const history = {
      ...moved,
      paintStrokes: [{ ...stroke, color: "#000000" }],
      maskStrokes: [
        { ...stroke, space: "asset", mode: "hide" },
        { ...stroke, space: "page", mode: "hide" },
      ],
      partMoves: [{ ...move, paintCount: 1, maskCount: 1 }, move],
    };
    expect(generatedLettering.safeParse(history).success).toBe(false);
    expect(
      generatedLettering.safeParse({
        ...history,
        partMoves: [
          history.partMoves[0],
          { ...move, paintCount: 1, maskCount: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      appendLetteringPartMove(
        { ...artwork, partMoves: Array(16).fill(move) },
        polygon,
        { x: 1, y: 0 },
      ),
    ).toThrow(/16/);
  });
  it("characterizes the forward/inverse anchor through rotation, perspective and the existing warp", () => {
    const { block, page } = fixture();
    block.renderBbox = { x: 100, y: 150, w: 550, h: 500 };
    block.rotationDeg = 23;
    block.perspectiveTransform = createPerspectivePreset("topNarrow");
    block.warpTransform = createWarpPreset("archUp", 5);
    for (const point of [
      { x: 120, y: 240 },
      { x: 760, y: 710 },
      { x: 500, y: 500 },
    ]) {
      const result = pagePointToLettering(
        letteringPointToPage(point, block, page),
        block,
        page,
      );
      expect(result.x).toBeCloseTo(point.x, 0);
      expect(result.y).toBeCloseTo(point.y, 0);
    }
  });
});
