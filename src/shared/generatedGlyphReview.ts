import { z } from "zod";

export const GlyphInspectionGeometrySchema = z
  .object({
    coordinateSpace: z.literal("original-page-pixels"),
    crop: z
      .object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .strict(),
    pageWidth: z.number().positive(),
    pageHeight: z.number().positive(),
    imageWidth: z.number().int().positive(),
    imageHeight: z.number().int().positive(),
  })
  .strict();
export type GlyphInspectionGeometry = z.infer<
  typeof GlyphInspectionGeometrySchema
>;

const componentCheck = z
  .object({
    verdict: z.enum(["valid", "repair-needed", "uncertain", "not-applicable"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const GeneratedGlyphShapeSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    checks: z
      .object({
        consonants: componentCheck,
        vowels: componentCheck,
        finalConsonants: componentCheck,
        placement: componentCheck,
      })
      .strict()
      .optional(),
    verdict: z.enum(["valid", "repair-needed", "uncertain"]),
    reason: z.string().trim().min(1).max(2000),
    issues: z
      .array(
        z
          .object({
            kind: z.enum([
              "malformed-jamo",
              "misplaced-jamo",
              "missing-stroke",
              "extra-stroke",
              "fused-glyphs",
              "clipped-glyph",
              "ambiguous-glyph",
              "other",
            ]),
            reason: z.string().trim().min(1).max(1000),
            /** Location on the supplied composed crop, not the original asset or page. */
            rect: z
              .object({
                x: z.number().finite().min(0).max(1000),
                y: z.number().finite().min(0).max(1000),
                w: z.number().finite().positive().max(1000),
                h: z.number().finite().positive().max(1000),
              })
              .strict()
              .refine((r) => r.x + r.w <= 1000 && r.y + r.h <= 1000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .refine(
    (review) =>
      review.verdict === "valid"
        ? review.issues.length === 0
        : review.verdict !== "repair-needed" || review.issues.length > 0,
    "A valid shape has no unresolved issues; repair-needed must locate its defects.",
  );
export type GeneratedGlyphShape = z.infer<typeof GeneratedGlyphShapeSchema>;

export const GeneratedGlyphShapeResponseSchema = z
  .object({
    regions: z
      .array(
        z
          .object({ regionId: z.string(), shape: GeneratedGlyphShapeSchema })
          .strict(),
      )
      .max(400),
  })
  .strict();

export function hasValidGeneratedGlyphShape(
  shape?: GeneratedGlyphShape,
): boolean {
  return (
    shape?.version === 2 &&
    shape.verdict === "valid" &&
    shape.issues.length === 0 &&
    shape.checks?.placement.verdict === "valid" &&
    Boolean(shape.checks) &&
    Object.values(shape.checks ?? {}).every(
      (check) =>
        check.verdict === "valid" || check.verdict === "not-applicable",
    )
  );
}
