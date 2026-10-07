import { readPsd } from "ag-psd";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import type { MangaPage } from "../src/shared/libraryTypes";
import type { PageExportRenderSession } from "../src/main/pageExport";
import type { PageImageExportDependencies } from "../src/main/jobs/pageImageExportPorts";
import { writePagePsdExport } from "../src/main/jobs/pagePsdExportRunner";

function makePage(): MangaPage {
  return {
    id: "page-1",
    name: "page.png",
    imagePath: "original.png",
    inpaintedImagePath: "cleaned.png",
    dataUrl: "",
    width: 10,
    height: 10,
    analysisStatus: "idle",
    createdAt: "2026-09-16",
    updatedAt: "2026-09-16",
    blocks: [
      {
        id: "block-1",
        type: "nonsolid",
        bbox: { x: 100, y: 100, w: 500, h: 300 },
        sourceText: "source",
        translatedText: "translated",
        confidence: 1,
        sourceDirection: "horizontal",
        renderDirection: "horizontal",
        fontSizePx: 3,
        lineHeight: 1.2,
        textAlign: "center",
        textColor: "#111111",
        outlineColor: "#ffffff",
        outlineWidthScale: 1,
        backgroundColor: "#ffffff",
        opacity: 1,
      },
    ],
  };
}

function unexpected(): never {
  throw new Error("Unexpected PSD export dependency call");
}

describe("PSD runner original-resolution capture (#109)", () => {
  it.each([false, true])(
    "keeps every plane on the original pixel grid (omitText=%s)",
    async (omitText) => {
      const page = makePage();
      page.blocks.push({ ...page.blocks[0], id: "peer-2", fontSizePx: 6 });
      const background = new PNG({ width: page.width, height: page.height });
      background.data.fill(255);
      const text = new PNG({ width: page.width, height: page.height });
      text.data.fill(0);
      text.data.set([17, 34, 51, 255], (3 * page.width + 2) * 4);
      const renderPage = vi.fn<PageExportRenderSession["renderPage"]>(
        async () => PNG.sync.write(background),
      );
      const renderTransparentPage = vi.fn<
        NonNullable<PageExportRenderSession["renderTransparentPage"]>
      >(async () => PNG.sync.write(text));
      const renderSession = {
        renderPage,
        renderTransparentPage,
        inspectLastLayout: vi.fn(async () => {
          expect(renderPage).toHaveBeenCalledTimes(1);
          return page.blocks.map((block) => ({
            blockId: block.id,
            fontSizePx: 7,
            lines: ["measured", "lines"],
            innerWidth: 5,
            innerHeight: 8,
            overflow: false,
          }));
        }),
        resolvePsdFontName: () => "FixturePS-Regular",
        close: unexpected,
      };
      const writePsd = vi.fn(async (_path: string, _bytes: Buffer) => {});
      const dependencies: PageImageExportDependencies = {
        repository: { listLibrary: unexpected, openChapter: unexpected },
        renderer: { createSession: unexpected },
        logger: { error: unexpected },
        runtime: {
          createDirectory: unexpected,
          removeDirectory: unexpected,
          writePng: unexpected,
          writePsd,
          openDirectory: unexpected,
          createTimestamp: unexpected,
        },
      };
      await writePagePsdExport({
        abortController: new AbortController(),
        completedPages: 0,
        totalPages: 1,
        dependencies,
        omitText,
        outputPath: "page.psd",
        page,
        renderSession,
        throwIfAborted: (controller) => controller.signal.throwIfAborted(),
      });

      const options = { format: "png", resolutionMode: "original" };
      expect(renderPage.mock.calls.map(([, capture]) => capture)).toEqual([
        options,
        options,
        options,
      ]);
      expect(
        renderPage.mock.calls.map(([input]) => input.inpaintedImagePath),
      ).toEqual([page.inpaintedImagePath, undefined, page.inpaintedImagePath]);
      expect(renderPage.mock.calls.map(([input]) => input.blocks)).toEqual([
        omitText ? [] : page.blocks,
        [],
        [],
      ]);
      if (omitText) {
        expect(renderTransparentPage).not.toHaveBeenCalled();
      } else {
        expect(renderTransparentPage.mock.calls).toEqual(
          page.blocks.map((block) => [
            page,
            { ...options, visibleBlockIds: [block.id] },
          ]),
        );
      }
      expect(writePsd).toHaveBeenCalledOnce();
      const psd = readPsd(writePsd.mock.calls[0][1], {
        skipLayerImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
      });
      expect([psd.width, psd.height]).toEqual([page.width, page.height]);
      expect(psd.children).toHaveLength(3);
      expect(psd.children?.[0].children).toHaveLength(omitText ? 2 : 4);
      expect(renderSession.inspectLastLayout).toHaveBeenCalledTimes(
        omitText ? 0 : 1,
      );
      if (!omitText)
        expect(psd.children?.[1].children?.[0].text).toMatchObject({
          text: "measured\nlines",
          style: { fontSize: 7, font: { name: "FixturePS-Regular" } },
        });
    },
  );
});
