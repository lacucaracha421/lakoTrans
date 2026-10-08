import { nativeImage } from "electron";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { renderMcpPageImage } from "./mcpPageImageAdapter";
import type { GlyphInspectionGeometry } from "../../shared/generatedGlyphReview";

/** Production PageArtwork applies paint, masks, outline, page occlusion and transforms. */
export async function renderMcpLetteringPixels(
  page: MangaPage,
  block: TranslationBlock,
  signal?: AbortSignal,
  onGeometry?: (geometry: GlyphInspectionGeometry) => void,
) {
  const bytes = await renderMcpPageImage(
    { ...page, blocks: [block] },
    signal,
    { format: "png", omitText: false },
    120_000,
    undefined,
    undefined,
    true,
  );
  const image = nativeImage.createFromBuffer(bytes);
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < left)
    throw new Error("Composed lettering has no visible pixels.");
  const crop = image.crop({
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  });
  const size = crop.getSize();
  const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
  const png = crop
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "best",
    })
    .toPNG();
  if (png.length > 4 * 1024 * 1024)
    throw new Error("Composed lettering exceeds 4 MiB.");
  onGeometry?.({
    coordinateSpace: "original-page-pixels",
    crop: {
      x: (left * page.width) / width,
      y: (top * page.height) / height,
      w: (size.width * page.width) / width,
      h: (size.height * page.height) / height,
    },
    pageWidth: page.width,
    pageHeight: page.height,
    imageWidth: Math.max(1, Math.round(size.width * scale)),
    imageHeight: Math.max(1, Math.round(size.height * scale)),
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
