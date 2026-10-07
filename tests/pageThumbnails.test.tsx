/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePageThumbnail } from "../src/renderer/src/components/pageThumbnails";
import { useThumbnailResolution } from "../src/renderer/src/hooks/useThumbnailResolution";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("requests physical thumbnail pixels and leaves original previews unbounded", async () => {
  vi.stubGlobal("devicePixelRatio", 2);
  const getPageImageDataUrl = vi.fn(async () => "image");
  window.mangaApi = createTestMangaGatewayStub({ getPageImageDataUrl });
  const observe = (_element: Element, show: () => void) => {
    show();
    return () => {};
  };
  const page = { imagePath: "source.png", dataUrl: "" };
  // A real mounted frame is necessary: visibility gates the request.
  const Frame = ({ original = false }: { original?: boolean }) => {
    const { frameRef } = usePageThumbnail<HTMLDivElement>(page, observe, {
      original,
    });
    return <div ref={frameRef} />;
  };
  const { render } = await import("@testing-library/react");
  const view = render(<Frame />);
  await waitFor(() =>
    expect(getPageImageDataUrl).toHaveBeenCalledWith("source.png", 256),
  );
  view.rerender(<Frame original />);
  await waitFor(() =>
    expect(getPageImageDataUrl).toHaveBeenCalledWith("source.png"),
  );
});

it("uses the original above the derivative size ceiling to avoid blur", () => {
  vi.stubGlobal("devicePixelRatio", 4);
  const { result } = renderHook(() =>
    useThumbnailResolution(undefined, false, 600),
  );
  expect(result.current).toBeUndefined();
});

it("updates pixels when display density changes without a window resize", () => {
  const target = new EventTarget();
  const matchMedia = vi.fn(() => target);
  vi.stubGlobal("matchMedia", matchMedia);
  vi.stubGlobal("devicePixelRatio", 1);
  const { result, unmount } = renderHook(() =>
    useThumbnailResolution(undefined, false, 100),
  );
  expect(result.current).toBe(128);
  act(() => {
    vi.stubGlobal("devicePixelRatio", 2);
    target.dispatchEvent(new Event("change"));
  });
  expect(result.current).toBe(256);
  unmount();
  const count = matchMedia.mock.calls.length;
  target.dispatchEvent(new Event("change"));
  expect(matchMedia).toHaveBeenCalledTimes(count);
});
