import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronRight } from "@tabler/icons-react";
import { Button } from "../../components/ui/Button";
import styles from "./ChatPanel.module.css";
import { parseQualityReceipt } from "./chatQualityReceiptModel";

export function ChatQualityReceipt({ text }: { text: string }) {
  const { t } = useTranslation("components");
  const [expanded, setExpanded] = useState(false);
  const bodyId = React.useId();
  const receipt = useMemo(() => parseQualityReceipt(text), [text]);
  if (!receipt) return null;
  const reasons = groupReasons(
    receipt.pages.filter((page) => page.status !== "accepted"),
  );
  const accepted = receipt.status !== "incomplete";
  return (
    <div className={styles.quality} data-accepted={accepted || undefined}>
      <div className={styles.qualitySummary}>
        <strong>{t(`chat.quality.${receipt.status}`)}</strong>
        <span>
          {receipt.acceptedPages}/{receipt.checkedPages}
        </span>
      </div>
      <small>
        {[
          t("chat.quality.observation"),
          t(
            receipt.scope === "whole-chapter"
              ? "chat.quality.chapter"
              : "chat.quality.selection",
          ),
          receipt.fontSubstitutions.length > 0
            ? t("chat.quality.substitutions", {
                count: receipt.fontSubstitutions.length,
              })
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
      {reasons.length > 0 ? (
        <>
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
              {t("chat.quality.details")}
            </span>
          </Button>
          {expanded ? (
            <ul id={bodyId} className={styles.qualityReasons}>
              {reasons.map(([reason, count]) => (
                <li key={reason}>
                  <span>{t("chat.quality.pages", { count })}</span>
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The same reason for many pages reads as one line with a page count. */
function groupReasons(pages: { reason: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const page of pages)
    counts.set(page.reason, (counts.get(page.reason) ?? 0) + 1);
  return [...counts];
}
