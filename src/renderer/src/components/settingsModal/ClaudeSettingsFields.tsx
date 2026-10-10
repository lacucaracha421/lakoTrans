import React from "react";
import { useTranslation } from "react-i18next";
import type { ClaudeEffort } from "../../../../shared/claudeTypes";
import { claudeConnection } from "../../api/claudeConnection";
import { claudeGateway } from "../../api/claudeGateway";
import { useAccountConnection } from "../../hooks/useAccountConnection";
import { Field } from "../ui/Field";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

type Props = {
  model: string;
  effort: ClaudeEffort;
  disabled?: boolean;
} & (
  | { accountOnly: true }
  | {
      accountOnly?: false;
      onModel: (value: string) => void;
      onEffort: (value: ClaudeEffort) => void;
    }
);
export function ClaudeSettingsFields(props: Props) {
  const { t } = useTranslation("components");
  const { account } = useAccountConnection(claudeConnection, true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (
    action: "refresh" | "subscription" | "console" | "logout",
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (action === "refresh") await claudeConnection.refresh();
      else
        claudeConnection.publish(
          await (action === "logout"
            ? claudeGateway.logoutClaudeAccount()
            : claudeGateway.loginClaudeAccount(action)),
        );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t("settings.claude.error"),
      );
    } finally {
      setBusy(false);
    }
  };
  const disabled = props.disabled || busy;
  return (
    <>
      <Field as="div" label={t("settings.claude.account")}>
        <span>
          {account?.authenticated
            ? [account.email, account.plan].filter(Boolean).join(" · ")
            : t("chat.claudeLoginHint")}
        </span>
        <div className="settings-inline-actions">
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              void run(account?.authenticated ? "logout" : "subscription")
            }
          >
            {t(
              account?.authenticated
                ? "settings.claude.logout"
                : "settings.claude.login",
            )}
          </Button>
          {!account?.authenticated && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void run("console")}
            >
              {t("settings.claude.console")}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => void run("refresh")}
          >
            {t("settings.claude.refresh")}
          </Button>
        </div>
      </Field>
      {error && <p role="alert">{error}</p>}
      {!props.accountOnly && (
        <ClaudeModelFields {...props} account={account} disabled={disabled} />
      )}
    </>
  );
}

function ClaudeModelFields(
  props: Extract<Props, { accountOnly?: false }> & {
    account: import("../../../../shared/claudeTypes").ClaudeAccount | null;
  },
) {
  const { t } = useTranslation("components");
  const { account, disabled } = props;
  const selected = account?.models.find((model) => model.id === props.model);
  return (
    <>
      <Field as="div" label={t("settings.claude.model")}>
        <Select
          ariaLabel={t("settings.claude.model")}
          value={props.model}
          disabled={disabled || !account?.authenticated}
          options={
            account?.models.length
              ? account.models.map((model) => ({
                  value: model.id,
                  label: model.displayName,
                }))
              : [{ value: props.model, label: props.model }]
          }
          onValueChange={(value) => {
            props.onModel(value);
            const next = account?.models.find((model) => model.id === value);
            if (
              next?.supportedReasoningEfforts.length &&
              !next.supportedReasoningEfforts.includes(props.effort)
            )
              props.onEffort(next.defaultReasoningEffort);
          }}
        />
      </Field>
      {Boolean(selected?.supportedReasoningEfforts.length) && (
        <Field as="div" label={t("settings.claude.effort")}>
          <Select
            ariaLabel={t("settings.claude.effort")}
            value={props.effort}
            disabled={disabled}
            options={(selected?.supportedReasoningEfforts ?? []).map(
              (value) => ({
                value,
                label: t(`settings.options.reasoning.${value}.label`, {
                  defaultValue: value,
                }),
              }),
            )}
            onValueChange={(value) => {
              const effort = selected?.supportedReasoningEfforts.find(
                (entry) => entry === value,
              );
              if (effort) props.onEffort(effort);
            }}
          />
        </Field>
      )}
    </>
  );
}
