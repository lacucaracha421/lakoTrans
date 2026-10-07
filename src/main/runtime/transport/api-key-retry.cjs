// @ts-check
/** @typedef {import("../runtime-jsdoc-types").RuntimeOptions} RuntimeOptions */
/** @typedef {(request?: {forceRefresh?: boolean}) => Promise<string>} AccessTokenProvider */
/**
 * @typedef {RuntimeOptions & {
 *   apiKey?: unknown;
 *   apiAccessTokenProvider?: unknown;
 *   apiKeyMaxAttempts?: unknown;
 *   apiRetryDelaySeconds?: unknown;
 *   modelProvider?: unknown;
 *   [key: string]: unknown;
 * }} ApiKeyRetryOptions
 * @typedef {{ attemptIndex: number; attemptTotal: number; keyIndex: number; keyCount: number; round: number }} ApiKeyAttempt
 * @typedef {{ kind: string; requestBody: Record<string, unknown>; requestSummary: Record<string, unknown> }} RequestTrace
 */

const {
  isOpenAIApiProvider,
  resolveConfiguredApiKeyMaxAttempts,
  resolveConfiguredApiKeys,
  resolveConfiguredApiRetryDelaySeconds,
} = require("../simple-page-model-config.cjs");
const {
  findAbortError,
  isRetryableApiKeyError,
  markApiKeyRetriesExhausted,
} = require("./model-http-errors.cjs");
const { apiRetryDelay } = require("./api-http-failure.cjs");
const { waitForApiRequestStart } = require("./api-request-pacing.cjs");
const { traceEvent, traceModelRequest } = require("./translation-trace.cjs");

/**
 * Run an OpenAI-compatible API request with one selected key per attempt.
 * Attempts are ordered by round: key 1, key 2, ... key N, then repeat.
 * Non-API providers retain their existing single-attempt behavior.
 *
 * @template TResult
 * @param {ApiKeyRetryOptions} options
 * @param {(apiKey: string | undefined, attempt: ApiKeyAttempt) => Promise<TResult>} untracedAttempt
 * @param {RequestTrace} [trace] Fork: times each HTTP attempt into the translation trace.
 * @returns {Promise<TResult>}
 */
async function runWithApiKeyRetry(options, untracedAttempt, trace) {
  /** @type {typeof untracedAttempt} */
  const requestAttempt = trace
    ? (apiKey, attempt) =>
        traceModelRequest(
          trace.kind,
          options,
          trace.requestBody,
          trace.requestSummary,
          () => untracedAttempt(apiKey, attempt),
        )
    : untracedAttempt;
  const { accessTokenProvider, apiKeys } = resolveCredentialSources(options);
  if (!accessTokenProvider && apiKeys.length === 0) {
    throwIfSignalAborted(options.abortSignal);
    if (isOpenAIApiProvider(options)) await tracedPacingWait(options);
    return requestAttempt(undefined, {
      attemptIndex: 1,
      attemptTotal: 1,
      keyIndex: 0,
      keyCount: 0,
      round: 1,
    });
  }

  const maxAttemptsPerKey = resolveConfiguredApiKeyMaxAttempts(options);
  const keyCount = accessTokenProvider ? 1 : apiKeys.length;
  const attemptTotal = keyCount * maxAttemptsPerKey;
  const delayMs = resolveConfiguredApiRetryDelaySeconds(options) * 1000;
  let forceTokenRefresh = false;

  for (let attemptIndex = 1; attemptIndex <= attemptTotal; attemptIndex += 1) {
    const keyIndex = (attemptIndex - 1) % keyCount;
    const round = Math.floor((attemptIndex - 1) / keyCount) + 1;
    throwIfSignalAborted(options.abortSignal);
    try {
      const apiKey = await resolveRetryCredential(
        accessTokenProvider,
        apiKeys,
        keyIndex,
        forceTokenRefresh,
      );
      forceTokenRefresh = false;
      await tracedPacingWait(options);
      return await requestAttempt(apiKey, {
        attemptIndex,
        attemptTotal,
        keyIndex,
        keyCount,
        round,
      });
    } catch (error) {
      const abortError =
        readSignalAbortReason(options.abortSignal) || findAbortError(error);
      if (abortError) {
        throw abortError;
      }
      if (!isRetryableApiKeyError(error)) {
        throw error;
      }
      forceTokenRefresh = shouldForceTokenRefresh(accessTokenProvider, error);
      if (attemptIndex >= attemptTotal) {
        throw markApiKeyRetriesExhausted(error, attemptIndex, keyCount);
      }
      const retryDelayMs = apiRetryDelay(error, delayMs);
      traceEvent("api-retry", {
        attemptIndex,
        attemptTotal,
        status: /** @type {{ status?: unknown }} */ (error).status,
        delayMs: retryDelayMs,
      });
      await waitForRetryDelay(retryDelayMs, options.abortSignal);
    }
  }

  throw new Error("API key retry loop ended unexpectedly.");
}

/**
 * Fork: records API pacing waits long enough to matter in a slow run.
 * @param {ApiKeyRetryOptions} options
 */
async function tracedPacingWait(options) {
  const startedAt = performance.now();
  await waitForApiRequestStart(options);
  const waitMs = Math.round(performance.now() - startedAt);
  if (waitMs >= 50) traceEvent("api-pacing-wait", { waitMs });
}

/** @param {ApiKeyRetryOptions} options */
function resolveCredentialSources(options) {
  if (!isOpenAIApiProvider(options)) {
    return { accessTokenProvider: null, apiKeys: [] };
  }
  const candidate = options.apiAccessTokenProvider;
  return {
    accessTokenProvider:
      typeof candidate === "function"
        ? /** @type {AccessTokenProvider} */ (candidate)
        : null,
    apiKeys: resolveConfiguredApiKeys(options),
  };
}

/**
 * @param {AccessTokenProvider | null} accessTokenProvider
 * @param {string[]} apiKeys
 * @param {number} keyIndex
 * @param {boolean} forceRefresh
 */
async function resolveRetryCredential(
  accessTokenProvider,
  apiKeys,
  keyIndex,
  forceRefresh,
) {
  return accessTokenProvider
    ? accessTokenProvider({ forceRefresh })
    : apiKeys[keyIndex];
}

/**
 * @param {AccessTokenProvider | null} accessTokenProvider
 * @param {unknown} error
 */
function shouldForceTokenRefresh(accessTokenProvider, error) {
  return Boolean(accessTokenProvider && isAuthenticationFailure(error));
}

/** @param {unknown} error */
function isAuthenticationFailure(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = /** @type {Record<string, unknown>} */ (error);
  return (
    record.status === 401 ||
    record.status === 403 ||
    record.apiKeyRetryable === true
  );
}

/** @param {AbortSignal | null | undefined} signal */
function throwIfSignalAborted(signal) {
  const abortError = readSignalAbortReason(signal);
  if (abortError) {
    throw abortError;
  }
}

/** @param {AbortSignal | null | undefined} signal */
function readSignalAbortReason(signal) {
  if (!signal?.aborted) {
    return null;
  }
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

/**
 * @param {number} delayMs
 * @param {AbortSignal | null | undefined} signal
 */
function waitForRetryDelay(delayMs, signal) {
  throwIfSignalAborted(signal);
  if (!(delayMs > 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", abort, { once: true });

    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve(undefined);
    }

    function abort() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(
        readSignalAbortReason(signal) ||
          new DOMException("Aborted", "AbortError"),
      );
    }
  });
}

module.exports = {
  runWithApiKeyRetry,
};
