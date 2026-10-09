import { afterEach, expect, it, vi } from "vitest";
import type { ChatSession } from "../src/shared/chatTypes";
import { codexChatProtocolFixture } from "./helpers/codexChatProtocolFixture";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
const session: ChatSession = {
  version: 1,
  id: "6aad5ccf-e5e5-48c6-88d6-f28be7a0d175",
  title: "대화",
  runtime: "codex",
  nativeThreadId: null,
  model: null,
  effort: null,
  state: "idle",
  createdAt: 1,
  updatedAt: 1,
  items: [],
  checkpoint: [],
  question: null,
};
const input = [{ type: "text" as const, text: "이 화 번역해줘" }];
async function fixture(mode?: string) {
  const value = await codexChatProtocolFixture(mode);
  cleanup.push(value.close);
  return value;
}

it("persists and resumes the native thread, steers with IDs, and uses actual compaction RPC", async () => {
  const f = await fixture();
  await f.runtime.prepare({ ...session, nativeThreadId: "persistent" });
  await f.runtime.send("m1", input, "gpt-6.1-sol", "high");
  await f.runtime.send("m2", input, "gpt-6-astra", "medium");
  await f.runtime.stop();
  await f.runtime.compact();
  const audit = await f.audit();
  expect(audit.find((x) => x.method === "thread/resume")?.params).toMatchObject(
    { threadId: "persistent", sandbox: "read-only" },
  );
  expect(audit.find((x) => x.method === "turn/steer")?.params).toMatchObject({
    expectedTurnId: "turn-1",
    clientUserMessageId: "m2",
  });
  expect(audit.some((x) => /delete|archive/.test(x.method))).toBe(false);
  expect(f.events.notification).toHaveBeenCalledWith(
    expect.objectContaining({ method: "thread/compacted" }),
  );
  expect(f.args()).toContain(
    'mcp_servers.carrot.default_tools_approval_mode="approve"',
  );
  expect(f.args().join(" ")).not.toContain("private-test-token");
});
it.each(["ended", "uncertain", "completed-before-ack"])(
  "handles %s without ambiguous replay",
  async (mode) => {
    const f = await fixture(mode);
    await f.runtime.prepare(session);
    await f.runtime.send("m1", input, null, null);
    const follow = f.runtime.send("m2", input, null, null);
    if (mode === "uncertain")
      await expect(follow).rejects.toThrow("connection status unknown");
    else await follow;
    const starts = (await f.audit()).filter((x) => x.method === "turn/start");
    expect(starts).toHaveLength(mode === "uncertain" ? 1 : 2);
    expect(starts[0].params.clientUserMessageId).toBe("m1");
  },
);
it("interrupts a start acknowledged after stop was pressed", async () => {
  const f = await fixture("slow-start");
  await f.runtime.prepare(session);
  const pending = f.runtime.send("m1", input, null, null);
  await vi.waitFor(async () =>
    expect((await f.audit()).some((x) => x.method === "turn/start")).toBe(true),
  );
  await f.runtime.stop();
  await pending;
  expect(
    (await f.audit()).filter((x) => x.method === "turn/interrupt"),
  ).toHaveLength(1);
});
