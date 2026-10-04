import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isGeneratedBubbleLayout } from "../../shared/bubbleLayout";
import { logWarn } from "../logger";
import type {
  BubbleLayoutRunner,
  BubbleLayoutRunnerFactoryOptions,
  BubbleLayoutRunnerRequest,
  BubbleLayoutRunnerResult,
} from "../inpainting/bubbleLayoutRunner";
import { ensureKoharuLayoutAssets } from "./assets";
import { detectKoharuPageLayout } from "./detector";
import type { ComicPageDetectionResult } from "./contracts";
import {
  processDetectedBubbleLayouts,
  resolveBubbleLayoutBlockRevision,
} from "./bubbleLayoutPageProcessor";

type DetectionCache = {
  entries: Map<
    string,
    { promise: Promise<ComicPageDetectionResult>; bytes: number }
  >;
  bytes: number;
};
const MAX_DETECTION_CACHE_BYTES = 64 * 1024 * 1024;

export function createProductionBubbleLayoutRunner(
  options: BubbleLayoutRunnerFactoryOptions,
): BubbleLayoutRunner {
  const detectionsByOriginalPath: DetectionCache = {
    entries: new Map(),
    bytes: 0,
  };
  return {
    runPage: (request) =>
      runProductionBubbleLayout(options, request, detectionsByOriginalPath),
  };
}

async function runProductionBubbleLayout(
  options: BubbleLayoutRunnerFactoryOptions,
  request: BubbleLayoutRunnerRequest,
  detectionsByOriginalPath: DetectionCache,
): Promise<BubbleLayoutRunnerResult> {
  let pageRevision: string | null = null;
  try {
    throwIfAborted(request.signal);
    pageRevision = await resolvePageRevision(
      request.page.imagePath,
      request.imagePath,
    );
    const detection = await detectOriginalPageLayout(
      options,
      request,
      detectionsByOriginalPath,
    );
    throwIfAborted(request.signal);
    return {
      patches: processDetectedBubbleLayouts({
        page: request.page,
        imageWidth: detection.imageWidth,
        imageHeight: detection.imageHeight,
        detections: detection.detections,
        policy: request.policy,
        paddingRatio: request.paddingRatio,
        sharedOwnershipGapPx: request.sharedOwnershipGapPx,
        sourceEraseMask: request.sourceEraseMask,
        pageRevision,
      }),
      ...(request.includeTypographySegmentation
        ? {
            typographySegmentation: {
              imageWidth: detection.imageWidth,
              imageHeight: detection.imageHeight,
              detections: detection.detections,
            },
          }
        : {}),
    };
  } catch (error) {
    if (request.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const failureIsRequired = request.failureMode !== "best-effort";
    logWarn(
      failureIsRequired
        ? "Bubble-aware layout postprocess failed"
        : "Bubble-aware layout postprocess skipped",
      {
        pageId: request.page.id,
        error,
      },
    );
    if (failureIsRequired) {
      throw error;
    }
    return {
      patches: clearStaleGeneratedLayouts(request, pageRevision),
    };
  }
}

async function detectOriginalPageLayout(
  options: BubbleLayoutRunnerFactoryOptions,
  request: BubbleLayoutRunnerRequest,
  cache: DetectionCache,
): Promise<ComicPageDetectionResult> {
  const originalPath = request.page.imagePath;
  const source = await stat(originalPath);
  const key = `${originalPath}:${source.size}:${source.mtimeMs}:${source.ctimeMs}`;
  const cached = cache.entries.get(key);
  if (cached) return cached.promise;
  const detection = detectOriginalPageLayoutUncached(options, request);
  if (cache.entries.size >= 128) return detection;
  const entry = { promise: detection, bytes: 0 };
  cache.entries.set(key, entry);
  try {
    const result = await detection;
    const bytes = result.detections.reduce(
      (total, item) => total + 256 + (item.mask?.logits.byteLength ?? 0),
      256,
    );
    if (cache.bytes + bytes > MAX_DETECTION_CACHE_BYTES)
      cache.entries.delete(key);
    else {
      entry.bytes = bytes;
      cache.bytes += bytes;
    }
    return result;
  } catch (error) {
    cache.entries.delete(key);
    throw error;
  }
}

async function detectOriginalPageLayoutUncached(
  options: BubbleLayoutRunnerFactoryOptions,
  request: BubbleLayoutRunnerRequest,
): Promise<ComicPageDetectionResult> {
  const detectorAssets = await ensureKoharuLayoutAssets({
    dataRoot: options.dataRoot,
    signal: request.signal,
  });
  return detectKoharuPageLayout({
    imagePath: request.page.imagePath,
    modelPath: detectorAssets.modelPath,
    directMl: options.directMl,
    signal: request.signal,
    decodeFallback: options.decodeFallback,
  });
}

async function resolvePageRevision(
  originalPath: string,
  inpaintedPath: string,
): Promise<string> {
  const [original, inpainted] = await Promise.all([
    stat(originalPath),
    stat(inpaintedPath),
  ]);
  return createHash("sha256")
    .update(
      `${originalPath}:${original.size}:${original.mtimeMs}:${inpaintedPath}:${inpainted.size}:${inpainted.mtimeMs}`,
    )
    .digest("hex");
}

function clearStaleGeneratedLayouts(
  request: BubbleLayoutRunnerRequest,
  pageRevision: string | null,
): BubbleLayoutRunnerResult["patches"] {
  if (!pageRevision) return [];
  return request.page.blocks
    .filter(
      (block) =>
        isGeneratedBubbleLayout(block.bubbleLayout) &&
        block.bubbleLayout?.sourceImageRevision !==
          resolveBubbleLayoutBlockRevision(pageRevision, block),
    )
    .map((block) => ({
      blockId: block.id,
      renderBbox: null,
      renderBboxSpace: null,
      bubbleLayout: null,
    }));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
