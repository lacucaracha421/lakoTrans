import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ChatRepository } from "../src/main/chat/chatRepository";
import { ChatService } from "../src/main/application/chatService";
import { chatFixture, chatRequest, endChatTurn } from "./helpers/chatFixture";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.cwd() },
}));

describe("global chat durable execution", () => {
  it("cancels a late app receipt after stop without recursively cancelling status reads", async () => {
    const f = await chatFixture();
    try {
      await f.service.send(chatRequest(f.session.id));
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledOnce());
      await f.service.stop(f.session.id);
      f.events().notification({ method: "turn/started", params: {} });
      f.events().notification({
        method: "thread/compacted",
        params: { continuesTurn: true },
      });
      expect((await f.service.read(f.session.id)).state).toBe("paused");
      await f.observe({
        name: "carrot_run_page_erasure",
        args: {},
        content: [
          {
            type: "text",
            text: '{"jobId":"owned-late-job","status":"running"}',
          },
        ],
      });
      expect(f.cancelOperations).toHaveBeenCalledTimes(2);
      await f.observe({
        name: "carrot_get_job",
        args: {},
        content: [
          {
            type: "text",
            text: '{"jobId":"owned-late-job","status":"cancelled"}',
          },
        ],
      });
      expect(f.cancelOperations).toHaveBeenCalledTimes(2);
    } finally {
      await f.cleanup();
    }
  });

  it("keeps automatic compaction running and binds native results to the matching tool arguments", async () => {
    const f = await chatFixture();
    try {
      await f.service.send(chatRequest(f.session.id));
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledOnce());
      f.events().notification({
        method: "thread/compacted",
        params: { continuesTurn: true },
      });
      expect((await f.service.read(f.session.id)).state).toBe("running");
      for (const id of ["first", "second"])
        f.events().notification({
          method: "item/started",
          params: {
            item: {
              type: "mcpToolCall",
              id,
              tool: "carrot_get_page_blocks",
              arguments: { id },
            },
          },
        });
      await f.observe({
        name: "carrot_get_page_blocks",
        args: { id: "second" },
        content: [{ type: "text", text: "second result" }],
      });
      await f.observe({
        name: "carrot_get_page_blocks",
        args: { id: "first" },
        content: [{ type: "text", text: "first result" }],
      });
      const items = (await f.service.read(f.session.id)).items.filter(
        (item) => item.role === "tool",
      );
      expect(items).toHaveLength(2);
      expect(items.map((item) => [item.id, item.text])).toEqual([
        ["first", "first result"],
        ["second", "second result"],
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("keeps both works in one native conversation and deduplicates concurrent delivery", async () => {
    const f = await chatFixture();
    try {
      const first = chatRequest(f.session.id);
      const second = chatRequest(f.session.id, "현재 화도 확인해줘");
      await Promise.all([f.service.send(first), f.service.send(first)]);
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledTimes(1));
      await f.service.send(second);
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledTimes(2));
      const snapshot = await f.service.read(f.session.id);
      expect(snapshot.items.map((item) => item.context?.workId)).toEqual([
        first.context.workId,
        second.context.workId,
      ]);
      expect(f.connect).toHaveBeenCalledTimes(1);
      expect(f.runtime.send.mock.calls[0]).toEqual(
        expect.arrayContaining([first.messageId]),
      );
      expect(JSON.stringify(f.runtime.send.mock.calls[0])).toContain(
        first.context.chapterId,
      );
      expect(snapshot.nativeThreadId).toBe("native-persistent-thread");
      expect(await readdir(f.root)).toEqual(["chat"]);
    } finally {
      await f.cleanup();
    }
  });

  it("does not deliver a cancelled request after a delayed connection, even if another message arrives", async () => {
    let release!: () => void;
    const preparing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await chatFixture(async () => {
      await preparing;
      return "native-persistent-thread";
    });
    try {
      const cancelled = chatRequest(f.session.id);
      await f.service.send(cancelled);
      await vi.waitFor(() => expect(f.runtime.prepare).toHaveBeenCalled());
      await f.service.stop(f.session.id);
      const continued = chatRequest(f.session.id, "계속");
      await f.service.send(continued);
      release();
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledTimes(1));
      expect(f.runtime.send.mock.calls[0]?.[0]).toBe(continued.messageId);
    } finally {
      release();
      await f.cleanup();
    }
  });

  it("preserves visible messages through actual runtime compaction events without claiming translation quality", async () => {
    const f = await chatFixture();
    try {
      await f.service.send(chatRequest(f.session.id));
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledOnce());
      endChatTurn(f.events());
      await f.service.compact(f.session.id);
      expect(f.runtime.compact).toHaveBeenCalledOnce();
      f.events().notification({
        method: "item/started",
        params: { item: { type: "contextCompaction", id: "compact-1" } },
      });
      f.events().notification({
        method: "item/completed",
        params: { item: { type: "contextCompaction", id: "compact-1" } },
      });
      endChatTurn(f.events());
      await vi.waitFor(async () =>
        expect((await f.repository.read(f.session.id)).state).toBe("idle"),
      );
      const saved = await f.repository.read(f.session.id);
      expect(saved.items[0]?.text).toBe("이 화 번역해줘");
      expect(saved.items.some((item) => item.id === "compact-1")).toBe(true);
      expect(saved.checkpoint).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it("reconnects a dead runtime to its saved thread and restarts only on a user message", async () => {
    const f = await chatFixture();
    try {
      await f.service.send(chatRequest(f.session.id));
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledOnce());
      f.events().failed(new Error("network disconnected"));
      await vi.waitFor(() => expect(f.runtime.close).toHaveBeenCalledOnce());
      expect((await f.service.read(f.session.id)).state).toBe("failed");
      expect(f.connect).toHaveBeenCalledOnce();
      await f.service.send(chatRequest(f.session.id, "계속"));
      await vi.waitFor(() => expect(f.connect).toHaveBeenCalledTimes(2));
      expect(f.connect.mock.calls[1]?.[0].nativeThreadId).toBe(
        "native-persistent-thread",
      );
    } finally {
      await f.cleanup();
    }
  });

  it("restores interrupted chats and their attachments outside the library without executing anything", async () => {
    const f = await chatFixture();
    try {
      const image = await f.service.attachImage(
        f.session.id,
        "reference.png",
        "data:image/png;base64,aGVsbG8=",
      );
      const request = chatRequest(f.session.id);
      request.imageIds.push(image.id);
      await f.service.send(request);
      await vi.waitFor(() => expect(f.runtime.send).toHaveBeenCalledOnce());
      const repository = new ChatRepository(f.root);
      const restored = new ChatService({
        repository,
        runtime: f.connect,
        publish: vi.fn(),
        reportError: f.errors,
      });
      const snapshot = await restored.read(f.session.id);
      expect(snapshot.state).toBe("paused");
      expect((await restored.image(snapshot.id, image.id)).dataUrl).toBe(
        image.dataUrl,
      );
      expect(f.connect).toHaveBeenCalledOnce();
      await expect(restored.read("../library")).rejects.toThrow();
      await expect(
        restored.image(snapshot.id, "../reference"),
      ).rejects.toThrow();
      expect(
        await readFile(join(f.root, "chat", `${snapshot.id}.json`), "utf8"),
      ).not.toContain("CARROT_CHAT_MCP_TOKEN");
      await restored.dispose();
    } finally {
      await f.cleanup();
    }
  });
});
