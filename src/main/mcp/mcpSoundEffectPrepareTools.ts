import { z } from "zod/v4";
import {
  McpSoundEffectPrepareSchema,
  type McpSoundEffectPrepare,
} from "../../shared/mcpSoundEffects";
import type {
  McpOperationContext,
  McpOperationService,
} from "../application/mcpOperationService";
import type { InpaintingJobContext } from "../jobs/inpaintingJobTypes";
import { readWorkContextForEdit, openChapter } from "../library";
import { retainLibrarySnapshot, withLibraryRead } from "../library/lock";
import { assertContextTarget } from "../application/mcpContextEditPolicy";
import { createMcpBatchTool } from "./mcpBatchTool";
import { runMcpAppJob } from "./mcpAppJob";

type PlanReference = {
  batchId: string;
  expiresAt: number;
  generationCalls: number;
  failedItems: number;
  glyphEvidenceIds?: string[];
};
type Prepare = (
  owner: string,
  input: McpSoundEffectPrepare,
  context: McpOperationContext,
) => Promise<PlanReference>;
const commands = McpSoundEffectPrepareSchema.shape.command.options;
const editSchema = McpSoundEffectPrepareSchema.extend({
  command: z.discriminatedUnion("kind", [
    commands[0],
    commands[1],
    commands[2],
    commands[3],
    commands[5],
  ]),
});
const generationSchema = McpSoundEffectPrepareSchema.extend({
  command: commands[4],
});

export function createMcpSoundEffectPrepareTools(
  app: InpaintingJobContext,
  operations: McpOperationService,
  prepare: Prepare,
  lifetime: AbortSignal,
) {
  const pending = new Set<Promise<unknown>>();
  const tools = ["edit", "generate", "verify"].map((mode) => {
    const generation = mode !== "edit";
    return {
      ...createMcpBatchTool({
        name:
          mode === "verify"
            ? "carrot_verify_generated_lettering"
            : generation
              ? "carrot_generate_sound_effects"
              : "carrot_prepare_sound_effect_batch",
        schema:
          mode === "verify"
            ? McpSoundEffectPrepareSchema.extend({ command: commands[6] })
            : generation
              ? generationSchema
              : editSchema,
        scopes: [
          "carrot.read",
          "carrot.edit",
          "carrot.process",
          ...(generation ? ["carrot.images"] : []),
        ],
        write: false,
        background: true,
        description:
          mode === "verify"
            ? "Independently transcribe CURRENT rendered generated lettering, then separately inspect consonant/vowel/final-consonant anatomy and relative component placement. Neither reader receives the approved wording; shape inspection also does not receive the OCR guess. A recognizable syllable with malformed, fused or misplaced parts is not a pass. Includes part moves, paint, masks, outlines, transforms and page occlusion using production PageArtwork. Works for imported images and non-SFX generated layers. Uses configured reader model and account quota; requires allowExternalProcessing. No image generation or page changes. Poll job result.soundEffectPlan.glyphEvidenceIds, then carrot_get_quality_evidence. Both exact readback and a valid version-2 shape review are required. Failed, uncertain or missing component checks block detailed completion. shape.issues rectangles use 0..1000 of the composed crop; inspectionGeometry maps that crop to original page pixels. Inspect the current page/crop before editing. Repair defects and request fresh evidence; do not call the same unchanged image again to fish for a pass."
            : generation
              ? "Generate foreground image assets for at most 10 explicitly selected SAVED sound-effect blocks through the configured supported Codex image controller and existing app lettering engine. Requires allowExternalProcessing=true and exact expectedModel; uses account quota and may incur provider cost. Every candidate is independently transcribed and separately inspected for intact script anatomy and natural component placement, without revealing approved text; one attempt per call by default, at most 4 total across host/app providers; cumulative priorGenerationAttempts reduces the budget. Failed candidates persist across reconnect for direct touchup; inspect get_sound_effect_candidates. directions accepts creativeBrief, correctionInstruction, previousCandidateId and glyphGuideFontId. Revise prompts for retries, stop immediately when correct, and disclose sampled-font fallback if exhausted. attemptsPerCall can explicitly request up to four graduated corrections. Inspect final rendered glyphs too. Existing layers require replaceExisting=true. Refusals never trigger a fallback provider or automatic retry. Native render-box adjustment requires allowRenderAdjustment=true. Returns job ID: inspect result.soundEffectPlan, then get_sound_effect_batch and separately apply. Sequential targets, no OCR, translation, erasure, region replanning, C23, rendering, page save or model downloads. External artwork instead uses validated upload tools. Cancel generation using cancel_job."
              : "Prepare ONE saved page of explicit sound-effect candidate include/exclude/restore decisions, manual regions, approved candidate text materialization, saved sound-text edits, image enable/disable/remove, or command=candidate with a retained candidateId or candidateIds (up to 10, one per block). Adopt candidates from the same current page revision together so applying one does not stale the others. Inspect any proposed geometry adjustment before applying; this does not regenerate the image. Candidate adoption remains incomplete until composed-glyph verification and final page review. Unspecified candidates and dialogue remain unchanged. Rectangles are ORIGINAL pixels. Preserve detector records; overlapping materialization requires allowOverlap. No OCR or translation is performed for supplied text. Stale image text is never silently regenerated and blocked images cannot be enabled. No models, external calls, erasure or page saves. Returns a job ID; inspect result.soundEffectPlan then get_sound_effect_batch; application and exact recovery are separate.",
        execute: async (value, owner, guard) => {
          const input = McpSoundEffectPrepareSchema.parse(value);
          return operations.start({
            owner,
            kind: "soundEffectPrepare",
            requestId: input.requestId,
            parameters: input,
            assertAuthorized: guard,
            execute: (context) => {
              const task = runPreparation(
                app,
                owner,
                input,
                context,
                prepare,
                lifetime,
              );
              pending.add(task);
              return task.finally(() => pending.delete(task));
            },
          });
        },
      }),
      readOnly: false,
      destructive: false,
      openWorld: generation,
    };
  });
  return {
    tools,
    close: async () => {
      await Promise.allSettled([...pending]);
    },
  };
}

