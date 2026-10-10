import { describe, expect, it, vi } from "vitest";
import { ActiveJobStore } from "../src/main/jobs/activeJob";
import { createJobEventEmitter } from "../src/main/jobs/jobEvents";

describe("MCP job origin", () => {
  it("stamps the MCP origin on every event of an MCP-owned job", () => {
    const emit = createJobEventEmitter({
      validateEvent: vi.fn(),
      writeLog: vi.fn(),
    });
    const jobs = new ActiveJobStore();
    jobs.start({
      id: "mcp-job",
      kind: "mcp-edit",
      abortController: new AbortController(),
      origin: "mcp",
    });
    const userJobs = new ActiveJobStore();
    userJobs.start({
      id: "user-job",
      kind: "page-export",
      abortController: new AbortController(),
    });
    const send = vi.fn();
    const window = { webContents: { send } };
    emit(jobs, window, {
      id: "mcp-job",
      kind: "mcp-edit",
      status: "completed",
      progressText: "done",
    });
    emit(userJobs, window, {
      id: "user-job",
      kind: "page-export",
      status: "completed",
      progressText: "done",
    });
    expect(send.mock.calls[0]?.[1]).toMatchObject({ origin: "mcp" });
    expect(jobs.get("mcp-job")?.lastEvent).toMatchObject({ origin: "mcp" });
    expect(send.mock.calls[1]?.[1]).not.toHaveProperty("origin");
  });
});
