import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { normalizeTranslationCompletionReferences } from "../translationCompletionReferences";
import { bboxToPixelRect, expandRect, hasUsableBbox } from "./maskGeometry";
import type { InpaintingWindowMask } from "./inpaintingEngine";

export function isPatternInpaintingBlockEligible(
  block: TranslationBlock,
  blockId?: string,
  excludedBlockIds?: readonly string[],
  blockIds?: readonly string[],
): boolean {
  const explicitlySelected =
    block.id === blockId || Boolean(blockIds?.includes(block.id));
  return (
    (!blockId || block.id === blockId) &&
    (!blockIds || blockIds.includes(block.id)) &&
    (blockId !== undefined || !excludedBlockIds?.includes(block.id)) &&
    hasUsableBbox(block.bbox) &&
    (!block.inpaintExcluded || explicitlySelected)
  );
}

export function resolveEligiblePatternBlocks(
  page: Pick<MangaPage, "blocks">,
  blockId?: string,
  excludedBlockIds?: readonly string[],
  blockIds?: readonly string[],
): TranslationBlock[] {
  return page.blocks.filter((block) =>
    isPatternInpaintingBlockEligible(
      block,
      blockId,
      excludedBlockIds,
      blockIds,
    ),
  );
}

export function countEligiblePatternBlocks(
  page: Pick<MangaPage, "blocks">,
  blockId?: string,
  excludedBlockIds?: readonly string[],
  blockIds?: readonly string[],
): number {
  return resolveEligiblePatternBlocks(page, blockId, excludedBlockIds, blockIds)
    .length;
}

export function hasInvalidRequiredPatternBlock(
  page: Pick<MangaPage, "blocks">,
): boolean {
  return page.blocks.some(
    (block) => !block.inpaintExcluded && !hasUsableBbox(block.bbox),
  );
}

export function shouldUseOriginalPatternImage(
  page: Pick<
    MangaPage,
    "blocks" | "inpaintedImagePath" | "translationCompletion"
  >,
): boolean {
  const completion = normalizeTranslationCompletionReferences(
    page.translationCompletion,
    page.blocks,
  );
  return Boolean(
    page.inpaintedImagePath &&
    completion?.status === "pending" &&
    !completion.erasedBlockIds?.length,
  );
}

/** Detector ownership is approximate; a selected balloon must not cut peer ink. */
export function protectUnselectedPatternText(
  mask: InpaintingWindowMask,
  options: {
    page: MangaPage;
    blockId?: string;
    blockIds?: readonly string[];
    excludedBlockIds?: readonly string[];
  },
): InpaintingWindowMask {
  const { bounds } = mask;
  let data: Uint8Array | undefined;
  for (const block of options.page.blocks) {
    // Pasted/render-only overlays can be excluded precisely because they have
    // no source ink. Their rectangles must not reserve another block's ink.
    if (
      block.inpaintExcluded ||
      !hasUsableBbox(block.bbox) ||
      isPatternInpaintingBlockEligible(
        block,
        options.blockId,
        options.excludedBlockIds,
        options.blockIds,
      )
    )
      continue;
    const rect = expandRect(
      bboxToPixelRect(block.bbox, options.page),
      options.page.width,
      options.page.height,
      2,
    );
    const left = Math.max(0, rect.x - bounds.x);
    const top = Math.max(0, rect.y - bounds.y);
    const right = Math.min(bounds.w, rect.x + rect.w - bounds.x);
    const bottom = Math.min(bounds.h, rect.y + rect.h - bounds.y);
    if (left >= right || top >= bottom) continue;
    data ??= mask.data.slice();
    for (let y = top; y < bottom; y++) {
      data.fill(0, y * bounds.w + left, y * bounds.w + right);
    }
  }
  return data ? { bounds, data } : mask;
}
