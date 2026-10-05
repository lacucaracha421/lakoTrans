import type { AppSettings, CustomApiProfile } from "../shared/settingsTypes";
import { DEFAULT_CUSTOM_PROFILE_ID } from "../shared/customApiProfiles";
import {
  attachApiProfileSecrets,
  maskApiProfileSecrets,
  readActiveApiProfile,
  resolveApiProfileSecrets,
  resolveActiveApiProvider,
  resolveSubmittedApiProfileSecrets,
  separateApiProfileSecrets,
  type SettingsSecrets,
} from "./settingsSecretProfiles";

/** Custom IDs occupy a separate namespace in the existing encrypted map. */
export function transformCustomProfileSecrets(
  settings: AppSettings,
  mode: "separate" | "attach" | "submit" | "mask",
  secrets: SettingsSecrets = {},
): {
  api: Partial<AppSettings["api"]>;
  secrets: SettingsSecrets["apiProfiles"];
} {
  if (!settings.api.customProfiles) return { api: {}, secrets: {} };
  const customProfiles: Record<string, CustomApiProfile> = {};
  const result: NonNullable<SettingsSecrets["apiProfiles"]> = { custom: {} };
  const activeId = settings.api.activeCustomProfileId;
  for (const [id, stored] of Object.entries(settings.api.customProfiles)) {
    const profile =
      settings.api.provider === "custom" && activeId === id
        ? { ...stored, ...readActiveApiProfile(settings) }
        : stored;
    const key = `custom:${id}`;
    const existing = existingCustomSecrets(secrets, id, settings);
    const separated = separateApiProfileSecrets(profile);
    const resolved =
      mode === "submit"
        ? resolveSubmittedApiProfileSecrets(
            profile,
            separated.secrets,
            existing,
          )
        : separated.secrets;
    result[key] = resolved;
    const connection =
      mode === "mask"
        ? maskApiProfileSecrets(profile)
        : mode === "attach"
          ? attachApiProfileSecrets(profile, existing)
          : separated.profile;
    customProfiles[id] = {
      ...connection,
      name: stored.name,
      generationLimits: stored.generationLimits,
    };
  }
  const active = customProfiles[activeId ?? ""];
  return {
    api: {
      customProfiles,
      activeCustomProfileId: activeId,
      ...(settings.api.provider === "custom" && active
        ? {
            ...stripCustomMetadata(active),
            profiles: {
              ...settings.api.profiles,
              custom: stripCustomMetadata(active),
            },
          }
        : {}),
    },
    secrets: result,
  };
}

function stripCustomMetadata(profile: CustomApiProfile) {
  const { name: _name, generationLimits: _limits, ...connection } = profile;
  return connection;
}

function existingCustomSecrets(
  secrets: SettingsSecrets,
  id: string,
  settings: AppSettings,
) {
  const isolated = secrets.apiProfiles?.[`custom:${id}`];
  if (isolated) return isolated;
  const migrated = Object.keys(secrets.apiProfiles ?? {}).some((key) =>
    key.startsWith("custom:"),
  );
  return id === DEFAULT_CUSTOM_PROFILE_ID && !migrated
    ? resolveApiProfileSecrets(
        secrets,
        "custom",
        resolveActiveApiProvider(settings),
      )
    : {};
}
