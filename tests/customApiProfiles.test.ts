import { describe, expect, it, vi } from "vitest";
import { resolveApiTranslationOptions } from "../src/main/settings/translationApiOptions";
import { buildSettingsFromDraft } from "../src/renderer/src/components/settingsModal/settingsModalBuildSettings";
import { resolveSettingsDraft } from "../src/renderer/src/components/settingsModal/settingsModalFormUtils";
import { DEFAULT_BLOCK_FORMAT_DEFAULTS } from "../src/shared/blockFormat";
import { normalizeSecrets } from "../src/main/settingsSecretProfiles";
import {
  resolveDefaultAppSettings,
  normalizeAppSettings,
} from "../src/main/appSettings";
import { resolveCustomApiProfiles } from "../src/shared/customApiProfiles";
import { apiSessionHeaderError } from "../src/shared/apiSessionHeaders";
import {
  attachSettingsSecrets,
  maskSettingsSecrets,
  resolveSubmittedSettingsSecrets,
  separateSettingsSecrets,
} from "../src/main/settingsSecretStore";
import {
  createEncryptedSecretVault,
  decryptVault,
  parseEncryptedVault,
} from "../src/main/settingsSecretVaultCodec";
import { createSettingsFormValues } from "../src/renderer/src/components/settingsModal/settingsModalFormValues";
import { AppSettingsSchema } from "../src/shared/ipcSettingsSchemas";
import {
  inferApiProviderPreset,
  resolveApiProviderBaseUrl,
} from "../src/shared/apiProviderPresets";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "3.1.1" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`encrypted:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^encrypted:/, ""),
  },
}));

function fixture() {
  const settings = resolveDefaultAppSettings();
  settings.api = {
    ...settings.api,
    provider: "custom",
    baseUrl: "https://example.com/v1",
    apiKey: "legacy-secret",
    customHeadersJson: '{"x-api-key":"header-secret"}',
  };
  settings.api = { ...settings.api, ...resolveCustomApiProfiles(settings.api) };
  settings.api.customProfiles = {
    ...settings.api.customProfiles,
    "opencode-go": {
      name: "OpenCode Go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4.1-flash",
      sessionHeaderEnabled: true,
      sessionHeaderName: "x-opencode-session",
    },
  };
  return settings;
}

describe("custom API profile contracts", () => {
  it("stores Go in the existing provider vault independently of custom credentials", () => {
    const settings = fixture();
    settings.api = {
      ...settings.api,
      provider: "opencode-go",
      baseUrl: resolveApiProviderBaseUrl({ provider: "opencode-go" }) ?? "",
      model: "deepseek-v4.1-flash",
      apiKey: "go-provider-key",
      customHeadersJson: "{}",
      sessionHeaderEnabled: true,
      sessionHeaderName: "x-opencode-session",
    };
    settings.api.profiles = {
      ...settings.api.profiles,
      "opencode-go": {
        baseUrl: settings.api.baseUrl,
        model: settings.api.model,
        sessionHeaderEnabled: true,
        sessionHeaderName: "x-opencode-session",
      },
    };
    expect(AppSettingsSchema.safeParse(settings).success).toBe(true);
    const separated = separateSettingsSecrets(settings);
    expect(separated.secrets.apiProfiles?.["opencode-go"].apiKey).toBe(
      "go-provider-key",
    );
    expect(separated.secrets.apiProfiles?.["custom:default"].apiKey).toBe(
      "legacy-secret",
    );
    const restored = attachSettingsSecrets(
      separated.persistentSettings,
      separated.secrets,
    );
    expect(restored.api.apiKey).toBe("go-provider-key");
    expect(inferApiProviderPreset(settings.api.baseUrl)).toBe("opencode-go");
    expect(inferApiProviderPreset("https://opencode.ai/zen/v1")).toBe("custom");
    expect(
      Object.keys(
        resolveCustomApiProfiles(resolveDefaultAppSettings().api)
          .customProfiles,
      ),
    ).toEqual(["default"]);
  });
  it("does not project an inactive profile when the active ID is missing", () => {
    const settings = fixture();
    delete settings.api.activeCustomProfileId;
    const separated = separateSettingsSecrets(settings);
    expect(
      separated.persistentSettings.api.activeCustomProfileId,
    ).toBeUndefined();
    expect(separated.secrets.apiProfiles?.["custom:default"].apiKey).toBe(
      "legacy-secret",
    );
    expect(
      separated.secrets.apiProfiles?.["custom:opencode-go"],
    ).toBeUndefined();
  });
  it("discards empty stored credential records and keeps credential-only profiles", () => {
    expect(
      normalizeSecrets({
        apiProfiles: JSON.parse(
          '{"custom:empty":null,"custom:headers":{"credentialHeaders":{"Authorization":"secret"}}}',
        ),
      }).apiProfiles,
    ).toEqual({
      "custom:headers": { credentialHeaders: { Authorization: "secret" } },
    });
  });
  it("does not recreate profiles from an explicitly empty stored collection", () => {
    const settings = fixture();
    settings.api.customProfiles = {};
    const normalized = normalizeAppSettings(
      settings,
      resolveDefaultAppSettings(),
    );
    expect(normalized.api.customProfiles).toEqual({});
    expect(normalized.api.apiKey).toBe("legacy-secret");
  });
  it("ignores unknown secret namespaces and malformed encrypted profile records", () => {
    expect(
      normalizeSecrets({
        apiProfiles: {
          unrelated: { apiKey: "discard" },
          "custom:valid": { apiKey: "keep" },
        },
      }).apiProfiles,
    ).toEqual({ "custom:valid": { apiKey: "keep" } });
    const apiProfiles = Buffer.from(
      `encrypted:${JSON.stringify({ unrelated: { apiKey: "discard" }, "custom:bad": null, "custom:valid": { apiKey: "keep", credentialHeaders: false } })}`,
    ).toString("base64");
    expect(
      decryptVault({
        version: 2,
        generation: "01234567-89ab-4cde-8abc-0123456789ab",
        apiProfiles,
      }).apiProfiles,
    ).toEqual({ "custom:valid": { apiKey: "keep" } });
  });

  it("normalizes malformed stored names and excludes unsafe profile IDs", () => {
    const settings = fixture();
    const normalized = normalizeAppSettings(
      {
        ...settings,
        api: {
          ...settings.api,
          customProfiles: {
            valid: { ...settings.api, name: 42 },
            "bad id": { ...settings.api, name: "bad" },
          },
          activeCustomProfileId: "valid",
        },
      },
      resolveDefaultAppSettings(),
    );
    expect(normalized.api.customProfiles?.valid.name).toBe("valid");
    expect(normalized.api.customProfiles?.["bad id"]).toBeUndefined();
  });
  it("freezes connection options with the actual version and a fresh execution seed", () => {
    const settings = fixture();
    settings.api.sessionHeaderEnabled = true;
    settings.api.sessionHeaderName = "x-conversation";
    const first = resolveApiTranslationOptions({}, settings);
    expect(first.apiUserAgent).toBe("CarrotMangaTranslator/3.1.1");
    expect(first.apiSessionHeaderName).toBe("x-conversation");
    settings.api.apiKey = "new-key";
    settings.api.baseUrl = "https://changed.example/v1";
    expect(first.apiKey).toBe("legacy-secret");
    expect(first.apiBaseUrl).toBe("https://example.com/v1");
    expect(
      resolveApiTranslationOptions({}, settings).apiConversationSeed,
    ).not.toBe(first.apiConversationSeed);
    settings.api.provider = "openrouter";
    expect(resolveApiTranslationOptions({}, settings).apiProfileId).toBe(
      "openrouter",
    );
  });

  it("refuses to silently drop an invalid inactive profile on save", () => {
    const settings = fixture();
    const values = createSettingsFormValues(settings);
    values.customApiProfiles["opencode-go"].values.apiBaseUrl = "not-a-url";
    expect(() =>
      buildSettingsFromDraft({
        values,
        draft: resolveSettingsDraft(values),
        initialSettings: settings,
        keybindings: {},
        blockFormatDefaults: DEFAULT_BLOCK_FORMAT_DEFAULTS,
      }),
    ).toThrow(/invalid connection/);
  });

  it("normalizes inactive custom profiles and limits without changing the provider", () => {
    const settings = fixture();
    settings.api.provider = "openrouter";
    const profiles = settings.api.customProfiles ?? {};
    profiles["opencode-go"].name = "";
    profiles["opencode-go"].generationLimits = {
      maxTokens: 2048,
      contextTokens: 8192,
    };
    const normalized = normalizeAppSettings(
      settings,
      resolveDefaultAppSettings(),
    );
    expect(normalized.api.provider).toBe("openrouter");
    expect(normalized.api.customProfiles?.["opencode-go"].name).toBe(
      "opencode-go",
    );
    expect(
      normalized.api.customProfiles?.["opencode-go"].generationLimits,
    ).toEqual({ maxTokens: 2048, contextTokens: 8192 });
  });
  it("migrates old top-level encrypted credentials only into the default custom profile", () => {
    const settings = fixture();
    const publicSettings = separateSettingsSecrets(settings).persistentSettings;
    const restored = attachSettingsSecrets(publicSettings, {
      apiKey: "old-vault-key",
      credentialHeaders: { "x-api-key": "old-header" },
    });
    expect(restored.api.apiKey).toBe("old-vault-key");
    expect(restored.api.customProfiles?.default.apiKey).toBe("old-vault-key");
    expect(restored.api.customProfiles?.["opencode-go"].apiKey).toBeUndefined();
    const masked = maskSettingsSecrets(restored);
    const saved = resolveSubmittedSettingsSecrets(masked, {
      apiKey: "old-vault-key",
      credentialHeaders: { "x-api-key": "old-header" },
    });
    expect(saved.secrets.apiProfiles?.["custom:default"].apiKey).toBe(
      "old-vault-key",
    );
    expect(saved.secrets.apiProfiles?.custom).toBeUndefined();
  });

  it("preserves a legacy named Go connection without recreating deleted records", () => {
    const settings = fixture();
    expect(settings.api.activeCustomProfileId).toBe("default");
    expect(settings.api.customProfiles?.["opencode-go"]).toMatchObject({
      sessionHeaderName: "x-opencode-session",
      model: "deepseek-v4.1-flash",
    });
    expect(settings.api.customProfiles?.["opencode-go"].apiKey).toBeUndefined();
    delete settings.api.customProfiles?.["opencode-go"];
    expect(
      resolveCustomApiProfiles(settings.api).customProfiles["opencode-go"],
    ).toBeUndefined();
  });

  it("encrypts and masks every profile, restores sentinels by ID, and deletes only the removed profile", () => {
    const settings = fixture();
    Object.assign(settings.api.customProfiles?.["opencode-go"] ?? {}, {
      apiKey: "go-secret",
    });
    const separated = separateSettingsSecrets(settings);
    expect(JSON.stringify(separated.persistentSettings)).not.toMatch(
      /legacy-secret|header-secret|go-secret/,
    );
    const vault = createEncryptedSecretVault(
      "01234567-89ab-4cde-8abc-0123456789ab",
      separated.secrets,
    );
    const secrets = decryptVault(parseEncryptedVault(JSON.stringify(vault)));
    const restored = attachSettingsSecrets(
      separated.persistentSettings,
      secrets,
    );
    expect(restored.api.customProfiles?.default.apiKey).toBe("legacy-secret");
    expect(restored.api.customProfiles?.["opencode-go"].apiKey).toBe(
      "go-secret",
    );
    const masked = maskSettingsSecrets(restored);
    expect(JSON.stringify(masked)).not.toMatch(
      /legacy-secret|header-secret|go-secret/,
    );
    const saved = resolveSubmittedSettingsSecrets(masked, secrets);
    expect(saved.secrets.apiProfiles?.["custom:opencode-go"].apiKey).toBe(
      "go-secret",
    );
    delete masked.api.customProfiles?.["opencode-go"];
    const deleted = resolveSubmittedSettingsSecrets(masked, secrets);
    expect(deleted.secrets.apiProfiles?.["custom:opencode-go"]).toBeUndefined();
    expect(deleted.secrets.apiProfiles?.["custom:default"].apiKey).toBe(
      "legacy-secret",
    );
  });

  it("can clear an active key without resurrecting the stored mirror", () => {
    const settings = fixture();
    delete settings.api.apiKey;
    const normalized = normalizeAppSettings(
      settings,
      resolveDefaultAppSettings(),
    );
    expect(normalized.api.customProfiles?.default.apiKey).toBeUndefined();
  });

  it.each([
    "Authorization",
    "Content-Length",
    "User-Agent",
    "x-api-key",
    "x-test-token",
    "bad header",
    "bad\r\nheader",
    "",
  ])("rejects unsafe session header %j", (name) => {
    expect(
      apiSessionHeaderError({
        sessionHeaderEnabled: true,
        sessionHeaderName: name,
      }),
    ).toBeTruthy();
  });

  it("validates collisions case-insensitively in IPC and accepts a valid named profile", () => {
    const settings = fixture();
    expect(AppSettingsSchema.safeParse(settings).success).toBe(true);
    Object.assign(settings.api.customProfiles?.["opencode-go"] ?? {}, {
      customHeadersJson: '{"X-OpenCode-Session":"static"}',
    });
    expect(AppSettingsSchema.safeParse(settings).success).toBe(false);
    expect(
      apiSessionHeaderError({
        sessionHeaderEnabled: false,
        sessionHeaderName: "",
      }),
    ).toBeNull();
  });
});
