import { randomBytes, randomUUID } from "node:crypto";
import {
  parseMcpOAuthSnapshot,
  type McpOAuthSnapshot,
  type McpOAuthGrant,
} from "./mcpOAuthSnapshot";
import { McpOAuthClients } from "./mcpOAuthClients";
import { McpOAuthState } from "./mcpOAuthState";
import { McpOAuthRefreshTokens } from "./mcpOAuthRefreshTokens";
import {
  McpOAuthError,
  assertOAuthResource,
  matchesMcpOAuthRedirect,
  oauthEqual,
  oauthText,
  readOAuthScope,
  readPkceChallenge,
  verifyPkce,
} from "./mcpOAuthPolicy";

type ProviderOptions = {
  persistent?: boolean;
  allowEdits?: boolean;
  allowImages?: boolean;
  allowProcessing?: boolean;
};
type Grant = McpOAuthGrant;
type Code = {
  grant: Grant;
  redirect: string;
  challenge: string;
  used: boolean;
};
type Pending = { code: Code; state: string; cookie: string; name: string };
const DAY = 24 * 60 * 60 * 1000;

/** Authorization policy with an explicit durable snapshot boundary. Pending browser
 * transactions remain ephemeral; managed sessions commit grants before returning tokens. */
export class McpOAuthProvider {
  readonly resource: string;
  private readonly grants = new Map<string, Grant>();
  private readonly clients: McpOAuthClients;
  private readonly pending: McpOAuthState<Pending>;
  private readonly codes: McpOAuthState<Code>;
  private readonly access: McpOAuthState<Grant>;
  private readonly refresh: McpOAuthRefreshTokens<Grant>;
  constructor(
    readonly issuer: string,
    private readonly pairingSecret: string,
    private readonly now: () => number = Date.now,
    private readonly options: ProviderOptions = {},
  ) {
    this.resource = `${issuer}/mcp`;
    this.clients = new McpOAuthClients(now, options.persistent);
    this.pending = new McpOAuthState(now, 64);
    this.codes = new McpOAuthState(now, 64);
    this.access = new McpOAuthState(now, 8192);
    this.refresh = new McpOAuthRefreshTokens(now, this.grants);
  }
  resourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: this.allowedScopes(),
      bearer_methods_supported: ["header"],
    };
  }
  authorizationMetadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      registration_endpoint: `${this.issuer}/oauth/register`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
        "client_secret_basic",
      ],
      revocation_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
        "client_secret_basic",
      ],
      scopes_supported: [...this.allowedScopes(), "offline_access"],
    };
  }
  register(input: Record<string, unknown>) {
    this.pruneInactiveGrants();
    return {
      ...this.clients.register(
        input,
        [...this.grants.values()].map((grant) => grant.clientId),
      ),
      scope: [...this.allowedScopes(), "offline_access"].join(" "),
    };
  }
  begin(input: Record<string, unknown>) {
    if (input.response_type !== "code")
      throw new McpOAuthError(
        "unsupported_response_type",
        "Only authorization codes are supported.",
      );
    assertOAuthResource(input.resource, this.resource);
    const clientId = oauthText(input.client_id, 128);
    const client = this.clients.get(clientId);
    const redirect = oauthText(input.redirect_uri);
    if (!matchesMcpOAuthRedirect(client.redirects, redirect))
      throw new McpOAuthError(
        "invalid_request",
        "Callback does not match this registered client.",
      );
    const scope = readOAuthScope(
      input.scope,
      this.options.allowEdits,
      this.options.allowImages,
      this.options.allowProcessing,
    );
    const cookie = randomBytes(32).toString("base64url");
    const pending: Pending = {
      cookie,
      state: oauthText(input.state),
      name: client.name,
      code: {
        redirect,
        challenge: readPkceChallenge(
          input.code_challenge,
          input.code_challenge_method,
        ),
        used: false,
        grant: {
          id: randomUUID(),
          createdAt: this.now(),
          clientId,
          scope,
          resource: this.resource,
          expiresAt: persistentExpiry(
            this.options.persistent === true,
            this.now(),
          ),
          revoked: false,
        },
      },
    };
    return {
      transaction: this.pending.issue(pending, 5 * 60_000),
      cookie,
      clientName: client.name,
      scope,
      resource: this.resource,
      redirectOrigin: new URL(redirect).origin,
      redirectUri: redirect,
    };
  }
  approve(input: Record<string, unknown>, cookie: string) {
    const transaction = oauthText(input.transaction, 128);
    const pending = this.pending.get(transaction);
    if (!pending || !oauthEqual(pending.cookie, cookie))
      throw new McpOAuthError(
        "invalid_request",
        "Approval expired or browser session changed. Start linking again.",
      );
    this.pending.take(transaction);
    const redirect = new URL(pending.code.redirect);
    redirect.searchParams.set("state", pending.state);
    if (input.decision === "deny") {
      redirect.searchParams.set("error", "access_denied");
      return redirect.href;
    }
    if (
      input.decision !== "approve" ||
      typeof input.pairing_secret !== "string" ||
      !oauthEqual(input.pairing_secret, this.pairingSecret)
    )
      throw new McpOAuthError(
        "access_denied",
        "Incorrect connection password. Start linking again.",
        403,
      );
    this.pruneInactiveGrants();
    this.clients.get(pending.code.grant.clientId);
    const approvedClients = new Set(
      [...this.grants.values()].map((grant) => grant.clientId),
    );
    if (
      this.grants.size >= 256 ||
      (!approvedClients.has(pending.code.grant.clientId) &&
        approvedClients.size >= 64)
    )
      throw new McpOAuthError(
        "temporarily_unavailable",
        "Connection capacity reached. Remove an old connection in the app.",
        503,
      );
    const code = this.codes.issue(pending.code, 60_000);
    this.clients.remember(pending.code.grant.clientId);
    this.grants.set(pending.code.grant.id, pending.code.grant);
    redirect.searchParams.set("code", code);
    return redirect.href;
  }
  token(input: Record<string, unknown>, authorization?: string) {
    const clientId = this.clients.authenticate(input, authorization);
    assertOAuthResource(input.resource, this.resource);
    if (input.grant_type === "authorization_code")
      return this.exchangeCode(input, clientId);
    if (input.grant_type === "refresh_token")
      return this.exchangeRefresh(input, clientId);
    throw new McpOAuthError(
      "unsupported_grant_type",
      "Unsupported grant type.",
    );
  }
  accepts(header: string, scope = "carrot.read"): boolean {
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return false;
    const grant = this.access.get(header.slice(7));
    return (
      !!grant &&
      !grant.revoked &&
      grant.expiresAt > this.now() &&
      grant.resource === this.resource &&
      grant.scope.split(" ").includes(scope)
    );
  }
  revoke(input: Record<string, unknown>, authorization?: string): void {
    const clientId = this.clients.authenticate(input, authorization);
    const token = oauthText(input.token, 128);
    const grant = this.access.get(token) ?? this.refresh.get(token)?.grant;
    if (grant?.clientId === clientId) grant.revoked = true;
  }
  connectionIdFor(header: string): string | undefined {
    return this.accepts(header)
      ? this.access.get(header.slice(7))?.id
      : undefined;
  }

  scopeForConnection(id: string): string | undefined {
    const grant = this.grants.get(id);
    return grant &&
      !grant.revoked &&
      grant.expiresAt > this.now() &&
      grant.resource === this.resource
      ? grant.scope
      : undefined;
  }

  scopeFor(header: string): string | undefined {
    return this.accepts(header)
      ? this.access.get(header.slice(7))?.scope
      : undefined;
  }
  connections() {
    return [...this.grants.values()].map((grant) => ({
      id: grant.id,
      clientName: this.clients.get(grant.clientId).name,
      scope: grant.scope,
      createdAt: grant.createdAt,
      revoked: grant.revoked,
    }));
  }
  revokeConnection(id: string): void {
    const grant = this.grants.get(id);
    if (!grant) throw new Error("Connection not found.");
    grant.revoked = true;
  }
  snapshot(): McpOAuthSnapshot {
    return structuredClone({
      version: 2,
      issuer: this.issuer,
      clients: this.clients.snapshot(),
      grants: [...this.grants.values()],
      access: this.access.snapshot((grant) => grant.id),
      refresh: this.refresh.legacySnapshot(),
      families: this.refresh.snapshot(),
    });
  }
  restore(value: unknown): void {
    const state = parseMcpOAuthSnapshot(value, this.issuer);
    const grants = new Map(state.grants.map((grant) => [grant.id, grant]));
    const requireGrant = (id: string): Grant => {
      const grant = grants.get(id);
      if (!grant) throw new Error("Missing persisted OAuth grant.");
      return grant;
    };
    this.clients.restore(state.clients);
    this.access.restore(state.access, (id) => requireGrant(id));
    this.refresh.restore(
      state.refresh,
      state.version === 2 ? state.families : [],
      requireGrant,
    );
    this.grants.clear();
    for (const [id, grant] of grants) this.grants.set(id, grant);
    this.pending.clear();
    this.codes.clear();
  }
  close(): void {
    this.grants.clear();
    this.clients.clear();
    this.pending.clear();
    this.codes.clear();
    this.access.clear();
    this.refresh.clear();
  }
  private allowedScopes(): string[] {
    return [
      "carrot.read",
      ...(this.options.allowImages ? ["carrot.images"] : []),
      ...(this.options.allowEdits ? ["carrot.edit"] : []),
      ...(this.options.allowProcessing ? ["carrot.process"] : []),
    ];
  }
  private pruneInactiveGrants(): void {
    const inactive = (grant: Grant) =>
      grant.revoked || grant.expiresAt <= this.now();
    this.access.removeWhere(inactive);
    this.refresh.prune(inactive);
    this.codes.removeWhere((entry) => inactive(entry.grant));
    for (const [id, grant] of this.grants)
      if (inactive(grant)) this.grants.delete(id);
  }
  private exchangeCode(input: Record<string, unknown>, clientId: string) {
    const code = this.codes.get(oauthText(input.code, 128));
    if (
      !code ||
      code.grant.clientId !== clientId ||
      code.redirect !== input.redirect_uri ||
      !verifyPkce(input.code_verifier, code.challenge)
    )
      throw new McpOAuthError(
        "invalid_grant",
        "Invalid or expired authorization code.",
      );
    if (code.used) {
      code.grant.revoked = true;
      throw new McpOAuthError(
        "invalid_grant",
        "Authorization code was already used. Reconnect.",
      );
    }
    const tokens = this.issueTokens(code.grant);
    code.used = true;
    return tokens;
  }
  private exchangeRefresh(input: Record<string, unknown>, clientId: string) {
    const entry = this.refresh.get(oauthText(input.refresh_token, 128));
    if (!entry || entry.grant.clientId !== clientId)
      throw new McpOAuthError("invalid_grant", "Invalid refresh token.");
    if (entry.used) {
      entry.grant.revoked = true;
      throw new McpOAuthError(
        "invalid_grant",
        "Refresh replay detected. Reconnect.",
      );
    }
    if (
      input.scope !== undefined &&
      readOAuthScope(input.scope, true, true, true) !== entry.grant.scope
    )
      throw new McpOAuthError(
        "invalid_scope",
        "Reauthorization is required to change scope.",
      );
    const tokens = this.issueTokens(entry.grant);
    entry.used = true;
    return tokens;
  }
  private issueTokens(grant: Grant) {
    if (grant.revoked || grant.expiresAt <= this.now())
      throw new McpOAuthError(
        "invalid_grant",
        "Authorization expired or was revoked. Reconnect.",
      );
    const lifetime = Math.min(60 * 60_000, grant.expiresAt - this.now());
    const access = this.access.issue(grant, lifetime);
    try {
      return {
        access_token: access,
        token_type: "Bearer",
        expires_in: Math.floor(lifetime / 1000),
        refresh_token: this.refresh.issue(
          grant,
          Math.min(90 * DAY, grant.expiresAt - this.now()),
        ),
        scope: grant.scope,
      };
    } catch (error) {
      this.access.take(access);
      throw error;
    }
  }
}
function persistentExpiry(persistent: boolean, now: number): number {
  return persistent ? Number.MAX_SAFE_INTEGER : now + DAY;
}
