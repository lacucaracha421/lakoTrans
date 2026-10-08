import { z } from "zod/v4";
import { FONT_MATCHING_SEMANTIC_ROLES } from "./fontMatchingProfileTypes";
const fontId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const McpWorkTypographyReadSchema = z
  .object({ workId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
  .strict();
export const McpWorkTypographyChangeSchema = McpWorkTypographyReadSchema.extend(
  {
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    selections: z
      .array(
        z
          .object({
            role: z
              .enum(FONT_MATCHING_SEMANTIC_ROLES)
              .refine((role) => role !== "unknown_needs_review"),
            fontId,
            fontWeight: z.number().int().min(100).max(900).optional(),
            italic: z.boolean().optional(),
            candidateFontIds: z
              .array(fontId)
              .min(2)
              .max(4)
              .refine((ids) => new Set(ids).size === ids.length),
            specimenId: z.uuid(),
            reason: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(15)
      .refine(
        (items) =>
          new Set(items.map((item) => item.role)).size === items.length,
      ),
  },
).strict();
export type McpWorkTypographyChange = z.infer<
  typeof McpWorkTypographyChangeSchema
>;
