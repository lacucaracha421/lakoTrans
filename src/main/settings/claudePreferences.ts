import {
  CLAUDE_EFFORTS,
  type ClaudePreferences,
} from "../../shared/claudeTypes";
import { asRecord } from "./appSettingsResolvers";

export function normalizeClaudePreferences(value: unknown): ClaudePreferences {
  const record = asRecord(value);
  return {
    model:
      typeof record?.model === "string" && record.model.trim()
        ? record.model.trim().slice(0, 120)
        : "default",
    effort:
      CLAUDE_EFFORTS.find((effort) => effort === record?.effort) ?? "high",
  };
}

export function normalizeImageReview(
  value: unknown,
): NonNullable<
  import("../../shared/settingsTypes").AppSettings["imageReview"]
> {
  const record = asRecord(value);
  return {
    provider: record?.provider === "claude" ? "claude" : "codex",
    claude: normalizeClaudePreferences(record?.claude),
  };
}
