import { z } from "zod";
import { finiteNumber, uuid } from "./ipcSchemaPrimitives";

const PageTimingSessionRefSchema = z
  .object({
    id: uuid,
    startedAtEpochMs: finiteNumber.min(0),
  })
  .strict();

export const FinishPageTimingSessionRequestSchema = z
  .object({
    chapterId: uuid,
    sessionId: uuid,
    elapsedMs: finiteNumber.min(0),
    state: z.enum(["interrupted", "completed"]),
  })
  .strict();

export const PageTimingSessionFields = {
  timingSession: PageTimingSessionRefSchema.optional(),
};

const LegacyPageProcessingTimingStagesSchema = z
  .object({
    preparing: z.number().int().min(0).max(604_800_000).optional(),
    ocr: z.number().int().min(0).max(604_800_000).optional(),
    translation: z.number().int().min(0).max(604_800_000).optional(),
    postprocessing: z.number().int().min(0).max(604_800_000).optional(),
    typography: z.number().int().min(0).max(604_800_000).optional(),
    inpainting: z.number().int().min(0).max(604_800_000).optional(),
    bubbleLayout: z.number().int().min(0).max(604_800_000).optional(),
  })
  .strict();
const PageProcessingTimingStagesSchema = z
  .object({
    preparing: z.number().int().min(0).max(604_800_000).optional(),
    ocr: z.number().int().min(0).max(604_800_000).optional(),
    translation: z.number().int().min(0).max(604_800_000).optional(),
    typography: z.number().int().min(0).max(604_800_000).optional(),
    inpainting: z.number().int().min(0).max(604_800_000).optional(),
  })
  .strict();
const LegacyPageProcessingTimingSchema = z
  .object({
    version: z.literal(1),
    stages: LegacyPageProcessingTimingStagesSchema,
    measuredAt: z.string().datetime(),
    translationJobId: z.string().min(1).max(200).optional(),
    inpaintingJobId: z.string().min(1).max(200).optional(),
  })
  .strict();
const PageProcessingTimingV2Schema = z
  .object({
    version: z.literal(2),
    stages: PageProcessingTimingStagesSchema,
    measuredAt: z.string().datetime(),
    sessionId: z.string().min(1).max(200),
    state: z.enum(["running", "interrupted", "completed"]),
    checkpoint: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    translationJobId: z.string().min(1).max(200).optional(),
    inpaintingJobId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const PageProcessingTimingSchema = z.union([
  LegacyPageProcessingTimingSchema,
  PageProcessingTimingV2Schema,
]);
