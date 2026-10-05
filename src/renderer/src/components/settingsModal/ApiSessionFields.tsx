import React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/Field";
import { CheckboxField } from "../ui/CheckboxField";
import { settingsGateway } from "../../api/settingsGateway";
import { apiSessionHeaderError } from "../../../../shared/apiSessionHeaders";
import type { EngineSettingsPanelProps } from "./EngineSettingsPanelTypes";
type ApiSettingsFieldsProps = Pick<
  EngineSettingsPanelProps,
  | "apiSessionHeaderEnabled"
  | "apiSessionHeaderName"
  | "setApiSessionHeaderEnabled"
  | "setApiSessionHeaderName"
  | "apiCustomHeadersJson"
  | "clearTestState"
  | "controlsBusy"
>;
export function ApiSessionFields(props: ApiSettingsFieldsProps) {
  const { t } = useTranslation("components");
  const [version, setVersion] = React.useState("");
  React.useEffect(() => {
    let active = true;
    void settingsGateway
      .getAppUpdateInfo()
      .then((info) => {
        if (active) setVersion(info.currentVersion);
      })
      .catch((error) => console.error("Cannot read client version", error));
    return () => {
      active = false;
    };
  }, []);
  const error = apiSessionHeaderError({
    sessionHeaderEnabled: props.apiSessionHeaderEnabled,
    sessionHeaderName: props.apiSessionHeaderName,
    customHeadersJson: props.apiCustomHeadersJson,
  });
  return (
    <div className="settings-subsection-stack">
      <CheckboxField
        checked={props.apiSessionHeaderEnabled ?? false}
        disabled={props.controlsBusy}
        label={t("settings.api.customProfiles.session")}
        onCheckedChange={(value) => {
          props.clearTestState();
          props.setApiSessionHeaderEnabled?.(value);
        }}
      />
      {props.apiSessionHeaderEnabled && (
        <label>
          {t("settings.api.customProfiles.header")}
          <Input
            value={props.apiSessionHeaderName ?? ""}
            disabled={props.controlsBusy}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              props.clearTestState();
              props.setApiSessionHeaderName?.(event.target.value);
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert">{t("settings.api.customProfiles.invalidHeader")}</p>
      )}
      <p className="settings-note">
        {t("settings.api.customProfiles.client")}:{" "}
        {effectiveUserAgent(props.apiCustomHeadersJson, version)}
      </p>
    </div>
  );
}

function effectiveUserAgent(json: string, version: string): string {
  try {
    const headers = JSON.parse(json || "{}");
    const entry = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "user-agent",
    );
    if (entry) return String(entry[1]);
  } catch (_error) {
    // error-policy-allow: invalid JSON is displayed by the existing advanced field validation.
  }
  return `CarrotMangaTranslator/${version || "…"}`;
}
