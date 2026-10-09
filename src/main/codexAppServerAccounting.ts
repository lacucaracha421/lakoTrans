import { asRecord, type JsonRecord } from "./codexAppServerProtocol";

export function observeCodexTurnAccounting(
  threadId: string,
  subscribe: (listener: (value: JsonRecord) => void) => () => void,
) {
  const usageByTurn = new Map<
    string,
    { tokenUsage: JsonRecord | null; lastTokenUsage: JsonRecord | null }
  >();
  let routedModel: string | null = null;
  const listener = (notification: JsonRecord) => {
    const params = asRecord(notification.params);
    if (params?.threadId !== threadId) return;
    if (
      notification.method === "thread/tokenUsage/updated" &&
      typeof params.turnId === "string"
    ) {
      const usage = asRecord(params.tokenUsage);
      usageByTurn.set(params.turnId, {
        tokenUsage: asRecord(usage?.total),
        lastTokenUsage: asRecord(usage?.last),
      });
    }
    if (
      notification.method === "model/rerouted" &&
      typeof params.toModel === "string"
    ) {
      routedModel = params.toModel;
    }
  };
  const unsubscribe = subscribe(listener);
  return {
    snapshot: (turnId: string) => ({
      tokenUsage: usageByTurn.get(turnId)?.tokenUsage ?? null,
      lastTokenUsage: usageByTurn.get(turnId)?.lastTokenUsage ?? null,
      routedModel,
    }),
    dispose: () => {
      unsubscribe();
    },
  };
}
