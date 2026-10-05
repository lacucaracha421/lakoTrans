import type { ApiProviderProfileSettings } from "../../shared/settingsTypes";
import {
  DEFAULT_API_KEY_MAX_ATTEMPTS,
  DEFAULT_API_RETRY_DELAY_SECONDS,
  DEFAULT_API_REQUEST_INTERVAL_SECONDS,
  MAX_API_KEY_MAX_ATTEMPTS,
  MAX_API_RETRY_DELAY_SECONDS,
  MAX_API_REQUEST_INTERVAL_SECONDS,
  MIN_API_KEY_MAX_ATTEMPTS,
  MIN_API_RETRY_DELAY_SECONDS,
  MIN_API_REQUEST_INTERVAL_SECONDS,
  normalizeApiKeysText,
} from "../../shared/apiKeySettings";
import {
  resolveNullableIntegerRange,
  resolveNullableNumberRange,
  resolveNullableReasoningEffort,
  resolveNonEmptyString,
  resolveNumberRange,
  resolveOpenAiCompatibleBaseUrl,
  resolveOptionalJsonObjectString,
} from "./appSettingsResolvers";
import { normalizeVertexAuthSettings } from "./vertexAuthSettingsNormalize";
export function normalizeApiProviderProfile(
  api: Record<string, unknown> | null,
  fallback: ApiProviderProfileSettings,
): ApiProviderProfileSettings {
  const source = api ?? {};
  const apiKey = normalizeApiKeysText(source.apiKey);
  return {
    baseUrl: resolveOpenAiCompatibleBaseUrl(source.baseUrl, fallback.baseUrl),
    model: resolveNonEmptyString(source.model, fallback.model),
    ...optionalApiKey(apiKey),
    ...normalizeVertexAuthSettings(source),
    keyMaxAttempts: Math.round(
      resolveNumberRange(
        source.keyMaxAttempts,
        withDefault(fallback.keyMaxAttempts, DEFAULT_API_KEY_MAX_ATTEMPTS),
        MIN_API_KEY_MAX_ATTEMPTS,
        MAX_API_KEY_MAX_ATTEMPTS,
      ),
    ),
    retryDelaySeconds: resolveNumberRange(
      source.retryDelaySeconds,
      withDefault(fallback.retryDelaySeconds, DEFAULT_API_RETRY_DELAY_SECONDS),
      MIN_API_RETRY_DELAY_SECONDS,
      MAX_API_RETRY_DELAY_SECONDS,
    ),
    requestIntervalSeconds: resolveNumberRange(
      source.requestIntervalSeconds,
      withDefault(
        fallback.requestIntervalSeconds,
        DEFAULT_API_REQUEST_INTERVAL_SECONDS,
      ),
      MIN_API_REQUEST_INTERVAL_SECONDS,
      MAX_API_REQUEST_INTERVAL_SECONDS,
    ),
    temperature: resolveNullableNumberRange(
      source.temperature,
      withDefault(fallback.temperature, null),
      0,
      2,
    ),
    topP: resolveNullableNumberRange(
      source.topP,
      withDefault(fallback.topP, null),
      0,
      1,
    ),
    topK: resolveNullableIntegerRange(
      source.topK,
      withDefault(fallback.topK, null),
      1,
      1000,
    ),
    reasoningEffort: resolveNullableReasoningEffort(
      source.reasoningEffort,
      withDefault(fallback.reasoningEffort, null),
    ),
    extraBodyJson: resolveOptionalJsonObjectString(
      source.extraBodyJson,
      withDefault(fallback.extraBodyJson, ""),
    ),
    ...(source.sessionHeaderEnabled !== undefined
      ? { sessionHeaderEnabled: source.sessionHeaderEnabled === true }
      : {}),
    ...(typeof source.sessionHeaderName === "string"
      ? { sessionHeaderName: source.sessionHeaderName.trim() }
      : {}),
    customHeadersJson: resolveOptionalJsonObjectString(
      source.customHeadersJson,
      withDefault(fallback.customHeadersJson, ""),
    ),
  };
}

function optionalApiKey(
  apiKey: string,
): Pick<ApiProviderProfileSettings, "apiKey"> | object {
  return apiKey ? { apiKey } : {};
}

function withDefault<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}
