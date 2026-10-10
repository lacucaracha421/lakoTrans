import type { InpaintingHistoryTransactionRef } from "../../shared/inpaintingTypes";
import type { MangaPage } from "../../shared/libraryTypes";
import { isCodexImageModel } from "../../shared/codexSettings";
import { readImageRedactionState } from "../imageRedactionStore";
import { modelCleanupIsBlocked } from "../runtimeSupport/modelCleanupBarrier";
import type { InpaintingJobContext } from "../jobs/inpaintingJobTypes";
import type { startInpaintingJob } from "../jobs/inpaintingJobs";
import type { InpaintingJobRuntime } from "../jobs/inpaintingJobRuntime";
import { createPageRevision } from "../../shared/pageRevision";
import { McpEditError } from "../application/mcpEditPolicy";
import type { McpOperationContext } from "../application/mcpOperationService";
import type { McpOperationTarget } from "./mcpOperationTools";
import { currentRetentionInvocation } from "./mcpRecoveryCapture";

type Editing = {
  assertWritable: (chapterId: string, pageId: string) => Promise<void>;
  assertClean: (chapterId: string, pageId: string) => Promise<void>;
  notifySaved: (chapterId: string, pageId: string) => void;
};
/** Reuse the native job, page ownership, masks, history and transaction guards. */
export async function eraseMcpPage(
  app: InpaintingJobContext,
  editing: Editing,
  target: McpOperationTarget,
  operation: McpOperationContext,
  runtime?: InpaintingJobRuntime,
  onHistory?: (reference: InpaintingHistoryTransactionRef) => void,
) {
  operation.assertAuthorized();
  const retention = currentRetentionInvocation();
  if (retention) await retention.assertCapacity();
  const { startInpaintingJob } = await import("../jobs/inpaintingJobs.js");
  runtime ??= (await import("../jobs/inpaintingJobRuntime.js"))
    .productionInpaintingJobRuntime;
  operation.assertAuthorized();
  const storedSettings = await runtime.getSettings(app.appPaths);
  const settings = target.localModel
    ? {
        ...storedSettings,
        inpainting: { ...storedSettings.inpainting, model: target.localModel },
      }
    : storedSettings;
  await assertErasureEngine(app, target, settings);
  const scopedApp = {
    ...app,
    executionSettings: settings,
    retainPageOwnership: true,
  };
  operation.assertAuthorized();
  let committedPage: MangaPage | undefined;
  const guarded = guardErasureRuntime(
    runtime,
    editing,
    target,
    operation,
    (page) => {
      committedPage = page;
    },
  );
  const previous = new Set(app.jobs.all.map((job) => job.id));
  const pending = startInpaintingJob(
    scopedApp,
    {
      mode: "page-pattern",
      ...(target.engine === "codex" ? { engine: "codex" as const } : {}),
      chapterId: target.chapterId,
      pageId: target.pageId,
      blockId: target.blockId,
      postprocess: { bubbleLayout: { enabled: false, policy: "safe" } },
    },
    { ...guarded, getSettings: async () => settings },
  );
  const job = app.jobs.all.find(
    (entry) => !previous.has(entry.id) && entry.kind === "inpainting",
  );
  if (job) job.origin = "mcp";
  const cancel = () => {
    if (job && app.jobs.get(job.id) === job) job.abortController.abort();
  };
  operation.signal.addEventListener("abort", cancel, { once: true });
  if (operation.signal.aborted) cancel();
  try {
    const result = await pending;
    if (result.status === "failed")
      throw new Error("App erasure failed; see local job details.");
    const page = result.chapter?.pages.find(
      (entry) => entry.id === target.pageId,
    );
    if (page) editing.notifySaved(target.chapterId, target.pageId);
    recordSelectedHistory(result, target.blockId, onHistory);
    return erasureResult(result, page, target);
  } catch (error) {
    return cleanupFailure(error, committedPage, target, editing, runtime);
  } finally {
    operation.signal.removeEventListener("abort", cancel);
  }
}
async function assertErasureEngine(
  app: InpaintingJobContext,
  target: McpOperationTarget,
  settings: Awaited<ReturnType<InpaintingJobRuntime["getSettings"]>>,
) {
  if (target.engine === "codex") {
    if (!target.allowExternalProcessing)
      throw new McpEditError(
        "access_denied",
        "Explicit external image processing permission is required.",
      );
    if (
      !target.expectedModel ||
      !isCodexImageModel(target.expectedModel) ||
      settings.codex.imageModel !== target.expectedModel
    )
      throw new McpEditError(
        "invalid_edit",
        "The Codex image model changed. Read get_sound_effects before retrying; no fallback was started.",
      );
    if ((await readImageRedactionState(app.appPaths.dataRoot)).enabled)
      throw new McpEditError(
        "access_denied",
        "Codex erasure is blocked by image redaction review.",
      );
  }
}
function guardErasureRuntime(
  runtime: InpaintingJobRuntime,
  editing: Editing,
  target: McpOperationTarget,
  operation: McpOperationContext,
  onSaved: (page: MangaPage) => void,
): InpaintingJobRuntime {
  return {
    ...runtime,
    acquireEngine: async (options) => {
      const lease = await runtime.acquireEngine(options);
      return {
        ...lease,
        release: async () => {
          operation.progress({ phase: "releasing_model" });
          await lease.release();
        },
      };
    },
    openChapter: async (chapterId) => {
      operation.assertAuthorized();
      const chapter = await runtime.openChapter(chapterId);
      const page = chapter.pages.find((entry) => entry.id === target.pageId);
      if (
        chapterId !== target.chapterId ||
        !page ||
        createPageRevision(page) !== target.revision
      )
        throw new McpEditError(
          "revision_conflict",
          "Read the current page before erasing.",
        );
      if (target.blockId !== undefined) {
        const block = page.blocks.find((entry) => entry.id === target.blockId);
        if (!block)
          throw new McpEditError(
            "not_found",
            "The selected erasure block no longer exists. Read the page again.",
          );
        if (block.inpaintExcluded)
          throw new McpEditError(
            "invalid_edit",
            "The selected block is excluded from erasure. Change that setting explicitly before retrying.",
          );
      }
      return chapter;
    },
    savePages: async (chapterId, pages, options) => {
      operation.assertAuthorized();
      if (
        chapterId !== target.chapterId ||
        pages.some((page) => page.id !== target.pageId)
      )
        throw new McpEditError("invalid_edit", "Unexpected erasure target.");
      await editing.assertClean(chapterId, target.pageId);
      const saved = await runtime.savePages(
        chapterId,
        pages,
        options,
        operation.assertAuthorized,
      );
      const page = saved.pages.find((entry) => entry.id === target.pageId);
      if (page) onSaved(page);
      return saved;
    },
    emitEvent: (jobs, window, event) => {
      runtime.emitEvent(jobs, window, event);
      operation.progress({
        phase: event.phase ?? event.status,
        completed: event.progressCurrent,
        total: event.progressTotal,
      });
    },
  };
}
function cleanupFailure(
  error: unknown,
  page: MangaPage | undefined,
  target: McpOperationTarget,
  editing: Editing,
  runtime: InpaintingJobRuntime,
) {
  if (!modelCleanupIsBlocked()) throw error;
  if (!page)
    throw new McpEditError(
      "editor_busy",
      "Local model cleanup is incomplete. New model work is blocked; inspect the local log before retrying.",
      { cause: error },
    );
  runtime.logError("MCP page saved but native model cleanup failed", { error });
  editing.notifySaved(target.chapterId, target.pageId);
  return {
    status: "partial" as const,
    cleanupFailed: true,
    chapterId: target.chapterId,
    pageId: target.pageId,
    blockId: target.blockId,
    revision: createPageRevision(page),
    pagesChanged: 1,
    blocksErased: undefined,
    blocksIncomplete: undefined,
    performed: ["erase-original"],
    engine:
      target.engine === "codex"
        ? "codex"
        : (target.localModel ?? "app-configured-local"),
  };
}

function recordSelectedHistory(
  result: Awaited<ReturnType<typeof startInpaintingJob>>,
  blockId: string | undefined,
  remember: ((reference: InpaintingHistoryTransactionRef) => void) | undefined,
): void {
  if (blockId && result.status === "completed" && result.historyTransaction)
    remember?.(result.historyTransaction);
}

function erasureResult(
  result: Awaited<ReturnType<typeof startInpaintingJob>>,
  page: MangaPage | undefined,
  target: McpOperationTarget,
) {
  return {
    status: result.status,
    chapterId: target.chapterId,
    pageId: target.pageId,
    blockId: target.blockId,
    revision: page ? createPageRevision(page) : target.revision,
    pagesChanged: result.pagesChanged ?? 0,
    blocksErased: result.blocksErased ?? 0,
    blocksIncomplete: result.blocksIncomplete ?? 0,
    performed: ["erase-original"],
    engine:
      target.engine === "codex"
        ? "codex"
        : (target.localModel ?? "app-configured-local"),
  };
}
