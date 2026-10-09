import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { normalizeTranslationCompletionReferences } from "../translationCompletionReferences";
import { bboxToPixelRect, expandRect, hasUsableBbox } from "./maskGeometry";
import type { InpaintingWindowMask } from "./inpaintingEngine";
import { projectWindowMask } from "./bubbleLayoutConstraintMask";

/** Artwork SFX must not inherit the nearest dialogue balloon's erase boundary. */
export function acceptsPatternBubbleConstraint(
  block: TranslationBlock,
  page: MangaPage,
  mask: InpaintingWindowMask,
): boolean {
  if (block.textRole !== "sound" || block.bubbleLayout?.origin === "manual")
    return true;
  const source = bboxToPixelRect(block.bbox, page);
  return Boolean(
    projectWindowMask(mask, {
      x: Math.floor(source.x + source.w / 2),
      y: Math.floor(source.y + source.h / 2),
      w: 1,
      h: 1,
    })[0],
  );
}

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
function protectUnselectedPatternText(
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
export function protectUnselectedFluxPlan(
  plan: {
    compositeMask: InpaintingWindowMask;
    constraint: InpaintingWindowMask | null;
    featherPx: number;
  },
  options: Parameters<typeof protectUnselectedPatternText>[1],
): void {
  plan.compositeMask = protectUnselectedPatternText(
    plan.compositeMask,
    options,
  );
  // A fallback/SFX rectangle needs the same peer protection as a detected
  // balloon, including its outer feather. Keep legacy unconstrained output
  // exactly when no neighboring source ink intersects the write envelope.
  const bounds = expandRect(
    plan.compositeMask.bounds,
    options.page.width,
    options.page.height,
    plan.featherPx,
  );
  const envelope = plan.constraint ?? {
    bounds,
    data: new Uint8Array(bounds.w * bounds.h).fill(1),
  };
  const protectedEnvelope = protectUnselectedPatternText(envelope, options);
  if (plan.constraint || protectedEnvelope !== envelope)
    plan.constraint = protectedEnvelope;
}
