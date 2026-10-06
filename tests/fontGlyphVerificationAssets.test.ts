import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFontGlyphVerificationAssets } from "../src/main/pipeline/fontGlyphVerificationAssets";

const download = vi.hoisted(() => vi.fn());
vi.mock("../src/main/runtimeSupport/modelDownloads", async (original) => ({
  ...(await original<
    typeof import("../src/main/runtimeSupport/modelDownloads")
  >()),
  ensureRemoteFile: download,
}));
beforeEach(() => {
  download.mockReset();
});
describe("managed glyph accelerator", () => {
  it("pins both weights and dictionary and forwards download progress", async () => {
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    const directory = await prepareFontGlyphVerificationAssets({
      dataRoot: "data",
      signal,
      onProgress,
    });
    expect(directory).toContain("font-glyph-ppocr-v02-r1");
    expect(download).toHaveBeenCalledTimes(2);
    for (const [task] of download.mock.calls) {
      expect(task).toMatchObject({
        signal,
        onProgress,
        progressPhase: "font_matching_downloading",
      });
      expect(task.url).toContain("/ba1d479e8a61a20e8318c9758c73fbbbd290b98d/");
      expect(task.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(task.minimumBytes).toBe(task.maximumBytes);
    }
  });
  it("retains ordinary Hayai when optional assets cannot be installed", async () => {
    download.mockRejectedValue(new Error("offline"));
    await expect(
      prepareFontGlyphVerificationAssets({
        dataRoot: "data",
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });
  it("propagates cancellation instead of proceeding with Hayai", async () => {
    const controller = new AbortController();
    download.mockImplementation(() => {
      controller.abort();
      throw new Error("download stopped");
    });
    await expect(
      prepareFontGlyphVerificationAssets({
        dataRoot: "data",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
