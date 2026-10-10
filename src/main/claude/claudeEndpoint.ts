import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { getAppPaths } from "../appPaths";
import {
  MAX_CODEX_RESPONSES_REQUEST_BYTES,
  parseCodexResponsesRequest,
} from "../codexAppServerResponsesRequest";
import { runClaudeCompletion } from "./claudeCompletion";

export type ClaudeEndpoint = {
  provider: "claude-code";
  baseUrl: string;
  child: null;
  startedByScript: true;
  close: () => Promise<void>;
};
export async function startClaudeEndpoint(
  paths = getAppPaths(),
): Promise<ClaudeEndpoint> {
  const active = new Set<AbortController>();
  const server = createServer((request, response) => {
    const controller = new AbortController();
    active.add(controller);
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    void handle(request, response, controller.signal, paths)
      .catch((error: unknown) => {
        if (response.destroyed) return;
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      })
      .finally(() => active.delete(controller));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    provider: "claude-code",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    child: null,
    startedByScript: true,
    close: async () => {
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  paths: ReturnType<typeof getAppPaths>,
) {
  if (
    request.headers.origin ||
    request.method !== "POST" ||
    request.url !== "/v1/responses"
  ) {
    response.writeHead(403).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CODEX_RESPONSES_REQUEST_BYTES) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  const input = parseCodexResponsesRequest(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  const result = await runClaudeCompletion(paths, { ...input, signal });
  if (signal.aborted || response.destroyed) return;
  const output = {
    type: "message",
    id: randomUUID(),
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: result.text, annotations: [] }],
  };
  const completed = {
    id: randomUUID(),
    object: "response",
    status: "completed",
    model: input.model,
    output: [output],
    output_text: result.text,
    usage: result.usage,
  };
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: result.text })}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}\n\ndata: [DONE]\n\n`,
  );
}

export function isClaudeEndpoint(value: unknown): value is ClaudeEndpoint {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    value.provider === "claude-code"
  );
}
