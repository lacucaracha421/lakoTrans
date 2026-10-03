import { Worker } from "node:worker_threads";
import { McpEditError } from "../application/mcpEditPolicy";
import { AbortableExclusiveGate } from "../runtimeSupport/abortableExclusiveGate";
import { LeasedIdleResourcePool } from "../runtimeSupport/leasedIdleResource";
import type {
  McpImageOperation,
  McpImageOperations,
  McpImageProcessingPort,
  McpImageWorkerRequest,
} from "./mcpImageWorkerProtocol";

type McpImageWorkerHandle = {
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
  postMessage(
    request: McpImageWorkerRequest,
    transferList?: readonly ArrayBuffer[],
  ): void;
  terminate(): Promise<number>;
};
export type McpImageWorkerFactory = () => McpImageWorkerHandle;
type Pending = {
  id: number;
  kind: McpImageOperation;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

class ImageWorkerResource {
  healthy = true;
  private pending?: Pending;
  private disposal?: Promise<void>;
  private disposed = false;
  constructor(private readonly worker: McpImageWorkerHandle) {
    worker.on("message", this.onMessage);
    worker.on("error", this.onError);
    worker.on("exit", this.onExit);
  }
  execute(
    request: McpImageWorkerRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(abortError(signal));
      this.pending = {
        id: request.id,
        kind: request.kind,
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", abort),
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) return abort();
      try {
        this.worker.postMessage(request, transferInputs(request));
      } catch (error) {
        this.fail(asError(error));
      }
    });
  }
  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.disposal) return this.disposal;
    this.healthy = false;
    this.disposal = this.worker.terminate().then(
      () => {
        this.disposed = true;
        this.worker.off("message", this.onMessage);
        this.worker.off("error", this.onError);
        this.worker.off("exit", this.onExit);
      },
      (error: unknown) => {
        this.disposal = undefined;
        throw error;
      },
    );
    return this.disposal;
  }
  private readonly onMessage = (message: unknown) => {
    const pending = this.pending;
    if (!pending) return;
    if (!isRecord(message) || message.id !== pending.id)
      return this.fail(new Error("Invalid image worker response."));
    if ("error" in message) {
      const error = workerError(message.error);
      if (!error) return this.fail(new Error("Invalid image worker error."));
      this.finish(undefined, error);
    } else if (message.kind === pending.kind && "result" in message)
      this.finish(message.result);
    else this.fail(new Error("Invalid image worker response kind."));
  };
  private readonly onError = (error: Error) => this.fail(error);
  private readonly onExit = (code: number) =>
    this.fail(
      new Error("Image worker exited before completion (code " + code + ")."),
    );
  private fail(error: Error): void {
    this.healthy = false;
    this.finish(undefined, error);
  }
  private finish(result?: unknown, error?: Error): void {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    pending.cleanup();
    if (error) pending.reject(error);
    else pending.resolve(result);
  }
}

export class McpImageWorkerClient implements McpImageProcessingPort {
  private readonly lifetime = new AbortController();
  private readonly gate = new AbortableExclusiveGate();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly pool = new LeasedIdleResourcePool<ImageWorkerResource>({
    idleTtlMs: 30_000,
    isReusable: (resource) => resource.healthy,
    dispose: (resource) => resource.dispose(),
  });
  private nextId = 0;
  constructor(
    private readonly createWorker: McpImageWorkerFactory = () =>
      new Worker(require.resolve("./mcpImageWorker.js")),
    private readonly onCleanupFailure: () => void = () => undefined,
  ) {}
  run<K extends McpImageOperation>(
    kind: K,
    input: McpImageOperations[K]["input"],
    guard: () => void,
  ): Promise<McpImageOperations[K]["output"]> {
    const task = this.execute(kind, input, guard);
    this.tasks.add(task);
    return task.finally(() => this.tasks.delete(task));
  }
  stop(): void {
    this.lifetime.abort();
  }
  async close(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.tasks]);
    await this.pool.dispose("session-close");
  }
  private async execute<K extends McpImageOperation>(
    kind: K,
    input: McpImageOperations[K]["input"],
    guard: () => void,
  ): Promise<McpImageOperations[K]["output"]> {
    guard();
    const gate = await this.gate.acquire(this.lifetime.signal);
    try {
      return await this.executeOwned(kind, input, guard);
    } finally {
      gate.release();
    }
  }
  private async executeOwned<K extends McpImageOperation>(
    kind: K,
    input: McpImageOperations[K]["input"],
    guard: () => void,
  ): Promise<McpImageOperations[K]["output"]> {
    this.lifetime.signal.throwIfAborted();
    guard();
    const lease = await this.pool.acquire(
      "mcp-image",
      async () => new ImageWorkerResource(this.createWorker()),
    );
    let outcome:
      { result: McpImageOperations[K]["output"] } | { error: unknown };
    try {
      this.lifetime.signal.throwIfAborted();
      guard();
      const request = {
        id: ++this.nextId,
        kind,
        input,
      } as McpImageWorkerRequest;
      const result = await lease.resource.execute(
        request,
        this.lifetime.signal,
      );
      guard();
      try {
        outcome = { result: checkedResult(kind, input, result) };
      } catch (error) {
        lease.resource.healthy = false;
        throw error;
      }
    } catch (error) {
      outcome = { error };
    } finally {
      lease.release();
    }
    if (!lease.resource.healthy) {
      try {
        await this.pool.dispose("failed-or-cancelled-request");
      } catch (cleanup) {
        this.stop();
        this.onCleanupFailure();
        if ("error" in outcome)
          throw new AggregateError(
            [outcome.error, cleanup],
            "Image operation and worker cleanup failed.",
            { cause: cleanup },
          );
        throw cleanup;
      }
    }
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  }
}

