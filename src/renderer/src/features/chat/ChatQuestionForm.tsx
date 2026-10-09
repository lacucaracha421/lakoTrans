import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import type { useChat } from "./useChat";
import styles from "./ChatPanel.module.css";
export function ChatQuestionForm({
  question,
  busy,
  onAnswer,
}: {
  question: NonNullable<ReturnType<typeof useChat>["session"]>["question"];
  busy: boolean;
  onAnswer: (answers: Record<string, string>) => Promise<void>;
}) {
  const { t } = useTranslation("components");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className={styles.question}>
      {question?.questions.map((item) => (
        <div key={item.id}>
          <TextField
            label={item.question}
            value={answers[item.id] ?? ""}
            onChange={(event) =>
              setAnswers({ ...answers, [item.id]: event.target.value })
            }
          />
          {item.options.map((option) => (
            <Button
              key={option.label}
              size="sm"
              title={option.description}
              onClick={() =>
                setAnswers({ ...answers, [item.id]: option.label })
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      ))}
      <Button
        size="sm"
        onClick={() => void onAnswer(answers)}
        disabled={
          busy || question?.questions.some((item) => !answers[item.id]?.trim())
        }
      >
        {t("chat.answer")}
      </Button>
    </div>
  );
}
