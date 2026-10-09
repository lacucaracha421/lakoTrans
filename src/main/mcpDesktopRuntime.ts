import type { McpPreferences } from "../shared/mcpDesktopTypes";
import {
  McpDesktopService,
  type McpDesktopLease,
} from "./application/mcpDesktopService";
import { McpSecureStore } from "./mcp/mcpSecureStore";
import { McpDesktopAuthorization } from "./mcp/mcpDesktopAuthorization";
import {
  startMcpHttpServer,
  type McpRequestDiagnostic,
} from "./mcp/mcpHttpServer";
import {
  prepareTailscale,
  openTailscale,
  McpTailscaleSetupError,
} from "./mcp/mcpTailscale";
import { diagnoseMcpEndpoint } from "./mcp/mcpDiagnostics";
import { McpLocalHost, type McpLocalEditing } from "./mcp/mcpLocalHost";
import { mcpEndpointTools } from "./mcp/mcpEndpointTools";

export function createMcpDesktopRuntime(
  dataRoot: string,
  reportError: (error: unknown) => void,
  editing: McpLocalEditing,
  reportRequest: (diagnostic: McpRequestDiagnostic) => void,
) {
  const store = new McpSecureStore(dataRoot);
  const authorization = new McpDesktopAuthorization(store);
  const host = new McpLocalHost(store, editing, reportError);
  const service = new McpDesktopService({
    reportEditorState: (state) => host.guard.report(state),
    preferences: () => store.preferences(),
    savePreferences: (value) => store.savePreferences(value),
    savedStatus: () => authorization.status(),
    revokeSaved: (id) => authorization.revoke(id),
    open: (preferences, signal, failed) =>
      openDesktop({
        authorization,
        host,
        reportError,
        reportRequest,
        preferences,
        signal,
        failed,
      }),
    diagnose: async (url) => {
      const result = await diagnoseMcpEndpoint(url);
      const identity = await store.identity();
      return {
        ...result,
        checks: [
          { name: "Local data directory", passed: true, message: dataRoot },
          {
            name: "Server / data profile",
            passed: true,
            message: `${identity.serverId} / ${identity.dataProfileId}`,
          },
          ...result.checks,
        ],
      };
    },
    reportError,
    setupUrl: (error) =>
      error instanceof McpTailscaleSetupError ? error.setupUrl : null,
  });
  const dispose = service.dispose.bind(service);
  return Object.assign(service, {
    connectChat: host.connect.bind(host),
    dispose: async () => {
      try {
        await dispose();
      } finally {
        await host.dispose();
      }
    },
  });
}

type DesktopOptions = {
  reportRequest: (diagnostic: McpRequestDiagnostic) => void;
  authorization: McpDesktopAuthorization;
  host: McpLocalHost;
  reportError: (error: unknown) => void;
  preferences: McpPreferences;
  signal: AbortSignal;
  failed: () => void;
};

async function openDesktop(options: DesktopOptions): Promise<McpDesktopLease> {
  const target = await prepareTailscale();
  options.signal.throwIfAborted();
  const auth = await options.authorization.open(
    target.origin,
    options.preferences,
  );
  let server: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;
  try {
    const host = await options.host.ready();
    options.signal.throwIfAborted();
    server = await startMcpHttpServer({
      config: {
        port: 38475,
        token: auth.localToken,
        publicOrigin: target.origin,
      },
      tools: mcpEndpointTools(
        filterTools(host.tools, options.preferences),
        host.origin,
        target.origin,
      ),
      reportError: options.reportError,
      reportRequest: options.reportRequest,
      enforceScopes: true,
      oauthHttp: auth.http,
      artifacts: host.pageOperations.artifacts,
    });
    const listener = server;
    const stopAccepting = () => listener.stopAccepting();
    const tunnel = await openTailscale(target, 38475, options.signal, () => {
      stopAccepting();
      options.failed();
    });
    return {
      url: `${target.origin}/mcp`,
      stopAccepting,
      close: async () => {
        await tunnel.close();
        await listener.close();
      },
      connections: () => auth.provider.connections(),
      pairingStatus: () => auth.pairing.status(),
      resolvePairing: (id, approve) => auth.pairing.resolve(id, approve),
      revoke: (id) =>
        auth.session.run(() => auth.provider.revokeConnection(id)),
    };
  } catch (error) {
    try {
      if (server) await server.close();
      else await auth.http.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "MCP startup and cleanup failed.",
        { cause: cleanup },
      );
    }
    throw error;
  }
}

function filterTools(
  tools: Awaited<ReturnType<McpLocalHost["ready"]>>["tools"],
  preferences: McpPreferences,
) {
  const scopes = [
    "carrot.read",
    ...(preferences.allowImages ? ["carrot.images"] : []),
    ...(preferences.allowEditing ? ["carrot.edit"] : []),
    ...(preferences.allowProcessing ? ["carrot.process"] : []),
  ];
  return tools.filter((tool) =>
    (tool.requiredScopes ?? ["carrot.read"]).every((scope) =>
      scopes.includes(scope),
    ),
  );
}
