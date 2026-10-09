import type { ChapterSnapshot, MangaPage } from "../../shared/libraryTypes";
import type { PixelRect } from "../../shared/region";
import { createPageRevision } from "../../shared/pageRevision";
import { McpEditError } from "./mcpEditPolicy";
import type { PageExportLayoutEvidence } from "../../shared/pageExportContracts";
import { generatedAssetSha256 } from "./mcpGeneratedTouchup";
import { inspectMcpLayout } from "../../shared/mcpLayoutReview";
import { describeLetteringText } from "../../shared/letteringTextStructure";

type Image = {
  data: string;
  width: number;
  height: number;
  layout?: PageExportLayoutEvidence;
};
export type McpRenderedPageOptions = {
  includeLayout?: boolean;
  crop?: PixelRect;
};
type Ports = {
  openChapter: (id: string) => Promise<ChapterSnapshot>;
  crop: (page: MangaPage, rect: PixelRect) => Promise<Image>;
  render: (page: MangaPage, options?: McpRenderedPageOptions) => Promise<Image>;
};

/** Resolve IDs and verify page revision after image work; no paths leave this boundary. */
export class McpPageImageService {
  constructor(private readonly ports: Ports) {}
  async read(
    chapterId: string,
    pageId: string,
    rect?: PixelRect,
    options?: McpRenderedPageOptions,
  ) {
    const page = await this.load(chapterId, pageId);
    if (rect) assertCrop(page, rect);
    if (options?.crop) assertCrop(page, options.crop);
    const revision = createPageRevision(page);
    const image = rect
      ? await this.ports.crop(page, rect)
      : options
        ? await this.ports.render(page, options)
        : await this.ports.render(page);
    if (createPageRevision(await this.load(chapterId, pageId)) !== revision)
      throw new McpEditError(
        "revision_conflict",
        "The page changed during rendering. Request the image again.",
      );
    const area = rect ?? options?.crop;
    return {
      chapterId,
      pageId,
      revision,
      kind: imageKind(rect, area),
      sourceWidth: page.width,
      sourceHeight: page.height,
      crop: area ?? null,
      ...renderMetadata(page, image, Boolean(rect)),
      width: image.width,
      height: image.height,
      pixelMapping: area
        ? {
            originX: area.x,
            originY: area.y,
            scaleX: area.w / image.width,
            scaleY: area.h / image.height,
          }
        : {
            originX: 0,
            originY: 0,
            scaleX: page.width / image.width,
            scaleY: page.height / image.height,
          },
      imageData: image.data,
    };
  }
  private async load(chapterId: string, pageId: string) {
    const page = (await this.ports.openChapter(chapterId)).pages.find(
      (p) => p.id === pageId,
    );
    if (!page) throw new McpEditError("not_found", "Page not found.");
    return page;
  }
}

function assertCrop(page: MangaPage, rect: PixelRect): void {
  if (
    !Object.values(rect).every(Number.isSafeInteger) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w < 1 ||
    rect.h < 1 ||
    rect.x + rect.w > page.width ||
    rect.y + rect.h > page.height
  )
    throw new McpEditError(
      "invalid_edit",
      "Crop must be an integer pixel rectangle wholly inside the source page.",
    );
}

function renderMetadata(page: MangaPage, image: Image, source: boolean) {
  return {
    ...(image.layout
      ? {
          layout: image.layout,
          layoutWarnings: inspectMcpLayout(image.layout, page.height),
          layoutUnits: "original-image-pixels-before-block-transforms",
          layoutBoundary:
            "text-rectangle-only; balloon-contours-and-artwork-not-verified",
          fontMeasurement:
            "renderer-resolved-em-and-sampled-Hangul-ink-bounds; apply-textScale-and-preview-pixelMapping; perspective-and-warp-require-visual-inspection",
        }
      : {}),
    ...(!source
      ? {
          generatedAssets: page.blocks
            .filter((block) => block.generatedLettering)
            .map((block) => ({
              blockId: block.id,
              assetSha256: generatedAssetSha256(block),
              targetStructure: describeLetteringText(block.translatedText),
              touchupCoordinates:
                "normalized_1000_in_named_asset_or_page_space",
            })),
        }
      : {}),
  };
}

function imageKind(source: PixelRect | undefined, area: PixelRect | undefined) {
  return source ? "source-crop" : area ? "rendered-crop" : "rendered-page";
}
