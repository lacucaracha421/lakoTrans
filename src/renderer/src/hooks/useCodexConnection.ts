import { codexConnection } from "../api/codexConnection";
import { useAccountConnection } from "./useAccountConnection";
export function useCodexConnection(enabled: boolean) {
  return useAccountConnection(codexConnection, enabled);
}
