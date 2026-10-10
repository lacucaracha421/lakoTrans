import { claudeIpcContracts } from "../../shared/ipcClaudeContracts";
import { authenticateClaude, readClaudeAccount } from "../claude/claudeAccount";
import type { IpcContext } from "./context";
import { trustedHandleContract } from "./trustedIpc";
import { randomUUID } from "node:crypto";
import { runManagedAppOperation } from "../appOperationRegistry";

export function registerClaudeAccountIpc(context: IpcContext) {
  trustedHandleContract(context, claudeIpcContracts.getClaudeAccount, () =>
    readClaudeAccount(context.appPaths),
  );
  const authenticate = (action: "subscription" | "console" | "logout") =>
    runManagedAppOperation(
      context.operations,
      {
        id: `claude-auth-${randomUUID()}`,
        kind: "claude-auth",
        mutatesLibrary: false,
        resources: [{ kind: "claude-auth", scope: "*", access: "write" }],
        presentation: { phase: "waiting-for-user", cancellable: true },
      },
      (signal) => authenticateClaude(context.appPaths, action, signal),
    );
  trustedHandleContract(
    context,
    claudeIpcContracts.loginClaudeAccount,
    (_event, method?: "subscription" | "console") =>
      authenticate(method ?? "subscription"),
  );
  trustedHandleContract(context, claudeIpcContracts.logoutClaudeAccount, () =>
    authenticate("logout"),
  );
}
