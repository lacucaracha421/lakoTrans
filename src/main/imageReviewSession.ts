import type { AppSettings } from "../shared/settingsTypes";
import type { AppPaths } from "./appPaths";
import type { CodexAppServerTurnRequest } from "./codexAppServerProtocol";
import { startCodexImageSession } from "./codexImageSession";
import { runClaudeCompletion } from "./claude/claudeCompletion";
import { requireImageRedactionReview } from "./imageRedactionContext";

/** Analysis-only transport. Generation always retains its own configured client. */
export async function startImageReviewSession(
  paths: AppPaths,
  settings: Parameters<typeof startCodexImageSession>[1] &
    Pick<AppSettings, "imageReview">,
  directory: string,
  signal: AbortSignal,
) {
  if (settings.imageReview?.provider !== "claude")
    return startCodexImageSession(
      paths,
      settings,
      directory,
      signal,
      "isolated",
    );
  await requireImageRedactionReview(paths.dataRoot);
  const lifetime = new AbortController();
  const { model, effort } = settings.imageReview.claude;
  return {
    imageModel: model,
    runEphemeralTurn: async (request: CodexAppServerTurnRequest) => {
      if (request.previewTool || request.imageGenerationSize)
        throw new Error("Claude 이미지 검수는 생성 도구를 실행하지 않습니다.");
      const result = await runClaudeCompletion(paths, {
        ...request,
        model,
        effort,
        signal: AbortSignal.any([
          signal,
          lifetime.signal,
          ...(request.signal ? [request.signal] : []),
        ]),
      });
      return {
        text: result.text,
        threadId: result.sessionId,
        turnId: result.resultId,
        itemId: null,
        tokenUsage: { ...result.usage, modelUsage: result.modelUsage },
      };
    },
    dispose: async () => {
      lifetime.abort();
    },
  };
}
