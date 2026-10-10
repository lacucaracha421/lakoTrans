import type { McpTool } from "./mcpReadTools";
import { McpEditError } from "../application/mcpEditPolicy";
import { mcpOutputSchemas } from "./mcpOutputSchemas";
import { McpInvalidParams } from "./mcpArguments";

export function mcpToolResult(
  tool: McpTool,
  content: Awaited<ReturnType<McpTool["invoke"]>>,
) {
  const schema = mcpOutputSchemas[tool.name];
  if (!schema) return { content, isError: false };
  const metadata = content[0];
  if (metadata?.type !== "text")
    throw new Error("MCP output metadata is missing.");
  const parsed = schema.safeParse(JSON.parse(metadata.text));
  if (!parsed.success)
    throw new Error(`MCP output contract failed for ${tool.name}.`);
  return { content, structuredContent: parsed.data, isError: false };
}

export function mcpToolError(error: unknown) {
  const nativeBusy =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "APP_ACTIVITY_BUSY";
  const code =
    error instanceof McpInvalidParams
      ? "invalid_arguments"
      : error instanceof McpEditError
        ? error.code
        : nativeBusy
          ? "editor_busy"
          : "operation_failed";
  const guidance: Record<string, string> = {
    revision_conflict:
      "Read the current page and review changes before retrying.",
    editor_busy: "Save local edits or wait for the active app job, then retry.",
    retention_full:
      "Recovery storage is full. Do not retry unchanged or discard history automatically. Ask the user which owned recovery records may be discarded, or wait for their retention period to expire.",
    not_found: "List current targets or owned jobs before retrying.",
    invalid_edit: "Correct the arguments; do not retry unchanged.",
    invalid_arguments:
      "Correct the reported fields using this tool's inputSchema in tools/list, then retry. No operation was started.",
    editor_open:
      "Close this chapter in the app, preserving any local edits, then retry. Waiting alone will not close the editor.",
    access_denied:
      "Check this connection's approval in the app. Do not bypass permissions.",
  };
  const structuredContent = {
    error: code,
    message:
      error instanceof McpEditError || error instanceof McpInvalidParams
        ? error.message
        : nativeBusy
          ? "Another app operation temporarily owns the required resources."
          : "The app could not complete this operation. Check its local log; no internal paths or error details are returned here.",
    retryable: code === "editor_busy",
    nextAction:
      guidance[code] ??
      "Check the local app log and resulting page before retrying.",
    ...(error instanceof McpInvalidParams ? { issues: error.issues } : {}),
  };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: true,
  };
}
