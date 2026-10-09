import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { McpTranslationCompletionSchema } from "../../../../shared/mcpTranslationGuide";
import styles from "./ChatPanel.module.css";

export function ChatQualityReceipt({ text }: { text: string }) {
  const { t } = useTranslation("components");
  const receipt = useMemo(() => {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || !("completion" in value))
        return null;
      const parsed = McpTranslationCompletionSchema.safeParse(value.completion);
      return parsed.success ? parsed.data : null;
    } catch (_error) {
      // error-policy-allow: unstructured tool output has no quality receipt.
      return null;
    }
  }, [text]);
  if (!receipt) return null;
  const pending = receipt.pages.filter((page) => page.status !== "accepted");
  return (
    <div className={styles.quality}>
      <strong>{t("chat.quality.observation")}</strong>
      <p>
        {t(`chat.quality.${receipt.status}`)} · {receipt.acceptedPages}/
        {receipt.checkedPages}
      </p>
      <small>
        {t(
          receipt.scope === "whole-chapter"
            ? "chat.quality.chapter"
            : "chat.quality.selection",
        )}
      </small>
      {pending.length > 0 && (
        <ul>
          {pending.map((page, index) => (
            <li key={page.pageId}>
              {index + 1}. {page.reason}
            </li>
          ))}
        </ul>
      )}
      {receipt.fontSubstitutions.length > 0 && (
        <p>
          {t("chat.quality.substitutions", {
            count: receipt.fontSubstitutions.length,
          })}
        </p>
      )}
    </div>
  );
}
