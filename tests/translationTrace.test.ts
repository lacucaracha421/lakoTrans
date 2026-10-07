import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enableTranslationTrace,
  summarizeWorkContextSize,
  traceDuration,
  traceTranslation,
} from "../src/main/pipeline/translationTrace";
import type { CharacterSpeechStyle } from "../src/shared/workContextTypes";

const { traceEvent, traceModelRequest } =
  require("../src/main/runtime/transport/translation-trace.cjs") as {
    traceEvent: (type: string, fields?: Record<string, unknown>) => void;
    traceModelRequest: <T>(
      kind: string,
      options: Record<string, unknown>,
      requestBody: Record<string, unknown>,
      requestSummary: Record<string, unknown>,
      run: () => Promise<T>,
    ) => Promise<T>;
  };

const ENV = "LAKOTRANS_TRACE_PATH";
let dir = "";
let tracePath = "";

function readTrace(): Array<Record<string, unknown>> {
  return readFileSync(tracePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lakotrans-trace-"));
  tracePath = join(dir, "translation-trace.jsonl");
  process.env[ENV] = tracePath;
});

afterEach(() => {
  delete process.env[ENV];
  rmSync(dir, { recursive: true, force: true });
});

describe("runtime model request trace", () => {
  const body = {
    model: "gemma",
    max_tokens: 4096,
    messages: [
      { role: "system", content: "s".repeat(10) },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "x".repeat(4096) } },
          { type: "text", text: "p".repeat(25) },
        ],
      },
    ],
  };
  const summary = {
    options: { workContextBudget: { originalTokens: 900 } },
  };

  it("records request size, llama timings and no content", async () => {
    const result = await traceModelRequest(
      "page",
      { modelProvider: "local" },
      body,
      summary,
      async () => ({
        outputText: "secret translation",
        rawResponse: {
          choices: [{ finish_reason: "stop" }],
          timings: {
            cache_n: 0,
            prompt_n: 3000,
            prompt_ms: 4200.44,
            predicted_n: 600,
            predicted_ms: 9000,
            predicted_per_second: 66.66,
          },
          usage: { prompt_tokens: 3000, completion_tokens: 600 },
        },
      }),
    );
    expect(result.outputText).toBe("secret translation");
    const [event] = readTrace();
    expect(event).toMatchObject({
      type: "model-request",
      kind: "page",
      provider: "local",
      model: "gemma",
      ok: true,
      messages: 2,
      textChars: 35,
      images: 1,
      imageKb: 3,
      maxTokens: 4096,
      outputChars: 18,
      finishReason: "stop",
      workContext: { originalTokens: 900 },
      llama: {
        cacheTokens: 0,
        promptTokens: 3000,
        promptMs: 4200.4,
        generatedTokens: 600,
        generateMs: 9000,
        generatedPerSecond: 66.7,
      },
      usage: { promptTokens: 3000, completionTokens: 600 },
    });
    expect(typeof event.ms).toBe("number");
    expect(typeof event.rssMb).toBe("number");
    expect(readFileSync(tracePath, "utf8")).not.toContain("secret");
  });

  it("records Responses-style input and a failed request, then rethrows", async () => {
    const failure = Object.assign(new TypeError("boom"), { status: 503 });
    await expect(
      traceModelRequest(
        "responses",
        {},
        {
          instructions: "abc",
          input: [{ content: [{ type: "input_text", text: "de" }] }],
          max_output_tokens: 10,
        },
        {},
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(readTrace()[0]).toMatchObject({
      kind: "responses",
      ok: false,
      status: 503,
      error: "TypeError",
      textChars: 5,
      maxTokens: 10,
    });
  });

  it("summarizes OpenAI-style usage and string image urls", async () => {
    await traceModelRequest(
      "structured",
      {},
      { messages: [{ content: [{ image_url: "y".repeat(2048) }] }] },
      { options: "unexpected" },
      async () => ({
        rawResponse: { usage: { input_tokens: 7, output_tokens: 2 } },
      }),
    );
    await traceModelRequest("structured", {}, {}, {}, async () => ({
      rawResponse: "not-an-object",
    }));
    const [first, second] = readTrace();
    expect(first).toMatchObject({
      images: 1,
      usage: { promptTokens: 7, completionTokens: 2 },
      outputChars: 0,
    });
    expect(first.workContext).toBeUndefined();
    expect(second).toMatchObject({ messages: 0, ok: true });
  });

  it("is a pass-through when tracing is disabled and survives write failures", async () => {
    delete process.env[ENV];
    await expect(
      traceModelRequest("page", {}, {}, {}, async () => ({ outputText: "x" })),
    ).resolves.toEqual({ outputText: "x" });
    traceEvent("ignored");
    expect(existsSync(tracePath)).toBe(false);
    process.env[ENV] = join(dir, "missing", "trace.jsonl");
    expect(() => traceEvent("unwritable")).not.toThrow();
  });

  it("rotates a trace file above its size cap", () => {
    writeFileSync(tracePath, "x".repeat(16 * 1024 * 1024 + 1));
    traceEvent("after-rotation", { n: 1 });
    expect(existsSync(`${tracePath}.1`)).toBe(true);
    expect(readTrace()).toEqual([
      expect.objectContaining({ type: "after-rotation", n: 1 }),
    ]);
  });
});

