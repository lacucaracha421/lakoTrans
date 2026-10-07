// @ts-check
// Fork-only diagnostics: one JSON line per model request so a slow stretch of
// a translation run can be attributed (prompt growth, generation length,
// llama prompt/eval time, API pacing or key retries). Only sizes, counts and
// timings are written; never prompt, OCR, translation or image content.

const { appendFileSync, renameSync, statSync } = require("node:fs");
const { freemem } = require("node:os");

const TRACE_PATH_ENV = "LAKOTRANS_TRACE_PATH";
const MAX_TRACE_BYTES = 16 * 1024 * 1024;

/**
 * @param {string} type
 * @param {Record<string, unknown>} [fields]
 */
function traceEvent(type, fields = {}) {
  const path = process.env[TRACE_PATH_ENV];
  if (!path) return;
  try {
    rotateIfLarge(path);
    const memory = process.memoryUsage();
    const line = JSON.stringify({
      at: new Date().toISOString(),
      type,
      ...fields,
      rssMb: toMb(memory.rss),
      freeMemMb: toMb(freemem()),
    });
    appendFileSync(path, `${line}\n`, "utf8");
  } catch (error) {
    // Tracing must never break translation.
    void error;
  }
}

/** @param {string} path */
function rotateIfLarge(path) {
  if (readSize(path) > MAX_TRACE_BYTES) renameSync(path, `${path}.1`);
}

/** @param {string} path */
function readSize(path) {
  try {
    return statSync(path).size;
  } catch (error) {
    void error;
    return 0;
  }
}

/** @param {number} bytes */
function toMb(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Times one model HTTP request (including reading the body) and records its
 * size and the timing/usage the server reported.
 *
 * @template TResult
 * @param {string} kind
 * @param {Record<string, unknown>} options
 * @param {Record<string, unknown>} requestBody
 * @param {Record<string, unknown>} requestSummary
 * @param {() => Promise<TResult>} run
 * @returns {Promise<TResult>}
 */
async function traceModelRequest(
  kind,
  options,
  requestBody,
  requestSummary,
  run,
) {
  if (!process.env[TRACE_PATH_ENV]) return run();
  const startedAt = performance.now();
  const base = {
    kind,
    provider: options.modelProvider,
    model: requestBody.model,
    ...summarizeRequestBody(requestBody),
    workContext: summarizeWorkContext(requestSummary),
  };
  try {
    const result = await run();
    const output =
      /** @type {{ rawResponse?: unknown; outputText?: unknown }} */ (
        result ?? {}
      );
    traceEvent("model-request", {
      ...base,
      ok: true,
      ms: Math.round(performance.now() - startedAt),
      outputChars:
        typeof output.outputText === "string" ? output.outputText.length : 0,
      ...summarizeServerReport(output.rawResponse),
    });
    return result;
  } catch (error) {
    const record =
      error && typeof error === "object"
        ? /** @type {Record<string, unknown>} */ (error)
        : {};
    traceEvent("model-request", {
      ...base,
      ok: false,
      ms: Math.round(performance.now() - startedAt),
      status: record.status,
      error: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

/** @param {Record<string, unknown>} body */
function summarizeRequestBody(body) {
  let textChars = 0;
  let images = 0;
  let imageKb = 0;
  /** @param {unknown} part */
  const visit = (part) => {
    if (typeof part === "string") {
      textChars += part.length;
      return;
    }
    if (!part || typeof part !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (part);
    const url = readImageUrl(record);
    if (url) {
      images += 1;
      imageKb += Math.round((url.length * 3) / 4 / 1024);
      return;
    }
    if (typeof record.text === "string") textChars += record.text.length;
    if (Array.isArray(record.content)) record.content.forEach(visit);
    else if (typeof record.content === "string") visit(record.content);
  };
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];
  messages.forEach(visit);
  if (typeof body.instructions === "string") visit(body.instructions);
  return {
    messages: messages.length,
    textChars,
    images,
    imageKb,
    maxTokens: body.max_tokens ?? body.max_output_tokens,
  };
}

/** @param {Record<string, unknown>} record */
function readImageUrl(record) {
  const imageUrl = record.image_url;
  if (typeof imageUrl === "string") return imageUrl;
  if (imageUrl && typeof imageUrl === "object") {
    const url = /** @type {Record<string, unknown>} */ (imageUrl).url;
    if (typeof url === "string") return url;
  }
  return null;
}

/** @param {Record<string, unknown>} requestSummary */
function summarizeWorkContext(requestSummary) {
  const options = requestSummary?.options;
  if (!options || typeof options !== "object") return undefined;
  const budget = /** @type {Record<string, unknown>} */ (options)
    .workContextBudget;
  return budget && typeof budget === "object" ? budget : undefined;
}

/** @param {unknown} rawResponse */
function summarizeServerReport(rawResponse) {
  if (!rawResponse || typeof rawResponse !== "object") return {};
  const response = /** @type {Record<string, unknown>} */ (rawResponse);
  const llama = summarizeLlamaTimings(response.timings);
  const usage = summarizeUsage(response.usage);
  const finishReason = readFinishReason(response);
  return {
    ...(llama ? { llama } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
  };
}

/** @param {unknown} timings llama-server per-request timings */
function summarizeLlamaTimings(timings) {
  if (!timings || typeof timings !== "object") return undefined;
  const t = /** @type {Record<string, unknown>} */ (timings);
  return {
    cacheTokens: t.cache_n,
    promptTokens: t.prompt_n,
    promptMs: roundMs(t.prompt_ms),
    generatedTokens: t.predicted_n,
    generateMs: roundMs(t.predicted_ms),
    generatedPerSecond: roundMs(t.predicted_per_second),
  };
}

/** @param {unknown} usage OpenAI chat or Responses usage */
function summarizeUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const u = /** @type {Record<string, unknown>} */ (usage);
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens,
    completionTokens: u.completion_tokens ?? u.output_tokens,
    totalTokens: u.total_tokens,
  };
}

/** @param {Record<string, unknown>} response */
function readFinishReason(response) {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const first = /** @type {Record<string, unknown> | undefined} */ (choices[0]);
  return typeof first?.finish_reason === "string"
    ? first.finish_reason
    : undefined;
}

/** @param {unknown} value */
function roundMs(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : undefined;
}

module.exports = {
  TRACE_PATH_ENV,
  traceEvent,
  traceModelRequest,
};
