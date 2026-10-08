import type { McpPreferences } from "../../shared/mcpDesktopTypes";
import { createMcpFontSamplesTool } from "./mcpFontSamplesTool";
import { renderMcpFontSamples } from "./mcpFontSamplesAdapter";
import { readMcpFontCatalog } from "./mcpFontCatalogAdapter";
import { readMcpCompositeFontEnvironment } from "./mcpCompositeNativeFonts";
import { saveMcpQualityEvidence } from "./mcpQualityEvidenceStore";
import { createMcpTranslationSourceTool } from "./mcpTranslationSourceTool";
import { createMcpWorkTypographyTools } from "./mcpWorkTypographyTools";
import { createMcpSoundEffectCandidateTools } from "./mcpSoundEffectCandidateTools";

/** Compose quality tools under the same connection permissions as the native edit tools. */
export function createMcpQualityTools(
  preferences: Pick<McpPreferences, "allowEditing" | "allowImages">,
) {
  const tools = createMcpWorkTypographyTools(preferences.allowEditing);
  if (preferences.allowImages)
    tools.push(
      createMcpFontSamplesTool({
        catalog: readMcpFontCatalog,
        render: renderMcpFontSamples,
        fontFingerprint: readMcpCompositeFontEnvironment,
        saveEvidence: saveMcpQualityEvidence,
      }),
      createMcpTranslationSourceTool(),
      ...createMcpSoundEffectCandidateTools(preferences.allowEditing),
    );
  return tools;
}
