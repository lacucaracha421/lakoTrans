import { nativeImage } from "electron";
import type { MangaPage } from "../../shared/libraryTypes";
import type { McpExternalImagePreview } from "../../shared/mcpExternalImages";
import { loadPageImage } from "../inpainting/imageIO";
import { McpEditError } from "../application/mcpEditPolicy";
import type { ExternalImageAssets } from "./mcpExternalImageAssets";
import type { McpExternalRasterInput } from "./mcpImageWorkerProtocol";
import { generatedAssetSha256 } from "../application/mcpGeneratedTouchup";

type Command = McpExternalImagePreview["command"];
/** No model or image sizing heuristic. External pixels use exact declared placement. */
export async function composeMcpExternalImage(
  page: MangaPage,
  command: Command,
  assets: ExternalImageAssets,
) {
  const input: McpExternalRasterInput = {
    image: assets.image,
    mask: assets.mask,
    protectedMask: assets.protectedMask,
    width: assets.width,
    height: assets.height,
  };
  if (command.kind === "lettering") {
    if (command.patch) {
      const block = page.blocks.find((item) => item.id === command.blockId);
      if (
        !block?.generatedLettering ||
        generatedAssetSha256(block) !== command.patch.assetSha256 ||
        !command.replaceExisting ||
        command.existingDecorations !== "preserve"
      )
        throw new McpEditError(
          "revision_conflict",
          "Lettering patch requires the current asset SHA, explicit replacement and preserved decorations.",
        );
      input.letteringPatch = {
        base: Buffer.from(
          block.generatedLettering.dataUrl.split(",")[1],
          "base64",
        ),
        rect: command.patch.rect,
      };
    }
    const result = await assets.processing.run(
      "lettering",
      input,
      assets.guard,
    );
    return { ...result, bytes: Buffer.from(result.bytes) };
  }
  return composeBackground(page, command, assets, input);
}

async function composeBackground(
  page: MangaPage,
  command: Exclude<Command, { kind: "lettering" }>,
  assets: ExternalImageAssets,
  input: McpExternalRasterInput,
) {
  const rect =
    command.kind === "patch-background"
      ? command.rect
      : { x: 0, y: 0, w: page.width, h: page.height };
  if (
    rect.w !== assets.width ||
    rect.h !== assets.height ||
    rect.x + rect.w > page.width ||
    rect.y + rect.h > page.height
  )
    throw new McpEditError(
      "invalid_edit",
      "Patch dimensions must exactly match an in-page original-pixel rectangle; no stretching or clipping is performed.",
    );
  const nativePixels = await readNativeBitmaps(page, assets);
  const result = await assets.processing.run(
    "background",
    {
      ...input,
      rect,
      ...nativePixels,
      pageWidth: page.width,
      pageHeight: page.height,
    },
    assets.guard,
  );
  assets.guard();
  const { bitmap, ...stats } = result;
  return {
    ...stats,
    bytes: nativeImage
      .createFromBitmap(
        Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength),
        {
          width: page.width,
          height: page.height,
        },
      )
      .toPNG(),
  };
}

async function readNativeBitmaps(page: MangaPage, assets: ExternalImageAssets) {
  assets.guard();
  const base = await loadPageImage(page.inpaintedImagePath ?? page.imagePath);
  assets.guard();
  const before = Uint8Array.from(base.toBitmap());
  const incoming = nativeImage.createFromBuffer(assets.image);
  if (incoming.isEmpty() || before.length !== page.width * page.height * 4)
    throw new McpEditError(
      "invalid_edit",
      "Native image dimensions do not match the reviewed page.",
    );
  const size = incoming.getSize();
  const pixels = incoming.toBitmap();
  if (
    size.width !== assets.width ||
    size.height !== assets.height ||
    pixels.length !== assets.width * assets.height * 4
  )
    throw new McpEditError(
      "invalid_edit",
      "Native uploaded PNG dimensions differ from the validated image.",
    );
  return { before, pixels: Uint8Array.from(pixels) };
}
