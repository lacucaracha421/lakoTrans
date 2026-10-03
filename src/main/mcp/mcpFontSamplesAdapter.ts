import { mkdtemp, rm } from "node:fs/promises";
import { nativeImage } from "electron";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageExportRenderSession } from "../pageExport";
import { renderFontSamples } from "../pipeline/codexTypesettingRaster";
import { getAppPaths } from "../appPaths";

/** Uses the existing measured literal specimen path; no font matcher/model is loaded. */
export async function renderMcpFontSamples(
  fontIds: string[],
  text: string,
  guard: () => void,
) {
  guard();
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
