import { serializeRichTextRuns } from "../../shared/richTextMarkup";
import { mkdtemp, rm } from "node:fs/promises";
import { nativeImage } from "electron";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageExportRenderSession } from "../pageExport";
import { renderFontSamples } from "../pipeline/codexTypesettingRaster";
import { getAppPaths } from "../appPaths";
import { openChapter } from "../library";
import { createPageRevision } from "../../shared/pageRevision";
import { McpEditError } from "../application/mcpEditPolicy";
import { renderMcpSavedPage } from "./mcpPageImageAdapter";
import { normalizeBboxTo1000 } from "../../shared/bboxNormalization";

/** Uses the existing measured literal specimen path; no font matcher/model is loaded. */
export async function renderMcpFontSamples(
  fontIds: string[],
  text: string,
  guard: () => void,
  context?: {
    chapterId: string;
    pageId: string;
    blockId: string;
    revision: string;
  },
) {
  guard();
  if (context) return renderContextSamples(fontIds, text, guard, context);
  const directory = await mkdtemp(join(tmpdir(), "carrot-mcp-font-samples-"));
  let renderer:
    Awaited<ReturnType<typeof createPageExportRenderSession>> | undefined;
  try {
    renderer = await createPageExportRenderSession({
      dataRoot: getAppPaths().dataRoot,
      decodeFallback: async (path) => {
        if (path !== join(directory, "font-sample-background.png"))
          throw new Error("Unexpected font sample source.");
        return nativeImage.createFromPath(path).toPNG();
      },
      lowPriority: true,
    });
    const images = [];
    for (const fontId of fontIds) {
      guard();
      images.push(
        ...(await renderFontSamples(
          {
            version: 1,
            eraseOriginal: false,
            sfxRendering: "font",
            preset: {
              id: "mcp-visual",
              name: "MCP visual sample",
              fonts: [
                {
                  fontId,
                  purpose: "Compare actual glyph strokes to the source.",
                },
              ],
            },
          },
          text,
          directory,
          renderer,
        )),
      );
    }
    guard();
    return images;
  } finally {
    renderer?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function renderContextSamples(
  fontIds: string[],
  text: string,
  guard: () => void,
  context: {
    chapterId: string;
    pageId: string;
    blockId: string;
    revision: string;
  },
) {
  const load = async () => {
    const page = (await openChapter(context.chapterId)).pages.find(
      (item) => item.id === context.pageId,
    );
    if (!page || createPageRevision(page) !== context.revision)
      throw new McpEditError(
        "revision_conflict",
        "Font specimen context changed.",
      );
    return page;
  };
  const page = await load();
  const block = page.blocks.find((item) => item.id === context.blockId);
  if (!block)
    throw new McpEditError("not_found", "Font specimen block missing.");
  const box = normalizeBboxTo1000(
    block.renderBbox ?? block.bbox,
    page,
    block.renderBbox
      ? (block.renderBboxSpace ?? block.bboxSpace)
      : block.bboxSpace,
  );
  const x = Math.max(0, Math.floor((box.x * page.width) / 1000 - 24));
  const y = Math.max(0, Math.floor((box.y * page.height) / 1000 - 24));
  const crop = {
    x,
    y,
    w: Math.min(page.width - x, Math.ceil((box.w * page.width) / 1000 + 48)),
    h: Math.min(page.height - y, Math.ceil((box.h * page.height) / 1000 + 48)),
  };
  const samples = [];
  for (const fontId of fontIds) {
    guard();
    const candidate = {
      ...page,
      blocks: page.blocks.map((item) =>
        item.id !== block.id
          ? item
          : {
              ...item,
              translatedText: serializeRichTextRuns([
                { text, bold: false, italic: false },
              ]),
              fontFamily: fontId,
              generatedLettering: undefined,
            },
      ),
    };
    const image = await renderMcpSavedPage(candidate, {
      includeLayout: true,
      crop,
    });
    samples.push({
      label: `${fontId}; full contextual text; original-pixel crop ${JSON.stringify(crop)}; layout ${JSON.stringify(image.layout?.find((item) => item.blockId === block.id))}`,
      dataUrl: `data:image/png;base64,${image.data}`,
    });
  }
  await load();
  guard();
  return samples;
}
