import { app } from "electron";
import type { AppPaths } from "../appPaths";
import { CodexAppServerClient } from "../codexAppServerClient";
import { asRecord } from "../codexAppServerProtocol";
import { imageEditingBudget } from "../../shared/imageEditingBudget";
import { allowArguments } from "./mcpArguments";
import { textContent, type McpTool } from "./mcpReadTools";

type BudgetClient = Pick<CodexAppServerClient, "readAccount" | "dispose"> & {
  connection: Pick<CodexAppServerClient["connection"], "request">;
};

/** Account metadata only: no inference, credentials, email, purchase or reset. */
export function createMcpImageBudgetTool(
  paths: AppPaths,
  signal: AbortSignal,
  start: () => Promise<BudgetClient> = () =>
    CodexAppServerClient.start({ paths, appVersion: app.getVersion(), signal }),
): McpTool {
  return {
    name: "carrot_get_image_budget",
    description:
      "Read the app's signed-in ChatGPT plan and current Codex account usage before automatically choosing erasure/ImageGen. Returns a conservative image policy, not an image quota count. User-specified engine/model wins. For an external host's ImageGen use THAT host's own account usage; this tool describes only the app account. Opens the bundled account client without starting an inference turn, login, download, purchase or reset. Recheck before each generation batch; unavailable usage stays unknown.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiredScopes: ["carrot.read", "carrot.process"],
    readOnly: true,
    idempotent: true,
    invoke: async (args, context) => {
      allowArguments(args, []);
      context?.assertAuthorized();
      signal.throwIfAborted();
      const client = await start();
      try {
        const account = await client.readAccount();
        const planType =
          account.account?.type === "chatgpt" ? account.account.planType : null;
        const limits = await client.connection
          .request("account/rateLimits/read", undefined, 5000)
          .catch(() => null); // error-policy-allow: optional quota metadata is explicitly unknown on older/offline servers.
        context?.assertAuthorized();
        signal.throwIfAborted();
        return textContent({
          observedAt: Date.now(),
          ...imageEditingBudget({ planType, ...readUsage(limits, Date.now()) }),
        });
      } finally {
        await client.dispose(true);
      }
    },
  };
}

function readUsage(value: unknown, now: number) {
  const result = asRecord(value);
  const buckets = asRecord(result?.rateLimitsByLimitId);
  const bucket = asRecord(buckets?.codex ?? result?.rateLimits) ?? {};
  const windows = [bucket.primary, bucket.secondary].flatMap((value) => {
    const window = asRecord(value);
    if (
      !window ||
      typeof window.usedPercent !== "number" ||
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent > 100 ||
      typeof window.resetsAt !== "number" ||
      !Number.isFinite(window.resetsAt) ||
      window.resetsAt * 1000 <= now
    )
      return [];
    return [{ usedPercent: window.usedPercent, resetsAt: window.resetsAt }];
  });
  const limiting = windows.sort((a, b) => b.usedPercent - a.usedPercent)[0];
  return {
    usedPercent: limiting?.usedPercent ?? null,
    resetsAt: limiting?.resetsAt ?? null,
    limitReached:
      typeof bucket.rateLimitReachedType === "string" &&
      bucket.rateLimitReachedType.length > 0,
  };
}
