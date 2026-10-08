import {
  McpLetteringPrepareSchema,
  type McpLetteringPrepare,
} from "../../shared/mcpLettering";
import type {
  McpOperationContext,
  McpOperationService,
} from "../application/mcpOperationService";
import type { InpaintingJobContext } from "../jobs/inpaintingJobTypes";
import { openChapter, readWorkContextForEdit } from "../library";
import { validateBatchTargets } from "../application/mcpPageBatchPolicy";
import { reserveJobChapter, acquireJobPage } from "../jobs/jobPageOwnership";
import { createMcpBatchTool } from "./mcpBatchTool";
import { runMcpAppJob } from "./mcpAppJob";

type Prepare = (
  owner: string,
  input: McpLetteringPrepare,
  context: McpOperationContext,
) => Promise<{ batchId: string; expiresAt: number }>;
const scopes = ["carrot.read", "carrot.edit", "carrot.process"];
export function createMcpLetteringPrepareTool(
  app: InpaintingJobContext,
  operations: McpOperationService,
  prepare: Prepare,
  lifetime: AbortSignal,
) {
  return {
    ...createMcpBatchTool({
      name: "carrot_prepare_lettering_batch",
      schema: McpLetteringPrepareSchema,
      scopes,
      write: false,
      background: true,
      description:
        "Prepare a reversible lettering plan for explicit saved blocks in ONE chapter (50 pages/1000 selected blocks max). Returns a job receipt: poll carrot_get_job until completed, then inspect result.letteringPlan.batchId using carrot_get_lettering_batch. No original or page changes. Choose generated-touchup for existing generated layers (any text role): edits require blockId/assetSha256 and bounded native strokes, moves, outline or occlusion changes. moves:[{space,polygon,from,to}] cuts and translates selected composed pixels; polygon (3..128 points) and from/to anchors are normalized 0..1000 in the named asset/page space. Page anchors use the existing inverse rotation/perspective/warp; this is a rigid asset-space translation after conversion. Up to 16 moves per asset. Moves precede new strokes in the same request, carry earlier asset paint/masks, and preserve raw PNG bytes. Source and destination must fit the asset canvas; clipping is rejected. Inspect the final composition before accepting a repair. Coordinates/radii are normalized 0..1000 in explicit asset/page space; paint in page space uses the existing inverse rotation/perspective/warp transform. No image/text replacement. Inspect render_page_preview for current SHA and revision; use verify_generated_lettering AFTER applying, since raw image bytes do not include touchup. Or choose format (bounded scalar fields/effects/transforms), rule (schemeJson: JSON serialized existing conditional-rule draft; typography/styleText/applyStylePreset only, no text replacement), or layout (geometry, wrap, geometry-and-wrap). Geometry uses the existing Koharu detector and may install approved assets only with explicit allowAssetDownloads=true. Wrap-only and styling never run a model. Transform points use block-local coordinates: 0..1 spans the render rectangle. A warp gridSize of 3 needs 16 row-major points (4x4), and 5 needs 36 (6x6); a quadratic curve uses start/control/end with tangent or upright glyphs. Use small deformations and inspect the actual rendered page. Disabled or stale generated images keep their bytes while their visible text fallback can be styled. Manual sizes, manual bubble layouts and existing hard line breaks are protected by default. No OCR, translation, erasure, C23, image transfer or rendering. Model cleanup completes before plans publish. Use command kind=resource with resourceKind/id/item snapshot from carrot_list_lettering_resources for saved presets, rules, sequences or block styles. groupIds can narrow preset/block-style fields. The prepared resource version is rechecked before apply/redo; undo never needs the resource. Cancel preparation using carrot_cancel_job.",
      execute: async (args, owner, guard) => {
        const input = McpLetteringPrepareSchema.parse(args);
        return operations.start({
          owner,
          kind: "letteringPrepare",
          requestId: input.requestId,
          parameters: input,
          assertAuthorized: guard,
          execute: (operation) => {
            const signal = AbortSignal.any([operation.signal, lifetime]);
            const context = {
              ...operation,
              signal,
              assertAuthorized: () => {
                signal.throwIfAborted();
                operation.assertAuthorized();
              },
            };
            return prepareUnderApp(app, owner, input, context, prepare);
          },
        });
      },
    }),
    readOnly: false,
    destructive: false,
    openWorld: true,
  };
}
async function prepareUnderApp(
  app: InpaintingJobContext,
  owner: string,
  input: McpLetteringPrepare,
  operation: McpOperationContext,
  prepare: Prepare,
) {
  const geometry =
    input.command.kind === "layout" && input.command.mode !== "wrap";
  return runMcpAppJob(
    app,
    operation,
    "gemma-analysis",
    async (context) => {
      const saved = await readWorkContextForEdit(input.chapterId);
      context.assertAuthorized();
      validateBatchTargets(saved, input);
      reserveJobChapter(
        app.jobs,
        context.id,
        saved.chapter,
        input.pages.map((page) => page.pageId),
      );
      for (const page of input.pages) {
        await acquireJobPage(
          app.jobs,
          context.id,
          input.chapterId,
          page.pageId,
          openChapter,
        );
        context.assertAuthorized();
      }
      context.progress({ phase: "lettering_preparation" });
      const plan = await prepare(owner, input, context);
      context.assertAuthorized();
      return {
        kind: "lettering-plan",
        status: "prepared",
        chapterId: input.chapterId,
        pagesChanged: 0,
        performed: ["lettering_preparation"],
        needsReview: true,
        letteringPlan: { batchId: plan.batchId, expiresAt: plan.expiresAt },
      };
    },
    {
      resources: geometry
        ? [{ kind: "model-runtime", scope: "*", access: "write" }]
        : [],
    },
  );
}
