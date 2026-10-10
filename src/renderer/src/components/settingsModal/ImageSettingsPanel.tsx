import { InpaintingSettingsSection } from "./HardwareSettingsPanel";
import { ImageRedactionSettings } from "../ImageRedactionSettings";
import type React from "react";
import { useTranslation } from "react-i18next";
import { CodexSettingsFields } from "./CodexSettingsFields";
import type { EngineSettingsPanelProps } from "./EngineSettingsPanelTypes";
import type { HardwareSettingsPanelProps } from "./hardwareSettingsTypes";
import { InpaintingModelSettings } from "./InpaintingModelSettings";
import { SettingsSection } from "./SettingsSection";
import { ClaudeSettingsFields } from "./ClaudeSettingsFields";
import { Select } from "../ui/Select";

export function ImageSettingsPanel({
  engine,
  hardware,
}: {
  engine: EngineSettingsPanelProps;
  hardware: HardwareSettingsPanelProps;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <div className="settings-panel-stack">
      <SettingsSection title={t("settings.image.localErasure")}>
        <InpaintingModelSettings {...hardware} />
        <InpaintingSettingsSection {...hardware} />
      </SettingsSection>
      <SettingsSection title={t("settings.image.codex")}>
        <CodexSettingsFields {...engine} imageOnly />
      </SettingsSection>
      <SettingsSection title={t("settings.image.review")}>
        <Select
          ariaLabel={t("settings.image.review")}
          value={engine.imageReview?.provider ?? "codex"}
          disabled={engine.controlsBusy}
          options={[
            { value: "codex", label: "Codex" },
            { value: "claude", label: "Claude Code" },
          ]}
          onValueChange={(value) =>
            engine.setImageReview?.((old) => ({
              ...old,
              provider: value === "claude" ? "claude" : "codex",
            }))
          }
        />
        {engine.imageReview?.provider === "claude" && (
          <ClaudeSettingsFields
            model={engine.imageReview.claude.model}
            effort={engine.imageReview.claude.effort}
            disabled={engine.controlsBusy}
            onModel={(model) =>
              engine.setImageReview?.((old) => ({
                ...old,
                claude: { ...old.claude, model },
              }))
            }
            onEffort={(effort) =>
              engine.setImageReview?.((old) => ({
                ...old,
                claude: { ...old.claude, effort },
              }))
            }
          />
        )}
      </SettingsSection>
      <ImageRedactionSettings />
    </div>
  );
}
