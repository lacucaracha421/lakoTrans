/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type React from "react";
import { useLetteringPartMove } from "../src/renderer/src/hooks/useLetteringPartMove";
import { createWorkspaceInteractionPreviewStore } from "../src/renderer/src/lib/workspaceInteractionPreview";
import { DEFAULT_LETTERING_TOOL } from "../src/shared/generatedLetteringMask";
import {
  detailedQualityFixture,
  generatedFixturePng,
} from "./mcpDetailedQuality.fixture";

afterEach(cleanup);
function fixture() {
  const f = detailedQualityFixture();
  f.page.width = f.page.height = 1000;
  f.block.bbox = { x: 0, y: 0, w: 1000, h: 1000 };
  f.block.bboxSpace = "normalized_1000";
  delete f.block.renderBbox;
  f.block.generatedLettering = {
    version: 1,
    sourceText: f.block.sourceText,
    translatedText: f.block.translatedText,
    dataUrl: generatedFixturePng(),
  };
  const preview = createWorkspaceInteractionPreviewStore(),
    onUpdate = vi.fn();
  const controls = {
    tool: {
      ...DEFAULT_LETTERING_TOOL,
      blockId: f.block.id,
      mode: "move" as const,
      selectionShape: "rectangle" as const,
    },
    onUpdate,
  };
  const view = renderHook(
    ({ block }) => useLetteringPartMove(f.page, block, controls, preview),
    { initialProps: { block: f.block } },
  );
  return { ...f, preview, onUpdate, ...view };
}
function event(x: number, y: number): React.PointerEvent<SVGSVGElement> {
  const surface = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  surface.setPointerCapture = vi.fn();
  surface.focus = vi.fn();
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
  const input: Partial<React.PointerEvent<SVGSVGElement>> = {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    currentTarget: surface,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return input as React.PointerEvent<SVGSVGElement>;
}
function key(
  value: string,
  shiftKey = false,
): React.KeyboardEvent<SVGSVGElement> {
  const input: Partial<React.KeyboardEvent<SVGSVGElement>> = {
    key: value,
    shiftKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return input as React.KeyboardEvent<SVGSVGElement>;
}
function select(f: ReturnType<typeof fixture>) {
  act(() => {
    f.result.current.start(event(100, 100));
    f.result.current.update(event(300, 300));
    f.result.current.end(event(300, 300));
  });
}
it("previews a cut/move and keyboard nudges, then commits exactly one native history patch", () => {
  const f = fixture();
  select(f);
  expect(f.result.current.draft?.polygon).toHaveLength(4);
  act(() => {
    f.result.current.start(event(200, 200));
    f.result.current.update(event(260, 240));
    f.result.current.end(event(260, 240));
    f.result.current.lost();
  });
  expect(f.onUpdate).not.toHaveBeenCalled();
  act(() => f.result.current.keyDown(key("ArrowRight", true)));
  act(() => f.result.current.keyDown(key("ArrowDown")));
  expect(f.result.current.draft?.offset.x).toBeCloseTo(70);
  expect(f.result.current.draft?.offset.y).toBeCloseTo(41);
  act(() => f.result.current.keyDown(key("Enter")));
  expect(f.onUpdate).toHaveBeenCalledOnce();
  const asset = f.onUpdate.mock.calls[0][0].generatedLettering;
  expect(asset.dataUrl).toBe(f.block.generatedLettering?.dataUrl);
  expect(asset.partMoves).toHaveLength(1);
  expect(asset.partMoves[0].offset.x).toBeCloseTo(70);
  expect(f.result.current.draft).toBeNull();
});
it("cancels empty moves, Escape, lost gestures and concurrent block edits without saving", () => {
  const f = fixture();
  select(f);
  act(() => f.result.current.apply());
  expect(f.onUpdate).not.toHaveBeenCalled();
  select(f);
  act(() => f.result.current.keyDown(key("Escape")));
  expect(f.result.current.draft).toBeNull();
  act(() => {
    f.result.current.start(event(100, 100));
    f.result.current.update(event(300, 300));
    f.result.current.lost();
  });
  expect(f.result.current.draft).toBeNull();
  select(f);
  f.rerender({ block: { ...f.block, rotationDeg: 30 } });
  expect(f.result.current.draft).toBeNull();
  expect(f.onUpdate).not.toHaveBeenCalled();
});
it("clamps movement to the asset canvas rather than silently clipping selected strokes", () => {
  const f = fixture();
  select(f);
  act(() => {
    f.result.current.start(event(200, 200));
    f.result.current.end(event(1000, 1000));
  });
  expect(f.result.current.draft?.offset).toEqual({ x: 700, y: 700 });
});
