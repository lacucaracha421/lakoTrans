import { expect, it } from "vitest";
import { startMcpHttpServer } from "../src/main/mcp/mcpHttpServer";

it("authenticates loopback independently of OAuth and rechecks the same scope/owner after revocation", async () => {
  let valid = true,
    edits = 0,
    revokeDuringCall = false;
  const header = "Bearer " + "c".repeat(43);
  const server = await startMcpHttpServer({
    config: { port: 0, token: "unused".repeat(9) },
    enforceScopes: true,
    reportError: () => undefined,
    authorization: {
      scopeFor: (value) =>
        valid && value === header ? "carrot.read carrot.edit" : undefined,
      principalFor: (value) =>
        valid && value === header ? "stable-chat-owner" : undefined,
      clientNameFor: (value) =>
        valid && value === header ? "OpenCode" : undefined,
      scopeForPrincipal: (value) =>
        valid && value === "stable-chat-owner"
          ? "carrot.read carrot.edit"
          : undefined,
    },
    tools: [
      {
        name: "carrot_internal_edit",
        description: "Fixture edit",
        inputSchema: { type: "object" },
        readOnly: false,
        requiredScopes: ["carrot.edit"],
        invoke: async (_args, context) => {
          expect(context?.principalId).toBe("stable-chat-owner");
          expect(context?.clientName).toBe("OpenCode");
          if (revokeDuringCall) valid = false;
          context?.assertAuthorized();
          edits++;
          return [{ type: "text", text: "saved" }];
        },
      },
    ],
  });
  const call = (authorization = header) =>
    fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "carrot_internal_edit", arguments: {} },
      }),
    });
  try {
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call()).status).toBe(200);
    expect(edits).toBe(1);
    revokeDuringCall = true;
    const rejected = await (await call()).json();
    expect(rejected.error ?? rejected.result?.isError).toBeTruthy();
    expect(edits).toBe(1);
    expect((await call()).status).toBe(401);
  } finally {
    await server.close();
  }
});
