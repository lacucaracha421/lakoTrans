import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const {
  requestTranslation,
} = require("../src/main/runtime/transport/translation-request.cjs");
const {
  testModelReply,
} = require("../src/main/runtime/transport/model-probe.cjs");
const {
  buildChatRequestHeaders,
} = require("../src/main/runtime/simple-page-request-builders.cjs");
const {
  withApiConversation,
} = require("../src/main/runtime/transport/api-conversation.cjs");
const {
  createHttpFailureError,
  truncateSensitiveText,
} = require("../src/main/runtime/transport/model-http-errors.cjs");
const {
  runWithApiKeyRetry,
} = require("../src/main/runtime/transport/api-key-retry.cjs");
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(
  respond: (
    index: number,
    body: Record<string, unknown>,
  ) => { status?: number; body: unknown; retry?: string },
) {
  const seen: Array<{
    session: string | undefined;
    userAgent: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    seen.push({
      session: req.headers["x-session"] as string,
      userAgent: req.headers["user-agent"],
      body,
    });
    const reply = respond(seen.length, body);
    res.writeHead(reply.status ?? 200, {
      "Content-Type": "application/json",
      ...(reply.retry ? { "Retry-After": reply.retry } : {}),
    });
    res.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const root = await mkdtemp(join(tmpdir(), "carrot-api-session-"));
  roots.push(root);
  const imagePath = join(root, "page.png");
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  return {
    seen,
    baseUrl,
    options: {
      modelProvider: "openai-api",
      apiModel: "vision",
      apiKey: "test-key",
      apiBaseUrl: baseUrl,
      apiSessionHeaderName: "x-session",
      apiConversationSeed: randomUUID(),
      apiUserAgent: "CarrotMangaTranslator/3.1.1",
      apiKeyMaxAttempts: 2,
      apiRetryDelaySeconds: 0,
      imagePath,
      outputDir: root,
      imageWidth: 100,
      imageHeight: 100,
      sourceLanguage: "ja",
      targetLanguage: "ko",
      ocrPipeline: "hayai",
      keepBlocksMode: true,
      maxTokens: 1024,
      ocrBboxHints: [
        {
          id: 1,
          label: "ocr_textline",
          ocrText: "こんにちは",
          x1: 10,
          y1: 10,
          x2: 90,
          y2: 30,
          score: 1,
        },
      ],
    },
  };
}

function completion(
  text = '{"items":[{"blockId":"B001","ko":"안녕","textRole":"ordinary","layoutIntent":"horizontal"}]}',
) {
  return { choices: [{ message: { content: text }, finish_reason: "stop" }] };
}

describe("API conversation HTTP boundaries", () => {
  it("redacts nested credential arrays from provider error details", () => {
    const redacted = truncateSensitiveText(
      "bad secret-one secret-two",
      {
        modelProvider: "openai-api",
        apiExtraBodyJson: JSON.stringify({
          credentials: [{ token: "secret-one" }, { password: "secret-two" }],
        }),
      },
      4000,
    );
    expect(redacted).not.toContain("secret-one");
    expect(redacted).not.toContain("secret-two");
  });
  it("keeps local probes at their original budget without API session headers", async () => {
    const f = await fixture(() => ({ body: completion("model test ok") }));
    await testModelReply(
      { baseUrl: f.baseUrl },
      { ...f.options, modelProvider: "gemma" },
    );
    expect(
      f.seen.find((request) => request.body.messages)?.body.max_tokens,
    ).toBe(48);
    expect(f.seen.every((request) => request.session === undefined)).toBe(true);
  });
  it("retains a page session through missing-block repair and an outer page retry", async () => {
    const f = await fixture((index) => ({
      body: index === 1 ? completion('{"items":[]}') : completion(),
    }));
    const options = { ...f.options, pageId: "repair-page" };
    await requestTranslation({ baseUrl: f.baseUrl }, options);
    expect(f.seen.length).toBe(2);
    await requestTranslation(
      { baseUrl: f.baseUrl },
      { ...options, translationAttempt: 2 },
    );
    expect(f.seen.length).toBe(3);
    expect(new Set(f.seen.map((request) => request.session)).size).toBe(1);
  });

  it("does not downgrade an image rejection to a text-only request", async () => {
    const f = await fixture(() => ({
      status: 415,
      body: { error: { message: "image input not supported" } },
    }));
    await expect(
      requestTranslation({ baseUrl: f.baseUrl }, f.options),
    ).rejects.toMatchObject({ apiFailureKind: "unsupported-image" });
    expect(f.seen).toHaveLength(1);
    expect(JSON.stringify(f.seen[0].body)).toContain("data:image/png;base64,");
  });

  it("waits for Retry-After and accepts HTTP date syntax", async () => {
    const f = await fixture((index) =>
      index === 1
        ? {
            status: 429,
            retry: "0.04",
            body: { error: { code: "rate_limit_exceeded" } },
          }
        : { body: completion() },
    );
    const start = Date.now();
    await testModelReply({ baseUrl: f.baseUrl }, f.options);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
    const date = new Date(Date.now() + 60000).toUTCString();
    const error = createHttpFailureError(
      f.options,
      {},
      new Response(null, { status: 429, headers: { "Retry-After": date } }),
      "{}",
    );
    expect(error.retryAfterMs).toBeGreaterThan(58000);
  });
  it("keeps page IDs through schema fallback and rate retry, isolates parallel pages and probes", async () => {
    const f = await fixture((index) =>
      index === 1
        ? {
            status: 400,
            body: {
              error: {
                message: "response_format json_schema is not supported",
              },
            },
          }
        : index === 2
          ? {
              status: 429,
              retry: "0",
              body: { error: { code: "rate_limit_exceeded" } },
            }
          : { body: completion() },
    );
    const first = await requestTranslation(
      { baseUrl: f.baseUrl },
      { ...f.options, pageId: "one" },
    );
    expect(JSON.parse(first.outputText).items).toHaveLength(1);
    expect(f.seen.length).toBe(3);
    expect(new Set(f.seen.map((r) => r.session)).size).toBe(1);
    expect(f.seen[0].userAgent).toBe("CarrotMangaTranslator/3.1.1");
    expect(JSON.stringify(f.seen[0].body)).toContain("data:image/png;base64,");
    await Promise.all(
      ["two", "three"].map((pageId) =>
        requestTranslation({ baseUrl: f.baseUrl }, { ...f.options, pageId }),
      ),
    );
    expect(new Set(f.seen.map((r) => r.session)).size).toBe(3);
    await testModelReply({ baseUrl: f.baseUrl }, f.options);
    expect(new Set(f.seen.map((r) => r.session)).size).toBe(4);
    expect(f.options).not.toHaveProperty("apiConversationId");
    expect(
      withApiConversation({ ...f.options, pageId: "one" }).apiConversationId,
    ).toBe(f.seen[0].session);
    expect(
      withApiConversation({
        ...f.options,
        apiConversationSeed: randomUUID(),
        pageId: "one",
      }).apiConversationId,
    ).not.toBe(f.seen[0].session);
  });

  it("rejects header collisions and preserves an explicit client identity", () => {
    const options = {
      modelProvider: "openai-api",
      apiSessionHeaderName: "x-session",
      apiConversationId: "session",
      apiUserAgent: "default",
    };
    expect(() =>
      buildChatRequestHeaders({
        ...options,
        apiCustomHeadersJson: '{"X-Session":"static"}',
      }),
    ).toThrow(/conflict/);
    expect(
      buildChatRequestHeaders({
        ...options,
        apiCustomHeadersJson: '{"user-agent":"own-client"}',
      })["user-agent"],
    ).toBe("own-client");
  });

  it.each([
    [402, "insufficient_balance", "quota"],
    [403, "permission_denied", "permission"],
    [400, "image input not supported", "unsupported-image"],
  ])(
    "does not rotate keys for terminal %s failures",
    async (status, message, kind) => {
      let calls = 0;
      const options = {
        modelProvider: "openai-api",
        apiKey: "one\ntwo",
        apiKeyMaxAttempts: 3,
        apiRetryDelaySeconds: 0,
      };
      await expect(
        runWithApiKeyRetry(options, async () => {
          calls++;
          throw createHttpFailureError(
            options,
            {},
            new Response(null, { status: Number(status) }),
            JSON.stringify({ error: { message } }),
          );
        }),
      ).rejects.toMatchObject({ apiFailureKind: kind, nonRetriable: true });
      expect(calls).toBe(1);
    },
  );

  it("cancels a Retry-After wait without sending another request", async () => {
    const controller = new AbortController();
    let calls = 0;
    const options = {
      modelProvider: "openai-api",
      apiKey: "one",
      apiKeyMaxAttempts: 3,
      apiRetryDelaySeconds: 0,
      abortSignal: controller.signal,
    };
    const start = Date.now();
    const promise = runWithApiKeyRetry(options, async () => {
      calls++;
      setTimeout(() => controller.abort(), 20);
      throw createHttpFailureError(
        options,
        {},
        new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
        '{"error":{"code":"rate_limit_exceeded"}}',
      );
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
