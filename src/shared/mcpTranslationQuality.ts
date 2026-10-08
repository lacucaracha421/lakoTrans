import { z } from "zod/v4";
import { McpDetailedPageAssessmentSchema } from "./mcpQualityEvidence";

export const McpTranslationQualityPolicySchema = z.enum([
  "complete-translation-v1",
  "complete-translation-v2",
]);
const imageFailure = z.enum([
  "generation-failed",
  "delivery-failed",
  "quality-rejected",
]);
const check = z.enum(["passed", "failed", "unverified"]);
const optionalCheck = z.enum([
  "passed",
  "failed",
  "unverified",
  "not-applicable",
]);
const imageHistory = z
  .object({
    regionId: z.string().trim().min(1).max(200),
    hostAttempts: z.number().int().min(0).max(4),
    appAttempts: z.number().int().min(0).max(4),
    purpose: z.enum(["background-restoration", "korean-lettering"]).optional(),
    touchupPasses: z.number().int().min(0).max(8).optional(),
    outcome: z.enum([
      "generated",
      "local-fallback",
      "unresolved",
      "policy-refused",
    ]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((value) => value.hostAttempts + value.appAttempts <= 4, {
    message:
      "A region has at most four total generation attempts across providers and internal retries.",
  });
export const McpTranslationQualityAssessmentSchema = z
  .object({
    sourceCoverage: check,
    translationAccuracy: check,
    contextConsistency: check,
    soundEffectCoverage: check,
    backgroundRestoration: optionalCheck,
    typography: optionalCheck,
    generatedGlyphs: optionalCheck,
    soundEffectsFound: z.number().int().nonnegative().max(1000),
    soundEffectsCompleted: z.number().int().nonnegative().max(1000),
    unresolved: z.array(z.string().trim().min(1).max(500)).max(100),
    imageHistory: z.array(imageHistory).max(100).default([]),
    detailed: McpDetailedPageAssessmentSchema.optional(),
  })
  .strict()
  .refine((value) => value.soundEffectsCompleted <= value.soundEffectsFound, {
    message: "Completed effects cannot exceed visually found effects.",
  })
  .refine(
    (value) =>
      new Set(
        value.imageHistory.map(
          (item) => `${item.regionId}/${item.purpose ?? "legacy"}`,
        ),
      ).size === value.imageHistory.length,
    { message: "Image history region/purpose pairs must be unique." },
  );
export type McpTranslationQualityAssessment = z.infer<
  typeof McpTranslationQualityAssessmentSchema
>;

/** Saved metadata is evidence of omissions, never proof of exhaustive visual detection. */
export const McpTranslationSavedQualitySchema = z
  .object({
    blocks: z.number().int().nonnegative(),
    generatedLettering: z.number().int().nonnegative(),
    hasCleanedImage: z.boolean(),
    untranslated: z.number().int().nonnegative(),
    missingSource: z.number().int().nonnegative(),
    staleLettering: z.number().int().nonnegative(),
    pendingSoundEffects: z.number().int().nonnegative(),
    soundEffects: z.number().int().nonnegative(),
  })
  .strict();

export const McpImageRouteInputSchema = z
  .object({
    hostGeneration: z
      .enum(["available", "unavailable", "unknown"])
      .default("unknown"),
    hostFileTransfer: z
      .enum(["available", "unavailable", "unknown"])
      .default("unknown"),
    appGeneration: z
      .enum(["available", "unavailable", "unknown"])
      .default("unknown"),
    attemptsUsed: z.number().int().min(0).max(4).default(0),
    policyRefused: z.boolean().default(false),
    hostFailure: imageFailure.optional(),
    appFailure: imageFailure.optional(),
  })
  .strict();
export type McpImageRouteInput = z.infer<typeof McpImageRouteInputSchema>;

/** Host capabilities are explicitly host-reported; MCP cannot discover another tool namespace. */
export function selectMcpImageRoute(input: McpImageRouteInput) {
  const remainingAttempts = 4 - input.attemptsUsed;
  if (input.hostFailure)
    input = {
      ...input,
      hostGeneration: "unavailable",
      hostFileTransfer: "unavailable",
    };
  if (input.appFailure) input = { ...input, appGeneration: "unavailable" };
  if (input.policyRefused)
    return {
      route: "blocked",
      reason: "policy-refusal-no-provider-bypass",
      remainingAttempts: 0,
    };
  if (!remainingAttempts)
    return {
      route: "local",
      reason: "generation-budget-exhausted",
      remainingAttempts,
    };
  if (
    ![input.hostGeneration, input.hostFileTransfer].includes("unavailable") &&
    [input.hostGeneration, input.hostFileTransfer].includes("unknown")
  )
    return {
      route: "check-host",
      reason: "verify-generation-and-real-png-delivery",
      remainingAttempts,
    };
  if (
    [input.hostGeneration, input.hostFileTransfer].every(
      (state) => state === "available",
    )
  )
    return {
      route: "host",
      reason: "host-generation-and-byte-delivery-available",
      remainingAttempts,
    };
  if (input.appGeneration === "unknown")
    return {
      route: "check-app",
      reason: "verify-configured-image-controller",
      remainingAttempts,
    };
  if (input.appGeneration === "available")
    return {
      route: "app",
      reason:
        input.hostFailure ?? "host-generation-or-byte-delivery-unavailable",
      remainingAttempts,
    };
  return {
    route: "local",
    reason: input.appFailure ?? "generative-routes-unavailable",
    remainingAttempts,
  };
}

export function translationQualityPassed(
  quality: McpTranslationQualityAssessment,
) {
  return (
    quality.sourceCoverage === "passed" &&
    quality.translationAccuracy === "passed" &&
    quality.contextConsistency === "passed" &&
    quality.soundEffectCoverage === "passed" &&
    [
      quality.backgroundRestoration,
      quality.typography,
      quality.generatedGlyphs,
    ].every((value) => value === "passed" || value === "not-applicable") &&
    quality.soundEffectsFound === quality.soundEffectsCompleted &&
    !quality.unresolved.length &&
    quality.imageHistory.every(
      (item) =>
        item.outcome === "generated" || item.outcome === "local-fallback",
    )
  );
}
