import { execFile, spawn } from "node:child_process";
import type { AppPaths } from "../appPaths";
import type { ClaudeAccount } from "../../shared/claudeTypes";
import { CLAUDE_EFFORTS } from "../../shared/claudeTypes";
import {
  CLAUDE_VERSION,
  claudeBinary,
  startClaudeRuntime,
} from "./claudeRuntime";

export async function readClaudeAccount(
  paths: AppPaths,
): Promise<ClaudeAccount> {
  const authenticated = await readAuthentication(paths);
  if (!authenticated)
    return {
      authenticated: false,
      email: null,
      plan: null,
      version: CLAUDE_VERSION,
      models: [],
    };
  const runtime = await startClaudeRuntime(paths);
  try {
    const [account, models] = await Promise.all([
      runtime.stream.accountInfo(),
      runtime.stream.supportedModels(),
    ]);
    return {
      authenticated,
      email: account.email ?? null,
      plan: account.subscriptionType ?? null,
      version: CLAUDE_VERSION,
      models: models.map((model, index) => ({
        id: model.value,
        displayName: model.displayName,
        supportedReasoningEfforts: (
          model.supportedEffortLevels ??
          (model.supportsEffort ? ["low", "medium", "high"] : [])
        ).filter((effort): effort is (typeof CLAUDE_EFFORTS)[number] =>
          CLAUDE_EFFORTS.includes(effort),
        ),
        defaultReasoningEffort: "high",
        isDefault: index === 0,
      })),
    };
  } finally {
    runtime.close();
  }
}

export async function authenticateClaude(
  paths: AppPaths,
  action: "logout" | "subscription" | "console",
  signal?: AbortSignal,
): Promise<ClaudeAccount> {
  signal?.throwIfAborted();
  const args =
    action === "logout"
      ? ["auth", "logout"]
      : ["auth", "login", ...(action === "console" ? ["--console"] : [])];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(claudeBinary(paths), args, {
      windowsHide: true,
      signal,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Claude 인증에 실패했습니다 (${code}). 로그인 창을 확인해 주세요.`,
            ),
          ),
    );
  });
  return readClaudeAccount(paths);
}

function readAuthentication(paths: AppPaths): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      claudeBinary(paths),
      ["auth", "status", "--json"],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error && error.code !== 1) {
          reject(error);
          return;
        }
        try {
          const status: unknown = JSON.parse(stdout);
          if (
            !status ||
            typeof status !== "object" ||
            !("loggedIn" in status) ||
            typeof status.loggedIn !== "boolean"
          )
            throw new Error("Claude 인증 상태를 확인하지 못했습니다.");
          resolve(status.loggedIn);
        } catch (cause) {
          reject(cause);
        }
      },
    );
  });
}
