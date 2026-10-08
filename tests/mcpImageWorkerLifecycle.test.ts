import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { PNG } from "pngjs";
import { afterEach, expect, it, vi } from "vitest";
import { McpImageUploadStore } from "../src/main/mcp/mcpImageUploadStore";
import { McpImageWorkerClient } from "../src/main/mcp/mcpImageWorkerClient";
import { McpEditError } from "../src/main/application/mcpEditPolicy";
import type { McpImageWorkerRequest } from "../src/main/mcp/mcpImageWorkerProtocol";

const guard = () => {};
const validation = {
  path: "internal-owned-staging-path",
  declared: {
    bytes: 50,
    sha256: "0".repeat(64),
    width: 2,
    height: 2,
    purpose: "image" as const,
  },
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class ControlledWorker extends EventEmitter {
  requests: McpImageWorkerRequest[] = [];
  readonly termination = deferred<number>();
  readonly terminate = vi.fn(() => this.termination.promise);
  postMessage(request: McpImageWorkerRequest): void {
    this.requests.push(structuredClone(request));
  }
  reply(
    result: unknown = { hasTransparency: false, selectedPixels: null },
  ): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("No request to answer");
    this.emit("message", { id: request.id, kind: request.kind, result });
  }
  fail(code: "invalid_edit" | "revision_conflict"): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("No request to answer");
    this.emit("message", {
      id: request.id,
      error: { name: "McpEditError", message: "invalid upload", code },
    });
  }
}
async function requestPosted(worker: ControlledWorker, count = 1) {
  await vi.waitFor(() => expect(worker.requests).toHaveLength(count), {
    interval: 1,
  });
}
afterEach(() => vi.useRealTimers());

it.each(["truncated", "zero-width", "oversized"])(
  "rejects a worker's purported patch success with a %s base header",
  async (variant) => {
    const worker = new ControlledWorker();
    const client = new McpImageWorkerClient(() => worker);
    const base = Buffer.alloc(variant === "truncated" ? 8 : 24);
    if (base.length >= 24) {
      base.writeUInt32BE(variant === "zero-width" ? 0 : 5000, 16);
      base.writeUInt32BE(5000, 20);
    }
    const result = client.run(
      "lettering",
      {
        image: new Uint8Array(4),
        width: 1,
        height: 1,
        letteringPatch: { base, rect: { x: 0, y: 0, w: 1, h: 1 } },
      },
      guard,
    );
    const rejected = expect(result).rejects.toThrow(
      /Invalid lettering patch asset/,
    );
    await requestPosted(worker);
    worker.termination.resolve(0);
    worker.reply({
      width: 1,
      height: 1,
      mask: new Uint8Array(1),
      bytes: new Uint8Array(4),
      selectedPixels: 1,
      protectedPixels: 0,
      changedPixels: 1,
    });
    await rejected;
    await client.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  },
);

it("creates no worker before a request, queues one request at a time and reuses its worker", async () => {
  const worker = new ControlledWorker();
  const create = vi.fn(() => worker);
  const client = new McpImageWorkerClient(create);
  expect(create).not.toHaveBeenCalled();
  const first = client.run("validate", validation, guard);
  const second = client.run("validate", validation, guard);
  await requestPosted(worker);
  expect(create).toHaveBeenCalledTimes(1);
  worker.reply();
  await expect(first).resolves.toEqual({
    hasTransparency: false,
    selectedPixels: null,
  });
  await requestPosted(worker, 2);
  worker.reply();
  await second;
  expect(create).toHaveBeenCalledTimes(1);
  worker.termination.resolve(0);
  await client.close();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.eventNames()).toEqual([]);
});

it("rechecks queued guards without interrupting the active request", async () => {
  const worker = new ControlledWorker();
  const client = new McpImageWorkerClient(() => worker);
  let authorized = true;
  const first = client.run("validate", validation, guard);
  const second = client.run("validate", validation, () => {
    if (!authorized) throw new Error("authorization revoked");
  });
  const rejected = expect(second).rejects.toThrow("authorization revoked");
  await requestPosted(worker);
  authorized = false;
  worker.reply();
  await first;
  await rejected;
  expect(worker.requests).toHaveLength(1);
  worker.termination.resolve(0);
  await client.close();
});

it("rechecks authorization after the result before returning success", async () => {
  const worker = new ControlledWorker();
  const client = new McpImageWorkerClient(() => worker);
  let authorized = true;
  const request = client.run("validate", validation, () => {
    if (!authorized) throw new Error("late revocation");
  });
  const rejected = expect(request).rejects.toThrow("late revocation");
  await requestPosted(worker);
  authorized = false;
  worker.reply();
  await rejected;
  worker.termination.resolve(0);
  await client.close();
});

it("aborts queued and active work and waits for termination before closing", async () => {
  const worker = new ControlledWorker();
  const client = new McpImageWorkerClient(() => worker);
  const first = client.run("validate", validation, guard);
  const second = client.run("validate", validation, guard);
  const failures = Promise.all([
    expect(first).rejects.toMatchObject({ name: "AbortError" }),
    expect(second).rejects.toMatchObject({ name: "AbortError" }),
  ]);
  await requestPosted(worker);
  let finished = false;
  const close = client.close().then(() => {
    finished = true;
  });
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1), {
    interval: 1,
  });
  expect(finished).toBe(false);
  expect(worker.requests).toHaveLength(1);
  worker.reply();
  expect(finished).toBe(false);
  worker.termination.resolve(0);
  await failures;
  await close;
  await expect(client.run("validate", validation, guard)).rejects.toMatchObject(
    { name: "AbortError" },
  );
  expect(worker.eventNames()).toEqual([]);
});

