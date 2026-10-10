import { resolveCustomApiProfiles } from "../../../../shared/customApiProfiles";
import type {
  ApiProviderProfileSettings,
  ApiReasoningEffort,
  AppSettings,
  GenerationLimitSettings,
  ModelProvider,
} from "../../../../shared/settingsTypes";
import {
  API_PROVIDER_PRESET_IDS,
  inferApiProviderPreset,
  resolveApiProviderBaseUrl,
  type ApiProviderPresetId,
  type VertexAuthMode,
} from "../../../../shared/apiProviderPresets";
import {
  DEFAULT_API_KEY_MAX_ATTEMPTS,
  DEFAULT_API_RETRY_DELAY_SECONDS,
  DEFAULT_API_REQUEST_INTERVAL_SECONDS,
} from "../../../../shared/apiKeySettings";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_API_CUSTOM_HEADERS_JSON,
  DEFAULT_API_EXTRA_BODY_JSON,
  DEFAULT_API_MODEL,
  DEFAULT_API_REASONING_EFFORT,
  DEFAULT_API_TEMPERATURE,
  DEFAULT_API_TOP_K,
  DEFAULT_API_TOP_P,
  resolveRecommendedGenerationLimits,
} from "../../../../shared/modelPresets";

export type ApiProfileFormValues = {
  apiBaseUrl: string;
  apiModel: string;
  apiKey: string;
  apiKeyCount: number;
  apiVertexAuthMode: VertexAuthMode;
  apiVertexServiceAccountPath: string;
  apiKeyMaxAttempts: string;
  apiRetryDelaySeconds: string;
  apiRequestIntervalSeconds: string;
  apiTemperature: string;
  apiTopP: string;
  apiTopK: string;
  apiReasoningEffort: ApiReasoningEffort | "";
  apiExtraBodyJson: string;
  apiCustomHeadersJson: string;
  apiSessionHeaderEnabled: boolean;
  apiSessionHeaderName: string;
};

export type CustomApiProfileForm = {
  name: string;
  values: ApiProfileFormValues;
  limits: GenerationLimitFormValues;
};

export type GenerationLimitFormValues = {
  maxTokens: string;
  contextTokens: string;
};

export type GenerationLimitProfilesFormValues = {
  gemma: GenerationLimitFormValues;
  codex: GenerationLimitFormValues;
  claude?: GenerationLimitFormValues;
  api: Partial<Record<ApiProviderPresetId, GenerationLimitFormValues>>;
};

export type ResearchApiProfileFormValues = {
  model: string;
  maxOutputTokens: string;
  contextTokens: string;
};

export function resolveApiFormValues(
  settings: AppSettings,
): ApiProfileFormValues & {
  apiProvider: ApiProviderPresetId;
  apiProfiles: Partial<Record<ApiProviderPresetId, ApiProfileFormValues>>;
  customApiProfiles: Record<string, CustomApiProfileForm>;
  activeCustomProfileId: string;
} {
  const provider =
    settings.api.provider ?? inferApiProviderPreset(settings.api.baseUrl);
  const storedProfiles = settings.api.profiles ?? {};
  const apiProfiles = Object.fromEntries(
    API_PROVIDER_PRESET_IDS.flatMap((candidate) => {
      const profile = storedProfiles[candidate];
      return profile
        ? [[candidate, createApiProfileFormValues(profile, candidate)]]
        : [];
    }),
  );
  return {
    ...createApiProfileFormValues(settings.api, provider),
    apiProvider: provider,
    apiProfiles,
    activeCustomProfileId: resolveCustomApiProfiles(settings.api)
      .activeCustomProfileId,
    customApiProfiles: Object.fromEntries(
      Object.entries(resolveCustomApiProfiles(settings.api).customProfiles).map(
        ([id, profile]) => [
          id,
          {
            name: profile.name,
            values: createApiProfileFormValues(profile, "custom"),
            limits: formatGenerationLimits(
              profile.generationLimits ??
                settings.generationLimits?.api.custom ??
                resolveRecommendedGenerationLimits("openai-api", profile.model),
            ),
          },
        ],
      ),
    ),
  };
}

