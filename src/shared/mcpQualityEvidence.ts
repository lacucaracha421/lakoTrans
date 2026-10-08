import { z } from "zod/v4";
import {
  GeneratedGlyphShapeSchema,
  GlyphInspectionGeometrySchema,
} from "./generatedGlyphReview";
const id = z.string().min(1).max(200);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const base = { id: z.uuid(), createdAt: z.number().int().nonnegative() };
const McpFontSpecimenEvidenceSchema = z
  .object({
    ...base,
    kind: z.literal("font-specimen"),
    fontFingerprint: sha,
    catalogSnapshot: z.string(),
    text: z.string().max(2000),
    context: z
      .object({ chapterId: id, pageId: id, blockId: id, revision: z.string() })
      .strict()
      .optional(),
    samples: z
      .array(
        z.object({ fontId: id, imageSha256: sha, label: z.string() }).strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
const McpSourceEvidenceSchema = z
  .object({
    ...base,
    kind: z.literal("source-page"),
    chapterId: id,
    pageId: id,
    sourceSha256: sha,
    imageSha256: sha,
  })
  .strict();
const McpGlyphEvidenceSchema = z
  .object({
    ...base,
    kind: z.literal("generated-glyphs"),
    chapterId: id,
    pageId: id,
    blockId: id,
    revision: z.string(),
    assetSha256: sha,
    compositionFingerprint: sha,
    imageSha256: sha,
    expectedText: z.string().max(20000),
    readText: z.string().max(20000),
    passed: z.boolean(),
    shape: GeneratedGlyphShapeSchema.optional(),
    inspectionGeometry: GlyphInspectionGeometrySchema.optional(),
  })
  .strict();
export const McpQualityEvidenceSchema = z.discriminatedUnion("kind", [
  McpFontSpecimenEvidenceSchema,
  McpSourceEvidenceSchema,
  McpGlyphEvidenceSchema,
]);
export type McpQualityEvidence = z.infer<typeof McpQualityEvidenceSchema>;

/** Host interpretation is explicit; native receipts prove bytes and freshness, not aesthetics. */
export const McpDetailedPageAssessmentSchema = z
  .object({
    sourceEvidenceId: z.uuid(),
    inventory: z
      .array(
        z
          .object({
            itemId: id,
            blockId: id.optional(),
            sourceRect: z
              .object({
                x: z.number().nonnegative(),
                y: z.number().nonnegative(),
                w: z.number().positive(),
                h: z.number().positive(),
              })
              .strict(),
            role: z.enum([
              "dialogue",
              "thought",
              "narration",
              "aside",
              "label",
              "sound",
            ]),
            outcome: z.enum([
              "editable-text",
              "generated-lettering",
              "font-fallback",
              "intentional-original",
              "unresolved",
            ]),
            restoration: z.enum(["completed", "not-needed", "unresolved"]),
            reason: z.string().trim().min(1).max(1000),
            glyphEvidenceId: z.uuid().optional(),
          })
          .strict(),
      )
      .max(1000),
    fontEvidence: z
      .array(z.object({ fontId: id, specimenId: z.uuid() }).strict())
      .max(100),
    paletteRevision: z.string().nullable(),
    layoutReviewed: z.literal(true),
    exceptions: z
      .array(
        z
          .object({ blockId: id, reason: z.string().trim().min(1).max(1000) })
          .strict(),
      )
      .max(500),
  })
  .strict();
