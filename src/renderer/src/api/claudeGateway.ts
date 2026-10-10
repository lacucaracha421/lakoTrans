import { createMangaDomainGateway } from "./mangaGateway";
export const claudeGateway = createMangaDomainGateway("Claude", [
  "getClaudeAccount",
  "loginClaudeAccount",
  "logoutClaudeAccount",
]);
