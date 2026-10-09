import { handleMcpArtifact } from "./mcpArtifactHttp";
import type { McpArtifactStore } from "./mcpArtifactStore";
import { McpEditError } from "../application/mcpEditPolicy";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { McpConfiguration } from "./mcpConfiguration";
import {
  McpHttpError,
  validateMcpHost,
  validateMcpPost,
  validateMcpEndpoint,
} from "./mcpHttpPolicy";
import { handleMcpMessage, type McpHttpReply } from "./mcpProtocol";
import type { McpTool } from "./mcpReadTools";
import { readMcpBody } from "./mcpRequestBody";
import { McpOAuthHttp } from "./mcpOAuthHttp";
import { openMcpEventStream } from "./mcpEventStream";
import {
  mcpOAuthAuthorization,
  authorizeMcpHttpRequest,
  type McpHttpAuthorization,
} from "./mcpHttpAuthorization";

export type McpHttpServer = {
  url: string;
  stopAccepting: () => void;
  close: () => Promise<void>;
};
type RequestTrace = {
  route: string;
  httpMethod: string;
  protocol: string;
  rpcMethod: string;
  rpcError?: number;
  toolCount?: number;
  authorized: boolean;
};
export type McpRequestDiagnostic = RequestTrace & {
  status: number;
  responseBytes: number | null;
  completed: boolean;
  durationMs: number;
};
type ServerOptions = {
  config: McpConfiguration;
  tools: readonly McpTool[];
  reportError: (error: unknown) => void;
  reportRequest?: (diagnostic: McpRequestDiagnostic) => void;
  oauthHttp?: McpOAuthHttp;
  enforceScopes?: boolean;
  artifacts?: McpArtifactStore | (() => McpArtifactStore | undefined);
  authorization?: McpHttpAuthorization;
};

export async function startMcpHttpServer(
  options: ServerOptions,
): Promise<McpHttpServer> {
  const config = { ...options.config };
  if (config.oauthPassword && !config.publicOrigin)
    throw new Error("OAuth requires an HTTPS public origin.");
  const oauth =
    options.oauthHttp ??
    (config.oauthPassword && config.publicOrigin
      ? new McpOAuthHttp(config.publicOrigin, config.oauthPassword)
      : undefined);
  const handler = createRequestHandler(options, config, oauth);
  const requests = new Set<Promise<void>>();
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const trace = traceRequest(request, response, options);
    const task = handler.serve(request, response, trace);
    requests.add(task);
    const remove = () => {
      requests.delete(task);
    };
    void task.then(remove, remove);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 75_000;
  server.maxConnections = 32;
  let closing: Promise<void> | undefined;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", options.reportError);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("MCP listener address is unavailable.");
  config.port = address.port;
  async function closeListener(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await Promise.allSettled([...requests]);
    await oauth?.close();
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    stopAccepting: handler.stopAccepting,
    close: () => {
      handler.stopAccepting();
      closing ??= closeListener();
      return closing;
    },
  };
}

function createRequestHandler(
  options: ServerOptions,
  config: McpConfiguration,
  oauth?: McpOAuthHttp,
) {
  const state = { accepting: true, active: 0 };
  const streams = new Set<ServerResponse>();
  const authorize = (request: IncomingMessage) =>
    authorizeMcpHttpRequest(request, config, oauth, options.authorization);
  async function serve(
    request: IncomingMessage,
    response: ServerResponse,
    trace: RequestTrace,
  ) {
    let counted = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      validateMcpHost(request, config);
      if (!state.accepting)
        throw new McpHttpError(503, "MCP server is stopping.");
      if (state.active >= 8)
        throw new McpHttpError(429, "Too many concurrent requests.");
      state.active++;
      counted = true;
      deadline = setTimeout(() => {
        sendFailure(
          response,
          new McpHttpError(504, "MCP read timed out."),
          oauth,
        );
      }, 30_000);
      deadline.unref();
      if (await handleMcpArtifact(resolveArtifacts(options), request, response))
        return;
      if (await oauth?.handle(request, response)) return;
      await authorize(request);
      trace.authorized = true;
      validateMcpEndpoint(request, response);
      if (
        openMcpEventStream(request, response, {
          streams,
          authorize,
          reportError: options.reportError,
        })
      )
        return;
      validateMcpPost(request);
      const body = await readMcpBody(request, 8 * 1024 * 1024);
      traceRpcRequest(trace, body);
      if (!state.accepting)
        throw new McpHttpError(503, "MCP server is stopping.");
      await authorize(request);
      const reply = await handleMcpMessage(
        body,
        visibleTools(options, request, response, oauth),
        options.reportError,
        request.headersDistinct,
      );
      traceRpcReply(trace, reply.body);
      sendReply(response, reply);
    } catch (error) {
      if (!(error instanceof McpHttpError)) options.reportError(error);
      sendFailure(response, error, oauth);
    } finally {
      clearTimeout(deadline);
      if (counted) state.active--;
    }
  }
  return {
    serve,
    stopAccepting: () => {
      state.accepting = false;
      for (const response of streams) response.end();
      oauth?.stop();
    },
  };
}

