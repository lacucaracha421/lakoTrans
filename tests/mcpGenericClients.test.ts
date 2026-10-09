import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { McpOAuthProvider } from "../src/main/mcp/mcpOAuthProvider";
import { McpOAuthSession } from "../src/main/mcp/mcpOAuthSession";
import { McpOAuthHttp } from "../src/main/mcp/mcpOAuthHttp";
import { McpPairingBroker } from "../src/main/mcp/mcpPairingBroker";
import { startMcpHttpServer } from "../src/main/mcp/mcpHttpServer";
import { mcpOAuthAuthorization } from "../src/main/mcp/mcpHttpAuthorization";
import {
  matchesMcpOAuthRedirect,
  oauthDigest,
  readMcpOAuthRedirect,
} from "../src/main/mcp/mcpOAuthPolicy";

const issuer = "https://carrot.example";
const secret = "p".repeat(43);
const verifier = "v".repeat(43);
const callbacks = [
  "http://127.0.0.1:19876/mcp/oauth/callback",
  "http://localhost:40321/an/unlisted/app/return",
  "http://[::1]:40321/sign-in/return?channel=desktop",
  "https://unlisted-client.example/auth/return?channel=web",
];

it.each(callbacks)(
  "authorizes, resumes and revokes a generic client over HTTP: %s",
  async (redirectUri) => {
    const provider = new McpOAuthProvider(issuer, secret, Date.now, {
      persistent: true,
    });
    const session = new McpOAuthSession(provider, {
      save: async () => undefined,
    });
    const pairing = new McpPairingBroker(provider, secret);
    const server = await startMcpHttpServer({
      config: { port: 0, token: "t".repeat(43), publicOrigin: issuer },
      tools: [],
      oauthHttp: new McpOAuthHttp(issuer, secret, { session, pairing }),
      reportError: (error) => {
        throw error;
      },
    });
    const base = new URL(server.url).origin;
    try {
      const registration = await fetch(`${base}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
        }),
      });
      expect(registration.status).toBe(201);
      const client = await registration.json();
      expect(client.client_name).toBe("MCP client");
      const params = {
        client_id: client.client_id,
        redirect_uri: redirectUri,
        resource: `${issuer}/mcp`,
        response_type: "code",
        state: "generic-client-state",
        scope: "carrot.read offline_access",
        code_challenge: oauthDigest(verifier),
        code_challenge_method: "S256",
      };
      const consent = await fetch(
        `${base}/oauth/authorize?${new URLSearchParams(params)}`,
      );
      expect(consent.status).toBe(200);
      const html = await consent.text();
      expect(html).toContain("승인 후 돌아갈 주소");
      expect(html).toContain(redirectUri.replaceAll("&", "&amp;"));
      const pending = pairing.status().pending[0];
      expect(pending.redirectUri).toBe(redirectUri);
      pairing.resolve(pending.id, true);
      const cookie = consent.headers.get("set-cookie");
      assert.ok(cookie);
      const completion = await fetch(`${base}/oauth/complete`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Origin: issuer,
          Cookie: cookie.split(";")[0],
        },
        body: new URLSearchParams({ transaction: pending.id }),
      });
      expect(completion.status).toBe(303);
      expect(completion.headers.get("content-security-policy")).toContain(
        `form-action 'self' ${new URL(redirectUri).origin};`,
      );
      const destination = completion.headers.get("location");
      assert.ok(destination);
      const location = new URL(destination);
      expect(location.origin + location.pathname).toBe(
        new URL(redirectUri).origin + new URL(redirectUri).pathname,
      );
      expect(location.searchParams.get("state")).toBe(params.state);
      if (new URL(redirectUri).search)
        expect(location.searchParams.get("channel")).toBe(
          new URL(redirectUri).searchParams.get("channel"),
        );
      const code = location.searchParams.get("code");
      assert.ok(code);
      const exchange = await fetch(`${base}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: redirectUri,
          resource: params.resource,
          code,
          code_verifier: verifier,
        }),
      });
      expect(exchange.status).toBe(200);
      const tokens = await exchange.json();
      const restored = new McpOAuthProvider(issuer, secret, Date.now, {
        persistent: true,
      });
      restored.restore(provider.snapshot());
      const refreshed = restored.token({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: params.resource,
      });
      expect(restored.accepts(`Bearer ${refreshed.access_token}`)).toBe(true);
      const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      const authorization = mcpOAuthAuthorization(
        new McpOAuthHttp(issuer, secret, { session, pairing }),
      );
      expect(authorization.clientNameFor?.(headers.Authorization)).toBe(
        "MCP client",
      );
      expect(authorization.clientNameFor?.("Bearer invalid")).toBeUndefined();
      const rpc = () =>
        fetch(server.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
      expect((await rpc()).status).toBe(200);
      const connectionId = provider.connectionIdFor(headers.Authorization);
      assert.ok(connectionId);
      provider.revokeConnection(connectionId);
      expect(
        authorization.clientNameFor?.(headers.Authorization),
      ).toBeUndefined();
      expect((await rpc()).status).toBe(401);
    } finally {
      await server.close();
    }
  },
);

it("keeps exact registered return addresses and only relaxes the port of loopback callbacks", () => {
  for (const callback of callbacks)
    expect(readMcpOAuthRedirect(callback)).toBe(callback);
  const native = callbacks[2];
  expect(
    matchesMcpOAuthRedirect([native], native.replace("40321", "40322")),
  ).toBe(true);
  for (const changed of [
    native.replace("[::1]", "localhost"),
    native.replace("return", "other"),
    native.replace("desktop", "other"),
    native.replace("40321", "80"),
  ])
    expect(matchesMcpOAuthRedirect([native], changed)).toBe(false);
  for (const changed of [
    callbacks[3].replace(".example", ".example.evil"),
    callbacks[3].replace("web", "other"),
    callbacks[3].replace("return", "other"),
  ])
    expect(matchesMcpOAuthRedirect([callbacks[3]], changed)).toBe(false);
});
