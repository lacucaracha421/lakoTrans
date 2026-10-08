import { PNG } from "pngjs";
import { expect, it } from "vitest";
import {
  composeExternalBackgroundRaster,
  composeExternalLetteringRaster,
} from "../src/main/mcp/mcpExternalImageRaster";
import { imageNativeBoundary } from "./mcpImageNative.fixture";

const cases = [
  {
    name: "whole image",
    selected: [0, 1, 2, 3],
    selection: undefined,
    protected: undefined,
  },
  {
    name: "whole image with protection",
    selected: [0, 1, 3],
    selection: undefined,
    protected: [0, 0, 1, 0],
  },
  {
    name: "explicit selection",
    selected: [0, 2],
    selection: [1, 0, 1, 0],
    protected: undefined,
  },
  {
    name: "explicit selection with protection",
    selected: [0],
    selection: [1, 0, 1, 0],
    protected: [0, 0, 1, 0],
  },
  {
    name: "empty selection",
    selected: [],
    selection: [0, 0, 0, 0],
    protected: undefined,
  },
  {
    name: "empty selection with protection",
    selected: [],
    selection: [0, 0, 0, 0],
    protected: [0, 0, 1, 0],
  },
];
it("patches a malformed syllable in asset coordinates, preserving exact outside and protected RGBA", () => {
  const base = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < base.data.length; i++) base.data[i] = i;
  const incoming = makePng(true);
  const before = Buffer.from(base.data);
  const result = composeExternalLetteringRaster({
    image: PNG.sync.write(incoming),
    width: 2,
    height: 2,
    protectedMask: mask([0, 1, 0, 0]),
    letteringPatch: {
      base: PNG.sync.write(base),
      rect: { x: 1, y: 1, w: 2, h: 2 },
    },
  });
  const after = PNG.sync.read(Buffer.from(result.bytes));
  expect([after.width, after.height]).toEqual([4, 4]);
  for (let index = 0; index < 16; index++) {
    const source = new Map([
      [5, 0],
      [9, 2],
      [10, 3],
    ]).get(index);
    expect(after.data.subarray(index * 4, index * 4 + 4)).toEqual(
      source === undefined
        ? before.subarray(index * 4, index * 4 + 4)
        : incoming.data.subarray(source * 4, source * 4 + 4),
    );
  }
  for (const x of [-1, 3])
    expect(() =>
      composeExternalLetteringRaster({
        image: PNG.sync.write(incoming),
        width: 2,
        height: 2,
        letteringPatch: {
          base: PNG.sync.write(base),
          rect: { x, y: 1, w: 2, h: 2 },
        },
      }),
    ).toThrow();
});
it("rejects truncated or oversized base assets before allocating a lettering patch", () => {
  const input = { image: PNG.sync.write(makePng(true)), width: 2, height: 2 };
  const oversized = Buffer.alloc(24);
  oversized.writeUInt32BE(100_000, 16);
  oversized.writeUInt32BE(100_000, 20);
  for (const base of [Buffer.alloc(8), oversized])
    expect(() =>
      composeExternalLetteringRaster({
        ...input,
        letteringPatch: { base, rect: { x: 0, y: 0, w: 2, h: 2 } },
      }),
    ).toThrow();
});
function makePng(alpha: boolean) {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    211,
    31,
    47,
    255,
    19,
    193,
    73,
    alpha ? 93 : 255,
    29,
    59,
    181,
    255,
    233,
    211,
    83,
    alpha ? 0 : 255,
  ]);
  return png;
}
function mask(values?: number[]) {
  if (!values) return undefined;
  const png = new PNG({ width: 2, height: 2 });
  values.forEach((value, index) => {
    png.data.fill(value ? 255 : 0, index * 4, index * 4 + 3);
    png.data[index * 4 + 3] = 255;
  });
  return PNG.sync.write(png);
}
function input(test: (typeof cases)[number], alpha: boolean) {
  const png = makePng(alpha);
  return {
    png,
    assets: {
      image: PNG.sync.write(png),
      width: 2,
      height: 2,
      mask: mask(test.selection),
      protectedMask: mask(test.protected),
    },
  };
}

