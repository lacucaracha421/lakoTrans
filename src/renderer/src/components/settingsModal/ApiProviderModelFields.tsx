import React from "react";
import { useTranslation } from "react-i18next";
import type { ApiModelOption } from "../../../../shared/apiProviderPresets";
import type {
  ApiProviderConnectionProps,
  ApiProviderConnectionState,
  DiscoveryState,
} from "./useApiProviderConnection";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";

type ModelFieldProps = Pick<
  ApiProviderConnectionProps,
  | "apiModel"
  | "clearTestState"
  | "controlsBusy"
  | "setApiBaseUrl"
  | "setApiModel"
  | "submit"
> & { connection: ApiProviderConnectionState };

export function ApiProviderModelFields({
  apiModel,
  clearTestState,
  connection,
  controlsBusy,
  setApiBaseUrl,
  setApiModel,
  submit,
}: ModelFieldProps): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <>
      {connection.isDiscoverable ? (
        <ModelDiscoveryFields
          apiModel={apiModel}
          clearTestState={clearTestState}
          connection={connection}
          controlsBusy={controlsBusy}
          setApiBaseUrl={setApiBaseUrl}
          setApiModel={setApiModel}
        />
      ) : null}
      <DiscoveryMessage
        discovery={connection.discovery}
        models={connection.models}
        isGo={connection.provider === "opencode-go"}
      />
      <label>
        {t("settings.api.model")}
        <Input
          value={apiModel}
          disabled={controlsBusy || connection.discovery.status === "loading"}
          onChange={(event) => {
            clearTestState();
            setApiModel(event.target.value);
          }}
          placeholder="gpt-5.5"
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </label>
    </>
  );
}

function ModelDiscoveryFields({
  apiModel,
  clearTestState,
  connection,
  controlsBusy,
  setApiBaseUrl,
  setApiModel,
}: Omit<ModelFieldProps, "submit">): React.JSX.Element {
  const { t } = useTranslation("components");
  const label = t(
    connection.provider === "opencode-go"
      ? "settings.api.availableModel"
      : "settings.api.discoveredModel",
  );
  const selected = connection.models.some((model) => model.id === apiModel)
    ? apiModel
    : "";
  const selectModel = (modelId: string): void => {
    const model = connection.models.find((item) => item.id === modelId);
    if (!model) return;
    clearTestState();
    setApiBaseUrl(model.baseUrl);
    setApiModel(model.id);
  };
  return (
    <div className="settings-model-discovery-row">
      <label>
        {label}
        <Select
          ariaLabel={label}
          value={selected}
          disabled={
            controlsBusy ||
            connection.discovery.status === "loading" ||
            !connection.models.length
          }
          options={[
            { value: "", label: t("settings.api.chooseModel") },
            ...connection.models.map((model) => ({
              value: model.id,
              label:
                model.label === model.id
                  ? model.id
                  : `${model.label} · ${model.id}`,
              searchText: `${model.label} ${model.id}`,
            })),
          ]}
          searchable="auto"
          onValueChange={selectModel}
        />
      </label>
      <Button
        type="button"
        disabled={
          controlsBusy ||
          connection.discovery.status === "loading" ||
          !connection.vertexReady
        }
        onClick={() => void connection.loadModels()}
        variant="bare"
      >
        {t(
          connection.discovery.status === "loading"
            ? "settings.api.loadingModels"
            : "settings.api.loadModels",
        )}
      </Button>
    </div>
  );
}

function DiscoveryMessage({
  discovery,
  models,
  isGo,
}: {
  discovery: DiscoveryState;
  models: ApiModelOption[];
  isGo: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation("components");
  if (discovery.status === "error") {
    return (
      <p className="settings-api-status error" role="alert">
        {t("settings.api.modelLoadError", { message: discovery.message })}
      </p>
    );
  }
  if (discovery.status !== "success") return null;
  return (
    <p className="settings-api-status" role="status">
      {t(
        isGo ? "settings.api.modelListLoaded" : "settings.api.modelLoadSuccess",
        {
          count: models.length,
          checked: discovery.checkedCount,
          excluded: discovery.unverifiedCount,
        },
      )}
    </p>
  );
}
