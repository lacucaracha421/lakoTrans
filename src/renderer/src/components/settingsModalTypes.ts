export type SettingsTabId =
  "mcp" | "general" | "engine" | "format" | "results" | "shortcuts" | "test";

export type TestState =
  | {
      status: "idle";
      message: null;
      detail: null;
    }
  | {
      status: "running" | "success" | "error";
      message: string;
      detail: string | null;
    };
