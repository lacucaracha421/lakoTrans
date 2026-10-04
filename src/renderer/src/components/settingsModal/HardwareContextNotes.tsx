import React from "react";
import { useTranslation } from "react-i18next";

export function FluxHardwareContextNote({
  usesAppleHardware,
}: {
  usesAppleHardware: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation("components");
  if (usesAppleHardware) {
    return (
      <p className="muted-line modal-note">
        {t("settings.hardware.fluxAppleNote")}
      </p>
    );
  }
  return null;
}
