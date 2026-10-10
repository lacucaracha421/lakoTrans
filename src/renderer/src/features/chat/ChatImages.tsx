import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { chatGateway } from "../../api/chatGateway";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import styles from "./ChatPanel.module.css";

/** Thumbnails of tool and message images; the full image opens in a dialog. */
export function ChatImages({
  sessionId,
  ids,
  limit,
  onShowMore,
}: {
  sessionId: string;
  ids: string[];
  limit?: number;
  onShowMore?: () => void;
}) {
  const { t } = useTranslation("components");
  const hidden = limit === undefined ? 0 : Math.max(0, ids.length - limit);
  return ids.length ? (
    <div className={styles.images}>
      {ids.slice(hidden).map((id) => (
        <ChatImageView key={id} sessionId={sessionId} imageId={id} />
      ))}
      {hidden > 0 ? (
        <Button
          variant="bare"
          className={styles.moreImages}
          aria-label={t("chat.moreImages", { count: hidden })}
          onClick={onShowMore}
        >
          +{hidden}
        </Button>
      ) : null}
    </div>
  ) : null;
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
        title={image.name}
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
  ) : (
    <span className={styles.imagePlaceholder} aria-hidden="true" />
  );
}
