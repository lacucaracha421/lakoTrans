import { z } from "zod/v4";
import {
  GeneratedGlyphShapeSchema,
  GlyphInspectionGeometrySchema,
} from "./generatedGlyphReview";
import { WorkTypographyProfileV2Schema } from "./fontMatchingProfileSchemas";
import { McpQualityEvidenceSchema } from "./mcpQualityEvidence";
import { pageExportLayoutEvidenceSchema } from "./pageExportContracts";
import { LetteringTextStructureSchema } from "./letteringTextStructure";

const id = z.string().min(1).max(200);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
export const McpSoundEffectCandidateMetadataSchema = z
  .object({
    id: z.uuid(),
    chapterId: id,
    pageId: id,
    blockId: id,
    baseRevision: z.string(),
    baseBlockFingerprint: sha,
    attempt: count.min(1).max(4),
    touchupPasses: count.max(2),
    touchupRequests: z
      .array(z.object({ id: z.uuid(), fingerprint: sha }).strict())
      .max(2)
      .optional(),
    instructions: z.string(),
    issues: z.array(z.string()),
    readback: z
      .object({
        expectedText: z.string(),
        readText: z.string(),
        compositionFingerprint: sha,
        passed: z.boolean(),
        shape: GeneratedGlyphShapeSchema.optional(),
      })
      .strict()
      .optional(),
    status: z.enum([
      "reserved",
      "pending-repair",
      "readback-passed",
      "refused",
    ]),
  })
  .strict();
export const mcpRenderedPageEvidenceFields = {
  layout: pageExportLayoutEvidenceSchema.optional(),
  layoutWarnings: z
    .array(z.object({ blockId: id, reasons: z.array(z.string()) }).strict())
    .optional(),
  layoutUnits: z
    .literal("original-image-pixels-before-block-transforms")
    .optional(),
  fontMeasurement: z.string().optional(),
  generatedAssets: z
    .array(
      z
        .object({
          blockId: id,
          assetSha256: sha.nullable(),
          targetStructure: LetteringTextStructureSchema.optional(),
          touchupCoordinates: z.literal(
            "normalized_1000_in_named_asset_or_page_space",
          ),
        })
        .strict(),
    )
    .optional(),
};
const workProfile = z
  .object({
    workId: id,
    revision: sha.nullable(),
    profile: WorkTypographyProfileV2Schema.nullable(),
  })
  .strict();
export const mcpQualityOutputs = {
  carrot_inspect_translation_source: z
    .object({
      chapterId: id,
      pageId: id,
      sourceEvidenceId: z.uuid(),
      sourceSha256: sha,
      sourceWidth: count.positive(),
      sourceHeight: count.positive(),
      width: count.positive(),
      height: count.positive(),
      inventoryOrigin: z.literal("host-visual-interpretation-required"),
    })
    .strict(),
  carrot_get_quality_evidence: McpQualityEvidenceSchema,
  carrot_get_work_typography: workProfile,
  carrot_apply_work_typography: workProfile,
  carrot_preview_work_typography: z
    .object({
      planId: z.uuid(),
      before: WorkTypographyProfileV2Schema.nullable(),
      after: WorkTypographyProfileV2Schema,
      distinctCoreFonts: count,
      visualQualityVerified: z.literal(false),
    })
    .strict(),
  carrot_get_sound_effect_candidates: z.union([
    z
      .object({
        total: count,
        nextOffset: count.nullable(),
        candidates: z.array(McpSoundEffectCandidateMetadataSchema).max(25),
      })
      .strict(),
    McpSoundEffectCandidateMetadataSchema.extend({
      candidateRevision: sha,
      assetSha256: sha.nullable(),
      expectedText: z.string(),
      inspectionGeometry: GlyphInspectionGeometrySchema.optional(),
    }),
  ]),
  carrot_touchup_sound_effect_candidate: z
    .object({
      candidateId: z.uuid(),
      candidateRevision: sha,
      touchupPasses: count.max(2),
    })
    .strict(),
};
