import { randomUUID } from "node:crypto";
import type { ChatItem, ChatSession } from "../../shared/chatTypes";
import { asRecord, type JsonRecord } from "../codexAppServerProtocol";
import { hashStableValue } from "../../shared/blockFingerprint";

export function reduceChatNotification(
  session: ChatSession,
  value: JsonRecord,
): boolean {
  const params = asRecord(value.params);
  if (!params) return false;
  const paused = session.state === "paused";
  switch (value.method) {
    case "item/agentMessage/delta":
      appendDelta(session, params);
      break;
    case "item/started":
    case "item/completed":
      readItemNotification(session, params, value.method === "item/completed");
      break;
    case "turn/started":
      session.state = "running";
      break;
    case "turn/completed":
      finishTurn(session, asRecord(params.turn));
      break;
    case "thread/compacted":
      session.state = params.continuesTurn === true ? "running" : "idle";
      break;
    case "thread/tokenUsage/updated":
      readUsage(session, params);
      break;
    case "error":
      reportRuntimeError(session, params);
      break;
    default:
      return false;
  }
  // A delayed native start/compaction acknowledgement must not undo Stop.
  // Only a new user send is allowed to leave the paused state.
  if (paused) session.state = "paused";
  session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
  return true;
}
function readItemNotification(
  session: ChatSession,
  params: JsonRecord,
  completed: boolean,
) {
  const item = asRecord(params.item);
  if (item) reduceItem(session, item, completed);
}
export function addChatStatus(
  session: ChatSession,
  text: string,
  state: ChatItem["state"] = "completed",
) {
  session.items.push({
    id: randomUUID(),
    role: "status",
    text,
    state,
    createdAt: Date.now(),
  });
}
function ensureItem(
  session: ChatSession,
  id: string,
  role: ChatItem["role"],
): ChatItem {
  const existing = session.items.find((item) => item.id === id);
  if (existing) return existing;
  const item: ChatItem = {
    id,
    role,
    text: "",
    state: "running",
    createdAt: Date.now(),
  };
  session.items.push(item);
  return item;
}
function reduceItem(
  session: ChatSession,
  item: JsonRecord,
  completed: boolean,
) {
  if (item.type === "contextCompaction") {
    session.state = completed ? "running" : "compacting";
    const target = ensureItem(session, String(item.id), "status");
    target.text = completed
      ? "대화 압축 완료 · 작업 기록을 유지합니다."
      : "대화를 압축하고 있습니다…";
    target.state = completed ? "completed" : "running";
  }
  if (item.type === "agentMessage") {
    const target = ensureItem(session, String(item.id), "assistant");
    if (typeof item.text === "string") target.text = item.text;
    target.state = completed ? "completed" : "running";
  }
  if (item.type === "mcpToolCall") {
    reduceTool(session, item, completed);
  }
}
function finishTurn(session: ChatSession, turn: JsonRecord | null) {
  const status = turn?.status;
  session.state =
    status === "completed"
      ? "idle"
      : status === "interrupted"
        ? "paused"
        : "failed";
  session.question = null;
  for (const item of session.items)
    if (item.state === "running")
      item.state = status === "completed" ? "completed" : "failed";
  const error = asRecord(turn?.error);
  if (typeof error?.message === "string")
    addChatStatus(session, error.message, "failed");
}

function appendDelta(session: ChatSession, params: JsonRecord) {
  if (typeof params.itemId !== "string") return;
  const target = ensureItem(session, params.itemId, "assistant");
  target.text += typeof params.delta === "string" ? params.delta : "";
}
function readUsage(session: ChatSession, params: JsonRecord) {
  const usage = asRecord(params.tokenUsage);
  const total = asRecord(usage?.total);
  if (typeof total?.totalTokens !== "number") return;
  session.usage = {
    totalTokens: total.totalTokens,
    contextWindow:
      typeof usage?.modelContextWindow === "number"
        ? usage.modelContextWindow
        : null,
  };
}
function reportRuntimeError(session: ChatSession, params: JsonRecord) {
  const error = asRecord(params.error);
  addChatStatus(
    session,
    typeof error?.message === "string" ? error.message : "Codex 연결 오류",
    "failed",
  );
}
function reduceTool(
  session: ChatSession,
  item: JsonRecord,
  completed: boolean,
) {
  const target = ensureItem(session, String(item.id), "tool");
  target.toolName = typeof item.tool === "string" ? item.tool : "carrot";
  target.toolFingerprint = hashStableValue(item.arguments ?? {});
  if (!target.text) target.text = target.toolName;
  target.state = !completed
    ? "running"
    : item.status === "failed"
      ? "failed"
      : "completed";
}