export function resolveResearchApiProfileFormValues(
  settings: AppSettings,
): Partial<Record<ApiProviderPresetId, ResearchApiProfileFormValues>> {
  const profiles = settings.internetResearch.apiProfiles ?? {};
  return Object.fromEntries(
    API_PROVIDER_PRESET_IDS.flatMap((provider) => {
      const profile = profiles[provider];
      return profile
        ? [
            [
              provider,
              {
                model: profile.model,
                maxOutputTokens: String(profile.maxOutputTokens),
                contextTokens: String(profile.contextTokens),
              },
            ],
          ]
        : [];
    }),
  );
}

function createApiProfileFormValues(
  profile: ApiProviderProfileSettings,
  provider: ApiProviderPresetId,
): ApiProfileFormValues {
  return {
    apiBaseUrl: profile.baseUrl,
    apiModel: profile.model,
    apiKey: profile.apiKey ?? "",
    apiKeyCount: profile.apiKeyCount ?? 0,
    apiVertexAuthMode: resolveVertexAuthMode(profile, provider),
    apiVertexServiceAccountPath: profile.vertexServiceAccountPath ?? "",
    apiKeyMaxAttempts: String(
      profile.keyMaxAttempts ?? DEFAULT_API_KEY_MAX_ATTEMPTS,
    ),
    apiRetryDelaySeconds: String(
      profile.retryDelaySeconds ?? DEFAULT_API_RETRY_DELAY_SECONDS,
    ),
    apiRequestIntervalSeconds: String(
      profile.requestIntervalSeconds ?? DEFAULT_API_REQUEST_INTERVAL_SECONDS,
    ),
    apiTemperature: formatNullableNumberInput(profile.temperature),
    apiTopP: formatNullableNumberInput(profile.topP),
    apiTopK: formatNullableNumberInput(profile.topK),
    apiReasoningEffort: profile.reasoningEffort ?? "",
    apiExtraBodyJson: profile.extraBodyJson ?? "",
    apiCustomHeadersJson: profile.customHeadersJson ?? "",
    apiSessionHeaderEnabled: profile.sessionHeaderEnabled ?? false,
    apiSessionHeaderName: profile.sessionHeaderName ?? "",
  };
}

function resolveVertexAuthMode(
  profile: ApiProviderProfileSettings,
  provider: ApiProviderPresetId,
): VertexAuthMode {
  if (profile.vertexAuthMode) return profile.vertexAuthMode;
  const isLegacyVertexToken =
    provider === "google-vertex" && Boolean(profile.apiKey?.trim());
  return isLegacyVertexToken ? "access-token" : "service-account";
}

export function createDefaultApiProfileFormValues(
  provider: ApiProviderPresetId,
): ApiProfileFormValues {
  const model =
    provider === "google-ai-studio"
      ? "gemini-3.5-flash-lite"
      : provider === "opencode-go"
        ? "deepseek-v4.1-flash"
        : DEFAULT_API_MODEL;
  return {
    apiBaseUrl:
      resolveApiProviderBaseUrl({ provider }) ??
      (provider === "google-vertex" ? "" : DEFAULT_API_BASE_URL),
    apiModel: model,
    apiKey: "",
    apiKeyCount: 0,
    apiVertexAuthMode:
      provider === "google-vertex" ? "service-account" : "access-token",
    apiVertexServiceAccountPath: "",
    apiKeyMaxAttempts: String(DEFAULT_API_KEY_MAX_ATTEMPTS),
    apiRetryDelaySeconds: String(DEFAULT_API_RETRY_DELAY_SECONDS),
    apiRequestIntervalSeconds: String(DEFAULT_API_REQUEST_INTERVAL_SECONDS),
    apiTemperature: formatNullableNumberInput(DEFAULT_API_TEMPERATURE),
    apiTopP: formatNullableNumberInput(DEFAULT_API_TOP_P),
    apiTopK: formatNullableNumberInput(DEFAULT_API_TOP_K),
    apiReasoningEffort: DEFAULT_API_REASONING_EFFORT ?? "",
    apiExtraBodyJson:
      provider === "opencode-go"
        ? '{"response_format":{"type":"json_object"}}'
        : DEFAULT_API_EXTRA_BODY_JSON,
    apiCustomHeadersJson: DEFAULT_API_CUSTOM_HEADERS_JSON,
    apiSessionHeaderEnabled: provider === "opencode-go",
    apiSessionHeaderName:
      provider === "opencode-go" ? "x-opencode-session" : "",
  };
}

