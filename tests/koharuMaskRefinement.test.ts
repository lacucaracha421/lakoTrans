import { describe, expect, it } from "vitest";
import {
  refineKoharuBubbleMask,
  resolveKoharuSafeInsetPx,
} from "../src/main/bubbleLayout/koharuMaskRefinement";
import type { KoharuInstanceMask } from "../src/main/bubbleLayout/contracts";

describe("Koharu bubble mask refinement", () => {
  it("does not shrink source erasure when the translated font or outline is enlarged", () => {
    const input = {
      mask: filledMask(80, 80, 1),
      imageWidth: 80,
      imageHeight: 80,
      bubbleBox: { x: 0, y: 0, w: 80, h: 80 },
      promptBoxes: [{ x: 25, y: 25, w: 30, h: 30 }],
      fontSizePx: 12,
      outlineWidthPx: 1,
      policy: "balanced" as const,
    };
    const render = refineKoharuBubbleMask(input);
    expect(render?.regions[0].bounds).toEqual({ x: 4, y: 4, w: 72, h: 72 });
    const erased = refineKoharuBubbleMask({ ...input, sourceEraseMask: true });
    expect(
      refineKoharuBubbleMask({
        ...input,
        fontSizePx: 90,
        outlineWidthPx: 10,
        sourceEraseMask: true,
      }),
    ).toEqual(erased);
    expect(refineKoharuBubbleMask(input)).toEqual(render);
  });
  it("fills enclosed source-ink holes only for erasure and preserves an exterior notch", () => {
    const mask = filledMask(80, 80, 1);
    for (let y = 36; y < 44; y += 1)
      for (let x = 36; x < 44; x += 1) mask.logits[y * 80 + x] = -1;
    for (let y = 0; y < 25; y += 1)
      for (let x = 12; x < 18; x += 1) mask.logits[y * 80 + x] = -1;
    const input = {
      mask,
      imageWidth: 80,
      imageHeight: 80,
      bubbleBox: { x: 0, y: 0, w: 80, h: 80 },
      promptBoxes: [{ x: 25, y: 25, w: 30, h: 30 }],
      fontSizePx: 12,
      outlineWidthPx: 1,
      policy: "balanced" as const,
    };
    const render = refineKoharuBubbleMask(input);
    const erased = refineKoharuBubbleMask({ ...input, sourceEraseMask: true });
    const contains = (result: typeof render, x: number, y: number) =>
      result?.regions.some(
        ({ bounds, width, mask: data }) =>
          x >= bounds.x &&
          x < bounds.x + bounds.w &&
          y >= bounds.y &&
          y < bounds.y + bounds.h &&
          data[(y - bounds.y) * width + x - bounds.x] === 1,
      );
    expect(contains(render, 40, 40)).toBe(false);
    expect(contains(erased, 40, 40)).toBe(true);
    expect(contains(erased, 15, 15)).toBe(false);
    expect(erased?.regions[0].bounds).toEqual({ x: 2, y: 2, w: 76, h: 76 });
    expect(refineKoharuBubbleMask(input)).toEqual(render);
    expect(mask.logits[40 * 80 + 40]).toBe(-1);
  });
  it("uses the Koharu instance mask as the only balloon geometry", () => {
    const result = refineKoharuBubbleMask({
      mask: filledMask(16, 16, 1),
      imageWidth: 64,
      imageHeight: 48,
      bubbleBox: { x: 4, y: 4, w: 56, h: 40 },
      promptBoxes: [{ x: 20, y: 16, w: 24, h: 16 }],
      fontSizePx: 8,
      outlineWidthPx: 2,
      policy: "maximize",
    });

    expect(result).not.toBeNull();
    expect(result?.promptCoverage).toBe(1);
    expect(result?.regions).toHaveLength(1);
    const bounds = result?.regions[0]?.bounds;
    expect(bounds?.x).toBeGreaterThan(4);
    expect(bounds?.y).toBeGreaterThan(4);
    expect((bounds?.x ?? 0) + (bounds?.w ?? 0)).toBeLessThan(60);
    expect((bounds?.y ?? 0) + (bounds?.h ?? 0)).toBeLessThan(44);
  });

  it("preserves the spatial boundary of a partial Koharu mask", () => {
    const logits = new Float32Array(8 * 8).fill(-1);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 4; x += 1) logits[y * 8 + x] = 1;
    }
    const result = refineKoharuBubbleMask({
      mask: { width: 8, height: 8, logits },
      imageWidth: 80,
      imageHeight: 80,
      bubbleBox: { x: 0, y: 0, w: 80, h: 80 },
      promptBoxes: [{ x: 10, y: 20, w: 20, h: 40 }],
      fontSizePx: 12,
      outlineWidthPx: 1,
      policy: "balanced",
    });

    expect(result).not.toBeNull();
    const bounds = result?.regions[0]?.bounds;
    expect((bounds?.x ?? 0) + (bounds?.w ?? 0)).toBeLessThanOrEqual(40);
  });

  it("returns no layout instead of falling back when the mask is empty", () => {
    expect(
      refineKoharuBubbleMask({
        mask: filledMask(8, 8, -1),
        imageWidth: 80,
        imageHeight: 80,
        bubbleBox: { x: 0, y: 0, w: 80, h: 80 },
        promptBoxes: [{ x: 20, y: 20, w: 40, h: 40 }],
        fontSizePx: 12,
        outlineWidthPx: 1,
        policy: "balanced",
      }),
    ).toBeNull();
  });

  it("rejects malformed instance-mask inventory", () => {
    expect(() =>
      refineKoharuBubbleMask({
        mask: { width: 8, height: 8, logits: new Float32Array(63) },
        imageWidth: 80,
        imageHeight: 80,
        bubbleBox: { x: 0, y: 0, w: 80, h: 80 },
        promptBoxes: [{ x: 20, y: 20, w: 40, h: 40 }],
        fontSizePx: 12,
        outlineWidthPx: 1,
        policy: "balanced",
      }),
    ).toThrow("KoharuLayout instance mask");
  });

  it("keeps the policy inset ordering explicit", () => {
    const input = { fontSizePx: 20, outlineWidthPx: 1 };
    expect(resolveKoharuSafeInsetPx({ ...input, policy: "safe" })).toBeCloseTo(
      4.32,
    );
    expect(
      resolveKoharuSafeInsetPx({ ...input, policy: "balanced" }),
    ).toBeCloseTo(3.6);
    expect(
      resolveKoharuSafeInsetPx({ ...input, policy: "maximize" }),
    ).toBeCloseTo(2.7);
  });
});

function filledMask(
  width: number,
  height: number,
  value: number,
): KoharuInstanceMask {
  return {
    width,
    height,
    logits: new Float32Array(width * height).fill(value),
  };
}
