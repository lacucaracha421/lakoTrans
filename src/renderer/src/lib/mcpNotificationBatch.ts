import type { ChatSession } from "../../../shared/chatTypes";
import { isTerminalJobStatus } from "../../../shared/jobContracts";
import type { JobEvent } from "../../../shared/jobTypes";
import { appI18n } from "../appI18n";
import { toast } from "./toastStore";

/**
 * MCP work (an external client or the built-in chat) runs as many short app
 * jobs. Their completion toasts are held here and replaced by one summary once
 * every MCP job and chat turn has settled.
 */
const QUIET_MS = 2500;
const CHAT_BUSY: readonly ChatSession["state"][] = ["running", "compacting"];

type ChatEnd = Exclude<ChatSession["state"], "running" | "compacting">;

const mcpJobIds = new Set<string>();
const activeJobs = new Set<string>();
const busyChats = new Set<string>();
const counted = new Set<string>();
let finished = 0;
let failed = 0;
let chatEnd: ChatEnd | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function isMcpJob(id: string): boolean {
  return mcpJobIds.has(id);
}

/** Records an MCP job event; returns whether it belongs to the batch. */
export function noteMcpJobEvent(event: JobEvent): boolean {
  if (event.origin !== "mcp") return false;
  mcpJobIds.add(event.id);
  if (!isTerminalJobStatus(event.status)) {
    activeJobs.add(event.id);
    cancelFlush();
    return true;
  }
  activeJobs.delete(event.id);
  if (!counted.has(event.id)) {
    counted.add(event.id);
    finished++;
    if (event.status === "failed" || event.status === "partial") failed++;
  }
  scheduleFlush();
  return true;
}

export function noteChatState(
  sessionId: string,
  state: ChatSession["state"],
): void {
  if (CHAT_BUSY.includes(state)) {
    busyChats.add(sessionId);
    cancelFlush();
    return;
  }
  if (!busyChats.delete(sessionId)) return;
  chatEnd = state as ChatEnd;
  scheduleFlush();
}

function cancelFlush(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function scheduleFlush(): void {
  cancelFlush();
  if (activeJobs.size || busyChats.size) return;
  if (!finished && !chatEnd) return;
  timer = setTimeout(flush, QUIET_MS);
}

const CHAT_END_MESSAGES = {
  idle: "job.notifications.chat.idle",
  failed: "job.notifications.chat.failed",
  "needs-input": "job.notifications.chat.needs-input",
  paused: "job.notifications.chat.paused",
} as const satisfies Record<ChatEnd, string>;

function flush(): void {
  timer = undefined;
  const summary = chatEnd
    ? appI18n.t(CHAT_END_MESSAGES[chatEnd], { ns: "renderer" })
    : appI18n.t("job.notifications.mcpCompleted", {
        ns: "renderer",
        count: finished,
      });
  const message = failed
    ? `${summary} · ${appI18n.t("job.notifications.mcpFailed", {
        ns: "renderer",
        count: failed,
      })}`
    : summary;
  if (failed || chatEnd === "failed") toast.error(message);
  else if (chatEnd === "needs-input" || chatEnd === "paused")
    toast.info(message);
  else toast.success(message);
  finished = 0;
  failed = 0;
  chatEnd = null;
  counted.clear();
}

/** Test seam: forget every pending batch. */
export function resetMcpNotificationBatch(): void {
  cancelFlush();
  mcpJobIds.clear();
  activeJobs.clear();
  busyChats.clear();
  counted.clear();
  finished = 0;
  failed = 0;
  chatEnd = null;
}
