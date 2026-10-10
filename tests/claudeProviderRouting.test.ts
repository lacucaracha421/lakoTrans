import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import {
  resolveDefaultAppSettings,
  buildBaseTranslationOptions,
} from "../src/main/appSettings";
import { resolveActiveGenerationLimits } from "../src/main/settings/appSettingsGenerationLimitDefaults";
import { resolveAnalysisInputBudget } from "../src/main/workContextAnalysisBudget";
import {
  emitEndpointStarting,
  emitEndpointReady,
} from "../src/main/pipeline/progressEvents";
import { normalizeAppSettings } from "../src/main/settings/appSettingsNormalize";
import { resolveActiveGenerationLimits as activeStoredLimits } from "../src/main/settings/appSettingsProviderProfiles";
import { getAppPaths } from "../src/main/appPaths";
import type { AppSettings } from "../src/shared/settingsTypes";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.cwd() },
}));
const requireRuntime = createRequire(import.meta.url);
const baseOptions = (settings: AppSettings) =>
  buildBaseTranslationOptions({
    settings,
    jobId: "test",
    runDir: ".tmp/claude-routing",
    paths: getAppPaths(),
    env: {},
  });

it.each([undefined, "sonnet"])(
  "treats Claude %s as a remote runtime without downloading or migrating local model assets",
  async (model) => {
    const options = {
      modelProvider: "claude-code",
      claudeModel: model,
      llamaRuntimeProfile: "metal",
    };
    const { inspectModelLaunch, isModelCached } = requireRuntime(
      "../src/main/runtime/model/model-launch-target.cjs",
    );
    const target = inspectModelLaunch(options);
    expect(target).toEqual({
      launchMode: "claude-code",
      model: model ?? "default",
      requiresDownload: false,
    });
    expect(isModelCached(options)).toBe(true);
    const { collectRequiredHfDownloads } = requireRuntime(
      "../src/main/runtime/model/hf-model-download-tasks.cjs",
    );
    expect(collectRequiredHfDownloads(options, target)).toEqual([]);
    const { ensureCompactCachedHfAssets } = requireRuntime(
      "../src/main/runtime/model/compact-model-cache.cjs",
    );
    await expect(
      ensureCompactCachedHfAssets(options, target),
    ).resolves.toBeUndefined();
    const { removeInvalidMetalCachedAssets } = requireRuntime(
      "../src/main/runtime/model/hf-model-download.cjs",
    );
    await expect(
      removeInvalidMetalCachedAssets(options, target),
    ).resolves.toBeUndefined();
    const { resolveRequestModelName } = requireRuntime(
      "../src/main/runtime/simple-page-request-summary.cjs",
    );
    expect(resolveRequestModelName(options)).toBe(model ?? "default");
  },
);

it("keeps Claude budgets independent, including legacy settings without a Claude profile", () => {
  const defaults = resolveDefaultAppSettings({
    MANGA_TRANSLATOR_MODEL_PROVIDER: "claude-code",
  });
  const settings = normalizeAppSettings({
    ...defaults,
    modelProvider: "claude-code",
    claude: { model: "sonnet", effort: "max" },
    generationLimits: {
      ...defaults.generationLimits,
      claude: { maxTokens: 10000, contextTokens: 50000 },
    },
  });
  const base = baseOptions(settings);
  expect(base).toMatchObject({
    modelProvider: "claude-code",
    claudeModel: "sonnet",
    claudeEffort: "max",
  });
  const profiles = defaults.generationLimits;
  if (!profiles) throw new Error("Missing default profiles");
  expect(
    activeStoredLimits(
      { ...profiles, claude: undefined },
      "claude-code",
      "custom",
    ),
  ).toEqual({ maxTokens: 32768, contextTokens: 65536 });
  expect(
    resolveActiveGenerationLimits(
      { ...profiles, claude: undefined },
      "claude-code",
      { ...settings.api, provider: "custom", profiles: {} },
    ),
  ).toEqual({ maxTokens: 32768, contextTokens: 65536 });
  expect(
    resolveActiveGenerationLimits(
      { ...profiles, claude: { maxTokens: 10000, contextTokens: 50000 } },
      "claude-code",
      { ...settings.api, provider: "custom", profiles: {} },
    ).maxTokens,
  ).toBe(10000);
  expect(
    resolveAnalysisInputBudget({
      options: {
        modelProvider: "claude-code",
        claudeModel: "sonnet",
        maxTokens: 32768,
        ctx: 65536,
      },
    }),
  ).toBe(63536);
});

it("reports Claude preparation and readiness rather than a Gemma download", () => {
  const options = baseOptions(
    normalizeAppSettings({
      modelProvider: "claude-code",
      claude: { model: "sonnet", effort: "high" },
    }),
  );
  const context = {
    jobId: "test",
    emit: vi.fn(),
    progressTotal: 1,
    pageTotal: 1,
    ocrPipeline: "hayai" as const,
  };
  const selection = {
    apiSelected: false,
    codexSelected: false,
    baseOptions: options,
  };
  emitEndpointStarting(context, {
    ...selection,
    localModelSelected: false,
    modelCached: true,
    formatGemmaVramMode: () => "local",
  });
  expect(context.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      phase: "booting",
      progressText: "Claude Code",
      detail: "Claude Code",
    }),
  );
  emitEndpointReady(context, {
    ...selection,
    server: {
      provider: "claude-code",
      baseUrl: "http://127.0.0.1:1234",
      child: null,
      startedByScript: true,
      close: async () => {},
    },
  });
  expect(context.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ detail: "sonnet", phase: "ready" }),
  );
});
