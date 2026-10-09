import { z } from "zod";
import { defineIpcContract } from "./ipcContractCore";
import {
  ChatImageSchema,
  ChatSendRequestSchema,
  ChatSessionSchema,
  ChatSummarySchema,
} from "./chatSchemas";
import type {
  ChatImage,
  ChatSendRequest,
  ChatSession,
  ChatSummary,
} from "./chatTypes";

const id = z.string().uuid();
export const chatIpcContracts = {
  listChats: defineIpcContract<[], ChatSummary[]>({
    apiKey: "listChats",
    channel: "chat:list",
    args: z.tuple([]),
    result: z.array(ChatSummarySchema),
  }),
  createChat: defineIpcContract<[], ChatSession>({
    apiKey: "createChat",
    channel: "chat:create",
    args: z.tuple([]),
    result: ChatSessionSchema,
  }),
  readChat: defineIpcContract<[string], ChatSession>({
    apiKey: "readChat",
    channel: "chat:read",
    args: z.tuple([id]),
    result: ChatSessionSchema,
  }),
  sendChat: defineIpcContract<[ChatSendRequest], ChatSession>({
    apiKey: "sendChat",
    channel: "chat:send",
    args: z.tuple([ChatSendRequestSchema]),
    result: ChatSessionSchema,
  }),
  stopChat: defineIpcContract<[string], ChatSession>({
    apiKey: "stopChat",
    channel: "chat:stop",
    args: z.tuple([id]),
    result: ChatSessionSchema,
  }),
  compactChat: defineIpcContract<[string], ChatSession>({
    apiKey: "compactChat",
    channel: "chat:compact",
    args: z.tuple([id]),
    result: ChatSessionSchema,
  }),
  answerChat: defineIpcContract<
    [string, string, Record<string, string>],
    ChatSession
  >({
    apiKey: "answerChat",
    channel: "chat:answer",
    args: z.tuple([id, z.string(), z.record(z.string(), z.string())]),
    result: ChatSessionSchema,
  }),
  attachChatImage: defineIpcContract<[string, string, string], ChatImage>({
    apiKey: "attachChatImage",
    channel: "chat:attach-image",
    args: z.tuple([id, z.string().max(256), z.string().max(28 * 1024 * 1024)]),
    result: ChatImageSchema,
  }),
  readChatImage: defineIpcContract<[string, string], ChatImage>({
    apiKey: "readChatImage",
    channel: "chat:read-image",
    args: z.tuple([id, id]),
    result: ChatImageSchema,
  }),
};
