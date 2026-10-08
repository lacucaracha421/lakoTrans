import React from "react";
import { useTranslation } from "react-i18next";
import type { MangaPage } from "../../../shared/libraryTypes";
import type { TranslationBlock } from "../../../shared/textTypes";
import type { LetteringTool } from "../../../shared/generatedLetteringMaskTypes";
import type { WorkspaceInteractionPreviewStore } from "../lib/workspaceInteractionPreview";
import { useLetteringPartMove } from "../hooks/useLetteringPartMove";
import { Button } from "./ui/Button";
import styles from "./GeneratedLetteringRetouchLayer.module.css";

export function LetteringMoveSurface({
  page,
  block,
  controls,
  preview,
}: {
  page: MangaPage;
  block: TranslationBlock;
  controls: {
    tool: LetteringTool;
    onUpdate: (patch: Partial<TranslationBlock>) => void;
  };
  preview: WorkspaceInteractionPreviewStore;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  const move = useLetteringPartMove(page, block, controls, preview);
  const changed = Boolean(
    move.draft && (move.draft.offset.x || move.draft.offset.y),
  );
  return (
    <>
      <svg
        className={styles.surface}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        role="group"
        tabIndex={0}
        aria-label={t("letteringBrush.moveHint")}
        onKeyDown={move.keyDown}
        onPointerDown={move.start}
        onPointerMove={move.update}
        onPointerUp={move.end}
        onPointerCancel={move.cancel}
        onLostPointerCapture={move.lost}
      >
        {move.polygon ? (
          <polygon className={styles.selection} points={move.polygon} />
        ) : null}
      </svg>
      {move.draft ? (
        <div className={styles.moveActions}>
          <Button
            size="sm"
            variant="secondary"
            disabled={!changed}
            onClick={move.apply}
          >
            {t("letteringBrush.applyMove")}
          </Button>
          <Button size="sm" variant="ghost" onClick={move.cancel}>
            {t("letteringBrush.cancelSelection")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