export function createDefaultGenerationLimitFormValues(
  provider: ModelProvider,
  model?: string,
): GenerationLimitFormValues {
  return formatGenerationLimits(
    resolveRecommendedGenerationLimits(provider, model),
  );
}

export function createDefaultResearchApiProfileFormValues(
  model: string,
): ResearchApiProfileFormValues {
  const limits = resolveRecommendedGenerationLimits("openai-api", model);
  return {
    model,
    maxOutputTokens: String(limits.maxTokens),
    contextTokens: String(limits.contextTokens),
  };
}

export function resolveGenerationLimitProfileFormValues(
  settings: AppSettings,
): GenerationLimitProfilesFormValues {
  const stored = settings.generationLimits;
  const provider =
    settings.api.provider ?? inferApiProviderPreset(settings.api.baseUrl);
  const legacy = { maxTokens: settings.maxTokens, contextTokens: settings.ctx };
  const apiProfiles = { ...(stored?.api ?? {}) };
  apiProfiles[provider] ??= resolveActiveApiLegacyLimits(settings, legacy);
  return {
    gemma: formatGenerationLimits(
      stored?.gemma ?? resolveGemmaLegacyLimits(settings, legacy),
    ),
    claude: formatGenerationLimits(
      stored?.claude ?? { maxTokens: 32768, contextTokens: 65536 },
    ),
    codex: formatGenerationLimits(
      stored?.codex ?? resolveCodexLegacyLimits(settings, legacy),
    ),
    api: Object.fromEntries(
      API_PROVIDER_PRESET_IDS.flatMap((candidate) => {
        const limits = apiProfiles[candidate];
        return limits ? [[candidate, formatGenerationLimits(limits)]] : [];
      }),
    ),
  };
}

function resolveGemmaLegacyLimits(
  settings: AppSettings,
  legacy: GenerationLimitSettings,
): GenerationLimitSettings {
  return settings.modelProvider === "gemma"
    ? legacy
    : resolveRecommendedGenerationLimits("gemma");
}

function resolveCodexLegacyLimits(
  settings: AppSettings,
  legacy: GenerationLimitSettings,
): GenerationLimitSettings {
  return settings.modelProvider === "openai-codex"
    ? legacy
    : resolveRecommendedGenerationLimits("openai-codex", settings.codex.model);
}

function resolveActiveApiLegacyLimits(
  settings: AppSettings,
  legacy: GenerationLimitSettings,
): GenerationLimitSettings {
  return settings.modelProvider === "openai-api"
    ? legacy
    : resolveRecommendedGenerationLimits("openai-api", settings.api.model);
}

function formatGenerationLimits(
  limits: GenerationLimitSettings,
): GenerationLimitFormValues {
  return {
    maxTokens: String(limits.maxTokens),
    contextTokens: String(limits.contextTokens),
  };
}

function formatNullableNumberInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function readActiveApiProfile(
  values: ApiProfileFormValues,
): ApiProfileFormValues {
  return {
    apiBaseUrl: values.apiBaseUrl,
    apiModel: values.apiModel,
    apiKey: values.apiKey,
    apiKeyCount: values.apiKeyCount,
    apiVertexAuthMode: values.apiVertexAuthMode,
    apiVertexServiceAccountPath: values.apiVertexServiceAccountPath,
    apiKeyMaxAttempts: values.apiKeyMaxAttempts,
    apiRetryDelaySeconds: values.apiRetryDelaySeconds,
    apiRequestIntervalSeconds: values.apiRequestIntervalSeconds,
    apiTemperature: values.apiTemperature,
    apiTopP: values.apiTopP,
    apiTopK: values.apiTopK,
    apiReasoningEffort: values.apiReasoningEffort,
    apiExtraBodyJson: values.apiExtraBodyJson,
    apiCustomHeadersJson: values.apiCustomHeadersJson,
    apiSessionHeaderEnabled: values.apiSessionHeaderEnabled,
    apiSessionHeaderName: values.apiSessionHeaderName,
  };
}
