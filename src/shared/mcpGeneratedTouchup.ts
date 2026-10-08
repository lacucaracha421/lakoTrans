import { z } from "zod/v4";
import { letteringSelectionSchema } from "./generatedLetteringPartMove";
import {
  letteringMaskStrokesSchema,
  letteringOutlineSchema,
  letteringOcclusionSchema,
} from "./generatedLetteringMaskSchemas";

/** Coordinates and radii are normalized 0..1000 in the explicitly named space. */
export const McpGeneratedTouchupSchema = z
  .object({
    kind: z.literal("generated-touchup"),
    edits: z
      .array(
        z
          .object({
            blockId: z.string().min(1).max(200),
            assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
            moves: z
              .array(
                z
                  .object({
                    space: z.enum(["asset", "page"]),
                    polygon: letteringSelectionSchema,
                    from: z
                      .object({
                        x: z.number().finite().min(0).max(1000),
                        y: z.number().finite().min(0).max(1000),
                      })
                      .strict(),
                    to: z
                      .object({
                        x: z.number().finite().min(0).max(1000),
                        y: z.number().finite().min(0).max(1000),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .max(16)
              .default([]),
            strokes: z
              .array(
                letteringMaskStrokesSchema.element
                  .extend({
                    mode: z.enum(["hide", "restore", "paint"]),
                    color: z
                      .string()
                      .regex(/^#[0-9a-f]{6}$/i)
                      .optional(),
                  })
                  .refine(
                    (stroke) =>
                      stroke.mode !== "paint" || Boolean(stroke.color),
                    {
                      message: "Paint requires an explicit color.",
                    },
                  ),
              )
              .max(100)
              .default([]),
            outline: letteringOutlineSchema.nullable().optional(),
            occlusionPolygons: letteringOcclusionSchema.nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (edits) =>
          new Set(edits.map((edit) => edit.blockId)).size === edits.length,
      ),
  })
  .strict();
export type McpGeneratedTouchup = z.infer<typeof McpGeneratedTouchupSchema>;