function transferInputs(request: McpImageWorkerRequest): ArrayBuffer[] {
  if (request.kind !== "background") return [];
  // These two arrays are newly owned native-bitmap copies. Upload buffers stay attached.
  return [
    ...new Set(
      [request.input.before, request.input.pixels]
        .filter(
          (value) =>
            value.buffer instanceof ArrayBuffer &&
            value.byteOffset === 0 &&
            value.byteLength === value.buffer.byteLength,
        )
        .map((value) => value.buffer as ArrayBuffer),
    ),
  ];
}
function checkedResult<K extends McpImageOperation>(
  kind: K,
  input: McpImageOperations[K]["input"],
  result: unknown,
): McpImageOperations[K]["output"] {
  if (!isRecord(result)) throw new Error("Invalid image worker result.");
  if (kind === "validate") {
    const declared = (input as McpImageOperations["validate"]["input"])
      .declared;
    if (
      typeof result.hasTransparency !== "boolean" ||
      !(
        result.selectedPixels === null ||
        countInRange(result.selectedPixels, declared.width * declared.height)
      )
    )
      throw new Error("Invalid image validation result.");
    if ((declared.purpose === "mask") !== (result.selectedPixels !== null))
      throw new Error("Invalid image selection result.");
  } else validateRasterResult(kind, input, result);
  return result as McpImageOperations[K]["output"];
}
function validateRasterResult(
  kind: "lettering" | "background",
  input: McpImageOperations[McpImageOperation]["input"],
  result: Record<string, unknown>,
): void {
  const raster = input as McpImageOperations["lettering"]["input"];
  const background = input as McpImageOperations["background"]["input"];
  const width = kind === "background" ? background.pageWidth : raster.width;
  const height = kind === "background" ? background.pageHeight : raster.height;
  if (
    result.width !== width ||
    result.height !== height ||
    !(result.mask instanceof Uint8Array) ||
    result.mask.length !== width * height
  )
    throw new Error("Invalid image worker raster dimensions.");
  for (const field of ["selectedPixels", "protectedPixels", "changedPixels"])
    if (!countInRange(result[field], raster.width * raster.height))
      throw new Error("Invalid image worker pixel count.");
  validateRasterBytes(kind, width * height, result);
}
function validateRasterBytes(
  kind: "lettering" | "background",
  pixels: number,
  result: Record<string, unknown>,
): void {
  if (kind === "background") {
    if (
      !(result.bitmap instanceof Uint8Array) ||
      result.bitmap.byteLength !== pixels * 4
    )
      throw new Error("Invalid image worker bitmap.");
  } else if (
    !(result.bytes instanceof Uint8Array) ||
    result.bytes.byteLength > 2 * 1024 * 1024
  )
    throw new Error("Invalid image worker PNG.");
}
function countInRange(value: unknown, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function workerError(value: unknown): Error | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.message !== "string"
  )
    return undefined;
  if (value.code === "invalid_edit" || value.code === "revision_conflict")
    return new McpEditError(value.code, value.message);
  if (value.code !== undefined) return undefined;
  const error = new Error(value.message);
  error.name = value.name;
  return error;
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Image worker failed.");
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}
