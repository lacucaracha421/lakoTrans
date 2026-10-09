import { randomUUID } from "node:crypto";
import type { ChatSession, ChatItem } from "../../shared/chatTypes";
import type { McpChatObservation } from "../mcp/mcpLocalHost";
import { asRecord } from "../codexAppServerProtocol";
import type { ChatRepository } from "./chatRepository";
import { hashStableValue } from "../../shared/blockFingerprint";

export async function observeChatTool(
  session: ChatSession,
  observation: McpChatObservation,
  repository: Pick<ChatRepository, "addImage">,
) {
  const { imageIds, texts } = await captureContent(
    session.id,
    observation,
    repository,
  );
  recordTool(session, observation, imageIds, texts);
}
async function captureContent(
  sessionId: string,
  observation: McpChatObservation,
  repository: Pick<ChatRepository, "addImage">,
) {
  const imageIds: string[] = [];
  const texts: string[] = [];
  for (const content of observation.content) {
    if (content.type === "image") {
      const image = await repository.addImage(
        sessionId,
        observation.name,
        `data:${content.mimeType};base64,${content.data}`,
      );
      imageIds.push(image.id);
    }
    if (content.type === "text") texts.push(content.text);
  }
  return { imageIds, texts };
}
function recordTool(
  session: ChatSession,
  observation: McpChatObservation,
  imageIds: string[],
  texts: string[],
) {
  const text = texts.join("\n");
  const args = observation.args;
  const fingerprint = hashStableValue(args);
  const existing = session.items.find(
    (item) =>
      item.role === "tool" &&
      item.toolName === observation.name &&
      item.toolFingerprint === fingerprint &&
      !item.observed,
  );
  const item: ChatItem = {
    id: existing?.id ?? randomUUID(),
    role: "tool",
    toolName: observation.name,
    text,
    state: "completed",
    createdAt: Date.now(),
    imageIds,
    toolFingerprint: fingerprint,
    observed: true,
    ...(typeof args.chapterId === "string"
      ? { chapterId: args.chapterId }
      : {}),
    ...(typeof args.pageId === "string" ? { pageId: args.pageId } : {}),
  };
  if (existing) Object.assign(existing, item);
  else session.items.push(item);
  for (const text of texts) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (_error) {
      // error-policy-allow: plain-text MCP output has no structured operation receipt.
      continue;
    }
    const record = asRecord(value);
    if (record && hasReceipt(record))
      session.checkpoint.push({
        toolName: observation.name,
        record: referenceFields(record),
        at: Date.now(),
      });
  }
}
function hasReceipt(record: Record<string, unknown>) {
  return (
    [
      "jobId",
      "workflowId",
      "compositeId",
      "recordId",
      "batchId",
      "retained",
      "retention",
      "completion",
      "qualityPolicy",
    ].some((key) => key in record) ||
    ("id" in record && "status" in record)
  );
}
function referenceFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) => {
      if (/url|token|secret|data|path|prompt|content|text/i.test(key))
        return [];
      return [[key, referenceValue(value)]];
    }),
  );
}

function referenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(referenceValue);
  const nested = asRecord(value);
  return nested ? referenceFields(nested) : value;
}
