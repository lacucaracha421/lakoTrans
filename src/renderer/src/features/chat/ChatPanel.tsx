import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  ChatImage,
  ChatSession,
  CurrentViewContext,
} from "../../../../shared/chatTypes";
import { useChat } from "./useChat";
import { useChatModel } from "./useChatModel";
import { ChatComposer } from "./ChatComposer";
import { ChatTranscript } from "./ChatTranscript";
import { ChatQuestionForm } from "./ChatQuestionForm";
import {
  ChatHistoryControls,
  ChatModelControls,
  ChatViewContext,
  ChatLogin,
} from "./ChatControls";
import styles from "./ChatPanel.module.css";

const LIBRARY_CONTEXT: CurrentViewContext = {
  workId: null,
  workTitle: null,
  chapterId: null,
  chapterTitle: null,
  pageId: null,
  pageNumber: null,
  blockIds: [],
};
export function ChatPanel(props: {
  enabled: boolean;
  context?: CurrentViewContext;
  onPage?: (chapterId: string, pageId: string) => void;
  /** Host header row; the conversation controls render there when given. */
  headerSlot?: HTMLElement | null;
}) {
  const { t } = useTranslation("components");
  const chat = useChat(props.enabled);
  const model = useChatModel(props.enabled, chat.session);
  const running = Boolean(
    chat.session &&
    ["running", "compacting", "needs-input"].includes(chat.session.state),
  );
  const send = (text: string, images: ChatImage[]) =>
    chat.send(
      text,
      images,
      props.context ?? LIBRARY_CONTEXT,
      model.model?.id ?? null,
      model.effort || null,
    );
  const history = <ChatHistoryControls chat={chat} running={running} />;
  return (
    <section className={styles.panel} aria-label={t("chat.open")}>
      {props.headerSlot ? createPortal(history, props.headerSlot) : history}
      {!model.authenticated && <ChatLogin chat={chat} />}
      {chat.error && (
        <div role="alert" className={styles.error}>
          {chat.error}
        </div>
      )}
      {chat.session ? (
        <ChatConversation
          key={chat.session.id}
          session={chat.session}
          chat={chat}
          send={send}
          running={running}
          authenticated={model.authenticated}
          context={props.context}
          modelControl={
            <ChatModelControls
              model={model}
              disabled={chat.busy}
              onRuntimeChange={(runtime) =>
                void chat.select(undefined, runtime)
              }
            />
          }
          onPage={props.onPage}
        />
      ) : (
        <div className={styles.empty}>{t("chat.loading")}</div>
      )}
    </section>
  );
}
function ChatConversation(props: {
  session: ChatSession;
  chat: ReturnType<typeof useChat>;
  send: (text: string, images: ChatImage[]) => Promise<boolean>;
  running: boolean;
  authenticated: boolean;
  context?: CurrentViewContext;
  modelControl: React.ReactNode;
  onPage?: (chapterId: string, pageId: string) => void;
}) {
  const { t } = useTranslation("components");
  const { session, chat } = props;
  return (
    <>
      <ChatTranscript
        session={session}
        onPage={props.onPage}
        onUndo={(item) =>
          void chat.perform(async () => {
            await props.send(
              t(
                item.toolName?.includes("undo")
                  ? "chat.redoRequest"
                  : "chat.undoRequest",
                { tool: item.toolName, result: item.text },
              ),
              [],
            );
          })
        }
      />
      {session.question && (
        <ChatQuestionForm
          key={session.question.id}
          question={session.question}
          busy={chat.busy}
          onAnswer={chat.answer}
        />
      )}
      <ChatComposer
        sessionId={session.id}
        busy={chat.busy}
        running={props.running}
        authenticated={props.authenticated}
        context={<ChatViewContext context={props.context} />}
        modelControl={props.modelControl}
        drafts={chat.drafts}
        onSend={props.send}
        onStop={() => void chat.stop()}
        onError={chat.perform}
      />
    </>
  );
}
