import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with {
  "resolution-mode": "import",
};
import type { AgentRuntimeEvents } from "../application/chatRuntimePorts";

/** Maps official SDK events without persisting reasoning or authentication data. */
export class ClaudeChatEvents {
  private currentMessage = "";
  constructor(private readonly emit: AgentRuntimeEvents["notification"]) {}
  accept(message: SDKMessage) {
    switch (message.type) {
      case "stream_event":
        this.partial(message);
        break;
      case "assistant":
        this.assistant(message);
        break;
      case "user":
        this.toolResult(message);
        break;
      case "system":
        this.system(message);
        break;
      case "result":
        this.result(message);
        break;
    }
  }
  private partial(message: Extract<SDKMessage, { type: "stream_event" }>) {
    if (message.parent_tool_use_id) return;
    const event = message.event;
    if (event.type === "message_start") this.currentMessage = event.message.id;
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    )
      this.emit({
        kind: "text",
        id: this.currentMessage,
        delta: event.delta.text,
      });
  }
  private assistant(message: Extract<SDKMessage, { type: "assistant" }>) {
    if (message.parent_tool_use_id) return;
    const text = message.message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    if (text)
      this.emit({ kind: "text", id: message.message.id, text, done: true });
    for (const part of message.message.content)
      if (part.type === "tool_use")
        this.emit({
          kind: "tool",
          id: part.id,
          name: part.name.replace(/^mcp__carrot__/, ""),
          arguments: part.input,
        });
  }
  private toolResult(message: Extract<SDKMessage, { type: "user" }>) {
    if (!Array.isArray(message.message.content)) return;
    for (const part of message.message.content)
      if (part.type === "tool_result")
        this.emit({
          kind: "tool",
          id: part.tool_use_id,
          done: true,
          failed: part.is_error,
        });
  }
  private system(message: Extract<SDKMessage, { type: "system" }>) {
    if (message.subtype === "init") this.emit({ kind: "started" });
    if (message.subtype === "compact_boundary")
      this.emit({ kind: "compacted", continues: true });
    if (message.subtype !== "status") return;
    if (message.status === "compacting") this.emit({ kind: "compacting" });
    if (message.compact_result === "failed")
      this.emit({
        kind: "finished",
        status: "failed",
        error: message.compact_error ?? "대화 압축에 실패했습니다.",
      });
  }
  private result(message: Extract<SDKMessage, { type: "result" }>) {
    this.emit({
      kind: "usage",
      totalTokens:
        message.usage.input_tokens +
        message.usage.output_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0),
    });
    this.emit({
      kind: "finished",
      status: message.is_error ? "failed" : "completed",
      error:
        message.subtype === "success" ? undefined : message.errors.join("\n"),
    });
  }
}
