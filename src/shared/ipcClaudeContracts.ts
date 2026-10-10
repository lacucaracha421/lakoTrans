import { z } from "zod";
import { defineIpcContract } from "./ipcContractCore";
import { CLAUDE_EFFORTS, type ClaudeAccount } from "./claudeTypes";
const account = z
  .object({
    authenticated: z.boolean(),
    email: z.string().nullable(),
    plan: z.string().nullable(),
    version: z.string(),
    models: z.array(
      z
        .object({
          id: z.string(),
          displayName: z.string(),
          supportedReasoningEfforts: z.array(z.enum(CLAUDE_EFFORTS)),
          defaultReasoningEffort: z.enum(CLAUDE_EFFORTS),
          isDefault: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export const claudeIpcContracts = {
  getClaudeAccount: defineIpcContract<[], ClaudeAccount>({
    apiKey: "getClaudeAccount",
    channel: "claude:account",
    args: z.tuple([]),
    result: account,
  }),
  loginClaudeAccount: defineIpcContract<
    [("subscription" | "console")?],
    ClaudeAccount
  >({
    apiKey: "loginClaudeAccount",
    channel: "claude:login",
    args: z.tuple([z.enum(["subscription", "console"]).optional()]),
    result: account,
  }),
  logoutClaudeAccount: defineIpcContract<[], ClaudeAccount>({
    apiKey: "logoutClaudeAccount",
    channel: "claude:logout",
    args: z.tuple([]),
    result: account,
  }),
};

export const ClaudePreferencesSchema = z
  .object({ model: z.string().min(1).max(120), effort: z.enum(CLAUDE_EFFORTS) })
  .strict();
export const ImageReviewSettingsSchema = z
  .object({
    provider: z.enum(["codex", "claude"]),
    claude: ClaudePreferencesSchema,
  })
  .strict();
