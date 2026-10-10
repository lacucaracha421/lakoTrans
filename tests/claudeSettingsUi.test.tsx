/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { initializeAppI18n } from "../src/renderer/src/appI18n";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";
import { claudeConnection } from "../src/renderer/src/api/claudeConnection";
import { useSettingsFormState } from "../src/renderer/src/components/settingsModal/useSettingsFormState";
import { useSettingsModalController } from "../src/renderer/src/components/settingsModal/useSettingsModalController";
import { ImageSettingsPanel } from "../src/renderer/src/components/settingsModal/ImageSettingsPanel";
import { StyleGuideResearchSetupContent } from "../src/renderer/src/components/styleGuide/StyleGuideResearchSetupContent";
import { useStyleGuideResearchSetup } from "../src/renderer/src/components/styleGuide/useStyleGuideResearchSetup";
import { chooseCustomSelectOption } from "./testUtils/customSelect";
import type { ClaudeAccount } from "../src/shared/claudeTypes";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
const account: ClaudeAccount = {
  authenticated: true,
  email: null,
  plan: "max",
  version: "test",
  models: [
    {
      id: "default",
      displayName: "Recommended",
      supportedReasoningEfforts: ["high"],
      defaultReasoningEffort: "high",
      isDefault: true,
    },
    {
      id: "sonnet",
      displayName: "Sonnet",
      supportedReasoningEfforts: ["high", "max"],
      defaultReasoningEffort: "high",
      isDefault: false,
    },
  ],
};
beforeEach(async () => {
  await initializeAppI18n("ko");
  window.mangaApi = createTestMangaGatewayStub({
    getClaudeAccount: async () => account,
    getCodexAccount: async () => ({
      authenticated: false,
      accountKind: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
      appServerVersion: "test",
      models: [],
    }),
  });
  claudeConnection.publish(account);
});
afterEach(cleanup);

it("restores independent generation limits when switching to Claude and back", () => {
  const defaults = resolveDefaultAppSettings({});
  const { result } = renderHook(() => useSettingsFormState(defaults));
  const original = result.current.values.maxTokens;
  act(() => result.current.setters.setModelProvider("claude-code"));
  act(() => result.current.setters.setMaxTokens("12000"));
  act(() => result.current.setters.setModelProvider("openai-codex"));
  expect(result.current.values.maxTokens).toBe(original);
  act(() => result.current.setters.setModelProvider("claude-code"));
  expect(result.current.values.maxTokens).toBe("12000");
});

it("selects Claude only for image reading and preserves Codex image generation", async () => {
  const initial = resolveDefaultAppSettings({});
  let current: ReturnType<typeof useSettingsModalController> | undefined;
  const controller = () => {
    if (!current) throw new Error("Not mounted");
    return current;
  };
  function Harness() {
    current = useSettingsModalController({
      initialSettings: initial,
      busy: false,
      jobActive: false,
      onCancel: vi.fn(),
      onOpenErrorReport: vi.fn(),
      onOpenLogFolder: vi.fn(),
      onReset: async () => null,
      onSubmit: vi.fn(),
    });
    return (
      <ImageSettingsPanel
        engine={current.enginePanelProps}
        hardware={current.hardwarePanelProps}
      />
    );
  }
  const view = render(<Harness />);
  const original = controller().enginePanelProps.codexImageGenerationModel;
  const label = "이미지 검수";
  expect(label).toBeTruthy();
  chooseCustomSelectOption(label, "Claude Code");
  await screen.findByRole("combobox", { name: /^모델$/ });
  chooseCustomSelectOption(/^모델$/, "Sonnet");
  chooseCustomSelectOption("추론 수준", "최대");
  expect(controller().enginePanelProps.imageReview).toEqual({
    provider: "claude",
    claude: { model: "sonnet", effort: "max" },
  });
  chooseCustomSelectOption(label, "Codex");
  expect(controller().enginePanelProps.codexImageGenerationModel).toBe(
    original,
  );
  expect(screen.queryByRole("combobox", { name: /^모델$/ })).toBeNull();
  view.rerender(
    <ImageSettingsPanel
      engine={{ ...controller().enginePanelProps, imageReview: undefined }}
      hardware={controller().hardwarePanelProps}
    />,
  );
  expect(screen.getByRole("combobox", { name: label }).textContent).toContain(
    "Codex",
  );
});

it("enables Claude web research after native account connection without modifying translation settings", async () => {
  const saveTitle = vi.fn(async (title: string) => title);
  const onStart = vi.fn(async () => {});
  const settings = resolveDefaultAppSettings({});
  const onSaveSettings = vi.fn(async () => settings);
  const { result } = renderHook(() =>
    useStyleGuideResearchSetup({
      engine: "claude-web",
      initialTitle: "작품",
      settings,
      onDismiss: vi.fn(),
      onSaveSettings,
      onSaveTitle: saveTitle,
      onStart,
    }),
  );
  await waitFor(() => expect(result.current.canStart).toBe(true));
  render(
    <StyleGuideResearchSetupContent
      controller={result.current}
      engine="claude-web"
    />,
  );
  expect(screen.getByText("Claude Code")).toBeTruthy();
  await act(() => result.current.startResearch());
  expect(saveTitle).toHaveBeenCalledWith("작품");
  expect(onStart).toHaveBeenCalledWith("작품");
  expect(onSaveSettings).not.toHaveBeenCalled();
});
