import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with {
  "resolution-mode": "import",
};
import type { AppSettings } from "../../shared/settingsTypes";
import { getAppPaths } from "../appPaths";
import {
  buildCodexWebResearchPrompt,
  type WorkContextResearchPromptInput,
} from "../workContextResearchPrompt";
import { parseWorkContextModelJson } from "../workContextJsonParser";
import type { TranslationOptions } from "../settings/appSettingsTypes";
import { runClaudeCompletion } from "./claudeCompletion";

export async function researchWithClaude(
  input: WorkContextResearchPromptInput,
  settings: AppSettings,
  signal?: AbortSignal,
  onProgress?: TranslationOptions["onProgress"],
) {
  const prompt = buildCodexWebResearchPrompt(input, { maxOutputTokens: 32768 });
  const queries = new Set<string>();
  const tools = new Set<string>();
  const allowedSourceUrls = new Set<string>();
  const onMessage = (message: SDKMessage) => {
    if (message.type === "assistant")
      for (const part of message.message.content) {
        if (
          part.type !== "tool_use" ||
          !["WebSearch", "WebFetch"].includes(part.name)
        )
          continue;
        tools.add(part.id);
        if (part.name === "WebSearch") queries.add(part.id);
      }
    collectSources(message, tools, allowedSourceUrls);
  };
  onProgress?.({
    phase: "model_requesting",
    progressText: "Claude 웹 조사 중",
    detail: "검색 출처를 확인하고 있습니다.",
    progressMode: "indeterminate",
    research: { stage: "searching" },
  });
  const result = await runClaudeCompletion(getAppPaths(), {
    model: settings.internetResearch.claude?.model ?? "default",
    effort: settings.internetResearch.claude?.effort ?? "high",
    instructions: prompt.instructions,
    input: [{ type: "text", text: prompt.userPrompt }],
    outputSchema: prompt.outputSchema,
    tools: ["WebSearch", "WebFetch"],
    signal,
    onMessage,
  });
  if (!queries.size || !allowedSourceUrls.size)
    throw new Error(
      "Claude의 실제 검색 출처를 확인하지 못했습니다. 조사 결과를 적용하지 않았습니다.",
    );
  return {
    raw: parseWorkContextModelJson(result.text),
    queryCount: queries.size,
    tavilyCreditsUsed: 0,
    warnings: [],
    allowedSourceUrls,
  };
}

function collectSources(
  message: SDKMessage,
  tools: Set<string>,
  allowedSourceUrls: Set<string>,
) {
  if (message.type === "user" && Array.isArray(message.message.content))
    for (const part of message.message.content) {
      if (
        part.type !== "tool_result" ||
        !tools.has(part.tool_use_id) ||
        part.is_error
      )
        continue;
      const text =
        typeof part.content === "string"
          ? part.content
          : JSON.stringify(part.content);
      for (const url of text.match(/https?:\/\/[^\s<>"\\)\]]+/g) ?? [])
        allowedSourceUrls.add(url);
    }
}
