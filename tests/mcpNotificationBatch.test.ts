/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useAppSessionLifecycleEffects } from "../src/renderer/src/app/session/useAppSessionLifecycleEffects";
import { initializeAppI18n } from "../src/renderer/src/appI18n";
import {
  isMcpJob,
  noteChatState,
  noteMcpJobEvent,
  resetMcpNotificationBatch,
} from "../src/renderer/src/lib/mcpNotificationBatch";
import { toast } from "../src/renderer/src/lib/toastStore";
import type { JobEvent } from "../src/shared/jobTypes";

const event = (
  id: string,
  status: JobEvent["status"],
  origin: JobEvent["origin"] | null = "mcp",
): JobEvent => ({
  id,
  kind: "mcp-edit",
  status,
  progressText: status,
  ...(origin ? { origin } : {}),
});

beforeAll(() => initializeAppI18n("ko"));
afterEach(() => {
  resetMcpNotificationBatch();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MCP notification batch", () => {
  it("replaces per-job toasts with one summary after all MCP work settles", () => {
    vi.useFakeTimers();
    const success = vi.spyOn(toast, "success").mockReturnValue("id");
    expect(noteMcpJobEvent(event("user", "completed", null))).toBe(false);
    expect(isMcpJob("user")).toBe(false);

    expect(noteMcpJobEvent(event("a", "running"))).toBe(true);
    expect(noteMcpJobEvent(event("b", "running"))).toBe(true);
    noteMcpJobEvent(event("a", "completed"));
    vi.advanceTimersByTime(10_000);
    expect(success).not.toHaveBeenCalled();

    noteMcpJobEvent(event("b", "completed"));
    noteMcpJobEvent(event("b", "completed"));
    vi.advanceTimersByTime(1_000);
    noteMcpJobEvent(event("c", "running"));
    noteMcpJobEvent(event("c", "completed"));
    vi.advanceTimersByTime(10_000);
    expect(success).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith("MCP 작업을 마쳤습니다 (3건)");
    expect(isMcpJob("a")).toBe(true);
  });

  it("waits for the chat turn and reports failures in the same toast", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(toast, "error").mockReturnValue("id");
    const success = vi.spyOn(toast, "success").mockReturnValue("id");
    noteChatState("chat", "idle");
    vi.advanceTimersByTime(10_000);
    expect(success).not.toHaveBeenCalled();

    noteChatState("chat", "running");
    noteMcpJobEvent(event("a", "running"));
    noteMcpJobEvent(event("a", "failed"));
    vi.advanceTimersByTime(10_000);
    expect(error).not.toHaveBeenCalled();

    noteChatState("chat", "idle");
    vi.advanceTimersByTime(10_000);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("채팅 작업을 마쳤습니다 · 실패 1건");
    expect(success).not.toHaveBeenCalled();
  });

  it("tells the reader when a chat stops or waits for an answer", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(toast, "info").mockReturnValue("id");
    noteChatState("chat", "running");
    noteChatState("chat", "needs-input");
    vi.advanceTimersByTime(10_000);
    expect(info).toHaveBeenLastCalledWith("채팅이 답변을 기다리고 있습니다");
    noteChatState("chat", "compacting");
    noteChatState("chat", "paused");
    vi.advanceTimersByTime(10_000);
    expect(info).toHaveBeenLastCalledWith("채팅 작업을 중지했습니다");
  });

  it("keeps an MCP job's own completion and failure out of the toast stack", () => {
    const spies = (["success", "error", "warn", "info"] as const).map(
      (variant) => vi.spyOn(toast, variant).mockReturnValue("id"),
    );
    const onAudibleCompletion = vi.fn();
    noteMcpJobEvent(event("mcp-1", "running"));
    noteMcpJobEvent(event("mcp-2", "running"));
    const { rerender } = renderHook(
      ({ id, status }: { id: string; status: JobEvent["status"] }) =>
        useAppSessionLifecycleEffects({
          currentChapter: null,
          jobState: { id, kind: "mcp-edit", status, progressText: status },
          onAudibleCompletion,
          onJobStart: vi.fn(),
          onPageChange: vi.fn(),
          openErrorReport: vi.fn(),
          refreshLibrary: vi.fn(),
          resetChapterScopedUi: vi.fn(),
          selectedPageId: null,
          setRegionSelection: vi.fn(),
          translationFlowActive: false,
        }),
      { initialProps: { id: "mcp-1", status: "running" } },
    );
    rerender({ id: "mcp-1", status: "completed" });
    rerender({ id: "mcp-2", status: "running" });
    rerender({ id: "mcp-2", status: "failed" });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
