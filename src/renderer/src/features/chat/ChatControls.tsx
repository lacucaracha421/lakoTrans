import React from "react";
import { useTranslation } from "react-i18next";
import {
  IconPlus,
  IconArrowsMinimize,
  IconChevronDown,
} from "@tabler/icons-react";
import type { CurrentViewContext } from "../../../../shared/chatTypes";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Select } from "../../components/ui/Select";
import { usePopupController } from "../../components/ui/usePopupController";
import { codexConnection } from "../../api/codexConnection";
import { settingsGateway } from "../../api/settingsGateway";
import { claudeGateway } from "../../api/claudeGateway";
import { claudeConnection } from "../../api/claudeConnection";
import type { useChat } from "./useChat";
import type { useChatModel } from "./useChatModel";
import styles from "./ChatPanel.module.css";

type Controller = ReturnType<typeof useChat>;
export function ChatHistoryControls({
  chat,
  running,
}: {
  chat: Controller;
  running: boolean;
}) {
  const { t } = useTranslation("components");
  return (
    <header className={styles.header}>
      <Select
        ariaLabel={t("chat.runtime")}
        value={chat.session?.runtime ?? "codex"}
        options={[
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude" },
        ]}
        onValueChange={(value) =>
          void chat.select(undefined, value === "claude" ? "claude" : "codex")
        }
        disabled={chat.busy}
      />
      <Select
        ariaLabel={t("chat.history")}
        value={chat.session?.id ?? ""}
        options={chat.history.map((entry) => ({
          value: entry.id,
          label: `${entry.runtime === "claude" ? "Claude" : "Codex"} · ${entry.title}`,
        }))}
        onValueChange={(id) => void chat.select(id)}
        disabled={chat.busy}
      />
      <IconButton
        label={t("chat.new")}
        onClick={() => void chat.select(undefined, chat.session?.runtime)}
        disabled={chat.busy}
      >
        <IconPlus size={18} />
      </IconButton>
      <IconButton
        label={t("chat.compact")}
        onClick={() => void chat.compact()}
        disabled={chat.busy || running || !chat.session?.nativeThreadId}
      >
        <IconArrowsMinimize size={18} />
      </IconButton>
    </header>
  );
}
/** One chip under the composer; the model and effort pickers open above it. */
export function ChatModelControls({
  model,
}: {
  model: ReturnType<typeof useChatModel>;
}) {
  const { t } = useTranslation("components");
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const { rootRef, contentRef, toggle, triggerRef } = usePopupController({
    closeOnFocusOut: true,
    isInsidePopup: isSelectMenuTarget,
    initialFocus: "[data-ui-select-trigger]",
    open,
    onOpenChange: setOpen,
    disabled: !model.authenticated,
  });
  const effortLabel = (value: string) =>
    t(`settings.options.reasoning.${value}.label`, { defaultValue: value });
  const summary = [
    model.model?.displayName,
    model.effort
      ? t("chat.effortChip", { level: effortLabel(model.effort) })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div ref={rootRef} className={styles.modelControl}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className={styles.modelChip}
        aria-label={`${t("chat.modelSettings")}: ${summary}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={!model.authenticated}
        iconRight={<IconChevronDown size={14} aria-hidden="true" />}
        onClick={toggle}
      >
        <span className={styles.modelChipText}>
          {summary || t("chat.modelSettings")}
        </span>
      </Button>
      {open ? (
        <div
          ref={contentRef}
          id={panelId}
          role="group"
          aria-label={t("chat.modelSettings")}
          className={styles.modelPopover}
        >
          <div className={styles.modelField}>
            <span>{t("chat.model")}</span>
            <Select
              ariaLabel={t("chat.model")}
              value={model.model?.id ?? ""}
              options={model.models.map((entry) => ({
                value: entry.id,
                label: entry.displayName,
              }))}
              onValueChange={model.selectModel}
            />
          </div>
          <div className={styles.modelField}>
            <span>{t("chat.effort")}</span>
            <Select
              ariaLabel={t("chat.effort")}
              value={model.effort}
              options={(model.model?.supportedReasoningEfforts ?? []).map(
                (value) => ({ value, label: effortLabel(value) }),
              )}
              onValueChange={model.selectEffort}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
/** Select menus are portaled to the body; they still belong to this popover. */
function isSelectMenuTarget(target: Node): boolean {
  const element = target instanceof Element ? target : target.parentElement;
  return Boolean(element?.closest("[data-ui-select-menu]"));
}
/** What the next message will carry, e.g. `2화 p.1 · 말풍선 1개`. */
export function ChatViewContext({ context }: { context?: CurrentViewContext }) {
  const { t } = useTranslation("components");
  const place = context?.chapterTitle
    ? [
        context.chapterTitle,
        context.pageNumber ? `p.${context.pageNumber}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : t("chat.library");
  const blocks = context?.blockIds.length
    ? t("chat.contextBlocks", { count: context.blockIds.length })
    : "";
  const label = [place, blocks].filter(Boolean).join(" · ");
  return (
    <div className={styles.context} title={label}>
      {label}
    </div>
  );
}
export function ChatLogin({ chat }: { chat: Controller }) {
  const { t } = useTranslation("components");
  return (
    <div className={styles.login}>
      <p>
        {t(
          chat.session?.runtime === "claude"
            ? "chat.claudeLoginHint"
            : "chat.loginHint",
        )}
      </p>
      <Button
        onClick={() =>
          void chat.perform(async () => {
            if (chat.session?.runtime === "claude")
              claudeConnection.publish(
                await claudeGateway.loginClaudeAccount(),
              );
            else
              codexConnection.publish(
                await settingsGateway.loginCodexAccount(),
              );
          })
        }
        disabled={chat.busy}
      >
        {t(
          chat.session?.runtime === "claude"
            ? "chat.claudeLogin"
            : "chat.login",
        )}
      </Button>
    </div>
  );
}
