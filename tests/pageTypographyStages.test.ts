import { describe, expect, it, vi } from "vitest";

import * as pageImage from "../src/main/fontMatchingPageImage";
import { runPageTypographyStages } from "../src/main/pipeline/pageTypographyStages";

describe("page typography stages", () => {
  it("rejects a foreign page or an already cancelled consumer before starting a shared decode", async () => {
    const decode = vi.fn();
    const cancelled = new AbortController();
    cancelled.abort(new Error("consumer cancelled"));
    const runFontMatching = vi.fn(
      async (options: Parameters<typeof runPageTypographyStages>[0]) => {
        if (!options.loadRaster)
          throw new Error("Missing shared raster provider.");
        await expect(options.loadRaster({ ...options.page })).rejects.toThrow(
          "Typography raster page mismatch.",
        );
        await expect(
          options.loadRaster(options.page, cancelled.signal),
        ).rejects.toThrow("consumer cancelled");
        return { pixelInferenceByBlockId: new Map() };
      },
    );
    await runPageTypographyStages(
      {
        page: { id: "guard-page" },
        jobId: "guard-job",
        items: [],
        pageOptions: { autoFontMatching: true, aiFontSizeMatching: false },
      } as never,
      {
        runFontMatching,
        estimateSourceFontSizes: vi.fn(async () => []),
        loadRaster: decode,
        logInfo: vi.fn(),
      },
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it("uses the default decoder with parent cancellation ownership when one waiting consumer cancels", async () => {
    const parent = new AbortController(),
      consumer = new AbortController();
    const pixels = {
      width: 1,
      height: 1,
      bgra: Uint8Array.from([1, 2, 3, 255]),
    };
    const pending = deferred<typeof pixels>();
    const decode = vi
      .spyOn(pageImage, "loadFontMatchingPageRaster")
      .mockReturnValue(pending.promise);
    const page = { id: "shared-cancel-page" } as never;
    const runFontMatching = vi.fn(
      async (options: Parameters<typeof runPageTypographyStages>[0]) => {
        if (!options.loadRaster)
          throw new Error("Missing shared raster provider.");
        await expect(
          options.loadRaster(options.page, consumer.signal),
        ).rejects.toThrow("font consumer cancelled");
        return { pixelInferenceByBlockId: new Map() };
      },
    );
    const estimateSourceFontSizes = vi.fn(
      async (
        options: Parameters<
          NonNullable<
            Parameters<typeof runPageTypographyStages>[1]
          >["estimateSourceFontSizes"]
        >[0],
      ) => {
        if (!options.loadRaster)
          throw new Error("Missing shared raster provider.");
        const raster = options.loadRaster(options.page, parent.signal);
        consumer.abort(new Error("font consumer cancelled"));
        pending.resolve(pixels);
        expect(await raster).toBe(pixels);
        return [];
      },
    );
    try {
      await runPageTypographyStages(
        {
          page,
          jobId: "cancel-job",
          items: [],
          pageOptions: {
            autoFontMatching: true,
            aiFontSizeMatching: true,
            abortSignal: parent.signal,
          },
        } as never,
        { runFontMatching, estimateSourceFontSizes, logInfo: vi.fn() },
      );
      expect(decode).toHaveBeenCalledExactlyOnceWith(page, parent.signal);
      expect(parent.signal.aborted).toBe(false);
    } finally {
      decode.mockRestore();
    }
  });

  it("decodes once per stage call and shares exact pixels without serializing consumers", async () => {
    const page = { id: "same-page" } as never;
    const pixels = {
      width: 1,
      height: 1,
      bgra: Uint8Array.from([1, 2, 3, 255]),
    };
    const decode = vi.fn(async () => pixels);
    const gate = deferred<void>();
    let sizePixels: unknown;
    const runFontMatching = vi.fn(
      async (options: Parameters<typeof runPageTypographyStages>[0]) => {
        if (!options.loadRaster)
          throw new Error("Expected shared raster provider.");
        const raster = await options.loadRaster(options.page);
        await gate.promise;
        expect(raster.bgra).toEqual(pixels.bgra);
        return { pixelInferenceByBlockId: new Map() };
      },
    );
    const estimateSourceFontSizes = vi.fn(
      async (
        options: Parameters<
          NonNullable<
            Parameters<typeof runPageTypographyStages>[1]
          >["estimateSourceFontSizes"]
        >[0],
      ) => {
        if (!options.loadRaster)
          throw new Error("Expected shared raster provider.");
        sizePixels = await options.loadRaster(options.page);
        gate.resolve();
        return [];
      },
    );
    const options = {
      page,
      jobId: "job",
      items: [{}],
      pageOptions: { autoFontMatching: true, aiFontSizeMatching: true },
    } as never;
    const dependencies = {
      runFontMatching,
      estimateSourceFontSizes,
      loadRaster: decode,
      logInfo: vi.fn(),
    };
    await runPageTypographyStages(options, dependencies);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(sizePixels).toBe(pixels);
    await runPageTypographyStages(options, dependencies);
    expect(decode).toHaveBeenCalledTimes(2); // no cross-job/path cache
  });

  it("overlaps independent pixel-font and source-size inference without changing either result", async () => {
    const font = deferred<{ pixelInferenceByBlockId: Map<string, never> }>();
    const size = deferred<readonly [undefined]>();
    const fontMatching = vi.fn(() => font.promise);
    const fontSize = vi.fn(() => size.promise);
    const logInfo = vi.fn();

    const pending = runPageTypographyStages(
      {
        jobId: "job-parallel-typography",
        page: { id: "page-1" },
        pageOptions: {
          autoFontMatching: true,
          aiFontSizeMatching: true,
          keepBlocksMode: false,
        },
        items: [{}],
      } as never,
      {
        runFontMatching: fontMatching,
        estimateSourceFontSizes: fontSize,
        logInfo,
      } as never,
    );

    expect(fontMatching).toHaveBeenCalledTimes(1);
    expect(fontSize).toHaveBeenCalledTimes(1);
    const fontResult = { pixelInferenceByBlockId: new Map<string, never>() };
    const sizeResult = [undefined] as const;
    font.resolve(fontResult);
    size.resolve(sizeResult);

    await expect(pending).resolves.toEqual({
      pixelInference: fontResult,
      sourceFontSizeEstimates: sizeResult,
    });
    expect(logInfo).toHaveBeenCalledWith(
      "Page typography stages completed",
      expect.objectContaining({
        jobId: "job-parallel-typography",
        pageId: "page-1",
        itemCount: 1,
      }),
    );
  });

  it("does not emit timing diagnostics when both automatic stages are disabled", async () => {
    const logInfo = vi.fn();
    const fontResult = { pixelInferenceByBlockId: new Map<string, never>() };
    const sizeResult = [undefined] as const;

    await expect(
      runPageTypographyStages(
        {
          jobId: "job-disabled-typography",
          page: { id: "page-2" },
          pageOptions: {
            autoFontMatching: false,
            aiFontSizeMatching: false,
            keepBlocksMode: false,
          },
          items: [{}],
        } as never,
        {
          runFontMatching: vi.fn(async () => fontResult),
          estimateSourceFontSizes: vi.fn(async () => sizeResult),
          logInfo,
        } as never,
      ),
    ).resolves.toEqual({
      pixelInference: fontResult,
      sourceFontSizeEstimates: sizeResult,
    });
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("measures source font sizes when automatic fitting is enabled for kept blocks", async () => {
    const estimateSourceFontSizes = vi.fn(async () => [
      { confidence: 0.91, facePx: 28, method: "raster-core-v1" as const },
    ]);

    await runPageTypographyStages(
      {
        jobId: "job-keep-typography",
        page: { id: "page-keep" },
        pageOptions: {
          autoFontMatching: false,
          fontSizeAutoFit: true,
          keepBlocksMode: true,
        },
        items: [{}],
      } as never,
      {
        runFontMatching: vi.fn(async () => ({
          pixelInferenceByBlockId: new Map<string, never>(),
        })),
        estimateSourceFontSizes,
        logInfo: vi.fn(),
      } as never,
    );

    expect(estimateSourceFontSizes).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("reads the legacy font-size setting when the AI matching setting is absent", async () => {
    const estimateSourceFontSizes = vi.fn(async () => [undefined] as const);

    await runPageTypographyStages(
      {
        jobId: "job-legacy-size-setting",
        page: { id: "page-legacy" },
        pageOptions: {
          autoFontMatching: false,
          fontSizeAutoFit: true,
          keepBlocksMode: false,
        },
        items: [{}],
      } as never,
      {
        runFontMatching: vi.fn(async () => ({
          pixelInferenceByBlockId: new Map<string, never>(),
        })),
        estimateSourceFontSizes,
        logInfo: vi.fn(),
      } as never,
    );

    expect(estimateSourceFontSizes).toHaveBeenCalledOnce();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