function sendFailure(
  response: ServerResponse,
  error: unknown,
  oauth?: McpOAuthHttp,
) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    // A streamed file is incomplete: never append JSON or rewrite its headers.
    response.destroy();
    return;
  }
  const status = error instanceof McpHttpError ? error.status : 500;
  const message =
    error instanceof McpHttpError ? error.message : "Internal server error.";
  response.setHeader("Connection", "close");
  if (status === 401)
    response.setHeader(
      "WWW-Authenticate",
      oauth?.challenge() ?? 'Bearer realm="carrot-mcp"',
    );
  if (status === 429) response.setHeader("Retry-After", "1");
  sendReply(response, { status, body: { error: message } });
}

function sendReply(response: ServerResponse, reply: McpHttpReply) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = reply.status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (reply.body === undefined) response.end();
  else {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const body = JSON.stringify(reply.body);
    response.setHeader("Content-Length", Buffer.byteLength(body));
    response.end(body);
  }
}

/** Allowlisted metadata only: never capture credentials, URLs, IDs or tool arguments. */
function traceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Pick<ServerOptions, "reportRequest" | "reportError">,
): RequestTrace {
  const path = request.url?.split("?")[0] ?? "";
  const method = request.method ?? "";
  const routes = [
    "/mcp",
    "/oauth/register",
    "/oauth/authorize",
    "/oauth/token",
    "/oauth/consent",
    "/oauth/pairing",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
  ];
  const trace: RequestTrace = {
    route: routes.includes(path) ? path : "other",
    httpMethod: ["GET", "POST", "DELETE", "OPTIONS"].includes(method)
      ? method
      : "other",
    protocol: safeProtocol(request.headers["mcp-protocol-version"]),
    rpcMethod: "unread",
    authorized: false,
  };
  const started = performance.now();
  let reported = false;
  const finish = () => {
    if (reported) return;
    reported = true;
    const length = Number(response.getHeader("Content-Length"));
    try {
      options.reportRequest?.({
        ...trace,
        status: response.statusCode,
        responseBytes: Number.isFinite(length) ? length : null,
        completed: response.writableFinished,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      options.reportError(error);
    }
  };
  response.once("finish", finish);
  response.once("close", finish);
  return trace;
}
function safeProtocol(value: unknown): string {
  return value === undefined
    ? "absent"
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : "invalid";
}
function traceRpcRequest(trace: RequestTrace, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const request = value as {
    method?: unknown;
    params?: { protocolVersion?: unknown };
  };
  const methods = [
    "initialize",
    "server/discover",
    "tools/list",
    "tools/call",
    "ping",
    "notifications/initialized",
  ];
  trace.rpcMethod =
    typeof request.method === "string" && methods.includes(request.method)
      ? request.method
      : "other";
  if (trace.protocol === "absent")
    trace.protocol = safeProtocol(request.params?.protocolVersion);
}
function traceRpcReply(trace: RequestTrace, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const reply = value as {
    error?: { code?: unknown };
    result?: { tools?: unknown };
  };
  if (typeof reply.error?.code === "number") trace.rpcError = reply.error.code;
  if (trace.rpcMethod === "tools/list" && Array.isArray(reply.result?.tools))
    trace.toolCount = reply.result.tools.length;
}

function visibleTools(
  options: ServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  oauth?: McpOAuthHttp,
) {
  if (!options.enforceScopes) return options.tools;
  const authorization = options.authorization ?? mcpOAuthAuthorization(oauth);
  const scope =
    authorization.scopeFor(request.headers.authorization ?? "") ?? "";
  const scopes = scope.split(" ");
  const visible = options.tools.filter((tool) =>
    (tool.requiredScopes ?? ["carrot.read"]).every((needed) =>
      scopes.includes(needed),
    ),
  );
  const visibleToolNames = visible.map((tool) => tool.name);
  return visible.map((tool) => {
    const assertAuthorized = () => {
      if (response.destroyed || response.writableEnded)
        throw new McpEditError(
          "access_denied",
          "The request ended before the operation could commit. Inspect the page before retrying.",
        );
      const current =
        authorization
          .scopeFor(request.headers.authorization ?? "")
          ?.split(" ") ?? [];
      if (
        !(tool.requiredScopes ?? ["carrot.read"]).every((needed) =>
          current.includes(needed),
        )
      )
        throw new McpEditError(
          "access_denied",
          "Authorization changed. Reconnect or request approval in the app.",
        );
    };
    return {
      ...tool,
      invoke: async (args: Record<string, unknown>) => {
        assertAuthorized();
        const header = request.headers.authorization ?? "";
        const principalId = authorization.principalFor(header);
        const required = tool.requiredScopes ?? ["carrot.read"];
        const assertScopes = (needed: readonly string[]) =>
          assertGranted(needed, authorization.scopeFor(header));
        const assertJobAuthorized = (needed: readonly string[] = required) => {
          assertGranted(needed, scope);
          assertGranted(
            needed,
            principalId
              ? authorization.scopeForPrincipal(principalId)
              : undefined,
          );
        };
        const result = await tool.invoke(args, {
          assertAuthorized,
          principalId,
          assertScopes,
          assertJobAuthorized,
          visibleToolNames,
          clientName: authorization.clientNameFor?.(header),
        });
        assertAuthorized();
        return result;
      },
    };
  });
}

function assertGranted(
  needed: readonly string[],
  scope: string | undefined,
): void {
  if (!scope || !needed.every((item) => scope.split(" ").includes(item)))
    throw new McpEditError(
      "access_denied",
      "The operation's approved permissions are unavailable or revoked.",
    );
}

function resolveArtifacts(options: ServerOptions) {
  return typeof options.artifacts === "function"
    ? options.artifacts()
    : options.artifacts;
}
