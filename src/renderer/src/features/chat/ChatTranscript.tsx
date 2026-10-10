import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconLoader2,
} from "@tabler/icons-react";
import type { ChatItem, ChatSession } from "../../../../shared/chatTypes";
import { Button } from "../../components/ui/Button";
import styles from "./ChatPanel.module.css";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatQualityReceipt } from "./ChatQualityReceipt";
import { parseQualityReceipt } from "./chatQualityReceiptModel";
import { ChatImages } from "./ChatImages";

type TranscriptEntry =
  | { kind: "message"; item: ChatItem }
  | { kind: "tools"; id: string; items: ChatItem[] };

/** Consecutive tool calls read as one activity, not one block per call. */
function groupItems(items: ChatItem[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const item of items) {
    const last = entries.at(-1);
    if (item.role !== "tool") entries.push({ kind: "message", item });
    else if (last?.kind === "tools") last.items.push(item);
    else entries.push({ kind: "tools", id: item.id, items: [item] });
  }
  return entries;
}

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
  const entries = groupItems(session.items);
  const { scroller, content, onScroll } = useBottomPinning(session.updatedAt);
  return (
    <div
      className={styles.transcript}
      ref={scroller}
      role="log"
      aria-label={t("chat.history")}
      aria-live="polite"
      onScroll={onScroll}
    >
      <div ref={content} className={styles.transcriptContent}>
        {entries.length > count && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCount(count + 80)}
          >
            {t("chat.older")}
          </Button>
        )}
        {entries
          .slice(-count)
          .map((entry) =>
            entry.kind === "message" ? (
              <ChatMessage
                key={entry.item.id}
                item={entry.item}
                sessionId={session.id}
                runtime={session.runtime}
              />
            ) : (
              <ChatToolGroup
                key={entry.id}
                items={entry.items}
                sessionId={session.id}
                onPage={onPage}
                onUndo={onUndo}
              />
            ),
          )}
        <ChatActivity state={session.state} />
      </div>
    </div>
  );
}

/**
 * Keeps the newest output in view while the reader is at the bottom, including
 * when images or expanded rows grow the content after the update arrived.
 */
function useBottomPinning(updatedAt: number) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const pin = () => {
    const node = scroller.current;
    if (following.current && node) node.scrollTop = node.scrollHeight;
  };
  useLayoutEffect(pin, [updatedAt]);
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(pin);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const node = scroller.current;
    if (node)
      following.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < 90;
  };
  return { scroller, content, onScroll };
}

function ChatActivity({ state }: { state: ChatSession["state"] }) {
  const { t } = useTranslation("components");
  if (state === "idle") return null;
  const busy = state === "running" || state === "compacting";
  return (
    <div
      className={busy ? styles.activity : styles.activityNotice}
      role="status"
    >
      {busy ? (
        <span className={styles.activityDots} aria-hidden="true" />
      ) : null}
      <span>{t(`chat.state.${state}`)}</span>
    </div>
  );
}

function ChatMessage({
  item,
  sessionId,
  runtime,
}: {
  item: ChatItem;
  sessionId: string;
  runtime: ChatSession["runtime"];
}) {
  const { t } = useTranslation("components");
  const user = item.role === "user";
  return (
    <article className={user ? styles.userMessage : styles.message}>
      {user ? null : (
        <strong className={styles.author}>
          {item.role === "assistant"
            ? runtime === "claude"
              ? "Claude"
              : "Codex"
            : t("chat.roles.status")}
        </strong>
      )}
      {item.role === "assistant" ? (
        <ChatMarkdown text={item.text} />
      ) : (
        <div className={styles.messageText}>{item.text}</div>
      )}
      {item.context?.chapterTitle && (
        <small className={styles.messageContext}>
          {item.context.workTitle} · {item.context.chapterTitle}
        </small>
      )}
      <ChatImages sessionId={sessionId} ids={item.imageIds ?? []} />
    </article>
  );
}

function ChatToolGroup({
  items,
  sessionId,
  onPage,
  onUndo,
}: {
  items: ChatItem[];
  sessionId: string;
  onPage?: (chapter: string, page: string) => void;
  onUndo: (item: ChatItem) => void;
}) {
  const { t } = useTranslation("components");
  const [expanded, setExpanded] = useState(false);
  const bodyId = React.useId();
  const receipt = [...items]
    .reverse()
    .find(
      (item) =>
        item.toolName === "carrot_get_translation_guide" &&
        parseQualityReceipt(item.text) !== null,
    );
  const images = items.flatMap((item) => item.imageIds ?? []);
  const last = items[items.length - 1];
  const failed = items.filter((item) => item.state === "failed").length;
  if (items.length === 1)
    return (
      <div className={styles.toolGroup}>
        <ChatTool item={last} onPage={onPage} onUndo={onUndo} />
        {receipt ? <ChatQualityReceipt text={receipt.text} /> : null}
        <ChatImages sessionId={sessionId} ids={images} />
      </div>
    );
  return (
    <div className={styles.toolGroup}>
      <Button
        variant="bare"
        className={styles.toolRow}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
      >
        <IconChevronRight
          size={14}
          className={expanded ? styles.chevronOpen : styles.chevron}
          aria-hidden="true"
        />
        <span className={styles.toolLabel}>
          {t("chat.toolGroup", { count: items.length })}
        </span>
        <span className={styles.toolMeta}>
          {t(`chat.tools.${toolCategory(last.toolName ?? "")}`)}
        </span>
        <ToolStatus state={failed ? "failed" : last.state} />
      </Button>
      {expanded ? (
        <div id={bodyId} className={styles.toolGroupBody}>
          {items.map((item) => (
            <ChatTool
              key={item.id}
              item={item}
              onPage={onPage}
              onUndo={onUndo}
            />
          ))}
        </div>
      ) : null}
      {receipt ? <ChatQualityReceipt text={receipt.text} /> : null}
      <ChatImages
        sessionId={sessionId}
        ids={images}
        limit={expanded ? undefined : PREVIEW_IMAGES}
        onShowMore={() => setExpanded(true)}
      />
    </div>
  );
}

/** A collapsed run of calls previews only its latest images. */
const PREVIEW_IMAGES = 4;

function ToolStatus({ state }: { state: ChatItem["state"] }) {
  const { t } = useTranslation("components");
  const Icon =
    state === "running"
      ? IconLoader2
      : state === "failed"
        ? IconAlertTriangle
        : IconCheck;
  return (
    <span className={styles.toolStatus} data-state={state}>
      <Icon size={14} aria-hidden="true" />
      <span className="visually-hidden">{t(`chat.operation.${state}`)}</span>
    </span>
  );
}

function ChatTool({
  item,
  onPage,
  onUndo,
}: {
  item: ChatItem;
  onPage?: (chapter: string, page: string) => void;
  onUndo: (item: ChatItem) => void;
}) {
  const { t } = useTranslation("components");
  const [expanded, setExpanded] = useState(false);
  const bodyId = React.useId();
  return (
    <div className={styles.tool}>
      <Button
        variant="bare"
        className={styles.toolRow}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
      >
        <IconChevronRight
          size={14}
          className={expanded ? styles.chevronOpen : styles.chevron}
          aria-hidden="true"
        />
        <span className={styles.toolLabel}>
          {t(`chat.tools.${toolCategory(item.toolName ?? "")}`)}
        </span>
        <ToolStatus state={item.state} />
      </Button>
      {expanded ? (
        <div id={bodyId} className={styles.toolBody}>
          <pre>{item.text}</pre>
          <div className={styles.toolActions}>
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
          </div>
        </div>
      ) : null}
    </div>
  );
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
