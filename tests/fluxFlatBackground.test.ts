import { describe, expect, it } from "vitest";
import { restoreFluxFlatBackground } from "../src/main/inpainting/fluxFlatBackground";

function fixture(value = 255) {
  const width = 60,
    height = 60;
  const source = Buffer.alloc(width * height * 4, value);
  const generated = Buffer.alloc(source.length, 120);
  const constraint = {
    bounds: { x: 20, y: 20, w: 20, h: 20 },
    data: new Uint8Array(400).fill(1),
  };
  for (let i = 0; i < width * height; i++) source[i * 4 + 3] = 77;
  for (let y = 24; y < 36; y++)
    for (let x = 24; x < 36; x++) {
      for (let channel = 0; channel < 3; channel++)
        source[(y * width + x) * 4 + channel] = 255 - value;
    }
  return {
    source,
    generated,
    constraint,
    width,
    height,
    crop: { x: 0, y: 0, w: width, h: height },
  };
}

describe("FLUX flat background correction", () => {
  it.each([0, 255])(
    "restores uniform %i paper instead of generated clouds; keeps mask exterior and alpha",
    (value) => {
      const f = fixture(value),
        before = Buffer.from(f.source);
      restoreFluxFlatBackground(f);
      expect(f.source).toEqual(before);
      expect([
        ...f.generated.subarray((30 * 60 + 30) * 4, (30 * 60 + 30) * 4 + 4),
      ]).toEqual([value, value, value, 120]);
      expect(f.generated[0]).toBe(120);
    },
  );
  it("keeps textured, gradient, colored-edge and border-crossing regions with FLUX", () => {
    for (const channel of [0, 1, 2]) {
      const f = fixture();
      for (let y = 0; y < f.height; y++)
        for (let x = 0; x < f.width; x++)
          f.source[(y * f.width + x) * 4 + channel] = x % 2 ? 255 : 0;
      const before = Buffer.from(f.generated);
      restoreFluxFlatBackground(f);
      expect(f.generated).toEqual(before);
    }
    const f = fixture();
    f.constraint.bounds.x = 0;
    const before = Buffer.from(f.generated);
    restoreFluxFlatBackground(f);
    expect(f.generated).toEqual(before);
  });
  it("does not paint holes, adjacent art or outside a tile", () => {
    const f = fixture();
    f.constraint.data[10 * 20 + 10] = 0;
    f.source.fill(255, (30 * 60 + 30) * 4, (30 * 60 + 30) * 4 + 3);
    restoreFluxFlatBackground(f);
    expect(f.generated[(30 * 60 + 30) * 4]).toBe(120);
    const tile = fixture();
    tile.crop = { x: 25, y: 25, w: 10, h: 10 };
    tile.generated = Buffer.alloc(400, 120);
    restoreFluxFlatBackground(tile);
    expect(tile.generated.length).toBe(400);
    expect(tile.generated[0]).toBe(255);
  });
  it("does nothing without an explicit final constraint", () => {
    const f = fixture(),
      before = Buffer.from(f.generated);
    restoreFluxFlatBackground({ ...f, constraint: null });
    expect(f.generated).toEqual(before);
  });
});
