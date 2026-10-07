import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { expect, it, vi } from "vitest";
import { readingEditProtection } from "../src/main/regionEditProtection";
import { sourceRegionCrops } from "../src/main/pipeline/codexTypesettingRaster";
import { flattenImageRedaction } from "../src/main/imageRedactionPixels";
import { normalizedRegionToPixelRect } from "../src/shared/region";
import { codexSourceContextRect } from "../src/shared/codexTypesettingMask";
import type { MangaPage } from "../src/shared/libraryTypes";
import type { CodexPageReading } from "../src/shared/codexTypesettingTypes";

vi.mock("electron", async () => ({
  nativeImage: (await import("./mcpImageNative.fixture")).imageNativeBoundary,
}));

it.each([false, true])(
  "preserves every protected crop pixel (context=%s)",
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "crop-efficiency-"));
    try {
      const width = 120,
        height = 160;
      const image = new PNG({ width, height });
      const protection = new PNG({ width, height });
      protection.data.fill(255);
      for (let i = 0; i < width * height; i++) {
        image.data.set([i % 251, i % 167, i % 113, 255], i * 4);
        if (i % 7 === 0) protection.data[i * 4 + 3] = 254;
      }
      const imagePath = join(root, "source.png");
      await writeFile(imagePath, PNG.sync.write(image));
      const page: MangaPage = {
        id: "p",
        name: "p",
        imagePath,
        width,
        height,
        dataUrl: "",
        blocks: [],
        analysisStatus: "idle",
        createdAt: "",
        updatedAt: "",
      };
      const region = {
        id: "r",
        action: "text" as const,
        sourceText: "字",
        translatedText: "글",
        sourceBbox: { x: 100, y: 200, w: 150, h: 100 },
        renderBbox: { x: 100, y: 200, w: 150, h: 100 },
        role: "ordinary" as const,
        direction: "horizontal" as const,
        background: "white" as const,
        reason: "",
      };
      const reading: CodexPageReading = {
        summary: "",
        regions: [
          region,
          {
            ...region,
            id: "kept",
            action: "keep",
            sourceBbox: { x: 230, y: 210, w: 200, h: 200 },
          },
        ],
        editProtection: {
          strokes: [],
          maskDataUrl: `data:image/png;base64,${PNG.sync.write(protection).toString("base64")}`,
        },
      };
      const rect = context
        ? codexSourceContextRect(region, page)
        : normalizedRegionToPixelRect(region.sourceBbox, page);
      const fullMask = readingEditProtection(reading, page, region.id);
      const croppedMask = readingEditProtection(reading, page, region.id, rect);
      if (!fullMask || !croppedMask)
        throw new Error("Expected protection masks");
      for (let y = 0; y < rect.h; y++)
        expect(croppedMask.subarray(y * rect.w, (y + 1) * rect.w)).toEqual(
          fullMask.subarray(
            (y + rect.y) * width + rect.x,
            (y + rect.y) * width + rect.x + rect.w,
          ),
        );
      const legacy = new PNG({ width, height });
      legacy.data = flattenImageRedaction(image.data, fullMask);
      const expected = new PNG({ width: rect.w, height: rect.h });
      PNG.bitblt(legacy, expected, rect.x, rect.y, rect.w, rect.h, 0, 0);
      const result = await sourceRegionCrops(
        [page],
        new Map([[page.id, reading]]),
        context,
      );
      expect(result).toHaveLength(1);
      const actual = PNG.sync.read(
        Buffer.from(result[0].dataUrl.split(",")[1], "base64"),
      );
      expect(actual.data).toEqual(expected.data);
      expect([actual.width, actual.height]).toEqual([rect.w, rect.h]);
      expect(
        await sourceRegionCrops(
          [page],
          new Map([[page.id, { ...reading, editProtection: undefined }]]),
          context,
        ),
      ).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
