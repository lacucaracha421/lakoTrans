export const CLAUDE_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type ClaudePreferences = { model: string; effort: ClaudeEffort };
export type ClaudeAccount = {
  authenticated: boolean;
  email: string | null;
  plan: string | null;
  version: string;
  models: {
    id: string;
    displayName: string;
    supportedReasoningEfforts: ClaudeEffort[];
    defaultReasoningEffort: ClaudeEffort;
    isDefault: boolean;
  }[];
};
export type ClaudeApi = {
  getClaudeAccount: () => Promise<ClaudeAccount>;
  loginClaudeAccount: (
    method?: "subscription" | "console",
  ) => Promise<ClaudeAccount>;
  logoutClaudeAccount: () => Promise<ClaudeAccount>;
};
