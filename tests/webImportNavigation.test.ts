import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebImportNavigation } from "../src/main/webImportNavigation";

const page = "https://reader.example/chapter";
const ad = "https://ads.example/landing";
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  let url = page;
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => url,
    isDestroyed: () => false,
    mainFrame: {},
  });
  const controller = new AbortController();
  const navigation = new WebImportNavigation(
    contents as WebContents,
    page,
    controller.signal,
  );
  cleanups.push(() => navigation.dispose());
  const commit = (target = page) => {
    url = target;
    contents.emit("did-navigate", {}, target);
  };
  const block = (target = ad, mainFrame = true) => {
    const event = {
      url: target,
      isMainFrame: mainFrame,
      preventDefault: vi.fn(),
    };
    contents.emit("will-frame-navigate", event);
    return event.preventDefault;
  };
  const ready = () => contents.emit("dom-ready");
  return {
    contents,
    controller,
    navigation,
    commit,
    ready,
    block,
    setUrl: (target: string) => {
      url = target;
    },
  };
}

function interrupted(url = ad) {
  return Object.assign(new Error("navigation interrupted"), {
    code: "ERR_ABORTED",
    errno: -3,
    url,
  });
}

describe("web import navigation lifecycle", () => {
  it("rejects a stopped load without a prepared DOM even if loadURL resolves", async () => {
    const f = fixture();
    await expect(
      f.navigation.load(async () => {
        f.commit();
        f.block();
        f.contents.emit("did-stop-loading");
      }),
    ).rejects.toThrow("page-unavailable");
  });
  it.each(["before-error", "after-error", "before-dom"])(
    "recovers only the retained ready document when blocking %s",
    async (order) => {
      const f = fixture();
      let rejectLoad!: (error: Error) => void;
      const loading = f.navigation.load(
        () =>
          new Promise<void>((_, reject) => {
            rejectLoad = reject;
          }),
      );
      await Promise.resolve();
      f.commit();
      if (order !== "before-dom") f.ready();
      if (order === "before-error") expect(f.block()).toHaveBeenCalledOnce();
      rejectLoad(interrupted());
      await Promise.resolve();
      if (order !== "before-error") expect(f.block()).toHaveBeenCalledOnce();
      if (order === "before-dom") f.ready();
      await expect(loading).resolves.toBeUndefined();
      expect(() => f.navigation.assertDocument()).not.toThrow();
      f.navigation.dispose();
      expect(f.contents.eventNames()).toEqual([]);
    },
  );

  it("allows HTTP redirects, subframes and same-document SPA/hash changes", async () => {
    const f = fixture();
    const target = "https://cdn.example/reader";
    await f.navigation.load(async () => {
      f.contents.emit(
        "did-redirect-navigation",
        {},
        "https://frame.example/",
        false,
        false,
      );
      f.contents.emit("did-redirect-navigation", {}, target, false, true);
      f.commit(target);
      f.ready();
    });
    expect(f.block("https://frame.example/", false)).not.toHaveBeenCalled();
    const next = target + "?chapter=2#page3";
    f.setUrl(next);
    f.contents.emit("did-navigate-in-page", {}, next, true);
    expect(() => f.navigation.assertDocument()).not.toThrow();
    f.contents.emit("did-navigate-in-page", {}, ad, false);
    expect(() => f.navigation.assertDocument()).not.toThrow();
    expect(f.block()).toHaveBeenCalledOnce();
  });

  it.each(["no-block", "wrong-block", "no-dom", "no-commit"])(
    "rejects an interrupted load with %s",
    async (kind) => {
      const f = fixture();
      const loading = f.navigation.load(async () => {
        if (kind !== "no-commit") f.commit();
        if (kind !== "no-dom") f.ready();
        if (kind !== "no-block")
          f.block(kind === "wrong-block" ? ad + "/other" : ad);
        throw interrupted();
      });
      const rejected = expect(loading).rejects.toThrow(
        "navigation interrupted",
      );
      await Promise.resolve();
      f.contents.emit("did-stop-loading");
      await rejected;
    },
  );

  it.each([
    "ERR_CERT_AUTHORITY_INVALID",
    "ERR_NAME_NOT_RESOLVED",
    "ERR_CONNECTION_RESET",
  ])("does not hide %s behind a blocked navigation", async (code) => {
    const f = fixture();
    await expect(
      f.navigation.load(async () => {
        f.commit();
        f.ready();
        f.block();
        throw Object.assign(new Error(code), { code, errno: -2, url: ad });
      }),
    ).rejects.toThrow(code);
  });

  it.each([
    "unrecognized-commit",
    "second-commit",
    "unreported-url",
    "replaced-frame",
    "main-load-failure",
    "destroyed",
  ])("rejects lost document ownership: %s", async (kind) => {
    const f = fixture();
    if (kind === "unrecognized-commit") {
      await expect(
        f.navigation.load(async () => {
          f.commit(ad);
          f.ready();
        }),
      ).rejects.toThrow("page-unavailable");
      return;
    }
    await f.navigation.load(async () => {
      f.commit();
      f.ready();
    });
    if (kind === "second-commit") f.commit(page);
    if (kind === "unreported-url") f.setUrl(ad);
    if (kind === "replaced-frame") f.contents.mainFrame = {};
    if (kind === "main-load-failure")
      f.contents.emit("did-fail-load", {}, -105, "DNS", page, true);
    if (kind === "destroyed") f.contents.emit("destroyed");
    expect(() => f.navigation.assertDocument()).toThrow("page-unavailable");
  });

  it("ignores failed subframes and failures belonging to a blocked navigation", async () => {
    const f = fixture();
    await f.navigation.load(async () => {
      f.commit();
      f.ready();
      f.block();
      f.contents.emit("did-fail-load", {}, -105, "DNS", ad, false);
      f.contents.emit("did-fail-load", {}, -3, "ABORTED", ad, true);
    });
    expect(() => f.navigation.assertDocument()).not.toThrow();
  });

  it.each(["cancel-before", "cancel-during", "deadline", "destroyed"])(
    "settles a pending load and removes listeners on %s",
    async (kind) => {
      const f = fixture();
      const load = vi.fn(() => new Promise<void>(() => {}));
      if (kind === "cancel-before") f.controller.abort(new Error(kind));
      const loading = f.navigation.load(load);
      const rejected = expect(loading).rejects.toThrow();
      await Promise.resolve();
      if (kind === "destroyed") f.contents.emit("destroyed");
      else f.controller.abort(new Error(kind));
      await rejected;
      if (kind === "cancel-before") expect(load).not.toHaveBeenCalled();
      f.navigation.dispose();
      expect(f.contents.eventNames()).toEqual([]);
    },
  );
});
