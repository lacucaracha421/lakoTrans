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

export function selectCustomApiProfile(
  values: SettingsFormValues,
  id: string,
): SettingsFormValues {
  const customApiProfiles = snapshotCustomApiProfiles(values);
  const selected = customApiProfiles[id];
  if (!selected) return values;
  return {
    ...values,
    ...selected.values,
    activeCustomProfileId: id,
    customApiProfiles,
    apiProfiles: { ...values.apiProfiles, custom: selected.values },
    generationLimitProfiles: {
      ...values.generationLimitProfiles,
      api: { ...values.generationLimitProfiles.api, custom: selected.limits },
    },
    ...(values.modelProvider === "openai-api" ? selected.limits : {}),
  };
}
