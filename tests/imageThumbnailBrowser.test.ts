import { runInNewContext } from "node:vm";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import {
  buildImageThumbnailScript,
  thumbnailWebpAllowed,
} from "../src/main/imageThumbnailBrowser";

function pngHeader(width = 3001, height = 4003, extra?: string): Buffer {
  const png = PNG.sync.write(new PNG({ width: 2, height: 3 }));
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  if (!extra) return png;
  const chunk = Buffer.alloc(12);
  chunk.write(extra, 4, "ascii");
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}
function jpegHeader(width = 600, height = 400, icc = false): Buffer {
  const frame = Buffer.from([8, 0, 0, 0, 0, 0]);
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(icc
      ? [jpegSegment(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01", "ascii"))]
      : []),
    jpegSegment(0xc0, frame),
    Buffer.from([0xff, 0xda]),
  ]);
}
function webpHeader(
  chunk: "VP8 " | "VP8L" | "VP8X",
  width = 3001,
  height = 4003,
  flags = 0,
): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write(chunk, 12, "ascii");
  if (chunk === "VP8 ") {
    bytes.set([0x9d, 0x01, 0x2a], 23);
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
  } else if (chunk === "VP8L") {
    bytes[20] = 0x2f;
    bytes.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  } else {
    bytes[20] = flags;
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
  }
  return bytes;
}
function browserFixture(
  bytes: Buffer,
  mime: string,
  width = 3001,
  height = 4003,
) {
  const decode = vi.fn(async () => undefined),
    drawImage = vi.fn();
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => "data:image/png;base64,RESULT"),
  };
  const createObjectURL = vi.fn(() => "blob:thumbnail-test"),
    revokeObjectURL = vi.fn();
  const fetch = vi.fn(
    async () =>
      new Response(Uint8Array.from(bytes), {
        headers: { "content-type": mime },
      }),
  );
  class ImageFixture {
    src = "";
    naturalWidth = width;
    naturalHeight = height;
    decode = decode;
  }
  const globals = {
    fetch,
    Uint8Array,
    DataView,
    Image: ImageFixture,
    URL: { createObjectURL, revokeObjectURL },
    document: { createElement: () => canvas },
  };
  return {
    globals,
    decode,
    canvas,
    context,
    createObjectURL,
    revokeObjectURL,
    fetch,
  };
}
async function execute(bytes: Buffer, mime: string) {
  const fixture = browserFixture(bytes, mime);
  const result: unknown = await runInNewContext(
    buildImageThumbnailScript("mgt-image://library/v1/test", 512),
    fixture.globals,
  );
  return { ...fixture, result };
}