async function runPreparation(
  app: InpaintingJobContext,
  owner: string,
  input: McpSoundEffectPrepare,
  operation: McpOperationContext,
  prepare: Prepare,
  lifetime: AbortSignal,
) {
  const signal = AbortSignal.any([operation.signal, lifetime]);
  const context = {
    ...operation,
    signal,
    assertAuthorized: () => {
      signal.throwIfAborted();
      operation.assertAuthorized();
    },
  };
  return runMcpAppJob(
    app,
    context,
    "gemma-analysis",
    async (current) => {
      const saved = await readWorkContextForEdit(input.chapterId);
      const release = await withLibraryRead(async () =>
        retainLibrarySnapshot(
          [{ kind: "work-context", scope: saved.workId, access: "read" }],
          [],
        ),
      );
      try {
        current.assertAuthorized();
        assertContextTarget(
          await readWorkContextForEdit(input.chapterId),
          input.chapterId,
          input.contextRevision,
        );
        current.progress({
          phase:
            input.command.kind === "generate"
              ? "sound_effect_generation"
              : "sound_effect_preparation",
        });
        const plan = await prepare(owner, input, current);
        current.assertAuthorized();
        return {
          kind: "sound-effect-plan",
          status: plan.failedItems ? "partial" : "prepared",
          chapterId: input.chapterId,
          pageId: input.pageId,
          pagesChanged: 0,
          needsReview: true,
          performed: [
            input.command.kind === "generate"
              ? "sound_effect_generation"
              : "sound_effect_preparation",
          ],
          soundEffectPlan: plan,
        };
      } finally {
        release();
      }
    },
    {
      resources: ["generate", "verify"].includes(input.command.kind)
        ? [{ kind: "model-runtime", scope: "*", access: "write" }]
        : [],
      page: {
        chapterId: input.chapterId,
        pageId: input.pageId,
        readChapter: openChapter,
      },
    },
  );
}
