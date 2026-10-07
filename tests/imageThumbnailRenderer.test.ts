import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import {
  createImageThumbnailRenderer,
  THUMBNAIL_RENDERER_DOCUMENT_URL,
} from "../src/main/imageThumbnailRenderer";

function fakeWindow(executeJavaScript: (script: string) => Promise<unknown>) {
  let destroyed = false;
  return {
    loadURL: vi.fn(async () => undefined),
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: () => destroyed,
    webContents: { executeJavaScript: vi.fn(executeJavaScript) },
  };
}
const original = "mgt-image://library/v1/example";

describe("isolated browser thumbnail lifetime", () => {
  it("reuses one renderer sequentially and releases it at terminal cleanup", async () => {
    const png = PNG.sync.write(new PNG({ width: 8, height: 12 }));
    let running = 0,
      peak = 0;
    const window = fakeWindow(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return "data:image/png;base64," + png.toString("base64");
    });
    const create = vi.fn(() => window);
    const render = createImageThumbnailRenderer(create, 1);
    const results = await Promise.all([
      render(original, 32),
      render(original, 32),
    ]);
    expect(results).toEqual([png, png]);
    expect(peak).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(window.loadURL).toHaveBeenCalledWith(
      THUMBNAIL_RENDERER_DOCUMENT_URL,
    );
    await render.close();
    expect(window.destroy).toHaveBeenCalledTimes(1);
    expect(await render(original, 32)).toBeNull();
  });

  it("keeps originals for small/animated results and destroys an unhealthy renderer", async () => {
    const window = fakeWindow(async () => null);
    const render = createImageThumbnailRenderer(() => window, 1);
    expect(await render(original, 32)).toBeNull();
    window.webContents.executeJavaScript.mockRejectedValueOnce(
      new Error("decode failed"),
    );
    expect(await render(original, 32)).toBeNull();
    expect(window.destroy).toHaveBeenCalledTimes(1);
    await render.close();
  });

  it("spreads concurrent rasters over parallel lanes, one raster per window", async () => {
    const png = PNG.sync.write(new PNG({ width: 8, height: 12 }));
    let running = 0,
      peak = 0;
    const windows: ReturnType<typeof fakeWindow>[] = [];
    const busy = new Map<unknown, number>();
    const create = vi.fn(() => {
      const window = fakeWindow(async () => {
        busy.set(window, (busy.get(window) ?? 0) + 1);
        expect(busy.get(window)).toBe(1);
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        busy.set(window, 0);
        return "data:image/png;base64," + png.toString("base64");
      });
      windows.push(window);
      return window;
    });
    const render = createImageThumbnailRenderer(create, 3);
    const results = await Promise.all(
      Array.from({ length: 7 }, () => render(original, 32)),
    );
    expect(results).toEqual(Array.from({ length: 7 }, () => png));
    expect(peak).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
    await render.close();
    for (const window of windows)
      expect(window.destroy).toHaveBeenCalledTimes(1);
  });
});
