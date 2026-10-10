import { z } from "zod";

const id = z.string().uuid();
const CurrentViewContextSchema = z
  .object({
    workId: id.nullable(),
    workTitle: z.string().nullable(),
    chapterId: id.nullable(),
    chapterTitle: z.string().nullable(),
    pageId: id.nullable(),
    pageNumber: z.number().int().positive().nullable(),
    blockIds: z.array(z.string()).max(10000),
    revision: z.string().nullable().optional(),
  })
  .strict();
export const ChatImageSchema = z
  .object({ id, name: z.string(), dataUrl: z.string() })
  .strict();
const item = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "tool", "status"]),
    text: z.string(),
    state: z.enum(["running", "completed", "failed"]),
    createdAt: z.number(),
    toolName: z.string().optional(),
    toolFingerprint: z.string().optional(),
    observed: z.boolean().optional(),
    imageIds: z.array(id).optional(),
    context: CurrentViewContextSchema.optional(),
    chapterId: id.optional(),
    pageId: id.optional(),
    delivery: z.enum(["pending", "sent", "uncertain"]).optional(),
  })
  .strict();
const question = z
  .object({
    id: z.string(),
    questions: z.array(
      z
        .object({
          id: z.string(),
          question: z.string(),
          options: z.array(
            z.object({ label: z.string(), description: z.string() }).strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export const ChatSessionSchema = z
  .object({
    version: z.literal(1),
    id,
    title: z.string(),
    runtime: z.enum(["codex", "claude"]),
    nativeThreadId: z.string().nullable(),
    model: z.string().nullable(),
    effort: z.string().nullable(),
    state: z.enum([
      "idle",
      "running",
      "compacting",
      "needs-input",
      "paused",
      "failed",
    ]),
    createdAt: z.number(),
    updatedAt: z.number(),
    items: z.array(item),
    question: question.nullable(),
    usage: z
      .object({ totalTokens: z.number(), contextWindow: z.number().nullable() })
      .strict()
      .optional(),
    checkpoint: z.array(
      z
        .object({
          toolName: z.string(),
          record: z.record(z.string(), z.unknown()),
          at: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
export const ChatSummarySchema = ChatSessionSchema.pick({
  runtime: true,
  id: true,
  title: true,
  state: true,
  updatedAt: true,
  model: true,
  effort: true,
});
export const ChatSendRequestSchema = z
  .object({
    sessionId: id,
    messageId: id,
    text: z.string().max(500000),
    imageIds: z.array(id).max(20),
    context: CurrentViewContextSchema,
    model: z.string().nullable(),
    effort: z.string().nullable(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.text.trim() || value.imageIds.length),
    "메시지 또는 이미지를 추가하세요.",
  );
export const ChatEventSchema = z
  .object({ sessionId: id, session: ChatSessionSchema })
  .strict();
