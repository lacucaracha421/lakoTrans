import { createAccountConnection } from "./accountConnection";
import { settingsGateway } from "./settingsGateway";
export const codexConnection = createAccountConnection(() =>
  settingsGateway.getCodexAccount(),
);