describe("pipeline translation trace", () => {
  it("appends events and times successful and failed work", async () => {
    traceTranslation("endpoint-dispose-for-ocr");
    await expect(
      traceDuration("endpoint-start", { reason: "test" }, async () => 7),
    ).resolves.toBe(7);
    await expect(
      traceDuration("endpoint-start", {}, async () => {
        throw new Error("start failed");
      }),
    ).rejects.toThrow("start failed");
    const events = readTrace();
    expect(events.map((event) => event.type)).toEqual([
      "endpoint-dispose-for-ocr",
      "endpoint-start",
      "endpoint-start",
    ]);
    expect(events[1]).toMatchObject({ reason: "test", ok: true });
    expect(events[2]).toMatchObject({ ok: false });
  });

  it("does nothing without a trace path and never throws on write errors", () => {
    delete process.env[ENV];
    traceTranslation("ignored");
    expect(existsSync(tracePath)).toBe(false);
    process.env[ENV] = join(dir, "missing", "trace.jsonl");
    expect(() => traceTranslation("unwritable")).not.toThrow();
  });

  it("rotates an oversized trace file", () => {
    writeFileSync(tracePath, "x".repeat(16 * 1024 * 1024 + 1));
    traceTranslation("after-rotation");
    expect(existsSync(`${tracePath}.1`)).toBe(true);
    expect(readTrace()).toHaveLength(1);
  });

  it("counts the rolling context parts that grow the prompt", () => {
    const character = (
      speechStyle: CharacterSpeechStyle,
      customSpeechStyle?: string,
    ) => ({ speechStyle, customSpeechStyle });
    const workContext = {
      styleGuide: {
        glossary: [{}, {}],
        characters: [
          character("neutral"),
          character("polite"),
          character("custom", "speaks in riddles"),
          character("custom", "  "),
          character("custom"),
        ],
      },
      storyMemory: { pages: [{}, {}, {}] },
    };
    expect(summarizeWorkContextSize(workContext)).toEqual({
      glossary: 2,
      characters: 5,
      voicedCharacters: 2,
      voicedStyleChars: 17,
      storyPages: 3,
    });
    expect(summarizeWorkContextSize(undefined)).toBeUndefined();
  });
});

describe("enableTranslationTrace", () => {
  it("points the shared trace path into the log directory once", () => {
    delete process.env[ENV];
    enableTranslationTrace(dir);
    expect(process.env[ENV]).toBe(tracePath);
    enableTranslationTrace(join(dir, "other"));
    expect(process.env[ENV]).toBe(tracePath);
  });
});
