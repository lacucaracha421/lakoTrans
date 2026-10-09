import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ChatItem, ChatSession } from "../../../../shared/chatTypes";
import { chatGateway } from "../../api/chatGateway";
import { Button } from "../../components/ui/Button";
import { CollapsibleSection } from "../../components/ui/Section";
import styles from "./ChatPanel.module.css";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatQualityReceipt } from "./ChatQualityReceipt";
import { Modal } from "../../components/ui/Modal";

export function ChatTranscript({
  session,
  onPage,
  onUndo,
}: {
  session: ChatSession;
  onPage?: (chapterId: string, pageId: string) => void;
  onUndo: (item: ChatItem) => void;
}) {
  const { t } = useTranslation("components");
  const [count, setCount] = useState(80);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (following.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [session.updatedAt]);
  return (
    <div
      className={styles.transcript}
      ref={scroller}
      role="log"
      aria-label={t("chat.history")}
      aria-live="polite"
      onLoadCapture={() => {
        if (following.current && scroller.current)
          scroller.current.scrollTop = scroller.current.scrollHeight;
      }}
      onScroll={() => {
        const node = scroller.current;
        if (node)
          following.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 90;
      }}
    >
      {session.items.length > count && (
        <Button variant="ghost" size="sm" onClick={() => setCount(count + 80)}>
          {t("chat.older")}
        </Button>
      )}
      {session.items.slice(-count).map((item) => (
        <ChatMessage
          key={item.id}
          item={item}
          sessionId={session.id}
          onPage={onPage}
          onUndo={onUndo}
        />
      ))}
    </div>
  );
}
function ChatMessage({
  item,
  sessionId,
  onPage,
  onUndo,
}: {
  item: ChatItem;
  sessionId: string;
  onPage?: (chapter: string, page: string) => void;
  onUndo: (item: ChatItem) => void;
}) {
  const { t } = useTranslation("components");
  if (item.role === "tool")
    return (
      <ChatTool
        item={item}
        sessionId={sessionId}
        onPage={onPage}
        onUndo={onUndo}
      />
    );
  return (
    <article
      className={`${styles.message} ${item.role === "user" ? styles.user : ""}`}
    >
      <strong className={styles.author}>{t(`chat.roles.${item.role}`)}</strong>
      {item.context?.chapterTitle && (
        <small className={styles.messageContext}>
          {item.context.workTitle} · {item.context.chapterTitle}
        </small>
      )}
      {item.role === "assistant" ? (
        <ChatMarkdown text={item.text} />
      ) : (
        <div className={styles.messageText}>{item.text}</div>
      )}
      <ChatImages sessionId={sessionId} ids={item.imageIds ?? []} />
    </article>
  );
}
function ChatTool({
  item,
  sessionId,
  onPage,
  onUndo,
}: {
  item: ChatItem;
  sessionId: string;
  onPage?: (chapter: string, page: string) => void;
  onUndo: (item: ChatItem) => void;
}) {
  const { t } = useTranslation("components");
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.tool}>
      <CollapsibleSection
        title={t(`chat.tools.${toolCategory(item.toolName ?? "")}`)}
        density="compact"
        expanded={expanded}
        onExpandedChange={setExpanded}
        description={t(`chat.operation.${item.state}`)}
      >
        <pre>{item.text}</pre>
        {item.chapterId && item.pageId && (
          <Button
            size="sm"
            onClick={() => {
              if (item.chapterId && item.pageId)
                onPage?.(item.chapterId, item.pageId);
            }}
          >
            {t("chat.openPage")}
          </Button>
        )}
        {/apply|update|commit|undo/.test(item.toolName ?? "") && (
          <Button size="sm" onClick={() => onUndo(item)}>
            {t(item.toolName?.includes("undo") ? "chat.redo" : "chat.undo")}
          </Button>
        )}
      </CollapsibleSection>
      {item.toolName === "carrot_get_translation_guide" && (
        <ChatQualityReceipt text={item.text} />
      )}
      <ChatImages sessionId={sessionId} ids={item.imageIds ?? []} />
    </div>
  );
}
function ChatImages({ sessionId, ids }: { sessionId: string; ids: string[] }) {
  return (
    <div className={styles.images}>
      {ids.map((id) => (
        <ChatImageView key={id} sessionId={sessionId} imageId={id} />
      ))}
    </div>
  );
}
function ChatImageView({
  sessionId,
  imageId,
}: {
  sessionId: string;
  imageId: string;
}) {
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    let live = true;
    void chatGateway.readChatImage(sessionId, imageId).then(
      (result) => {
        if (live) setImage(result);
      },
      (failure: unknown) => {
        if (live)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      },
    );
    return () => {
      live = false;
    };
  }, [sessionId, imageId]);
  if (error) return <small role="status">{error}</small>;
  return image ? (
    <>
      <Button
        variant="bare"
        className={styles.image}
        onClick={() => setLarge(!large)}
        aria-label={image.name}
      >
        <img src={image.dataUrl} alt={image.name} />
      </Button>
      {large &&
        createPortal(
          <Modal
            title={image.name}
            size="xl"
            onClose={() => setLarge(false)}
            closeOnBackdrop
          >
            <img
              className={styles.previewImage}
              src={image.dataUrl}
              alt={image.name}
            />
          </Modal>,
          document.body,
        )}
    </>
  ) : null;
}
function toolCategory(name: string) {
  if (/font|typography/.test(name)) return "font";
  if (/render|preview|crop|original|source/.test(name)) return "image";
  if (/list_works|list_chapters|chapter/.test(name)) return "library";
  if (/sound|lettering|candidate/.test(name)) return "sound";
  if (/erase|inpaint/.test(name)) return "erase";
  if (/review|composite|completion/.test(name)) return "review";
  if (/apply|update|commit|undo|redo/.test(name)) return "edit";
  if (/context|guide/.test(name)) return "context";
  return "inspect";
}