it.each(["invalid_edit", "revision_conflict"] as const)(
  "preserves %s errors and reuses a healthy worker",
  async (code) => {
    const worker = new ControlledWorker();
    const client = new McpImageWorkerClient(() => worker);
    const first = client.run("validate", validation, guard);
    const rejected = expect(first).rejects.toBeInstanceOf(McpEditError);
    await requestPosted(worker);
    worker.fail(code);
    await rejected;
    await expect(first).rejects.toMatchObject({ code });
    const second = client.run("validate", validation, guard);
    await requestPosted(worker, 2);
    worker.reply();
    await second;
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.termination.resolve(0);
    await client.close();
  },
);

it.each([
  { hasTransparency: "false", selectedPixels: null },
  { hasTransparency: false, selectedPixels: 5 },
  { hasTransparency: false, selectedPixels: 0 },
])(
  "rejects invalid validation metadata without synchronous fallback: %j",
  async (response) => {
    const worker = new ControlledWorker();
    const replacement = new ControlledWorker();
    const create = vi
      .fn()
      .mockReturnValueOnce(worker)
      .mockReturnValueOnce(replacement);
    const client = new McpImageWorkerClient(create);
    const first = client.run("validate", validation, guard);
    const rejected = expect(first).rejects.toThrow("Invalid image");
    await requestPosted(worker);
    worker.reply(response);
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1), {
      interval: 1,
    });
    worker.termination.resolve(0);
    await rejected;
    const second = client.run("validate", validation, guard);
    await requestPosted(replacement);
    replacement.reply();
    await second;
    replacement.termination.resolve(0);
    await client.close();
    expect(create).toHaveBeenCalledTimes(2);
  },
);

it("observes worker exit and waits for failed-resource disposal before retrying", async () => {
  const worker = new ControlledWorker();
  const replacement = new ControlledWorker();
  const client = new McpImageWorkerClient(
    vi.fn().mockReturnValueOnce(worker).mockReturnValueOnce(replacement),
  );
  const first = client.run("validate", validation, guard);
  const rejected = expect(first).rejects.toThrow("exited before completion");
  await requestPosted(worker);
  worker.emit("exit", 9);
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1), {
    interval: 1,
  });
  const second = client.run("validate", validation, guard);
  expect(replacement.requests).toHaveLength(0);
  worker.termination.resolve(0);
  await rejected;
  await requestPosted(replacement);
  replacement.reply();
  await second;
  replacement.termination.resolve(0);
  await client.close();
});

it("releases the idle worker and remains cold until the next request", async () => {
  const worker = new ControlledWorker();
  const create = vi.fn(() => worker);
  const client = new McpImageWorkerClient(create);
  const request = client.run("validate", validation, guard);
  await requestPosted(worker);
  vi.useFakeTimers();
  worker.reply();
  await request;
  await vi.advanceTimersByTimeAsync(29_999);
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.termination.resolve(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  await client.close();
});

it("retains staging and both errors after failed termination until a close retry succeeds", async () => {
  const worker = new ControlledWorker();
  worker.terminate.mockRejectedValueOnce(new Error("termination failed"));
  const store = new McpImageUploadStore(Date.now, () => worker);
  const image = new PNG({ width: 2, height: 2 });
  const bytes = PNG.sync.write(image);
  const receipt = await store.begin(
    "owner",
    {
      chapterId: "chapter",
      pageId: "page",
      revision: "page-v1:0000000000000000",
      contextRevision: "0".repeat(16),
      requestId: randomUUID(),
      purpose: "image",
      mimeType: "image/png",
      width: 2,
      height: 2,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    [],
    guard,
  );
  await store.chunk(
    "owner",
    { uploadId: receipt.uploadId, offset: 0, data: bytes.toString("base64") },
    guard,
  );
  const finished = store.finish("owner", receipt.uploadId, guard);
  const failed = finished.catch((error) => error as AggregateError);
  await requestPosted(worker);
  const request = worker.requests[0];
  if (request.kind !== "validate") throw new Error("Expected file validation");
  worker.emit("error", new Error("worker crashed"));
  const error = await failed;
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError))
    throw new Error("Expected aggregate failure");
  expect(error.errors.map((cause) => cause.message)).toEqual([
    "worker crashed",
    "termination failed",
  ]);
  expect((await stat(request.input.path)).isFile()).toBe(true);
  expect(() => store.discard("owner", receipt.uploadId, guard)).toThrow(
    "closed",
  );
  const close = store.close();
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(2), {
    interval: 1,
  });
  expect((await stat(request.input.path)).isFile()).toBe(true);
  worker.termination.resolve(0);
  await close;
  await expect(stat(request.input.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("closes an unused session without creating a worker", async () => {
  const create = vi.fn(() => new ControlledWorker());
  const client = new McpImageWorkerClient(create);
  await client.close();
  await client.close();
  expect(create).not.toHaveBeenCalled();
});

it("blocks an already-aborted upload session before admission without creating a worker", async () => {
  const { createMcpImageUploadSession } =
    await import("../src/main/mcp/mcpImageUploadSession");
  const lifetime = new AbortController();
  lifetime.abort();
  const create = vi.fn(() => new ControlledWorker());
  const session = createMcpImageUploadSession(lifetime.signal, create);
  try {
    expect(() => session.store.inspect("owner", randomUUID(), guard)).toThrow(
      "closed",
    );
  } finally {
    await session.close();
  }
  expect(create).not.toHaveBeenCalled();
});
