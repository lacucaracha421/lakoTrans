import type { SettingsFormValues } from "./settingsModalFormValues";
import { readActiveApiProfile } from "./settingsModalProfileFormValues";

export function snapshotCustomApiProfiles(values: SettingsFormValues) {
  const profiles = { ...values.customApiProfiles };
  const active = profiles[values.activeCustomProfileId];
  if (values.apiProvider === "custom" && active) {
    profiles[values.activeCustomProfileId] = {
      ...active,
      values: readActiveApiProfile(values),
      limits:
        values.modelProvider === "openai-api"
          ? { maxTokens: values.maxTokens, contextTokens: values.contextTokens }
          : (values.generationLimitProfiles.api.custom ?? active.limits),
    };
  }
  return profiles;
}
