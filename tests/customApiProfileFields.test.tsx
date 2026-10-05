/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { initializeAppI18n } from "../src/renderer/src/appI18n";
import { AppI18nProvider } from "../src/renderer/src/i18n";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";
import { ApiSettingsFields } from "../src/renderer/src/components/settingsModal/ApiSettingsFields";
import { useSettingsFormState } from "../src/renderer/src/components/settingsModal/useSettingsFormState";
import { useSettingsModelTest } from "../src/renderer/src/components/settingsModal/useSettingsModelTest";
import { chooseCustomSelectOption } from "./testUtils/customSelect";
import type { ModelTestResult } from "../src/shared/jobTypes";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
beforeEach(async () => {
  await initializeAppI18n("en");
  window.mangaApi = createTestMangaGatewayStub({
    getAppUpdateInfo: async () => ({
      currentVersion: "3.1.1",
      releasesUrl: "https://example.com",
      buildChannel: "stable",
    }),
    onUiLocaleChanged: () => () => undefined,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = resolveDefaultAppSettings({});
settings.modelProvider = "openai-api";
settings.api.provider = "custom";
const clear = vi.fn();
function Harness() {
  const form = useSettingsFormState(settings);
  const props = {
    ...form.values,
    ...form.setters,
    submit: () => undefined,
    controlsBusy: false,
    clearTestState: clear,
  };
  return (
    <AppI18nProvider>
      <ApiSettingsFields {...props} />
    </AppI18nProvider>
  );
}

describe("custom API profile settings UI", () => {
  it("offers Go through quick setup without named profile controls", async () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Add profile" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Profile name" })).toBeNull();
    chooseCustomSelectOption("Quick API provider setup", "OpenCode GO");
    expect(
      screen.getByDisplayValue("https://opencode.ai/zen/go/v1"),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("deepseek-v4.1-flash")).toBeTruthy();
    expect(
      screen.getByDisplayValue('{"response_format":{"type":"json_object"}}'),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("x-opencode-session")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /load models/i })).toBeNull();
    chooseCustomSelectOption("Quick API provider setup", "Custom");
    expect(screen.queryByDisplayValue("x-opencode-session")).toBeNull();
    chooseCustomSelectOption("Quick API provider setup", "OpenCode GO");
    expect(screen.getByDisplayValue("x-opencode-session")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/CarrotMangaTranslator\/3.1.1/)).toBeTruthy(),
    );
    expect(clear).toHaveBeenCalled();
  });

  it("shows invalid session header feedback", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Send a conversation session header",
      }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Session header name" }),
      { target: { value: "Authorization" } },
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("ignores a connection test result that arrives after changing profiles", async () => {
    let finish: (value: ModelTestResult) => void = () => undefined;
    window.mangaApi = createTestMangaGatewayStub({
      testModelSettings: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      onModelTestEvent: () => () => undefined,
    });
    const setTestState = vi.fn();
    const appendTestLogLine = vi.fn();
    const hook = renderHook(
      ({ identity }) =>
        useSettingsModelTest({
          buildSettings: () => settings,
          canSubmit: true,
          jobActive: false,
          modelProvider: "openai-api",
          setTestState,
          appendTestLogLine,
          connectionIdentity: identity,
        }),
      { initialProps: { identity: "first" } },
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = hook.result.current();
    });
    hook.rerender({ identity: "second" });
    setTestState.mockClear();
    appendTestLogLine.mockClear();
    await act(async () => {
      finish({
        ok: true,
        message: "old profile success",
        launchMode: "openai-api",
      });
      await pending;
    });
    expect(setTestState).not.toHaveBeenCalled();
    expect(appendTestLogLine).not.toHaveBeenCalled();
  });
});
