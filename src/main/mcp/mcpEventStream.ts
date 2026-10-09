import type { IncomingMessage, ServerResponse } from "node:http";
import { McpHttpError, validateMcpGet } from "./mcpHttpPolicy";

/** Optional Streamable HTTP listening channel. Comments carry no tool results,
 * session IDs or replay state; all operations still use authenticated POSTs. */
export function openMcpEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    streams: Set<ServerResponse>;
    authorize: (request: IncomingMessage) => Promise<void>;
    reportError: (error: unknown) => void;
  },
): boolean {
  if (request.method !== "GET") return false;
  validateMcpGet(request);
  options.streams.add(response);
  response.once("close", () => options.streams.delete(response));
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 15000\n: connected\n\n");
  let checking = false;
  const timer = setInterval(() => void heartbeat(), 15_000);
  timer.unref();
  response.once("close", () => clearInterval(timer));
  return true;
  async function heartbeat() {
    if (checking || response.destroyed || response.writableEnded) return;
    checking = true;
    try {
      await options.authorize(request);
      if (!response.destroyed && !response.writableEnded)
        response.write(": keepalive\n\n");
    } catch (error) {
      response.destroy();
      if (!(error instanceof McpHttpError)) options.reportError(error);
    } finally {
      checking = false;
    }
  }
}
