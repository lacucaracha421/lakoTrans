import { expect, it, vi } from "vitest";
import { createImageThumbnailResponse } from "../src/main/imageThumbnailResponse";

it("coalesces generation, returns independent bodies and keys source version/size", async () => {
  let finish!: (value: Buffer) => void;
  const render = vi.fn(
    () =>
      new Promise<Buffer>((resolve) => {
        finish = resolve;
      }),
  );
  const serve = createImageThumbnailResponse(render);
  const first = serve("signed-v1", 128);
  const second = serve("signed-v1", 128);
  expect(render).toHaveBeenCalledOnce();
  finish(Buffer.from("png"));
  expect(await (await first)?.text()).toBe("png");
  expect(await (await second)?.text()).toBe("png");
  expect(await (await serve("signed-v1", 128))?.text()).toBe("png");
  expect(render).toHaveBeenCalledOnce();
  render.mockImplementation(async () => Buffer.from("new"));
  await serve("signed-v2", 128);
  await serve("signed-v2", 256);
  expect(render).toHaveBeenCalledTimes(3);
});

it("bounds encoded cache bytes and entries and retries failed derivatives", async () => {
  const render = vi.fn(async () => Buffer.from("1234"));
  const serve = createImageThumbnailResponse(render, {
    maxBytes: 7,
    maxEntries: 2,
  });
  await serve("a", 64);
  await serve("b", 64);
  await serve("a", 64);
  expect(render).toHaveBeenCalledTimes(3);
  render.mockRejectedValueOnce(new Error("renderer exited"));
  await expect(serve("c", 64)).rejects.toThrow("renderer exited");
  expect((await serve("c", 64))?.headers.get("Content-Length")).toBe("4");
});

it("lets original-size or unsupported images fall back without caching a raster", async () => {
  const render = vi.fn(async () => null);
  expect(
    await createImageThumbnailResponse(render)("original", 256),
  ).toBeNull();
});
