export type CurrentViewContext = {
  workId: string | null;
  workTitle: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  pageId: string | null;
  pageNumber: number | null;
  blockIds: string[];
  revision?: string | null;
};
export type ChatImage = { id: string; name: string; dataUrl: string };
export type ChatItem = {
  id: string;
  role: "user" | "assistant" | "tool" | "status";
  text: string;
  state: "running" | "completed" | "failed";
  createdAt: number;
  toolName?: string;
  toolFingerprint?: string;
  observed?: boolean;
  imageIds?: string[];
  context?: CurrentViewContext;
  chapterId?: string;
  pageId?: string;
  delivery?: "pending" | "sent" | "uncertain";
};
export type ChatQuestion = {
  id: string;
  questions: {
    id: string;
    question: string;
    options: { label: string; description: string }[];
  }[];
};
export type ChatSession = {
  version: 1;
  id: string;
  title: string;
  runtime: "codex" | "claude";
  nativeThreadId: string | null;
  model: string | null;
  effort: string | null;
  state:
    "idle" | "running" | "compacting" | "needs-input" | "paused" | "failed";
  createdAt: number;
  updatedAt: number;
  items: ChatItem[];
  question: ChatQuestion | null;
  usage?: { totalTokens: number; contextWindow: number | null };
  checkpoint: {
    toolName: string;
    record: Record<string, unknown>;
    at: number;
  }[];
};
export type ChatSummary = Pick<
  ChatSession,
  "id" | "title" | "state" | "updatedAt" | "model" | "effort" | "runtime"
>;
export type ChatSendRequest = {
  sessionId: string;
  messageId: string;
  text: string;
  imageIds: string[];
  context: CurrentViewContext;
  model: string | null;
  effort: string | null;
};
export type ChatEvent = { sessionId: string; session: ChatSession };
export type ChatApi = {
  listChats: () => Promise<ChatSummary[]>;
  createChat: (runtime?: ChatSession["runtime"]) => Promise<ChatSession>;
  readChat: (id: string) => Promise<ChatSession>;
  sendChat: (request: ChatSendRequest) => Promise<ChatSession>;
  stopChat: (id: string) => Promise<ChatSession>;
  compactChat: (id: string) => Promise<ChatSession>;
  answerChat: (
    id: string,
    questionId: string,
    answers: Record<string, string>,
  ) => Promise<ChatSession>;
  attachChatImage: (
    id: string,
    name: string,
    dataUrl: string,
  ) => Promise<ChatImage>;
  readChatImage: (id: string, imageId: string) => Promise<ChatImage>;
  onChatEvent: (callback: (event: ChatEvent) => void) => () => void;
};
