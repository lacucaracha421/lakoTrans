import { ClaudeSettingsFields } from "../settingsModal/ClaudeSettingsFields";
import React from "react";
import { useTranslation } from "react-i18next";
import type { ResearchEngine } from "../../../../shared/internetResearchTypes";
import { CodexAccountField } from "../settingsModal/CodexAccountField";
import { TavilyAccessFields } from "../settingsModal/TavilyAccessFields";
import { TextField } from "../ui/Field";
import type { StyleGuideResearchSetupController } from "./useStyleGuideResearchSetup";

export function StyleGuideResearchSetupContent({
  controller,
  engine,
}: {
  controller: StyleGuideResearchSetupController;
  engine: ResearchEngine;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <>
      <TextField
        density="comfortable"
        label={t("styleGuide.research.titleLabel")}
        value={controller.title}
        maxLength={240}
        autoFocus
        disabled={controller.busy}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => controller.setTitle(event.target.value)}
      />
      <ResearchServiceIntro engine={engine} />
      {engine === "tavily" ? (
        <TavilyAccessFields
          apiKey={controller.tavilyApiKey}
          maxCreditsPerRun={controller.tavilyMaxCredits}
          controlsBusy={controller.busy}
          setApiKey={controller.setTavilyApiKey}
          setMaxCreditsPerRun={controller.setTavilyMaxCredits}
        />
      ) : engine === "claude-web" ? (
        <ClaudeSettingsFields
          model="default"
          effort="high"
          disabled={controller.busy}
          accountOnly
        />
      ) : (
        <CodexAccountField
          controlsBusy={controller.busy}
          onSnapshotChange={controller.setCodexAccount}
        />
      )}
      {controller.error ? (
        <p className="style-guide-research-setup-error" role="alert">
          {controller.error}
        </p>
      ) : null}
    </>
  );
}

function ResearchServiceIntro({
  engine,
}: {
  engine: ResearchEngine;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <div className="style-guide-research-service-intro">
      <strong>
        {t(
          engine === "claude-web"
            ? "settings.options.providers.claude.label"
            : engine === "tavily"
              ? "styleGuide.analysis.engines.tavily"
              : "styleGuide.analysis.engines.codex",
        )}
      </strong>
      <span>
        {t(
          engine === "claude-web"
            ? "settings.research.claude.description"
            : engine === "tavily"
              ? "settings.research.tavily.description"
              : "settings.research.codex.description",
        )}
      </span>
    </div>
  );
}
