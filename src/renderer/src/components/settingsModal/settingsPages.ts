import type { SettingsTabId } from "../settingsModalTypes";

export type LlmSettingsTab =
  "translation" | "ocr" | "image" | "research" | "hardware";

type SettingsPageId = Exclude<SettingsTabId, "engine"> | LlmSettingsTab;

const LLM_PAGES: readonly LlmSettingsTab[] = [
  "translation",
  "ocr",
  "image",
  "research",
  "hardware",
];

/** One flat, grouped list: every settings page is a single click away. */
export const SETTINGS_PAGES: readonly {
  page: SettingsPageId;
  group: "basics" | "ai" | "output" | "about";
  labelKey: string;
}[] = [
  { page: "general", group: "basics", labelKey: "settings.tabs.general" },
  { page: "format", group: "basics", labelKey: "settings.tabs.format" },
  { page: "shortcuts", group: "basics", labelKey: "settings.tabs.shortcuts" },
  { page: "translation", group: "ai", labelKey: "settings.tabs.translation" },
  { page: "ocr", group: "ai", labelKey: "settings.hardware.ocrSection" },
  { page: "image", group: "ai", labelKey: "settings.tabs.image" },
  { page: "research", group: "ai", labelKey: "settings.tabs.research" },
  { page: "hardware", group: "ai", labelKey: "settings.tabs.hardware" },
  { page: "results", group: "output", labelKey: "settings.tabs.results" },
  { page: "mcp", group: "output", labelKey: "settings.tabs.mcp" },
  { page: "test", group: "about", labelKey: "settings.tabs.test" },
];

export function isLlmPage(page: SettingsPageId): page is LlmSettingsTab {
  return (LLM_PAGES as readonly string[]).includes(page);
}

/** AI pages keep their historical ids so issue reveal can still find them. */
export function settingsPageIds(page: SettingsPageId): {
  tabId: string;
  panelId: string;
} {
  return isLlmPage(page)
    ? {
        tabId: `settings-llm-tab-${page}`,
        panelId: `settings-llm-panel-${page}`,
      }
    : { tabId: `settings-tab-${page}`, panelId: `settings-panel-${page}` };
}

export function currentSettingsPage(
  activeTab: SettingsTabId,
  activeLlmTab: LlmSettingsTab,
): SettingsPageId {
  return activeTab === "engine" ? activeLlmTab : activeTab;
}
