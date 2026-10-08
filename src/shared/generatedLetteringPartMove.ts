import { z } from "zod";
import type { Point, TranslationBlock, WarpTransform } from "./textTypes";
import type { LetteringPartMove } from "./generatedLetteringMaskTypes";
import { mapPointToQuad } from "./perspectiveTransformMath";
import { createWarpEvaluator } from "./warpTransformMath";

const coordinate = z.number().finite().min(0).max(1000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
export const letteringSelectionSchema = z
  .array(point)
  .min(3)
  .max(128)
  .refine(
    (polygon) =>
      Math.abs(
        polygon.reduce((area, p, i) => {
          const next = polygon[(i + 1) % polygon.length];
          return area + p.x * next.y - next.x * p.y;
        }, 0),
      ) >= 2,
    "Select a nonempty part of the lettering inside the asset.",
  );
export const letteringPartMoveSchema = z
  .object({
    polygon: letteringSelectionSchema,
    offset: z
      .object({
        x: z.number().finite().min(-1000).max(1000),
        y: z.number().finite().min(-1000).max(1000),
      })
      .strict(),
    paintCount: z.number().int().min(0).max(500),
    maskCount: z.number().int().min(0).max(500),
  })
  .strict()
  .refine(
    ({ polygon, offset }) =>
      polygon.every(
        (p) =>
          p.x + offset.x >= 0 &&
          p.x + offset.x <= 1000 &&
          p.y + offset.y >= 0 &&
          p.y + offset.y <= 1000,
      ),
    "Move would clip the selected pixels outside the asset; use a smaller offset.",
  );

export function appendLetteringPartMove(
  artwork: NonNullable<TranslationBlock["generatedLettering"]>,
  polygon: Point[],
  offset: Point,
): NonNullable<TranslationBlock["generatedLettering"]> {
  if (offset.x === 0 && offset.y === 0) return artwork;
  if ((artwork.partMoves?.length ?? 0) >= 16)
    throw new Error("A generated asset supports at most 16 part moves.");
  const move: LetteringPartMove = letteringPartMoveSchema.parse({
    polygon,
    offset,
    paintCount: artwork.paintStrokes?.length ?? 0,
    maskCount:
      artwork.maskStrokes?.filter((s) => s.space === "asset").length ?? 0,
  });
  return { ...artwork, partMoves: [...(artwork.partMoves ?? []), move] };
}

const forwardWarps = new WeakMap<
  WarpTransform,
  ReturnType<typeof createWarpEvaluator>
>();

/** Pair with pagePointToLettering; use the same warp and perspective evaluators. */
export function letteringPointToPage(
  point: Point,
  block: TranslationBlock,
  page: { width: number; height: number },
): Point {
  let unit = { x: point.x / 1000, y: point.y / 1000 };
  if (block.warpTransform) {
    let evaluator = forwardWarps.get(block.warpTransform);
    if (!evaluator) {
      evaluator = createWarpEvaluator(block.warpTransform);
      forwardWarps.set(block.warpTransform, evaluator);
    }
    unit = evaluator.map(unit);
  }
  if (block.perspectiveTransform)
    unit = mapPointToQuad(unit, block.perspectiveTransform.corners);
  const box = block.renderBbox ?? block.bbox;
  const x = ((unit.x - 0.5) * box.w * page.width) / 1000;
  const y = ((unit.y - 0.5) * box.h * page.height) / 1000;
  const angle = ((block.rotationDeg ?? 0) * Math.PI) / 180;
  return {
    x:
      box.x +
      box.w / 2 +
      ((x * Math.cos(angle) - y * Math.sin(angle)) * 1000) / page.width,
    y:
      box.y +
      box.h / 2 +
      ((x * Math.sin(angle) + y * Math.cos(angle)) * 1000) / page.height,
  };
}
