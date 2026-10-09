import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ChatSession } from "../src/shared/chatTypes";
import { cancelChatOperations } from "../src/main/chat/chatOperationControl";
import { startMcpHttpServer } from "../src/main/mcp/mcpHttpServer";
import { McpEditError } from "../src/main/application/mcpEditPolicy";

it("stops owned native batches using the current action and continues past an expired receipt", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const token = "c".repeat(43);
  const session = stoppedChat();
  const active = randomUUID(),
    old = randomUUID(),
    batch = randomUUID();
  session.checkpoint = [
    receipt("carrot_run_page_erasure", { jobId: "gone", status: "running" }),
    receipt("carrot_run_page_erasure", { jobId: "expired", status: "running" }),
    receipt("carrot_apply_translation_batch", {
      batchId: batch,
      requestId: old,
      status: "accepted",
    }),
    receipt("carrot_run_page_erasure", { jobId: "saved", status: "running" }),
    receipt("carrot_get_job", { jobId: "saved", status: "completed" }),
  ];
  const names = [
    "carrot_get_job",
    "carrot_get_translation_batch",
    "carrot_cancel_translation_batch",
  ];
  const current = {
    batchId: batch,
    chapterId: randomUUID(),
    contextRevision: "a".repeat(16),
    reason: "중지 검증",
    expiresAt: Date.now() + 30000,
    status: "running",
    direction: "apply",
    activeRequestId: active,
    cancellationRequested: false,
    pages: [],
    totalChanges: 1,
    excludedChanges: 0,
    canApply: false,
    canUndo: false,
    canRedo: false,
    warnings: [],
  };
  const server = await startMcpHttpServer({
    config: { port: 0, token },
    reportError: () => undefined,
    tools: names.map((name) => ({
      name,
      description: "Native HTTP boundary fixture",
      readOnly: false,
      inputSchema: { type: "object" },
      invoke: async (args) => {
        calls.push({ name, args });
        if (args.jobId === "gone")
          throw new McpEditError("not_found", "Owned job expired");
        if (args.jobId === "expired") throw new Error("Receipt expired");
        return [
          {
            type: "text" as const,
            text: JSON.stringify(
              name === "carrot_get_translation_batch"
                ? {
                    ...current,
                    offset: 0,
                    limit: 10,
                    nextOffset: null,
                    changes: [],
                  }
                : current,
            ),
          },
        ];
      },
    })),
  });
  try {
    await expect(
      cancelChatOperations({ url: server.url, token }, session),
    ).rejects.toThrow("일부 앱 작업");
    expect(calls).toEqual([
      { name: "carrot_get_job", args: { jobId: "gone" } },
      { name: "carrot_get_job", args: { jobId: "expired" } },
      { name: "carrot_get_translation_batch", args: { batchId: batch } },
      {
        name: "carrot_cancel_translation_batch",
        args: { batchId: batch, requestId: active },
      },
    ]);
  } finally {
    await server.close();
  }
});

function receipt(toolName: string, record: Record<string, unknown>) {
  return { toolName, record, at: Date.now() };
}
function stoppedChat(): ChatSession {
  return {
    version: 1,
    id: randomUUID(),
    title: "중지 시험",
    runtime: "codex",
    nativeThreadId: null,
    model: null,
    effort: null,
    state: "paused",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items: [],
    checkpoint: [],
    question: null,
  };
}
