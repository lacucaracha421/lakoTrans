import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatImage,
  ChatSession,
  ChatSummary,
  CurrentViewContext,
} from "../../../../shared/chatTypes";
import { chatGateway } from "../../api/chatGateway";

export function useChat(enabled: boolean) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = useRef<string | null>(null);
  const initialized = useRef(false);
  const requestVersion = useRef(0);
  const drafts = useRef(
    new Map<string, { text: string; images: ChatImage[] }>(),
  );
  const accept = useCallback((value: ChatSession) => {
    if (selected.current === value.id)
      setSession((current) =>
        current?.id === value.id && current.updatedAt > value.updatedAt
          ? current
          : value,
      );
    setHistory((current) => [
      {
        id: value.id,
        title: value.title,
        state: value.state,
        updatedAt: value.updatedAt,
        model: value.model,
        effort: value.effort,
      },
      ...current.filter((item) => item.id !== value.id),
    ]);
  }, []);
  const perform = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);
  const select = useCallback(
    async (id?: string) => {
      const version = ++requestVersion.current;
      const value = id
        ? await chatGateway.readChat(id)
        : await chatGateway.createChat();
      if (version !== requestVersion.current) return;
      selected.current = value.id;
      accept(value);
    },
    [accept],
  );
  useInitialChat(enabled, initialized, perform, select, setHistory);
  useEffect(
    () => chatGateway.onChatEvent((event) => accept(event.session)),
    [accept],
  );
  const actions = useChatActions(session, accept, perform, select);
  return {
    session,
    history,
    error,
    busy,
    drafts,
    perform,
    ...actions,
  };
}

function useInitialChat(
  enabled: boolean,
  initialized: React.RefObject<boolean>,
  perform: (run: () => Promise<void>) => Promise<void>,
  select: (id?: string) => Promise<void>,
  setHistory: (value: ChatSummary[]) => void,
) {
  useEffect(() => {
    if (!enabled || initialized.current) return;
    initialized.current = true;
    void perform(async () => {
      const saved = await chatGateway.listChats();
      setHistory(saved);
      await select(saved[0]?.id);
    });
  }, [enabled, initialized, perform, select, setHistory]);
}

function useChatActions(
  session: ChatSession | null,
  accept: (value: ChatSession) => void,
  perform: (run: () => Promise<void>) => Promise<void>,
  select: (id?: string) => Promise<void>,
) {
  const send = async (
    text: string,
    images: ChatImage[],
    context: CurrentViewContext,
    model: string | null,
    effort: string | null,
  ) => {
    if (!session) return false;
    const value = await chatGateway.sendChat({
      sessionId: session.id,
      messageId: crypto.randomUUID(),
      text,
      imageIds: images.map((image) => image.id),
      context,
      model,
      effort,
    });
    accept(value);
    return true;
  };
  return {
    send,
    select: (id?: string) => perform(() => select(id)),
    stop: () =>
      perform(async () => {
        if (session) accept(await chatGateway.stopChat(session.id));
      }),
    compact: () =>
      perform(async () => {
        if (session) accept(await chatGateway.compactChat(session.id));
      }),
    answer: (answers: Record<string, string>) =>
      perform(async () => {
        if (session?.question)
          accept(
            await chatGateway.answerChat(
              session.id,
              session.question.id,
              answers,
            ),
          );
      }),
  };
}
