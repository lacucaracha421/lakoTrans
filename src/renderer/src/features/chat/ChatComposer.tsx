import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import { useChatDraft, type ChatComposerProps } from "./useChatDraft";
import { IconButton } from "../../components/ui/IconButton";
import { Input, Textarea } from "../../components/ui/Field";
import styles from "./ChatPanel.module.css";

export function ChatComposer(props: ChatComposerProps) {
  const { t } = useTranslation("components");
  const { text, images, update, attach, submit } = useChatDraft(props);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.composer}>
      {props.context}
      <ChatAttachments
        images={images}
        onRemove={(id) =>
          update(
            text,
            images.filter((entry) => entry.id !== id),
          )
        }
      />
      <Textarea
        aria-label={t("chat.message")}
        placeholder={t("chat.placeholder")}
        rows={3}
        value={text}
        disabled={!props.authenticated}
        onChange={(event) => update(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) =>
            file.type.startsWith("image/"),
          );
          if (files.length) {
            event.preventDefault();
            void attach(files);
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Input
        ref={fileInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-label={t("chat.attach")}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void attach(files);
        }}
      />
      <ChatComposerActions
        props={props}
        text={text}
        images={images}
        submit={submit}
        onAttach={() => fileInput.current?.click()}
      />
    </div>
  );
}
function ChatComposerActions({
  props,
  text,
  images,
  submit,
  onAttach,
}: {
  props: ChatComposerProps;
  text: string;
  images: unknown[];
  submit: () => Promise<void>;
  onAttach: () => void;
}) {
  const { t } = useTranslation("components");
  const sendLabel = t(props.running ? "chat.steer" : "chat.send");
  return (
    <div className={styles.composerActions}>
      <IconButton
        label={t("chat.attach")}
        onClick={() => onAttach()}
        disabled={props.busy}
      >
        <IconPaperclip size={18} />
      </IconButton>
      <div className={styles.composerModel}>{props.modelControl}</div>
      <IconButton
        label={sendLabel}
        title={`${sendLabel} · ${t("chat.enterHint")}`}
        className={styles.send}
        onClick={() => void submit()}
        disabled={
          props.busy || !props.authenticated || (!text.trim() && !images.length)
        }
      >
        <IconSend size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function ChatAttachments({
  images,
  onRemove,
}: {
  images: ReturnType<typeof useChatDraft>["images"];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation("components");
  return images.length > 0 ? (
    <div className={styles.attachments}>
      {images.map((image) => (
        <div key={image.id}>
          <img src={image.dataUrl} alt={image.name} />
          <IconButton
            label={t("chat.removeImage")}
            size="sm"
            onClick={() => onRemove(image.id)}
          >
            <IconX size={14} />
          </IconButton>
        </div>
      ))}
    </div>
  ) : null;
}
