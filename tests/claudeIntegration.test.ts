import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with {
  "resolution-mode": "import",
};
import { ClaudeChatEvents } from "../src/main/chat/claudeChatEvents";
import { reduceChatNotification } from "../src/main/chat/chatReducer";
import {
  claudeEffort,
  claudeMessage,
  claudeBinary,
} from "../src/main/claude/claudeRuntime";
import { normalizeAppSettings } from "../src/main/settings/appSettingsNormalize";
import { AppSettingsSchema } from "../src/shared/ipcSettingsSchemas";
import { chatFixture } from "./helpers/chatFixture";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.cwd() },
}));

it("keeps each Claude task's preferences and legacy provider settings independent", () => {
  const settings = normalizeAppSettings({
    modelProvider: "claude-code",
    claude: { model: "sonnet", effort: "xhigh" },
    internetResearch: { claude: { model: "opus", effort: "max" } },
    imageReview: {
      provider: "claude",
      claude: { model: "haiku", effort: "low" },
    },
  });
  const parsed = AppSettingsSchema.parse(settings);
  expect(parsed.claude).toEqual({ model: "sonnet", effort: "xhigh" });
  expect(parsed.internetResearch.claude?.model).toBe("opus");
  expect(parsed.imageReview?.claude.model).toBe("haiku");
  expect(parsed.codex.model).not.toBe("sonnet");
  expect(normalizeAppSettings({}).imageReview?.provider).toBe("codex");
  expect(
    normalizeAppSettings({ claude: { effort: "ultra", model: " " } }).claude,
  ).toEqual({ model: "default", effort: "high" });
});

it("passes image bytes and composed context without local-file or slash-command expansion", () => {
  const id = randomUUID();
  const message = claudeMessage(id, "thread", [
    { type: "text", text: "/login @private-file" },
    { type: "image", url: "data:image/png;base64,YQ==" },
  ]);
  expect(message).toMatchObject({
    uuid: id,
    client_composed: true,
    message: {
      content: [
        { type: "text", text: "/login @private-file" },
        { type: "image", source: { media_type: "image/png", data: "YQ==" } },
      ],
    },
  });
  expect(
    claudeMessage(id, "thread", [{ type: "text", text: "/compact" }])
      .client_composed,
  ).toBeUndefined();
  expect(() =>
    claudeMessage(id, "thread", [
      { type: "image", url: "file:///private.png" },
    ]),
  ).toThrow();
  expect(claudeEffort("ultra")).toBe("high");
  expect(claudeEffort("max")).toBe("max");
  expect(
    claudeBinary({ isPackaged: true, resourcesDir: "C:/app/resources" }),
  ).toMatch(/claude[\\/]claude(?:\.exe)?$/);
});

it("preserves separate native conversations and remembers per-runtime model choices", async () => {
  const f = await chatFixture();
  try {
    const claude = await f.service.create("claude");
    expect(claude.runtime).toBe("claude");
    expect((await f.service.read(f.session.id)).runtime).toBe("codex");
    expect((await f.service.create()).runtime).toBe("claude");
    expect((await f.service.list()).map((x) => x.runtime)).toContain("codex");
  } finally {
    await f.cleanup();
  }
});

it("maps Claude streaming, MCP receipts, compaction and failure without exposing thinking", async () => {
  const f = await chatFixture();
  try {
    const session = f.session;
    const events = new ClaudeChatEvents((value) =>
      reduceChatNotification(session, value),
    );
    const feed = (message: unknown) => events.accept(message as SDKMessage);
    feed({ type: "system", subtype: "init" });
    feed({
      type: "stream_event",
      event: { type: "message_start", message: { id: "answer" } },
    });
    feed({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "private reasoning" },
      },
    });
    feed({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "확인" },
      },
    });
    feed({
      type: "assistant",
      message: {
        id: "answer",
        content: [
          { type: "text", text: "확인했습니다." },
          {
            type: "tool_use",
            id: "tool",
            name: "mcp__carrot__carrot_get_page",
            input: { pageId: "page" },
          },
        ],
      },
    });
    const fingerprint = session.items.find(
      (x) => x.id === "tool",
    )?.toolFingerprint;
    feed({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool", content: "ok" }],
      },
    });
    expect(session.items.find((x) => x.id === "answer")?.text).toBe(
      "확인했습니다.",
    );
    expect(session.items.find((x) => x.id === "tool")).toMatchObject({
      toolName: "carrot_get_page",
      toolFingerprint: fingerprint,
      state: "completed",
    });
    for (const content of [
      "Font evidence failed",
      [{ type: "text", text: "Font evidence failed" }],
    ]) {
      feed({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool",
              is_error: true,
              content,
            },
          ],
        },
      });
      expect(session.items.find((x) => x.id === "tool")).toMatchObject({
        state: "failed",
        text: "Font evidence failed",
      });
    }
    feed({ type: "system", subtype: "status", status: "compacting" });
    expect(session.state).toBe("compacting");
    feed({ type: "system", subtype: "compact_boundary" });
    feed({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["quota exceeded"],
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    expect(session.state).toBe("failed");
    expect(session.usage?.totalTokens).toBe(7);
    expect(JSON.stringify(session)).not.toContain("private reasoning");
    session.state = "paused";
    feed({ type: "system", subtype: "init" });
    expect(session.state).toBe("paused");
  } finally {
    await f.cleanup();
  }
});

it("uses the selected Claude model and effort for fixed-target OCR translation", async () => {
  const { createRequire } = await import("node:module");
  const runtime = createRequire(import.meta.url)(
    "../src/main/runtime/transport/semantic-ocr-request-builders.cjs",
  ) as {
    buildSemanticStageRequestBody: (
      options: object,
      messages: object[],
      schema: object,
      stage: string,
      count: number,
    ) => Record<string, unknown>;
  };
  const options = {
    modelProvider: "claude-code",
    claudeModel: "sonnet",
    claudeEffort: "xhigh",
    codexModel: "gpt-6-astra",
    codexReasoningEffort: "low",
    maxTokens: 4096,
    ctx: 32768,
  };
  const body = runtime.buildSemanticStageRequestBody(
    options,
    [
      { role: "system", content: "Translate" },
      { role: "user", content: "こんにちは" },
    ],
    {
      type: "json_object",
      schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    "translation",
    1,
  );
  expect(body).toMatchObject({
    model: "sonnet",
    reasoning: { effort: "xhigh" },
    stream: true,
  });
  expect(JSON.stringify(body)).not.toContain("gpt-6-astra");
});
