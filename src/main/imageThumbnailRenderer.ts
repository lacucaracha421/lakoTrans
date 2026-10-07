import { availableParallelism } from "node:os";
import { BrowserWindow } from "electron";
import { buildImageThumbnailScript } from "./imageThumbnailBrowser";
import { AbortableExclusiveGate } from "./runtimeSupport/abortableExclusiveGate";
import { LeasedIdleResourcePool } from "./runtimeSupport/leasedIdleResource";
import { withTimeout } from "./pageExportLifecycle";

export const THUMBNAIL_RENDERER_DOCUMENT_URL =
  "mgt-image://library/_thumbnail-renderer";
export const THUMBNAIL_RENDERER_DOCUMENT = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'"><title>Image thumbnail</title>`;
const PNG_PREFIX = "data:image/png;base64,";
const MAX_RESULT_BYTES = 24 * 1024 * 1024;

type ThumbnailWindow = Pick<
  BrowserWindow,
  "loadURL" | "destroy" | "isDestroyed"
> & {
  webContents: { executeJavaScript: (script: string) => Promise<unknown> };
};
type ThumbnailResource = { window: ThumbnailWindow; healthy: boolean };
export type ImageThumbnailRenderer = ((
  originalUrl: string,
  maxEdge: number,
) => Promise<Buffer | null>) & {
  /** Register with existing app terminal cleanup, not an independent quit listener. */
  close: () => Promise<void>;
};

/** Fork: hidden renderers working in parallel; each still runs one raster. */
export function defaultThumbnailLaneCount(): number {
  return Math.max(1, Math.min(3, availableParallelism() - 1));
}

type ThumbnailLane = {
  gate: AbortableExclusiveGate;
  pool: LeasedIdleResourcePool<ThumbnailResource>;
  load: number;
};

/** Caller owns signed URL validation, revision-bound PNG cache and inflight dedupe. */
export function createImageThumbnailRenderer(
  createWindow: () => ThumbnailWindow = createThumbnailWindow,
  laneCount = defaultThumbnailLaneCount(),
): ImageThumbnailRenderer {
  const lifetime = new AbortController();
  const active = new Set<Promise<Buffer | null>>();
  const lanes: ThumbnailLane[] = Array.from(
    { length: Math.max(1, laneCount) },
    () => ({
      gate: new AbortableExclusiveGate(),
      pool: new LeasedIdleResourcePool<ThumbnailResource>({
        idleTtlMs: 30_000,
        isReusable: ({ window, healthy }) => healthy && !window.isDestroyed(),
        dispose: async ({ window }) => {
          if (!window.isDestroyed()) window.destroy();
        },
      }),
      load: 0,
    }),
  );
  const execute = async (
    originalUrl: string,
    maxEdge: number,
  ): Promise<Buffer | null> => {
    if (!isThumbnailRequestAllowed(originalUrl, maxEdge)) return null;
    const lane = lanes.reduce((best, next) =>
      next.load < best.load ? next : best,
    );
    lane.load++;
    try {
      return await executeInLane(lane, originalUrl, maxEdge);
    } finally {
      lane.load--;
    }
  };
  const executeInLane = async (
    { gate, pool }: ThumbnailLane,
    originalUrl: string,
    maxEdge: number,
  ): Promise<Buffer | null> => {
    const turn = await gate.acquire(lifetime.signal);
    try {
      const lease = await pool.acquire("library-image-thumbnail", () =>
        createThumbnailResource(createWindow, lifetime.signal),
      );
      try {
        return await executeThumbnailResource(
          lease.resource,
          originalUrl,
          maxEdge,
          lifetime.signal,
        );
      } finally {
        lease.release();
      }
    } finally {
      turn.release();
    }
  };
  const render = ((originalUrl: string, maxEdge: number) => {
    // Any optional thumbnail failure returns the original through the caller.
    const task = execute(originalUrl, maxEdge).catch(() => null);
    active.add(task);
    void task.finally(() => active.delete(task));
    return task;
  }) as ImageThumbnailRenderer;
  render.close = async () => {
    lifetime.abort();
    await Promise.allSettled([...active]);
    await Promise.all(
      lanes.map(({ pool }) => pool.dispose("app-terminal-cleanup")),
    );
  };
  return render;
}

function isThumbnailRequestAllowed(
  originalUrl: string,
  maxEdge: number,
): boolean {
  const url = new URL(originalUrl);
  return (
    url.protocol === "mgt-image:" &&
    url.hostname === "library" &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.href !== THUMBNAIL_RENDERER_DOCUMENT_URL &&
    Number.isSafeInteger(maxEdge) &&
    maxEdge >= 1 &&
    maxEdge <= 2048
  );
}

async function createThumbnailResource(
  createWindow: () => ThumbnailWindow,
  signal: AbortSignal,
): Promise<ThumbnailResource> {
  const window = createWindow();
  try {
    await withTimeout(
      window.loadURL(THUMBNAIL_RENDERER_DOCUMENT_URL),
      15_000,
      "Thumbnail renderer initialization timed out",
      signal,
    );
    return { window, healthy: true };
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function executeThumbnailResource(
  resource: ThumbnailResource,
  originalUrl: string,
  maxEdge: number,
  signal: AbortSignal,
): Promise<Buffer | null> {
  try {
    signal.throwIfAborted();
    const value: unknown = await withTimeout(
      resource.window.webContents.executeJavaScript(
        buildImageThumbnailScript(originalUrl, maxEdge),
      ),
      15_000,
      "Thumbnail renderer timed out",
      signal,
    );
    return decodeThumbnailResult(value, maxEdge);
  } catch (error) {
    resource.healthy = false;
    if (!resource.window.isDestroyed()) resource.window.destroy();
    throw error;
  }
}

function decodeThumbnailResult(value: unknown, maxEdge: number): Buffer | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value.startsWith(PNG_PREFIX) ||
    value.length > PNG_PREFIX.length + Math.ceil(MAX_RESULT_BYTES / 3) * 4
  ) {
    throw new Error("Invalid thumbnail renderer result.");
  }
  const bytes = Buffer.from(value.slice(PNG_PREFIX.length), "base64");
  if (
    bytes.length < 24 ||
    bytes.length > MAX_RESULT_BYTES ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(16) < 1 ||
    bytes.readUInt32BE(20) < 1 ||
    bytes.readUInt32BE(16) > maxEdge ||
    bytes.readUInt32BE(20) > maxEdge
  ) {
    throw new Error("Thumbnail renderer exceeded its raster contract.");
  }
  return bytes;
}

function createThumbnailWindow(): ThumbnailWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    transparent: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== THUMBNAIL_RENDERER_DOCUMENT_URL) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  return window;
}
