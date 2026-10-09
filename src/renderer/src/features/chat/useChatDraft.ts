import { useRef, useState } from "react";
import type { ChatImage } from "../../../../shared/chatTypes";
import { chatGateway } from "../../api/chatGateway";

export type ChatComposerProps = {
  sessionId: string;
  busy: boolean;
  running: boolean;
  authenticated: boolean;
  /** One-line summary of what the next message carries. */
  context?: React.ReactNode;
  /** Model and reasoning chip shown beside the attach button. */
  modelControl?: React.ReactNode;
  drafts: React.RefObject<Map<string, { text: string; images: ChatImage[] }>>;
  onSend: (text: string, images: ChatImage[]) => Promise<boolean>;
  onError: (run: () => Promise<void>) => Promise<void>;
};
export function useChatDraft(props: ChatComposerProps) {
  const [draft, setDraft] = useState(
    () => props.drafts.current.get(props.sessionId) ?? { text: "", images: [] },
  );
  const current = useRef(draft);
  const sending = useRef(false);
  const update = (text: string, images = current.current.images) => {
    current.current = { text, images };
    props.drafts.current.set(props.sessionId, current.current);
    setDraft(current.current);
  };
  const attach = (files: File[]) =>
    props.onError(async () => {
      const additions: ChatImage[] = [];
      for (const file of files)
        additions.push(
          await chatGateway.attachChatImage(
            props.sessionId,
            file.name,
            await readImage(file),
          ),
        );
      update(current.current.text, [...current.current.images, ...additions]);
    });
  const submit = () =>
    props.onError(async () => {
      const captured = current.current;
      if (
        sending.current ||
        props.busy ||
        !props.authenticated ||
        (!captured.text.trim() && !captured.images.length)
      )
        return;
      sending.current = true;
      try {
        if (await props.onSend(captured.text, captured.images)) {
          const remaining = current.current.images.filter(
            (image) => !captured.images.some((sent) => sent.id === image.id),
          );
          update(
            current.current.text === captured.text ? "" : current.current.text,
            remaining,
          );
        }
      } finally {
        sending.current = false;
      }
    });
  return { ...draft, update, attach, submit };
}
function readImage(file: File): Promise<string> {
  if (
    !/^image\/(png|jpeg|webp)$/.test(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    return Promise.reject(
      new Error("PNG, JPEG, WebP 이미지를 20 MB 이하로 첨부해 주세요."),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
