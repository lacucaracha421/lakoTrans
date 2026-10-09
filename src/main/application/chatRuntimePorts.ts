import type { ChatQuestion, ChatSession } from "../../shared/chatTypes";
type AgentInput =
  { type: "text"; text: string } | { type: "image"; url: string };

export type AgentRuntime = {
  prepare: (session: ChatSession) => Promise<string>;
  send: (
    messageId: string,
    input: AgentInput[],
    model: string | null,
    effort: string | null,
  ) => Promise<void>;
  stop: () => Promise<void>;
  compact: () => Promise<void>;
  answer: (id: string, answers: Record<string, string>) => void;
  close: () => Promise<void>;
};
export type AgentRuntimeEvents = {
  notification: (value: Record<string, unknown>) => void;
  question: (value: ChatQuestion) => void;
  failed: (error: Error) => void;
};
