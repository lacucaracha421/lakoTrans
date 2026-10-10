import { cancelChatOperations } from "./chatOperationControl";
import type { AppPaths } from "../appPaths";
import type { ChatEvent } from "../../shared/chatTypes";
import type { createMcpDesktopRuntime } from "../mcpDesktopRuntime";
import { ChatService } from "../application/chatService";
import { ChatRepository } from "./chatRepository";
import { CodexChatRuntime } from "./codexChatRuntime";
import { ClaudeChatRuntime } from "./claudeChatRuntime";

export function createChatService(options: {
  paths: AppPaths;
  appVersion: string;
  mcp: Pick<ReturnType<typeof createMcpDesktopRuntime>, "connectChat">;
  publish: (event: ChatEvent) => void;
  reportError: (error: unknown) => void;
}) {
  return new ChatService({
    repository: new ChatRepository(options.paths.dataRoot),
    publish: options.publish,
    reportError: options.reportError,
    runtime: async (session, events, observe) => {
      const connection = await options.mcp.connectChat(
        session.id,
        observe,
        session.runtime === "claude" ? "Claude Code" : "Codex",
      );
      try {
        const runtime =
          session.runtime === "claude"
            ? new ClaudeChatRuntime(options.paths, connection, events)
            : await CodexChatRuntime.start(
                options.paths,
                options.appVersion,
                connection,
                events,
              );
        return {
          runtime,
          release: connection.close,
          cancelOperations: (current) =>
            cancelChatOperations(connection, current),
        };
      } catch (error) {
        connection.close();
        throw error;
      }
    },
  });
}
