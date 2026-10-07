/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockLibraryCard } from "../src/renderer/src/components/BlockLibraryCard";
import { useBlockLibraryPreviewObserver } from "../src/renderer/src/components/blockLibraryPreviewVisibility";
import { DEFAULT_BLOCK_FONT_CATALOG } from "../src/renderer/src/lib/fonts";
import { clipboardBlock } from "./fixtures/blockClipboard";
import { createBlockLibrarySaveInput } from "../src/shared/blockLibrary";

// The production artwork subtree stays intact; only visibility is controlled.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("library preview visibility", () => {
  it("uses one observer, releases offscreen artwork, and preserves card actions", () => {
    let notify!: IntersectionObserverCallback;
    const observed = new Set<Element>();
    const disconnect = vi.fn();
    const create = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
          create();
        }
        observe(element: Element) {
          observed.add(element);
        }
        unobserve(element: Element) {
          observed.delete(element);
        }
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText(text: string) {
        void text;
        return {
          width: 10,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        };
      },
    } as CanvasRenderingContext2D);
    const block = clipboardBlock();
    const onInsert = vi.fn();
    function Harness() {
      const observePreview = useBlockLibraryPreviewObserver();
      return (
        <>
          {["first", "second"].map((id) => (
            <BlockLibraryCard
              key={id}
              busy={false}
              canInsert
              entry={{
                schemaVersion: 1,
                id,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                lastUsedAt: "2026-01-01T00:00:00.000Z",
                ...createBlockLibrarySaveInput(
                  block,
                  { width: 1000, height: 1600 },
                  id,
                ),
              }}
              fontCatalog={DEFAULT_BLOCK_FONT_CATALOG}
              missingFont={false}
              observePreview={observePreview}
              onInsert={onInsert}
              onEdit={vi.fn()}
              onDelete={vi.fn()}
            />
          ))}
        </>
      );
    }
    const { container, unmount } = render(<Harness />);
    expect(create).toHaveBeenCalledOnce();
    expect(observed.size).toBe(2);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    const [first, second] = Array.from(observed);
    const visibility = (target: Element, visible: boolean) =>
      act(() =>
        notify(
          [{ target, isIntersecting: visible } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
    visibility(first, true);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      block.generatedLettering?.dataUrl,
    );
    visibility(first, false);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    visibility(second, true);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "first" }));
    expect(onInsert).toHaveBeenCalledOnce();
    visibility(second, false);
    fireEvent.focus(screen.getByRole("button", { name: "first" }));
    expect(container.querySelectorAll("img")).toHaveLength(1);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