describe("serialized browser thumbnail guards", () => {
  it.each(["acTL", "cICP", "cHRM"])(
    "retains PNG %s originals before allocating a raster",
    async (chunk) => {
      const fixture = await execute(pngHeader(3001, 4003, chunk), "image/png");
      expect(fixture.result).toBeNull();
      expect(fixture.decode).not.toHaveBeenCalled();
      expect(fixture.createObjectURL).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["PNG above32M", pngHeader(8001, 4000), "image/png"],
    ["PNG zero dimension", pngHeader(0, 4000), "image/png"],
    ["PNG incomplete header", pngHeader().subarray(0, 32), "image/png"],
    ["JPEG above32M", jpegHeader(8001, 4000), "image/jpeg"],
    ["JPEG absent frame", Buffer.from([0xff, 0xd8, 0xff, 0xda]), "image/jpeg"],
    ["JPEG truncated segment", jpegHeader().subarray(0, 8), "image/jpeg"],
    ["WebP unknown header", Buffer.alloc(16), "image/webp"],
    ["WebP animated", webpHeader("VP8X", 3001, 4003, 0x02), "image/webp"],
    ["WebP above32M", webpHeader("VP8X", 8001, 4000), "image/webp"],
    ["WebP lossless above32M", webpHeader("VP8L", 8001, 4000), "image/webp"],
  ])("keeps %s original", async (_name, bytes, mime) => {
    const fixture = await execute(bytes, mime);
    expect(fixture.result).toBeNull();
    expect(fixture.decode).not.toHaveBeenCalled();
  });
  it.each([
    [pngHeader(8000, 4000), "image/png"],
    [jpegHeader(8000, 4000), "image/jpeg"],
    [pngHeader(8000, 4000, "iCCP"), "image/png"],
    [jpegHeader(8000, 4000, true), "image/jpeg"],
    [webpHeader("VP8 ", 8000, 4000), "image/webp"],
    [webpHeader("VP8L", 8000, 4000), "image/webp"],
    [webpHeader("VP8X", 8000, 4000, 0x30), "image/webp"],
  ])(
    "accepts a header at the exact32M boundary and runs the complete isolated script",
    async (bytes, mime) => {
      const fixture = await execute(bytes, mime);
      expect(fixture.result).toBe("data:image/png;base64,RESULT");
      expect(fixture.decode).toHaveBeenCalledTimes(1);
      expect(fixture.context.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        0,
        0,
        384,
        512,
      );
      expect(fixture.context.imageSmoothingQuality).toBe("high");
      expect(fixture.canvas.getContext).toHaveBeenCalledWith("2d", {
        alpha: true,
      });
      expect(fixture.canvas.width).toBe(0);
      expect(fixture.canvas.height).toBe(0);
      expect(fixture.revokeObjectURL).toHaveBeenCalledWith(
        "blob:thumbnail-test",
      );
    },
  );
  it("retains a small source and cleans up a failed decoder", async () => {
    const small = browserFixture(pngHeader(16, 20), "image/png", 16, 20);
    expect(
      await runInNewContext(
        buildImageThumbnailScript("mgt-image://library/v1/test", 128),
        small.globals,
      ),
    ).toBeNull();
    expect(small.context.drawImage).not.toHaveBeenCalled();
    expect(small.revokeObjectURL).toHaveBeenCalledTimes(1);
    const failed = browserFixture(pngHeader(), "image/png");
    failed.decode.mockRejectedValueOnce(new Error("decoder failure"));
    await expect(
      runInNewContext(
        buildImageThumbnailScript("mgt-image://library/v1/test", 128),
        failed.globals,
      ),
    ).rejects.toThrow("decoder failure");
    expect(failed.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(failed.canvas.width).toBe(0);
  });
  it("serializes the URL as inert data with no ambient lexical dependencies", async () => {
    const fixture = browserFixture(pngHeader(), "image/png");
    const url = 'mgt-image://library/v1/a";globalThis.injected=true;//';
    await runInNewContext(buildImageThumbnailScript(url, 128), fixture.globals);
    expect(fixture.fetch).toHaveBeenCalledWith(url, {
      redirect: "error",
      credentials: "omit",
    });
    expect(fixture.globals).not.toHaveProperty("injected");
  });
});

describe("WebP thumbnail header guard", () => {
  it.each([
    ["lossy", webpHeader("VP8 "), true],
    ["lossless", webpHeader("VP8L"), true],
    ["extended with ICC and alpha", webpHeader("VP8X", 3001, 4003, 0x30), true],
    ["exact32M lossless", webpHeader("VP8L", 8000, 4000), true],
    ["animated", webpHeader("VP8X", 3001, 4003, 0x02), false],
    ["above32M extended", webpHeader("VP8X", 8001, 4000), false],
    ["above32M lossless", webpHeader("VP8L", 8001, 4000), false],
    ["zero-size lossy", webpHeader("VP8 ", 0, 4003), false],
    ["truncated", webpHeader("VP8 ").subarray(0, 29), false],
    [
      "not RIFF",
      Buffer.concat([Buffer.from("RIFX"), webpHeader("VP8 ").subarray(4)]),
      false,
    ],
  ])("%s", (_name, bytes, expected) => {
    expect(thumbnailWebpAllowed(Uint8Array.from(bytes))).toBe(expected);
  });

  it("rejects a bad lossy start code, lossless signature or unknown chunk", () => {
    const lossy = webpHeader("VP8 ");
    lossy[23] = 0;
    const lossless = webpHeader("VP8L");
    lossless[20] = 0;
    const unknown = webpHeader("VP8 ");
    unknown.write("ALPH", 12, "ascii");
    for (const bytes of [lossy, lossless, unknown]) {
      expect(thumbnailWebpAllowed(Uint8Array.from(bytes))).toBe(false);
    }
  });
});
