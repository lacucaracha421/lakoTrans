import { randomUUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with {
  "resolution-mode": "import",
};
import type { AppPaths } from "../appPaths";
import {
  claudeEffort,
  claudeMessage,
  startClaudeRuntime,
} from "./claudeRuntime";

export type ClaudeCompletionRequest = {
  model: string;
  effort?: string;
  instructions: string;
  input: ({ type: "text"; text: string } | { type: "image"; url: string })[];
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  tools?: string[];
  onMessage?: (message: SDKMessage) => void;
};

/** One isolated structured task; no library writes or generator tools. */
export async function runClaudeCompletion(
  paths: AppPaths,
  request: ClaudeCompletionRequest,
) {
  request.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", abort, { once: true });
  let runtime: Awaited<ReturnType<typeof startClaudeRuntime>> | undefined;
  try {
    runtime = await startClaudeRuntime(paths, {
      model: request.model,
      effort: claudeEffort(request.effort),
      abortController: controller,
      systemPrompt: request.instructions,
      tools: request.tools ?? [],
      allowedTools: request.tools ?? [],
      ...(request.outputSchema
        ? {
            outputFormat: { type: "json_schema", schema: request.outputSchema },
          }
        : {}),
    });
    request.signal?.throwIfAborted();
    runtime.push(claudeMessage(randomUUID(), "", request.input));
    for await (const message of runtime.stream) {
      request.onMessage?.(message);
      if (message.type !== "result") continue;
      return completedResult(message);
    }
    throw new Error("Claude가 완료 결과 없이 종료되었습니다.");
  } finally {
    request.signal?.removeEventListener("abort", abort);
    runtime?.close();
  }
}

function completedResult(message: Extract<SDKMessage, { type: "result" }>) {
  if (message.subtype !== "success" || message.is_error)
    throw new Error(
      message.subtype === "success"
        ? message.result
        : message.errors.join("\n"),
    );
  const text =
    message.structured_output === undefined
      ? message.result
      : JSON.stringify(message.structured_output);
  if (!text.trim()) throw new Error("Claude가 빈 응답을 반환했습니다.");
  return {
    text,
    usage: message.usage,
    modelUsage: message.modelUsage,
    sessionId: message.session_id,
    resultId: message.uuid,
  };
}
