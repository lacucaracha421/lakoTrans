import { ClaudeChatEvents } from "./claudeChatEvents";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" };
import type { AppPaths } from "../appPaths";
import type { ChatSession } from "../../shared/chatTypes";
import type {
  AgentRuntime,
  AgentRuntimeEvents,
} from "../application/chatRuntimePorts";
import {
  claudeEffort,
  claudeMessage,
  startClaudeRuntime,
} from "../claude/claudeRuntime";
import { CHAT_INSTRUCTIONS } from "./chatInstructions";

export class ClaudeChatRuntime implements AgentRuntime {
  private runtime?: Awaited<ReturnType<typeof startClaudeRuntime>>;
  private threadId = "";
  private closed = false;
  private readonly messageEvents: ClaudeChatEvents;
  private pending = new Map<string, (value: PermissionResult) => void>();
  private pendingCount = 0;
  private reading?: Promise<void>;
  private idleWaiters = new Set<() => void>();
  private choice: { model: string | null; effort: string | null } = {
    model: null,
    effort: null,
  };
  constructor(
    private readonly paths: AppPaths,
    private readonly connection: { url: string; token: string },
    private readonly events: AgentRuntimeEvents,
  ) {
    this.messageEvents = new ClaudeChatEvents(events.notification);
  }
  async prepare(session: ChatSession) {
    if (this.runtime) return this.threadId;
    this.closed = false;
    this.threadId = session.nativeThreadId ?? randomUUID();
    const resume =
      session.nativeThreadId &&
      session.items.some(
        (item) => item.role === "user" && item.delivery !== "pending",
      );
    this.choice = { model: session.model, effort: session.effort };
    const runtime = await startClaudeRuntime(this.paths, {
      cwd: join(this.paths.dataRoot, "chat", "claude-runtime"),
      ...(resume ? { resume: this.threadId } : { sessionId: this.threadId }),
      persistSession: true,
      model: session.model ?? undefined,
      effort: claudeEffort(session.effort),
      systemPrompt: CHAT_INSTRUCTIONS,
      tools: ["AskUserQuestion"],
      includePartialMessages: true,
      mcpServers: {
        carrot: {
          type: "http",
          url: this.connection.url,
          headers: { Authorization: `Bearer ${this.connection.token}` },
        },
      },
      canUseTool: (name, input, options) =>
        this.canUseTool(name, input, options),
    });
    if (this.closed) {
      runtime.close();
      return this.threadId;
    }
    this.runtime = runtime;
    try {
      await runtime.stream.initializationResult();
    } catch (error) {
      runtime.close();
      this.runtime = undefined;
      if (this.closed) return this.threadId;
      throw error;
    }
    if (this.closed) return this.threadId;
    this.reading = this.read().catch((error: unknown) => {
      if (!this.closed)
        this.events.failed(
          error instanceof Error ? error : new Error(String(error)),
        );
    });
    return this.threadId;
  }
  async send(
    id: string,
    input: Parameters<AgentRuntime["send"]>[1],
    model: string | null,
    effort: string | null,
  ) {
    if (!this.runtime) throw new Error("Claude 대화를 먼저 연결해 주세요.");
    const runtime = this.runtime;
    if (
      this.pendingCount &&
      (this.choice.model !== model || this.choice.effort !== effort)
    ) {
      await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
      if (runtime !== this.runtime) return;
    }
    // Claude accepts queued input; changing the model must not alter the active turn.
    if (this.pendingCount === 0) await this.setChoice(model, effort);
    if (runtime !== this.runtime || this.closed) return;
    this.choice = { model, effort };
    this.pendingCount = 1;
    this.events.notification({ kind: "started" });
    runtime.push(claudeMessage(id, this.threadId, input));
  }
  async stop() {
    this.cancelQuestions();
    this.pendingCount = 0;
    // A native interrupt alone leaves queued user input alive. Closing this
    // worker cancels both active and queued work; the next send resumes its ID.
    await this.close();
  }
  async compact() {
    await this.send(
      randomUUID(),
      [{ type: "text", text: "/compact" }],
      this.choice.model,
      this.choice.effort,
    );
  }
  answer(id: string, answers: Record<string, string>) {
    const resolve = this.pending.get(id);
    if (!resolve)
      throw new Error("이 질문은 더 이상 응답을 기다리지 않습니다.");
    this.pending.delete(id);
    resolve({ behavior: "allow", updatedInput: { answers } });
  }
  async close() {
    this.closed = true;
    this.pendingCount = 0;
    this.cancelQuestions();
    this.runtime?.close();
    this.runtime = undefined;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
    await this.reading;
  }
  private async canUseTool(
    name: string,
    input: Record<string, unknown>,
    options: { toolUseID: string; signal: AbortSignal },
  ): Promise<PermissionResult> {
    if (name.startsWith("mcp__carrot__"))
      return { behavior: "allow", updatedInput: input };
    if (name !== "AskUserQuestion")
      return {
        behavior: "deny",
        message: "Use Carrot MCP for app operations.",
      };
    const id = options.toolUseID;
    const result = new Promise<PermissionResult>((resolve) =>
      this.pending.set(id, resolve),
    );
    const questions = Array.isArray(input.questions)
      ? (input.questions as {
          question: string;
          options?: { label: string; description: string }[];
        }[])
      : [];
    this.events.question({
      id,
      questions: questions.map((q) => ({
        id: q.question,
        question: q.question,
        options: q.options ?? [],
      })),
    });
    const abort = () => {
      this.pending.get(id)?.({ behavior: "deny", message: "Cancelled" });
      this.pending.delete(id);
    };
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    try {
      const answer = await result;
      return answer.behavior === "allow"
        ? { ...answer, updatedInput: { ...input, ...answer.updatedInput } }
        : answer;
    } finally {
      options.signal.removeEventListener("abort", abort);
    }
  }
  private cancelQuestions() {
    for (const resolve of this.pending.values())
      resolve({ behavior: "deny", message: "Cancelled" });
    this.pending.clear();
  }
  private async setChoice(model: string | null, effort: string | null) {
    if (model) await this.runtime?.stream.setModel(model);
    await this.runtime?.stream.applyFlagSettings({
      effortLevel: claudeEffort(effort),
    });
  }
  private async read() {
    if (!this.runtime) return;
    for await (const message of this.runtime.stream) {
      this.accept(message);
    }
    if (!this.closed && this.pendingCount)
      throw new Error("Claude 연결이 응답 도중 종료되었습니다.");
  }
  private accept(message: SDKMessage) {
    this.messageEvents.accept(message);
    if (message.type === "result") {
      // Native streaming may coalesce several user messages into one turn.
      // Its result is authoritative; sent-message counts are not turn counts.
      this.pendingCount = 0;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }
}