it.each(cases)(
  "preserves exact lettering PNG pixels/bytes and counts for $name",
  (test) => {
    const { png, assets } = input(test, true);
    const expected = new PNG({ width: 2, height: 2 });
    expected.data.fill(0);
    for (const pixel of test.selected)
      png.data.copy(expected.data, pixel * 4, pixel * 4, pixel * 4 + 4);
    const result = composeExternalLetteringRaster(assets);
    expect(Buffer.from(result.bytes)).toEqual(PNG.sync.write(expected));
    expect(PNG.sync.read(Buffer.from(result.bytes)).data).toEqual(
      expected.data,
    );
    expect([...result.mask]).toEqual(
      [0, 1, 2, 3].map((pixel) => Number(test.selected.includes(pixel))),
    );
    expect(result).toMatchObject({
      width: 2,
      height: 2,
      changedPixels: 0,
      selectedPixels: test.selected.length,
      protectedPixels: test.protected ? 1 : 0,
    });
  },
);

it.each(cases)(
  "preserves untouched native channels/alpha and exact patch counts for $name",
  (test) => {
    const { assets } = input(test, false);
    const base = new PNG({ width: 3, height: 3 });
    for (let offset = 0; offset < base.data.length; offset++)
      base.data[offset] = offset + 11;
    const before = imageNativeBoundary
      .createFromBuffer(PNG.sync.write(base))
      .toBitmap();
    const pixels = imageNativeBoundary
      .createFromBuffer(assets.image)
      .toBitmap();
    const expected = Buffer.from(before);
    const targets = [4, 5, 7, 8];
    for (const pixel of test.selected)
      pixels.copy(expected, targets[pixel] * 4, pixel * 4, pixel * 4 + 4);
    const result = composeExternalBackgroundRaster({
      ...assets,
      before,
      pixels,
      pageWidth: 3,
      pageHeight: 3,
      rect: { x: 1, y: 1, w: 2, h: 2 },
    });
    expect(Buffer.from(result.bitmap)).toEqual(expected);
    expect([...result.mask]).toEqual(
      Array.from({ length: 9 }, (_, pixel) =>
        Number(test.selected.some((source) => targets[source] === pixel)),
      ),
    );
    expect(result).toMatchObject({
      width: 3,
      height: 3,
      changedPixels: test.selected.length,
      selectedPixels: test.selected.length,
      protectedPixels: test.protected ? 1 : 0,
    });
    expect(before).toEqual(
      imageNativeBoundary.createFromBuffer(PNG.sync.write(base)).toBitmap(),
    );
  },
);

it("rejects selected transparent background pixels with the existing error", () => {
  const { assets } = input(cases[0], true);
  expect(() =>
    composeExternalBackgroundRaster({
      ...assets,
      before: Buffer.alloc(3 * 3 * 4),
      pixels: imageNativeBoundary.createFromBuffer(assets.image).toBitmap(),
      pageWidth: 3,
      pageHeight: 3,
      rect: { x: 1, y: 1, w: 2, h: 2 },
    }),
  ).toThrow(
    expect.objectContaining({
      code: "invalid_edit",
      message:
        "Selected background pixels must be opaque. Transparent lettering belongs in a lettering layer.",
    }),
  );
});

it("allows unselected transparent background pixels while retaining the entire unselected bitmap", () => {
  const { assets } = input(cases[2], true);
  const before = Buffer.alloc(3 * 3 * 4, 77);
  const result = composeExternalBackgroundRaster({
    ...assets,
    before,
    pixels: imageNativeBoundary.createFromBuffer(assets.image).toBitmap(),
    pageWidth: 3,
    pageHeight: 3,
    rect: { x: 1, y: 1, w: 2, h: 2 },
  });
  expect(Buffer.from(result.bitmap).subarray(20, 24)).toEqual(
    Buffer.alloc(4, 77),
  );
  expect(Buffer.from(result.bitmap).subarray(32, 36)).toEqual(
    Buffer.alloc(4, 77),
  );
  expect(result.changedPixels).toBe(2);
});
