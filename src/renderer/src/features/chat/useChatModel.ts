import { useState } from "react";
import type { ChatSession } from "../../../../shared/chatTypes";
import { useCodexConnection } from "../../hooks/useCodexConnection";
import { useAccountConnection } from "../../hooks/useAccountConnection";
import { claudeConnection } from "../../api/claudeConnection";

export function useChatModel(enabled: boolean, session: ChatSession | null) {
  const runtime = session?.runtime ?? "codex";
  const codex = useCodexConnection(enabled && runtime !== "claude");
  const claude = useAccountConnection(
    claudeConnection,
    enabled && runtime === "claude",
  );
  const account = runtime === "claude" ? claude.account : codex.account;
  const [choices, setChoices] = useState<
    Record<string, { model: string; effort: string }>
  >({});
  const models = account?.models ?? [];
  const choice = session ? choices[session.id] : undefined;
  const { model, effort } = resolveSelection(models, choice, session);
  const update = (modelId: string, reasoning: string) => {
    if (session)
      setChoices((current) => ({
        ...current,
        [session.id]: { model: modelId, effort: reasoning },
      }));
  };
  return {
    models,
    model,
    effort,
    authenticated: Boolean(account?.authenticated),
    runtime,
    selectModel: (id: string) => {
      const next = models.find((entry) => entry.id === id);
      if (next) update(id, defaultEffort(next));
    },
    selectEffort: (value: string) => {
      if (model) update(model.id, value);
    },
  };
}

type ChatModel = {
  supportedReasoningEfforts: readonly string[];
  defaultReasoningEffort: string;
};

/** Chat translation starts at high reasoning whenever the model offers it. */
const PREFERRED_EFFORT = "high";

function defaultEffort(model: ChatModel): string {
  return model.supportedReasoningEfforts.includes(PREFERRED_EFFORT)
    ? PREFERRED_EFFORT
    : model.defaultReasoningEffort;
}

function selectEffort(model: ChatModel | undefined, requested?: string | null) {
  if (!model) return "";
  return (
    model.supportedReasoningEfforts.find((value) => value === requested) ??
    defaultEffort(model)
  );
}

function resolveSelection<
  T extends ChatModel & { id: string; isDefault: boolean },
>(
  models: T[],
  choice: { model: string; effort: string } | undefined,
  session: ChatSession | null,
) {
  const model =
    models.find((entry) => entry.id === (choice?.model ?? session?.model)) ??
    models.find((entry) => entry.isDefault) ??
    models[0];
  return {
    model,
    effort: selectEffort(model, choice?.effort ?? session?.effort),
  };
}
