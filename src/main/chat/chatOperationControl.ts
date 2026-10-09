import { randomUUID } from "node:crypto";
import type { ChatSession } from "../../shared/chatTypes";
import { asRecord } from "../codexAppServerProtocol";

type Connection = { url: string; token: string };
type Target = { kind: string; id: string; idKey: "jobId" | "id" | "batchId" };
const BATCH_KINDS = new Set([
  "translation_batch",
  "format_batch",
  "typography_batch",
  "selection_batch",
  "lettering_batch",
  "sound_effect_batch",
  "image_edit",
  "external_image",
]);

/** Only explicit owned receipts are cancelled, using the same public native contracts. */
export async function cancelChatOperations(
  connection: Connection,
  session: ChatSession,
) {
  const failures: unknown[] = [];
  // The shared HTTP boundary has a concurrency limit. Cancellation must not
  // flood it, nor let one expired receipt prevent cancellation of newer work.
  for (const target of cancellationTargets(session)) {
    try {
      const args = { [target.idKey]: target.id };
      const current = await callControl(
        connection,
        `carrot_get_${target.kind}`,
        args,
      );
      if (current.status !== "running") continue;
      const mutation = cancelArguments(target, current);
      await callControl(connection, `carrot_cancel_${target.kind}`, mutation);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "일부 앱 작업의 중지 상태를 확인하지 못했습니다.",
    );
}
function cancellationTargets(session: ChatSession): Target[] {
  const targets = new Map<string, Target>();
  for (const { toolName, record } of session.checkpoint) {
    const target = receiptTarget(toolName, record);
    if (!target) continue;
    const id = target.id;
    if (
      ["completed", "failed", "cancelled", "saved", "partial"].includes(
        String(record.status),
      )
    ) {
      targets.delete(id);
      continue;
    }
    if (
      ["running", "accepted", "already_started"].includes(String(record.status))
    )
      targets.set(id, target);
  }
  return [...targets.values()];
}
function receiptTarget(
  tool: string,
  record: Record<string, unknown>,
): Target | null {
  if (typeof record.jobId === "string")
    return { kind: "job", id: record.jobId, idKey: "jobId" };
  const kind = /^carrot_(?:run|resume|get|apply|undo|redo|cancel)_(.+)$/.exec(
    tool,
  )?.[1];
  if (!kind) return null;
  if (typeof record.batchId === "string" && BATCH_KINDS.has(kind))
    return { kind, id: record.batchId, idKey: "batchId" };
  if (typeof record.id === "string" && ["composite", "workflow"].includes(kind))
    return { kind, id: record.id, idKey: "id" };
  return null;
}
function cancelArguments(target: Target, current: Record<string, unknown>) {
  const args = { [target.idKey]: target.id };
  if (target.kind === "composite")
    return { ...args, version: current.version, requestId: randomUUID() };
  if (target.idKey !== "batchId") return args;
  if (typeof current.activeRequestId !== "string")
    throw new Error("현재 묶음 작업의 실행 ID를 확인하지 못했습니다.");
  return { ...args, requestId: current.activeRequestId };
}
async function callControl(
  connection: Connection,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`앱 작업 상태 확인 실패 (${response.status})`);
  const result = (await response.json()) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: string }[] };
  };
  return readControlReply(result);
}
function readControlReply(result: {
  error?: { message?: string };
  result?: { isError?: boolean; content?: { text?: string }[] };
}) {
  if (result.error) throw new Error(result.error.message ?? "작업 중지 실패");
  const reply = result.result;
  if (!reply) throw new Error("앱 작업 기록 응답이 없습니다.");
  const text = reply.content?.[0]?.text;
  const record = text ? asRecord(JSON.parse(text)) : null;
  if (!record) throw new Error("앱 작업 기록을 읽지 못했습니다.");
  if (reply.isError) {
    // Session-only histories can expire or disappear after a restart. The
    // native authority confirms there is no owned operation left to cancel.
    if (record.error === "not_found") return { status: "not-found" };
    throw new Error(
      typeof record.message === "string" ? record.message : "작업 중지 실패",
    );
  }
  return record;
}
