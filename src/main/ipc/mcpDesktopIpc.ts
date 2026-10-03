import { clipboard, shell } from "electron";
import { mcpIpcContracts } from "../../shared/ipcMcpContracts";
import type { IpcContext } from "./context";
import { readTailscaleSetupUrl } from "../mcp/mcpTailscalePolicy";
import { trustedHandleContract } from "./trustedIpc";

/** Fixed help pages; the Tailscale setup page comes from the live status. */
const MCP_HELP_URLS = {
  tailscale: "https://tailscale.com/download",
  chatgpt: "https://chatgpt.com/",
  codex: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
  claude: "https://claude.ai/",
  "claude-code": "https://code.claude.com/docs/en/mcp",
} as const;

/** App configuration is available to the trusted main renderer only, never MCP. */
export function registerMcpDesktopIpc(context: IpcContext): void {
  trustedHandleContract(
    context,
    mcpIpcContracts.reportMcpEditorState,
    (_event, state) => requireService(context).reportEditorState(state),
  );
  trustedHandleContract(context, mcpIpcContracts.getMcpStatus, () =>
    requireService(context).getStatus(),
  );
  trustedHandleContract(
    context,
    mcpIpcContracts.setMcpEnabled,
    (_event, value) => requireService(context).setEnabled(value),
  );
  trustedHandleContract(
    context,
    mcpIpcContracts.configureMcp,
    (_event, value) => requireService(context).configure(value),
  );
  trustedHandleContract(
    context,
    mcpIpcContracts.resolveMcpPairing,
    (_event, id, approve) =>
      requireService(context).resolvePairing(id, approve),
  );
  trustedHandleContract(
    context,
    mcpIpcContracts.revokeMcpConnection,
    (_event, id) => requireService(context).revokeConnection(id),
  );
  trustedHandleContract(context, mcpIpcContracts.diagnoseMcp, () =>
    requireService(context).diagnose(),
  );
  trustedHandleContract(
    context,
    mcpIpcContracts.openMcpHelp,
    async (_event, page) => {
      const setup = (await requireService(context).getStatus()).setupUrl;
      const url =
        page === "setup"
          ? setup && readTailscaleSetupUrl(setup)
          : MCP_HELP_URLS[page];
      if (!url) throw new Error("현재 열 수 있는 설정 주소가 없습니다.");
      await shell.openExternal(url);
      return { completed: true };
    },
  );
  trustedHandleContract(context, mcpIpcContracts.copyMcpUrl, async () => {
    const status = await requireService(context).getStatus();
    if (!status.url) throw new Error("먼저 MCP 서버를 켜세요.");
    await clipboard.writeText(status.url);
    return { completed: true };
  });
}

function requireService(context: IpcContext) {
  if (!context.mcpDesktop)
    throw new Error("MCP desktop service is unavailable.");
  return context.mcpDesktop;
}
