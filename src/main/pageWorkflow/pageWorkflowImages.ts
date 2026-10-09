import type { MangaPage } from "../../shared/libraryTypes";
import { PageWorkflowPartialFailure } from "../application/pageWorkflowPartialFailure";
import {
  workflowRegionKey,
  workflowTargetBlocks,
} from "../../shared/pageWorkflowPolicy";
import { acquireInpaintingEngine } from "../inpainting/inpaintingEnginePool";
import { acquireCodexInpaintingEngine } from "../inpainting/codexInpaintingEngine";
import { inpaintPatternPage } from "../inpainting/patternPage";
import { createProductionBubbleLayoutRunner } from "../bubbleLayout/bubbleLayoutFacade";
import { runBubbleLayoutMaskPrepass } from "../jobs/bubbleLayoutJob";
import { runBubbleLayoutPostprocess } from "../inpainting/bubbleLayoutRunner";
import { applyInpaintingLayoutStates } from "../inpainting/inpaintingLayoutState";
import { applyNaturalTextLayout } from "../../shared/naturalTextLayout";
import type { PageWorkflowRuntimeContext } from "./pageWorkflowRuntimeTypes";

const productionRuntime = {
  acquireInpaintingEngine,
  acquireCodexInpaintingEngine,
  createProductionBubbleLayoutRunner,
};

function workflowBubbleRunner(
  context: PageWorkflowRuntimeContext,
  runtime: typeof productionRuntime,
) {
  return runtime.createProductionBubbleLayoutRunner({
    dataRoot: context.paths.dataRoot,
    decodeFallback: context.decodeImage,
    directMl: {
      ...context.settings.hardware,
      computeGpuBackend: context.settings.ocr.gpuBackend,
    },
  });
}

export function createWorkflowImages(
  context: PageWorkflowRuntimeContext,
  runtime = productionRuntime,
) {
  const runner = workflowBubbleRunner(context, runtime);
  return {
    erase: (page: MangaPage) =>
      eraseWorkflowPage(context, page, runner, runtime),
    layout: (page: MangaPage) => layoutWorkflowPage(context, page, runner),
  };
}

async function eraseWorkflowPage(
  context: PageWorkflowRuntimeContext,
  page: MangaPage,
  runner: ReturnType<typeof workflowBubbleRunner>,
  runtime: typeof productionRuntime,
): Promise<MangaPage> {
  const targets = workflowTargetBlocks(page, "erase", context.plan);
  if (!targets.length) return page;
  const lease = await acquireWorkflowErasure(context, runtime);
  try {
    const blockIds = targets.map((block) => block.id);
    const prepass =
      lease.engine.model === "flux-klein"
        ? await runBubbleLayoutMaskPrepass({
            page,
            blockIds,
            config: { policy: "balanced", overwriteManual: false },
            runner,
            signal: context.signal,
          })
        : undefined;
    const {
      page: maskPage = page,
      restoreLayout,
      ...maskOptions
    } = prepass ?? {};
    const result = await inpaintPatternPage(maskPage, {
      ...maskOptions,
      blockIds,
      signal: context.signal,
      inpaintingEngine: lease.engine,
      decodeFallback: context.decodeImage,
      preserveExistingInpainting: true,
    });
    const erased = new Set(result.erasedBlockIds);
    const output = restoreLayout
      ? applyInpaintingLayoutStates(result.page, restoreLayout)
      : result.page;
    const committed = {
      ...output,
      erasedWorkflowRegions: {
        ...page.erasedWorkflowRegions,
        ...Object.fromEntries(
          targets
            .filter((block) => erased.has(block.id))
            .map((block) => [block.id, workflowRegionKey(page, block)]),
        ),
      },
    };
    if (result.incompleteBlockIds?.length)
      throw new PageWorkflowPartialFailure(
        `${result.incompleteBlockIds.length}개 영역의 원문 제거가 완료되지 않았습니다.`,
        committed,
      );
    return committed;
  } finally {
    await lease.release();
  }
}

async function layoutWorkflowPage(
  context: PageWorkflowRuntimeContext,
  page: MangaPage,
  runner: ReturnType<typeof workflowBubbleRunner>,
): Promise<MangaPage> {
  let output = page;
  if (context.plan.bubbleLayout) {
    const blockIds = workflowTargetBlocks(page, "layout", context.plan).map(
      (block) => block.id,
    );
    if (blockIds.length)
      output = (
        await runBubbleLayoutPostprocess({
          page,
          blockIds,
          runner,
          signal: context.signal,
          config: {
            policy: "balanced",
            overwriteManual: context.plan.overwrite.includes("layout"),
            naturalTextLayout: context.plan.naturalLayout
              ? { locale: context.settings.translation?.targetLanguage }
              : undefined,
          },
        })
      ).page;
  } else if (context.plan.naturalLayout) {
    const targets = new Set(
      workflowTargetBlocks(page, "layout", context.plan).map(
        (block) => block.id,
      ),
    );
    output = {
      ...page,
      blocks: page.blocks.map((block) =>
        targets.has(block.id) && block.translatedText.trim()
          ? {
              ...block,
              translatedText: applyNaturalTextLayout(block, {
                enabled: true,
                pageSize: { width: page.width, height: page.height },
                locale: context.settings.translation?.targetLanguage,
              }).translatedText,
            }
          : block,
      ),
    };
  }
  return output;
}

async function acquireWorkflowErasure(
  context: PageWorkflowRuntimeContext,
  runtime: typeof productionRuntime,
) {
  const settings = context.settings;
  return context.plan.erasureEngine === "codex"
    ? await runtime.acquireCodexInpaintingEngine(
        context.paths,
        settings,
        context.signal,
      )
    : await runtime.acquireInpaintingEngine({
        appPaths: context.paths,
        signal: context.signal,
        model: settings.inpainting?.model ?? "flux-klein",
        fluxBackend: settings.inpainting?.fluxBackend,
        koharuBackend: settings.inpainting?.koharuBackend,
        computeGpuIndex: settings.hardware?.computeGpuIndex,
        allowUnsafeLowMemoryFlux:
          settings.inpainting?.allowUnsafeLowMemoryFlux ?? false,
      });
}
