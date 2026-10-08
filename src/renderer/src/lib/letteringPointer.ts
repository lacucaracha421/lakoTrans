import type React from "react";
import type { Point } from "../../../shared/textTypes";

export function letteringEventPagePoint(
  event: React.PointerEvent<SVGSVGElement>,
): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000),
    ),
    y: Math.max(
      0,
      Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000),
    ),
  };
}
