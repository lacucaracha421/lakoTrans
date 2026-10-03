import { afterEach, expect, it, vi } from "vitest";
import { createPageWorkflowRuntime } from "../src/main/pageWorkflow/pageWorkflowRuntime";
import { applyWorkflowRuleStage } from "../src/main/pageWorkflow/pageWorkflowRuleExecution";
import type { PageWorkflowRuntimeContext } from "../src/main/pageWorkflow/pageWorkflowRuntimeTypes";
import type { PageExportRenderSession } from "../src/main/pageExport";
import { createPageWorkflowPlan } from "../src/shared/pageWorkflowTypes";
import { makeChapter, makePage } from "./helpers/workspacePointerFixtures";
import {
  loadPipeline,
  basePipelineOptions,
  makeEmptyWorkContext,
  cleanupPipelineTempDirs,
} from "./helpers/wholePagePipelineHarness";

afterEach(cleanupPipelineTempDirs);
it.each([false, true])(
  "shares the review renderer without PNG capture and closes after failure=%s",
  async (fail) => {
    const f = await loadPipeline();
    const pages = ["one", "two", "three"].map((id) => ({ ...makePage(), id }));
    const chapter = {
      ...makeChapter(pages[0]),
      pages,
      pageOrder: pages.map((page) => page.id),
    };
    const input = basePipelineOptions(pages, []);
    const context: PageWorkflowRuntimeContext = {
      runId: "review",
      plan: createPageWorkflowPlan(["review"]),
      rules: {},
      settings: await f.dependencies.settings.getAppSettings(),
      paths: f.dependencies.paths,
      dependencies: f.dependencies,
      signal: input.signal,
      emit: vi.fn(),
      decodeImage: async () => null,
      runPaths: async () => input.runPaths,
    };
    const runtime = createPageWorkflowRuntime(context);
    const preparePage = vi.fn(async () => {}),
      close = vi.fn(),
      renderPage = vi.fn(async () => Buffer.from("unused"));
    const createSession = vi.fn(async (): Promise<PageExportRenderSession> => ({
      preparePage,
      close,
      renderPage,
      applyWorkflowRules: async ({ chapter }) => ({ chapter, findings: [] }),
    }));
    if (fail) preparePage.mockRejectedValueOnce(new Error("renderer failed"));
    const run = runtime.group("review", async () => {
      for (const page of pages) {
        const result = await applyWorkflowRuleStage(
          context,
          chapter,
          page,
          "review",
          {
            createSession,
            readContext: async () => ({
              styleGuide: makeEmptyWorkContext().styleGuide,
            }),
          },
        );
        expect(result.pageWorkflow?.findings).toEqual([]);
      }
    });
    if (fail) await expect(run).rejects.toThrow("renderer failed");
    else await run;
    await runtime.dispose();
    expect(createSession).toHaveBeenCalledOnce();
    expect(preparePage).toHaveBeenCalledTimes(fail ? 1 : 3);
    expect(renderPage).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  },
);
