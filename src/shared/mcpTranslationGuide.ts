import { z } from "zod/v4";
import { McpSourceRectPatchSchema } from "./mcpSourceRect";
import {
  McpImageRouteInputSchema,
  McpTranslationQualityPolicySchema,
  McpTranslationSavedQualitySchema,
} from "./mcpTranslationQuality";

const { chapterId, pageId, revision } = McpSourceRectPatchSchema.shape;
export const McpTranslationCompletionSchema = z
  .object({
    scope: z.enum(["whole-chapter", "selected-pages"]),
    status: z.enum([
      "incomplete",
      "accepted-at-current-revisions",
      "accepted-with-font-substitutions",
    ]),
    chapterPageCount: z.number().int().nonnegative(),
    checkedPages: z.number().int().nonnegative(),
    acceptedPages: z.number().int().nonnegative(),
    pages: z
      .array(
        z
          .object({
            pageId,
            revision,
            status: z.enum(["pending", "stale", "accepted"]),
            compositeId: z.uuid().optional(),
            reason: z.string(),
          })
          .strict(),
      )
      .max(50),
    fontSubstitutions: z
      .array(
        z
          .object({
            pageId,
            itemId: z.string(),
            reason: z.string(),
          })
          .strict(),
      )
      .max(50000),
    nextAction: z.string(),
    observation: z.literal(
      "current-owned-v2-evidence; not-an-aesthetic-guarantee",
    ),
  })
  .strict();
export type McpTranslationCompletion = z.infer<
  typeof McpTranslationCompletionSchema
>;
export const McpTranslationGuideInputSchema = z
  .object({
    chapterId,
    pageIds: z
      .array(pageId)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    imageCapabilities: McpImageRouteInputSchema.optional(),
    mode: z.enum(["detailed", "quick"]).optional(),
    soundEffectScope: z.enum(["translate", "preserve-original"]).optional(),
  })
  .strict();
export const McpTranslationGuideOutputSchema = z
  .object({
    chapterId,
    workId: z.string(),
    chapterPageCount: z.number().int().nonnegative(),
    previousChapterId: chapterId.nullable(),
    context: z
      .object({
        revision: z.string().nullable(),
        glossaryEntries: z.number().int().nonnegative(),
        characters: z.number().int().nonnegative(),
        memoryPages: z.number().int().nonnegative(),
        state: z.enum(["available", "unavailable"]),
      })
      .strict(),
    pages: z
      .array(
        z
          .object({
            pageId,
            revision,
            reviewRevision: revision,
            width: z.number(),
            height: z.number(),
            blocks: z.number().int().nonnegative(),
            explicitFonts: z.number().int().nonnegative(),
            savedQuality: McpTranslationSavedQualitySchema,
            requiresVisualSourceInspection: z.literal(true),
          })
          .strict(),
      )
      .max(50),
    qualityPolicy: McpTranslationQualityPolicySchema.nullable(),
    mode: z.enum(["detailed", "quick"]),
    soundEffectScope: z.enum(["translate", "preserve-original"]),
    recommendedChunkPages: z.literal(5),
    completion: McpTranslationCompletionSchema.optional(),
    workTypography: z
      .object({ revision: z.string().nullable(), profile: z.unknown() })
      .optional(),
    requiredEvidence: z.array(z.string()),
    clientGuidance: z
      .object({ profile: z.literal("other"), instruction: z.string() })
      .strict()
      .optional(),
    maxReviewPasses: z.literal(3),
    imageRoute: z
      .object({
        route: z.string(),
        reason: z.string(),
        remainingAttempts: z.number().int().min(0).max(4),
      })
      .strict(),
    capabilityOrigin: z.literal(
      "mcp-tools-server-observed; image-capabilities-host-reported",
    ),
    availableTools: z.array(z.string()),
    missingTools: z.array(z.string()),
    steps: z.array(
      z
        .object({
          id: z.string(),
          instruction: z.string(),
          tools: z.array(z.string()),
        })
        .strict(),
    ),
    completionCriteria: z.array(z.string()),
    modelStarted: z.literal(false),
    qualityVerified: z.literal(false),
  })
  .strict();
