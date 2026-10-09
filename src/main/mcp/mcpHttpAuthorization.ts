import type { IncomingMessage } from "node:http";
import type { McpConfiguration } from "./mcpConfiguration";
import { authorizeMcpRequest } from "./mcpHttpPolicy";
import type { McpOAuthHttp } from "./mcpOAuthHttp";

/** HTTP identity adapter. Native scopes and retained ownership remain identical. */
export type McpHttpAuthorization = {
  scopeFor: (header: string) => string | undefined;
  principalFor: (header: string) => string | undefined;
  scopeForPrincipal: (principal: string) => string | undefined;
  clientNameFor?: (header: string) => string | undefined;
};

export function mcpOAuthAuthorization(
  oauth?: McpOAuthHttp,
): McpHttpAuthorization {
  return {
    scopeFor: (header) => oauth?.scopeFor(header),
    principalFor: (header) => oauth?.provider.connectionIdFor(header),
    scopeForPrincipal: (principal) => oauth?.scopeForConnection(principal),
    clientNameFor: (header) => {
      const id = oauth?.provider.connectionIdFor(header);
      return id
        ? oauth?.provider
            .connections()
            .find((connection) => connection.id === id)?.clientName
        : undefined;
    },
  };
}

export async function authorizeMcpHttpRequest(
  request: IncomingMessage,
  config: McpConfiguration,
  oauth?: McpOAuthHttp,
  override?: McpHttpAuthorization,
) {
  await oauth?.ready();
  const authorization = override ?? mcpOAuthAuthorization(oauth);
  authorizeMcpRequest(
    request,
    config,
    (header) => authorization.scopeFor(header) !== undefined,
  );
}
