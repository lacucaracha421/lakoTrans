import { randomUUID } from "node:crypto";
import type {
  ChatEvent,
  ChatSendRequest,
  ChatSession,
  ChatSummary,
} from "../../shared/chatTypes";
import type { AgentRuntime, AgentRuntimeEvents } from "./chatRuntimePorts";
import type { ChatRepository } from "../chat/chatRepository";
import { chatMessageInput } from "../chat/chatInstructions";
import { addChatStatus, reduceChatNotification } from "../chat/chatReducer";
import { observeChatTool } from "../chat/chatToolObservation";
import type { McpChatObservation } from "../mcp/mcpLocalHost";

type RuntimeLease = {
  runtime: AgentRuntime;
  release: () => void;
  cancelOperations: (session: ChatSession) => Promise<void>;
};
type Ports = {
  repository: Pick<
    ChatRepository,
    "list" | "read" | "save" | "image" | "addImage"
  >;
  runtime: (
    session: ChatSession,
    events: AgentRuntimeEvents,
    observe: (value: McpChatObservation) => Promise<void>,
  ) => Promise<RuntimeLease>;
  publish: (event: ChatEvent) => void;
  reportError: (error: unknown) => void;
};

export class ChatService {
  private sessions = new Map<string, Promise<ChatSession>>();
  private runtimes = new Map<string, Promise<RuntimeLease>>();
  private sending = new Map<string, Promise<void>>();
  private saves = new Map<string, ReturnType<typeof setTimeout>>();
  private generations = new Map<string, number>();
  private closed = false;
  constructor(private readonly ports: Ports) {}
  async list(): Promise<ChatSummary[]> {
    const saved = await this.ports.repository.list();
    return Promise.all(
      saved.map(async (item) => {
        const current = this.sessions.has(item.id)
          ? await this.get(item.id)
          : item;
        return {
          id: current.id,
          title: current.title,
          state: restoredState(current.state, this.runtimes.has(item.id)),
          updatedAt: current.updatedAt,
          model: current.model,
          effort: current.effort,
          runtime: current.runtime,
        };
      }),
    );
  }
  async create(runtime?: ChatSession["runtime"]): Promise<ChatSession> {
    this.assertOpen();
    const history = await this.list();
    runtime ??= history[0]?.runtime ?? "codex";
    const previous = history.find((entry) => entry.runtime === runtime);
    const now = Date.now();
    const session: ChatSession = {
      version: 1,
      id: randomUUID(),
      title: "새 대화",
      runtime,
      nativeThreadId: null,
      model: previous?.model ?? null,
      effort: previous?.effort ?? null,
      state: "idle",
      createdAt: now,
      updatedAt: now,
      items: [],
      checkpoint: [],
      question: null,
    };
    await this.ports.repository.save(session);
    this.sessions.set(session.id, Promise.resolve(session));
    return structuredClone(session);
  }
  async read(id: string) {
    return structuredClone(await this.get(id));
  }
  async send(request: ChatSendRequest): Promise<ChatSession> {
    this.assertOpen();
    const session = await this.get(request.sessionId);
    if (session.items.some((item) => item.id === request.messageId))
      return structuredClone(session);
    await Promise.all(
      request.imageIds.map((id) => this.ports.repository.image(session.id, id)),
    );
    this.assertOpen();
    if (session.items.some((item) => item.id === request.messageId))
      return structuredClone(session);
    const generation = this.generations.get(session.id) ?? 0;
    session.items.push({
      id: request.messageId,
      role: "user",
      text: request.text,
      state: "completed",
      createdAt: Date.now(),
      context: structuredClone(request.context),
      imageIds: [...request.imageIds],
      delivery: "pending",
    });
    if (session.title === "새 대화")
      session.title = request.text.trim().slice(0, 60) || "이미지 검토";
    session.model = request.model;
    session.effort = request.effort;
    session.state = "running";
    await this.save(session);
    const previous = this.sending.get(session.id) ?? Promise.resolve();
    const next = previous
      .then(() => this.runSend(session, request, generation))
      .catch((error: unknown) => this.fail(session, error));
    this.sending.set(session.id, next);
    return structuredClone(session);
  }
  async stop(id: string): Promise<ChatSession> {
    const session = await this.get(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    session.state = "paused";
    session.question = null;
    await this.save(session);
    const lease = await this.runtimes.get(id);
    if (lease) {
      await lease.runtime.stop();
      await this.cancelPending(session, lease);
    }
    return structuredClone(session);
  }
  async compact(id: string): Promise<ChatSession> {
    const session = await this.get(id);
    if (["running", "compacting", "needs-input"].includes(session.state))
      throw new Error("현재 작업이 끝난 뒤 압축할 수 있습니다.");
    const lease = await this.runtime(session);
    session.nativeThreadId = await lease.runtime.prepare(session);
    session.state = "compacting";
    await this.save(session);
    try {
      await lease.runtime.compact();
    } catch (error) {
      await this.fail(session, error);
    }
    return structuredClone(session);
  }
  async answer(
    id: string,
    questionId: string,
    answers: Record<string, string>,
  ): Promise<ChatSession> {
    const session = await this.get(id);
    if (session.question?.id !== questionId)
      throw new Error("질문 상태가 변경되었습니다. 대화를 다시 확인해 주세요.");
    const lease = await this.runtimes.get(id);
    if (!lease) throw new Error("대화를 다시 연결해 주세요.");
    lease.runtime.answer(questionId, answers);
    session.question = null;
    session.state = "running";
    await this.save(session);
    return structuredClone(session);
  }
  async attachImage(id: string, name: string, dataUrl: string) {
    return this.ports.repository.addImage(id, name, dataUrl);
  }
  async image(id: string, imageId: string) {
    return this.ports.repository.image(id, imageId);
  }
  async dispose(): Promise<void> {
    this.closed = true;
    await this.pauseAll();
  }
  async pauseAll(): Promise<void> {
    for (const timer of this.saves.values()) clearTimeout(timer);
    this.saves.clear();
    const results = await Promise.allSettled(
      [...this.sessions].map(async ([id, value]) => {
        const session = await value;
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
        const lease = await this.runtimes.get(id);
        try {
          if (lease) {
            try {
              await lease.runtime.stop();
            } finally {
              await lease.runtime.close();
            }
          }
        } finally {
          lease?.release();
          this.runtimes.delete(id);
          session.state = restoredState(session.state, false);
          session.question = null;
          await this.save(session);
        }
      }),
    );
    const failed = results.filter((value) => value.status === "rejected");
    if (failed.length)
      throw new AggregateError(
        failed.map((value) => value.reason),
        "채팅 종료 중 오류가 발생했습니다.",
      );
  }
  private get(id: string): Promise<ChatSession> {
    let entry = this.sessions.get(id);
    if (!entry) {
      entry = this.ports.repository.read(id).then((session) => {
        session.state = restoredState(session.state, false);
        session.question = null;
        for (const item of session.items)
          if (item.state === "running") item.state = "failed";
        return session;
      });
      this.sessions.set(id, entry);
      void entry.catch(() => {
        // error-policy-allow: callers receive the read error; an invalid ID or
        // temporary read failure must not poison shutdown or later retries.
        this.sessions.delete(id);
      });
    }
    return entry;
  }
  private async runSend(
    session: ChatSession,
    request: ChatSendRequest,
    generation: number,
  ) {
    if (this.shouldStop(session, generation)) return;
    const lease = await this.runtime(session);
    if (this.shouldStop(session, generation)) return;
    session.nativeThreadId = await lease.runtime.prepare(session);
    await this.save(session);
    const images = await Promise.all(
      request.imageIds.map((id) => this.ports.repository.image(session.id, id)),
    );
    if (this.shouldStop(session, generation)) return;
    const message = session.items.find((item) => item.id === request.messageId);
    if (message) message.delivery = "uncertain";
    await this.save(session);
    await lease.runtime.send(
      request.messageId,
      [
        { type: "text", text: chatMessageInput(request, session) },
        ...images.map((image) => ({
          type: "image" as const,
          url: image.dataUrl,
        })),
      ],
      request.model,
      request.effort,
    );
    if (message)
      message.delivery = this.shouldStop(session, generation)
        ? "uncertain"
        : "sent";
    await this.save(session);
  }
  private runtime(session: ChatSession): Promise<RuntimeLease> {
    let pending = this.runtimes.get(session.id);
    if (!pending) {
      pending = this.ports.runtime(
        session,
        {
          notification: (value) => {
            if (reduceChatNotification(session, value))
              this.scheduleSave(session);
          },
          question: (question) => {
            session.question = question;
            session.state = "needs-input";
            this.scheduleSave(session);
          },
          failed: (error) => {
            void this.disconnect(session, error).catch(this.ports.reportError);
          },
        },
        async (value) => {
          await observeChatTool(session, value, this.ports.repository);
          await this.save(session);
          if (
            session.state === "paused" &&
            !/^carrot_(get|list|cancel)_/.test(value.name)
          ) {
            const lease = await this.runtimes.get(session.id);
            if (lease) await this.cancelPending(session, lease);
          }
        },
      );
      this.runtimes.set(session.id, pending);
      void pending.catch((error: unknown) => {
        this.runtimes.delete(session.id);
        this.ports.reportError(error);
      });
    }
    return pending;
  }
  private scheduleSave(session: ChatSession) {
    if (this.saves.has(session.id)) return;
    this.saves.set(
      session.id,
      setTimeout(() => {
        this.saves.delete(session.id);
        void this.save(session).catch(this.ports.reportError);
      }, 150),
    );
  }
  private async cancelPending(session: ChatSession, lease: RuntimeLease) {
    try {
      await lease.cancelOperations(session);
    } catch (error) {
      this.ports.reportError(error);
      addChatStatus(
        session,
        "일부 앱 작업의 중지 상태를 확인하지 못했습니다. 작업 기록을 확인해 주세요.",
        "failed",
      );
      await this.save(session);
    }
  }
  private async save(session: ChatSession) {
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    await this.ports.repository.save(session);
    this.ports.publish({
      sessionId: session.id,
      session: structuredClone(session),
    });
  }
  private async fail(session: ChatSession, error: unknown) {
    this.ports.reportError(error);
    session.state = "failed";
    addChatStatus(
      session,
      error instanceof Error ? error.message : String(error),
      "failed",
    );
    await this.save(session);
  }
  private async disconnect(session: ChatSession, error: unknown) {
    const pending = this.runtimes.get(session.id);
    this.runtimes.delete(session.id);
    await this.fail(session, error);
    if (!pending) return;
    const lease = await pending;
    try {
      await lease.runtime.close();
    } finally {
      lease.release();
    }
  }
  private assertOpen() {
    if (this.closed) throw new Error("앱이 종료 중입니다.");
  }
  private shouldStop(session: ChatSession, generation: number) {
    return (
      this.closed || generation !== (this.generations.get(session.id) ?? 0)
    );
  }
}
function restoredState(
  state: ChatSession["state"],
  live: boolean,
): ChatSession["state"] {
  return !live && ["running", "compacting", "needs-input"].includes(state)
    ? "paused"
    : state;
}
