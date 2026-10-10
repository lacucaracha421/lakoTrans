import { useEffect, useSyncExternalStore } from "react";
import type { createAccountConnection } from "../api/accountConnection";
export function useAccountConnection<T>(
  connection: ReturnType<typeof createAccountConnection<T>>,
  enabled: boolean,
) {
  const revision = useSyncExternalStore(
    connection.subscribe,
    connection.getRevision,
  );
  useEffect(() => {
    if (!enabled) return;
    let initial = true;
    const refresh = () => {
      if (document.hidden && !initial) return;
      initial = false;
      void connection.refresh().catch((error: unknown) => {
        console.error("Account refresh failed", error);
        connection.publish(null);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [connection, enabled]);
  return { account: connection.getSnapshot(), revision };
}
