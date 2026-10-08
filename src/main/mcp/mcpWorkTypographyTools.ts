import { loadBuiltInFontMatchingCandidates } from "../builtInFontMatchingCatalog";
import { logError } from "../logger";
import {
  FONT_MATCHING_V2_MODEL_VERSION,
  FONT_MATCHING_V2_RENDERER_HASH,
  resolveFontMatchingV2CatalogVersion,
} from "../pipeline/automaticFontMatchingV2Catalog";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import {
  McpWorkTypographyReadSchema,
  McpWorkTypographyChangeSchema,
} from "../../shared/mcpWorkTypography";
import {
  readWorkTypographyProfile,
  writeWorkTypographyProfile,
} from "../library";
import {
  withLibraryRead,
  withLibraryMutation,
  withLibraryContentEdit,
} from "../library/lock";
import { previewWorkTypography } from "../application/mcpWorkTypographyPolicy";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { McpEditError } from "../application/mcpEditPolicy";
import { readMcpCompositeFontEnvironment } from "./mcpCompositeNativeFonts";
import { readMcpQualityEvidence } from "./mcpQualityEvidenceStore";
import { createMcpBatchTool } from "./mcpBatchTool";

type Plans = Map<
  string,
  {
    owner: string;
    input: ReturnType<typeof McpWorkTypographyChangeSchema.parse>;
    profile: NonNullable<Awaited<ReturnType<typeof readWorkTypographyProfile>>>;
    fontFingerprint: string;
    expiresAt: number;
  }
>;
function typographyReadTool() {
  return createMcpBatchTool({
    name: "carrot_get_work_typography",
    schema: McpWorkTypographyReadSchema,
    scopes: ["carrot.read"],
    write: false,
    description:
      "Read this work's saved role palette, visual specimen provenance and user locks. AI selections are not human gold. Reuse valid specimens; aim for 3–6 core fonts with justified special SFX exceptions.",
    execute: async (args, _owner, guard) => {
      const { workId } = McpWorkTypographyReadSchema.parse(args);
      const profile = await withLibraryRead(() =>
        readWorkTypographyProfile(workId),
      );
      guard();
      return {
        workId,
        revision: profile ? compositeFingerprint(profile) : null,
        profile,
      };
    },
  });
}
function typographyPreviewTool(plans: Plans) {
  return createMcpBatchTool({
    name: "carrot_preview_work_typography",
    schema: McpWorkTypographyChangeSchema,
    scopes: ["carrot.read"],
    write: false,
    description:
      "Preview a role palette from 2–4 actual font specimens. Retains existing user locks, exceptions and orientation rules. Saves no profile. Apply the returned planId; preview expires after 30 minutes.",
    execute: async (args, owner, guard) => {
      const input = McpWorkTypographyChangeSchema.parse(args);
      const current = await withLibraryRead(() =>
        readWorkTypographyProfile(input.workId),
      );
      const fontFingerprint = await readMcpCompositeFontEnvironment(guard);
      const profile = await previewWorkTypography(
        input,
        current,
        fontFingerprint,
        readMcpQualityEvidence,
        new Date().toISOString(),
        {
          catalogVersion: resolveFontMatchingV2CatalogVersion(
            loadBuiltInFontMatchingCandidates("ko", (message, detail) =>
              logError(message, detail),
            ),
          ),
          modelVersion: FONT_MATCHING_V2_MODEL_VERSION,
          rendererHash: FONT_MATCHING_V2_RENDERER_HASH,
        },
      );
      guard();
      for (const [id, plan] of plans)
        if (plan.expiresAt <= Date.now()) plans.delete(id);
      if (plans.size >= 64)
        throw new McpEditError(
          "invalid_edit",
          "Too many live work palette previews.",
        );
      const planId = randomUUID();
      plans.set(planId, {
        owner,
        input,
        profile,
        fontFingerprint,
        expiresAt: Date.now() + 30 * 60_000,
      });
      return {
        planId,
        before: current,
        after: profile,
        distinctCoreFonts: new Set(
          profile.visualSelections?.map((item) => item.selection.fontId),
        ).size,
        visualQualityVerified: false,
      };
    },
  });
}
function typographyApplyTool(plans: Plans) {
  return createMcpBatchTool({
    name: "carrot_apply_work_typography",
    schema: z.object({ planId: z.uuid() }).strict(),
    scopes: ["carrot.read", "carrot.edit"],
    write: true,
    description:
      "Apply an owned palette preview if profile and font bytes still match. Repeating the same plan is idempotent. Changes work policy only; does not restyle existing blocks or replace user locks.",
    execute: async (args, owner, guard) => {
      const plan = plans.get((args as { planId: string }).planId);
      if (!plan || plan.owner !== owner || plan.expiresAt <= Date.now())
        throw new McpEditError(
          "not_found",
          "Work palette preview missing or expired.",
        );
      return withLibraryContentEdit(
        [{ kind: "work-context", scope: plan.input.workId, access: "write" }],
        () =>
          withLibraryMutation(async () => {
            guard();
            const current = await readWorkTypographyProfile(plan.input.workId);
            const revision = current ? compositeFingerprint(current) : null;
            const nextRevision = compositeFingerprint(plan.profile);
            if (revision !== nextRevision) {
              if (
                revision !== plan.input.revision ||
                (await readMcpCompositeFontEnvironment(guard)) !==
                  plan.fontFingerprint
              )
                throw new McpEditError(
                  "revision_conflict",
                  "Work palette or font files changed after preview.",
                );
              guard();
              await writeWorkTypographyProfile(plan.profile);
            }
            return {
              workId: plan.input.workId,
              revision: nextRevision,
              profile: plan.profile,
            };
          }),
      );
    },
  });
}
export function createMcpWorkTypographyTools(editing: boolean) {
  const plans: Plans = new Map();
  return [
    typographyReadTool(),
    ...(editing
      ? [typographyPreviewTool(plans), typographyApplyTool(plans)]
      : []),
  ];
}
