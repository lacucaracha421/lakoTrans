import type { InpaintingWindowMask } from "./inpaintingEngine";
import { projectWindowMask } from "./bubbleLayoutConstraintMask";
import { expandRect, type PixelRect } from "./maskGeometry";
import { dilateBinaryMaskDisk } from "./patternMaskMorphology";
import { maskComponents } from "./rasterMasks";

type FlatBackgroundInput = {
  source: Buffer;
  generated: Buffer;
  constraint: InpaintingWindowMask | null;
  crop: PixelRect;
  width: number;
  height: number;
};

/**
 * A generator can invent a bubble on black paper or marks on white paper.
 * Only correct explicitly owned regions whose entire surrounding ring agrees
 * on a flat colour. Textured/edge-crossing regions keep the generated pixels.
 * The existing compositor still owns all page writes and feathering.
 */
export function restoreFluxFlatBackground(input: FlatBackgroundInput): void {
  const constraint = input.constraint;
  if (!constraint) return;
  for (const component of maskComponents(
    constraint.data,
    constraint.bounds.w,
    constraint.bounds.h,
    16,
  )) {
    const mask = {
      bounds: {
        ...component.rect,
        x: component.rect.x + constraint.bounds.x,
        y: component.rect.y + constraint.bounds.y,
      },
      data: component.data,
    };
    const color = surroundingFlatColor(input, mask, constraint);
    if (color) paintCandidate(input, mask, color);
  }
}

function surroundingFlatColor(
  input: FlatBackgroundInput,
  mask: InpaintingWindowMask,
  constraint: InpaintingWindowMask,
): number[] | null {
  const { bounds } = mask;
  if (
    bounds.x < 3 ||
    bounds.y < 3 ||
    bounds.x + bounds.w > input.width - 3 ||
    bounds.y + bounds.h > input.height - 3
  )
    return null;
  const expanded = expandRect(bounds, input.width, input.height, 3);
  const local = projectWindowMask(mask, expanded);
  const occupied = projectWindowMask(constraint, expanded);
  const ring = dilateBinaryMaskDisk(local, expanded.w, expanded.h, 3);
  const channels: number[][] = [[], [], []];
  for (let i = 0; i < ring.length; i++) {
    if (!ring[i] || occupied[i]) continue;
    const offset =
      ((expanded.y + Math.floor(i / expanded.w)) * input.width +
        expanded.x +
        (i % expanded.w)) *
      4;
    for (let c = 0; c < 3; c++) channels[c].push(input.source[offset + c]);
  }
  if (channels[0].length < 64) return null;
  const color = channels.map(
    (channel) => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)],
  );
  return channels.every((channel, c) => isFlatChannel(channel, color[c]))
    ? color
    : null;
}

function isFlatChannel(channel: number[], median: number): boolean {
  let squares = 0;
  for (const value of channel) {
    const delta = Math.abs(value - median);
    if (delta > 24) return false;
    squares += delta * delta;
  }
  return squares / channel.length <= 25;
}

function paintCandidate(
  input: FlatBackgroundInput,
  mask: InpaintingWindowMask,
  color: number[],
): void {
  for (let y = 0; y < mask.bounds.h; y++) {
    const cy = mask.bounds.y + y - input.crop.y;
    if (cy < 0 || cy >= input.crop.h) continue;
    for (let x = 0; x < mask.bounds.w; x++) {
      const cx = mask.bounds.x + x - input.crop.x;
      if (!mask.data[y * mask.bounds.w + x] || cx < 0 || cx >= input.crop.w)
        continue;
      const offset = (cy * input.crop.w + cx) * 4;
      for (let c = 0; c < 3; c++) input.generated[offset + c] = color[c];
    }
  }
}
