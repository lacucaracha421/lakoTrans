import type { WebContents } from "electron";
import { WebImportUrlError } from "./webImportUrlPolicy";

/** Keeps a scan bound to its requested document, including during loadURL rejection. */
export class WebImportNavigation {
  private expectedUrl: string;
  private documentUrl: string | undefined;
  private documentFrame: WebContents["mainFrame"] | undefined;
  private domReady = false;
  private loaded = false;
  private stopped = false;
  private blockedUrl: string | undefined;
  private loadError: unknown;
  private failure: Error | undefined;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });

  constructor(
    private readonly contents: WebContents,
    requestedUrl: string,
    private readonly signal: AbortSignal,
  ) {
    this.expectedUrl = requestedUrl;
    contents.on("will-frame-navigate", this.blockNavigation);
    contents.on("did-redirect-navigation", this.redirect);
    contents.on("did-navigate", this.commit);
    contents.on("did-navigate-in-page", this.inPage);
    contents.on("dom-ready", this.onDomReady);
    contents.on("did-stop-loading", this.stop);
    contents.on("did-fail-load", this.failLoad);
    contents.on("destroyed", this.destroyed);
    signal.addEventListener("abort", this.abort, { once: true });
  }

  async load(loadUrl: () => Promise<void>): Promise<void> {
    if (this.signal.aborted) this.abort();
    else {
      void Promise.resolve()
        .then(loadUrl)
        .then(
          () => {
            this.loaded = true;
            this.finish();
          },
          (error: unknown) => {
            this.loadError = error;
            if (!abortedNavigationUrl(error)) this.fail(error);
            else this.finish();
          },
        );
    }
    return this.ready;
  }

  assertDocument(): void {
    if (this.failure) throw this.failure;
    if (
      !this.domReady ||
      this.contents.isDestroyed() ||
      this.contents.mainFrame !== this.documentFrame ||
      this.contents.getURL() !== this.documentUrl
    )
      throw new WebImportUrlError("page-unavailable");
  }

  dispose(): void {
    this.contents.removeListener("will-frame-navigate", this.blockNavigation);
    this.contents.removeListener("did-redirect-navigation", this.redirect);
    this.contents.removeListener("did-navigate", this.commit);
    this.contents.removeListener("did-navigate-in-page", this.inPage);
    this.contents.removeListener("dom-ready", this.onDomReady);
    this.contents.removeListener("did-stop-loading", this.stop);
    this.contents.removeListener("did-fail-load", this.failLoad);
    this.contents.removeListener("destroyed", this.destroyed);
    this.signal.removeEventListener("abort", this.abort);
  }

  private readonly blockNavigation = (
    event: Electron.Event<{ isMainFrame: boolean; url: string }>,
  ): void => {
    if (!event.isMainFrame) return;
    event.preventDefault();
    this.blockedUrl = event.url;
    this.finish();
  };

  private readonly redirect = (
    _event: Electron.Event,
    url: string,
    _sameDocument: boolean,
    mainFrame: boolean,
  ): void => {
    if (mainFrame && !this.documentUrl) this.expectedUrl = url;
  };

  private readonly commit = (_event: Electron.Event, url: string): void => {
    if (this.documentUrl || url !== this.expectedUrl) {
      this.fail(new WebImportUrlError("page-unavailable"));
      return;
    }
    this.documentUrl = url;
    this.documentFrame = this.contents.mainFrame;
  };

  private readonly inPage = (
    _event: Electron.Event,
    url: string,
    mainFrame: boolean,
  ): void => {
    if (mainFrame && this.documentUrl) this.documentUrl = url;
  };

  private readonly onDomReady = (): void => {
    this.domReady = this.documentUrl !== undefined;
    this.finish();
  };

  private readonly stop = (): void => {
    this.stopped = true;
    this.finish();
  };

  private readonly failLoad = (
    _event: Electron.Event,
    code: number,
    _description: string,
    url: string,
    mainFrame: boolean,
  ): void => {
    if (mainFrame && !(code === -3 && url === this.blockedUrl))
      this.fail(new WebImportUrlError("page-unavailable"));
  };

  private readonly destroyed = (): void => {
    this.fail(new WebImportUrlError("page-unavailable"));
  };

  private readonly abort = (): void => {
    this.fail(this.signal.reason);
  };

  private finish(): void {
    if (this.failure) return;
    const abortedUrl = abortedNavigationUrl(this.loadError);
    const recovered =
      abortedUrl !== undefined && abortedUrl === this.blockedUrl;
    if (this.domReady && (this.loaded || recovered)) {
      try {
        this.assertDocument();
        this.resolveReady();
      } catch (error) {
        this.fail(error);
      }
    } else if (this.stopped && (this.loadError || this.loaded)) {
      this.fail(this.loadError ?? new WebImportUrlError("page-unavailable"));
    }
  }

  private fail(error: unknown): void {
    this.failure ??=
      error instanceof Error
        ? error
        : new WebImportUrlError("page-unavailable");
    this.rejectReady(this.failure);
  }
}

function abortedNavigationUrl(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_ABORTED" &&
    "errno" in error &&
    error.errno === -3 &&
    "url" in error &&
    typeof error.url === "string"
  )
    return error.url;
  return undefined;
}
