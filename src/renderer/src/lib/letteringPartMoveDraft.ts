import type { Point, TranslationBlock } from "../../../shared/textTypes";
import { letteringPointToPage } from "../../../shared/generatedLetteringPartMove";

export type LetteringMoveDraft = { polygon: Point[]; offset: Point };

export function clampLetteringMove(
  draft: LetteringMoveDraft,
  offset: Point,
): LetteringMoveDraft {
  const xs = draft.polygon.map((p) => p.x),
    ys = draft.polygon.map((p) => p.y);
  return {
    ...draft,
    offset: {
      x: Math.max(-Math.min(...xs), Math.min(1000 - Math.max(...xs), offset.x)),
      y: Math.max(-Math.min(...ys), Math.min(1000 - Math.max(...ys), offset.y)),
    },
  };
}

export function isInsideLetteringMove(
  point: Point,
  draft: LetteringMoveDraft,
): boolean {
  const x = point.x - draft.offset.x,
    y = point.y - draft.offset.y;
  let inside = false;
  for (
    let i = 0, j = draft.polygon.length - 1;
    i < draft.polygon.length;
    j = i++
  ) {
    const a = draft.polygon[i],
      b = draft.polygon[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function projectLetteringMove(
  draft: LetteringMoveDraft,
  block: TranslationBlock,
  page: { width: number; height: number },
): string {
  return draft.polygon
    .flatMap((p, index) => {
      const next = draft.polygon[(index + 1) % draft.polygon.length];
      return Array.from({ length: 4 }, (_, step) => {
        const point = letteringPointToPage(
          {
            x: p.x + ((next.x - p.x) * step) / 4 + draft.offset.x,
            y: p.y + ((next.y - p.y) * step) / 4 + draft.offset.y,
          },
          block,
          page,
        );
        return `${point.x},${point.y}`;
      });
    })
    .join(" ");
}

export function extendLetteringSelection(
  points: Point[],
  point: Point,
  rectangle: boolean,
): Point[] {
  const first = points[0];
  if (!first) return [point];
  if (rectangle)
    return [
      first,
      { x: point.x, y: first.y },
      point,
      { x: first.x, y: point.y },
    ];
  const last = points[points.length - 1];
  if (Math.hypot(last.x - point.x, last.y - point.y) < 2) return points;
  // Keep the complete lasso, instead of dropping its tail when the limit is reached.
  const previous =
    points.length < 128 ? points : points.filter((_, i) => i % 2 === 0);
  return [...previous, point];
}
