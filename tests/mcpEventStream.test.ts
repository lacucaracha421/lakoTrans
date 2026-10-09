import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { startMcpHttpServer } from "../src/main/mcp/mcpHttpServer";

it("keeps authenticated event streams open alongside RPC and closes them on revocation and shutdown", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let allowed = true;
  const errors: unknown[] = [];
  const server = await startMcpHttpServer({
    config: { port: 0, token: "unused-server-token" },
    tools: [],
    reportError: (error) => errors.push(error),
    authorization: {
      scopeFor: (header) =>
        allowed && header === "Bearer event-client" ? "carrot.read" : undefined,
      principalFor: () => "event-client",
      scopeForPrincipal: () => (allowed ? "carrot.read" : undefined),
    },
  });
  const headers = {
    Authorization: "Bearer event-client",
    Accept: "text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  };
  try {
    const response = await fetch(server.url, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    assert.ok(response.body);
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      ": connected",
    );
    const rpc = await fetch(server.url, {
      method: "POST",
      headers: {
        ...headers,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(rpc.status).toBe(200);
    expect((await rpc.json()).result.tools).toEqual([]);
    const heartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await heartbeat).value)).toContain(
      ": keepalive",
    );
    allowed = false;
    const closed = reader.read().then(
      (chunk) => chunk.done,
      () => true,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await closed).toBe(true);
    expect((await fetch(server.url, { headers })).status).toBe(401);
    expect(vi.getTimerCount()).toBe(0);
    allowed = true;
    const another = await fetch(server.url, { headers });
    assert.ok(another.body);
    const next = another.body.getReader();
    await next.read();
    const stopped = next.read().then(
      (chunk) => chunk.done,
      () => true,
    );
    server.stopAccepting();
    expect(await stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
    vi.useRealTimers();
  }
});

it("applies existing authentication, origin and exact endpoint checks to event streams", async () => {
  const errors: unknown[] = [];
  const server = await startMcpHttpServer({
    config: { port: 0, token: "event-test" },
    tools: [],
    reportError: (error) => errors.push(error),
  });
  const headers = {
    Authorization: "Bearer event-test",
    Accept: "text/event-stream",
  };
  try {
    expect(
      (await fetch(server.url, { headers: { Accept: "text/event-stream" } }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(server.url, {
          headers: { ...headers, Origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(server.url + "?token=event-test", { headers })).status,
    ).toBe(404);
    expect(
      (
        await fetch(server.url, {
          headers: { ...headers, Accept: "text/event-stream;q=0" },
        })
      ).status,
    ).toBe(406);
    expect(
      (
        await fetch(server.url, {
          headers: { ...headers, "MCP-Protocol-Version": "1900-01-01" },
        })
      ).status,
    ).toBe(400);
    const stream = await fetch(server.url, { headers });
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
