import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";
import { Select } from "../ui/Select";
import { CheckboxField } from "../ui/CheckboxField";
import { settingsGateway } from "../../api/settingsGateway";
import { apiSessionHeaderError } from "../../../../shared/apiSessionHeaders";
import type { EngineSettingsPanelProps } from "./EngineSettingsPanelTypes";
type ApiSettingsFieldsProps = Pick<
  EngineSettingsPanelProps,
  | "apiProvider"
  | "customApiProfiles"
  | "activeCustomProfileId"
  | "setActiveCustomProfileId"
  | "updateCustomApiProfiles"
  | "apiSessionHeaderEnabled"
  | "apiSessionHeaderName"
  | "setApiSessionHeaderEnabled"
  | "setApiSessionHeaderName"
  | "apiCustomHeadersJson"
  | "clearTestState"
  | "controlsBusy"
>;
import {
  createDefaultApiProfileFormValues,
  createDefaultGenerationLimitFormValues,
} from "./settingsModalProfileFormValues";
import {
  selectCustomApiProfile,
  snapshotCustomApiProfiles,
} from "./settingsCustomApiProfiles";

export function CustomApiProfileFields(props: ApiSettingsFieldsProps) {
  const { t } = useTranslation("components");
  if (props.apiProvider !== "custom" || !props.customApiProfiles) return null;
  const entries = Object.entries(props.customApiProfiles);
  const active = props.customApiProfiles[props.activeCustomProfileId ?? ""];
  const { add, remove } = customProfileActions(
    props,
    t("settings.api.customProfiles.newName"),
  );
  return (
    <div className="settings-subsection-stack">
      <label>
        {t("settings.api.customProfiles.select")}
        <Select
          ariaLabel={t("settings.api.customProfiles.select")}
          value={props.activeCustomProfileId ?? ""}
          disabled={props.controlsBusy}
          options={entries.map(([value, profile]) => ({
            value,
            label: profile.name,
          }))}
          onValueChange={(id) => {
            props.clearTestState();
            props.setActiveCustomProfileId?.(id);
          }}
        />
      </label>
      <label>
        {t("settings.api.customProfiles.name")}
        <Input
          value={active?.name ?? ""}
          maxLength={80}
          disabled={props.controlsBusy}
          onChange={(event) => {
            const name = event.target.value;
            props.updateCustomApiProfiles?.((current) => ({
              ...current,
              customApiProfiles: {
                ...current.customApiProfiles,
                [current.activeCustomProfileId]: {
                  ...current.customApiProfiles[current.activeCustomProfileId],
                  name,
                },
              },
            }));
          }}
        />
      </label>
      <div className="settings-inline-actions">
        <Button
          type="button"
          size="sm"
          disabled={props.controlsBusy}
          onClick={add}
        >
          {t("settings.api.customProfiles.add")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={props.controlsBusy || entries.length <= 1}
          onClick={remove}
        >
          {t("settings.api.customProfiles.delete")}
        </Button>
      </div>
    </div>
  );
}

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

function customProfileActions(props: ApiSettingsFieldsProps, newName: string) {
  const add = () => {
    props.clearTestState();
    props.updateCustomApiProfiles?.((current) => {
      const id = crypto.randomUUID();
      return selectCustomApiProfile(
        {
          ...current,
          customApiProfiles: {
            ...snapshotCustomApiProfiles(current),
            [id]: {
              name: newName,
              values: createDefaultApiProfileFormValues("custom"),
              limits: createDefaultGenerationLimitFormValues("openai-api"),
            },
          },
        },
        id,
      );
    });
  };
  const remove = () => {
    props.clearTestState();
    props.updateCustomApiProfiles?.((current) => {
      const profiles = snapshotCustomApiProfiles(current);
      delete profiles[current.activeCustomProfileId];
      const id = Object.keys(profiles)[0];
      return id
        ? selectCustomApiProfile(
            {
              ...current,
              customApiProfiles: profiles,
              activeCustomProfileId: "",
            },
            id,
          )
        : current;
    });
  };
  return { add, remove };
}
