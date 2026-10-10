import { Readable } from "node:stream";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type {
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" };
import type { AppPaths } from "../appPaths";
import type { ClaudeEffort } from "../../shared/claudeTypes";

export const CLAUDE_VERSION = "2.1.294";
const requireHere = createRequire(__filename);

export function claudeBinary(
  paths: Pick<AppPaths, "isPackaged" | "resourcesDir">,
): string {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  if (paths.isPackaged) return join(paths.resourcesDir, "claude", name);
  const manifest = requireHere.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
  );
  return join(dirname(manifest), name);
}

/** Credentials remain owned by the official CLI; the app never reads its tokens. */
export async function startClaudeRuntime(
  paths: AppPaths,
  options: Options = {},
) {
  const cwd = options.cwd ?? join(paths.dataRoot, "claude-workspace");
  await mkdir(cwd, { recursive: true });
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const input = new Readable({ objectMode: true, read() {} });
  const stream: Query = query({
    prompt: input as AsyncIterable<SDKUserMessage>,
    options: {
      pathToClaudeCodeExecutable: claudeBinary(paths),
      cwd,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
      persistSession: false,
      permissionMode: "default",
      extraArgs: { restricted: null },
      ...options,
    },
  });
  let closed = false;
  return {
    stream,
    push: (message: SDKUserMessage) => {
      input.push(message);
    },
    close: () => {
      if (closed) return;
      closed = true;
      input.push(null);
      stream.close();
      input.destroy();
    },
  };
}

export function claudeEffort(value?: string | null): ClaudeEffort {
  if (
    value === "low" ||
    value === "medium" ||
    value === "xhigh" ||
    value === "max"
  )
    return value;
  return "high";
}

export function claudeMessage(
  id: string,
  sessionId: string,
  input:
    | { type: "text"; text: string }[]
    | ({ type: "text"; text: string } | { type: "image"; url: string })[],
): SDKUserMessage {
  return {
    type: "user",
    uuid: id as `${string}-${string}-${string}-${string}-${string}`,
    session_id: sessionId,
    parent_tool_use_id: null,
    ...(input.length === 1 &&
    input[0].type === "text" &&
    input[0].text === "/compact"
      ? {}
      : { client_composed: true as const }),
    message: {
      role: "user",
      content: input.map((part) => {
        if (part.type === "text") return part;
        const match =
          /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
            part.url,
          );
        if (!match)
          throw new Error(
            "Claude 이미지 입력은 PNG, JPEG, GIF, WebP 데이터여야 합니다.",
          );
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: match[1] as
              "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: match[2],
          },
        };
      }),
    },
  };
}
