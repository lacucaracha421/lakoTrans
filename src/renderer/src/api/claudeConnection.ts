import { createAccountConnection } from "./accountConnection";
import { claudeGateway } from "./claudeGateway";
export const claudeConnection = createAccountConnection(() =>
  claudeGateway.getClaudeAccount(),
);
