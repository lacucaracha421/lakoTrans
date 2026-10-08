// @ts-check

/** Classify protocol evidence, never a provider name.
 * @param {Response} response @param {string} rawText
 */
function classifyApiHttpFailure(response, rawText) {
  const text = rawText.toLowerCase();
  const status = response.status;
  if (
    status === 402 ||
    /insufficient[_ ]quota|quota[_ ]exceeded|usage_limit_reached|insufficient[_ ](?:balance|credits)|(?:balance|credits) (?:exhausted|depleted)|billing[_ ]hard[_ ]limit|daily[_ ]limit[_ ]exceeded/.test(
      text,
    )
  ) {
    return {
      apiFailureKind: "quota",
      usageLimitReached: true,
      nonRetriable: true,
    };
  }
  if (
    status === 401 ||
    /api_key_invalid|invalid[_ ]api[_ ]key|please pass a valid api key|api key (?:expired|is not valid|has been reported as leaked)/.test(
      text,
    )
  ) {
    return { apiFailureKind: "authentication", apiKeyRetryable: true };
  }
  if (status === 403)
    return { apiFailureKind: "permission", nonRetriable: true };
  if (status === 429)
    return {
      apiFailureKind: "rate-limit",
      retryAfterMs: readRetryAfter(response.headers.get("retry-after")),
    };
  if ([400, 415, 422].includes(status)) {
    return {
      apiFailureKind: /image|vision|multimodal/.test(text)
        ? "unsupported-image"
        : "unsupported-request",
      nonRetriable: true,
      providerReason: readProviderReason(rawText),
    };
  }
  return { apiFailureKind: status >= 500 ? "service" : "request" };
}

/** @param {string | null} value */
function readRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/** @param {unknown} error @param {number} fallback */
function apiRetryDelay(error, fallback) {
  const delay =
    error && typeof error === "object" && "retryAfterMs" in error
      ? Number(error.retryAfterMs)
      : 0;
  return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
}

/** @param {Record<string, unknown>} error */
function isTerminalApiFailure(error) {
  return [
    "quota",
    "permission",
    "unsupported-image",
    "unsupported-request",
  ].includes(String(error.apiFailureKind));
}
module.exports = {
  apiFailureMessage,
  classifyApiHttpFailure,
  apiRetryDelay,
  isTerminalApiFailure,
};

/** @param {{apiFailureKind:string;providerReason?:string}|undefined} failure @param {number} status @param {string} statusText */
function apiFailureMessage(failure, status, statusText) {
  if (!failure && status === 401)
    return `API 오류 ${[String(status), statusText.trim()].filter(Boolean).join(" ")}: 인증에 실패했습니다. API 키가 올바르고 유효한지 확인하세요.`;
  const kind = failure?.apiFailureKind ?? "";
  const descriptions = /** @type {Record<string, string>} */ ({
    quota:
      "사용량 또는 잔액 한도에 도달했습니다. 계정의 한도와 잔액을 확인하세요.",
    authentication:
      "API 인증에 실패했습니다. 키가 올바르고 유효한지 확인하세요.",
    permission:
      "이 계정에 요청 권한이 없습니다. 서비스의 계정·모델·사용 조건을 확인하세요.",
    "rate-limit":
      "일시적인 요청 제한입니다. 서비스가 안내한 대기 시간 후 다시 시도할 수 있습니다.",
    "unsupported-image":
      "서비스가 이미지 요청을 거부했습니다. 이미지 입력 지원과 형식을 확인하세요.",
    "unsupported-request":
      "서비스가 요청 형식을 거부했습니다. 모델과 고급 요청 설정을 확인하세요.",
  });
  if (!descriptions[kind]) return null;
  const reason = failure?.providerReason;
  return `API 오류 ${status}: ${descriptions[kind]}${reason ? ` (서비스 응답: ${reason})` : ""}`;
}

/**
 * Fork: the service's own reason for a rejected request (`error.message` of
 * OpenAI-style bodies), so a 400 can be diagnosed without request logs. Key
 * looking tokens are masked; the text is capped.
 * @param {string} rawText
 */
function readProviderReason(rawText) {
  let reason;
  try {
    reason = /** @type {{error?: {message?: unknown}}} */ (JSON.parse(rawText))
      .error?.message;
  } catch (_error) {
    return undefined;
  }
  if (typeof reason !== "string" || !reason.trim()) return undefined;
  return reason
    .trim()
    .replace(/\b(?:sk|key)-[\w-]{8,}/gi, "[redacted]")
    .slice(0, 300);
}
