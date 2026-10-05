import type { AppSettings, CustomApiProfile } from "./settingsTypes";
import { DEFAULT_API_BASE_URL, DEFAULT_API_MODEL } from "./modelPresets";

export const CUSTOM_API_PROFILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const DEFAULT_CUSTOM_PROFILE_ID = "default";

/** Seed once. An existing (even empty) collection must never be reseeded. */
export function resolveCustomApiProfiles(api: AppSettings["api"]): {
  customProfiles: Record<string, CustomApiProfile>;
  activeCustomProfileId: string;
} {
  const legacy: AppSettings["api"] | undefined =
    api.provider === "custom" || !api.provider ? api : api.profiles?.custom;
  const {
    customProfiles: _custom,
    activeCustomProfileId: _id,
    provider: _provider,
    profiles: _profiles,
    ...connection
  } = legacy ?? {
    baseUrl: DEFAULT_API_BASE_URL,
    model: DEFAULT_API_MODEL,
  };
  const customProfiles = api.customProfiles ?? {
    default: { ...connection, name: "Default" },
  };
  const activeCustomProfileId =
    api.activeCustomProfileId &&
    Object.hasOwn(customProfiles, api.activeCustomProfileId)
      ? api.activeCustomProfileId
      : (Object.keys(customProfiles)[0] ?? "");
  return { customProfiles, activeCustomProfileId };
}
