import React from "react";
import type { MangaPage } from "../../../shared/libraryTypes";
import type { Point, TranslationBlock } from "../../../shared/textTypes";
import type { LetteringTool } from "../../../shared/generatedLetteringMaskTypes";
import { pagePointToLettering } from "../../../shared/generatedLetteringMask";
import {
  appendLetteringPartMove,
  letteringSelectionSchema,
  letteringPointToPage,
} from "../../../shared/generatedLetteringPartMove";
import { normalizeBboxTo1000 } from "../../../shared/bboxNormalization";
import type { WorkspaceInteractionPreviewStore } from "../lib/workspaceInteractionPreview";
import { letteringEventPagePoint } from "../lib/letteringPointer";
import {
  clampLetteringMove,
  extendLetteringSelection,
  isInsideLetteringMove,
  projectLetteringMove,
  type LetteringMoveDraft,
} from "../lib/letteringPartMoveDraft";

type Gesture = {
  pointer: number;
  start: Point;
  moving: boolean;
  initial: LetteringMoveDraft;
};
type Controls = {
  tool: LetteringTool;
  onUpdate: (patch: Partial<TranslationBlock>) => void;
};

export function useLetteringPartMove(
  page: MangaPage,
  block: TranslationBlock,
  controls: Controls,
  preview: WorkspaceInteractionPreviewStore,
) {
  const [draft, setDraft] = React.useState<LetteringMoveDraft | null>(null);
  const current = React.useRef(draft);
  const gesture = React.useRef<Gesture | null>(null);
  const normalized = normalizedMoveBlock(page, block);
  const cancel = React.useCallback(() => {
    gesture.current = null;
    current.current = null;
    setDraft(null);
    preview.set({ blockPreview: null });
  }, [preview]);
  React.useEffect(() => {
    cancel();
    return cancel;
  }, [block, controls.tool.selectionShape, cancel]);
  const show = (next: LetteringMoveDraft) => {
    current.current = next;
    setDraft(next);
    if (!letteringSelectionSchema.safeParse(next.polygon).success) return;
    preview.queue({
      blockPreview: {
        blockId: block.id,
        block: movedBlock(block, next),
      },
    });
  };
  const apply = () => {
    const selected = current.current;
    if (
      !selected ||
      !block.generatedLettering ||
      !letteringSelectionSchema.safeParse(selected.polygon).success
    )
      return;
    const next = movedBlock(block, selected).generatedLettering;
    cancel();
    if (next !== block.generatedLettering)
      controls.onUpdate({ generatedLettering: next });
  };
  const handlers = () =>
    moveGestureHandlers({
      page,
      block: normalized,
      controls,
      current,
      gesture,
      show,
      cancel,
    });
  const keyDown = (event: React.KeyboardEvent<SVGSVGElement>) =>
    moveKeyDown(event, {
      selected: current.current,
      block: normalized,
      page,
      show,
      apply,
      cancel,
    });
  return {
    draft,
    apply,
    cancel,
    keyDown,
    start: (event: React.PointerEvent<SVGSVGElement>) =>
      handlers().start(event),
    update: (event: React.PointerEvent<SVGSVGElement>) =>
      handlers().update(event),
    end: (event: React.PointerEvent<SVGSVGElement>) => handlers().end(event),
    lost: () => handlers().lost(),
    polygon: draft ? projectLetteringMove(draft, normalized, page) : "",
  };
}

function movedBlock(
  block: TranslationBlock,
  draft: LetteringMoveDraft,
): TranslationBlock {
  if (!block.generatedLettering) return block;
  return {
    ...block,
    generatedLettering: appendLetteringPartMove(
      block.generatedLettering,
      draft.polygon,
      draft.offset,
    ),
  };
}

function normalizedMoveBlock(page: MangaPage, block: TranslationBlock) {
  return {
    ...block,
    renderBbox: normalizeBboxTo1000(
      block.renderBbox ?? block.bbox,
      page,
      block.renderBbox
        ? (block.renderBboxSpace ?? block.bboxSpace)
        : block.bboxSpace,
    ),
  };
}

function moveKeyDown(
  event: React.KeyboardEvent<SVGSVGElement>,
  input: {
    selected: LetteringMoveDraft | null;
    block: TranslationBlock;
    page: MangaPage;
    show: (next: LetteringMoveDraft) => void;
    apply: () => void;
    cancel: () => void;
  },
) {
  if (event.key === "Escape") {
    event.stopPropagation();
    input.cancel();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    input.apply();
    return;
  }
  const vector = (
    {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    } as Record<string, number[]>
  )[event.key];
  const { selected, block, page } = input;
  if (!vector || !selected) return;
  event.preventDefault();
  event.stopPropagation();
  const first = selected.polygon[0];
  const anchor = {
    x: first.x + selected.offset.x,
    y: first.y + selected.offset.y,
  };
  const at = letteringPointToPage(anchor, block, page),
    amount = event.shiftKey ? 10 : 1;
  const to = pagePointToLettering(
    {
      x: at.x + (vector[0] * amount * 1000) / page.width,
      y: at.y + (vector[1] * amount * 1000) / page.height,
    },
    block,
    page,
  );
  input.show(
    clampLetteringMove(selected, {
      x: selected.offset.x + to.x - anchor.x,
      y: selected.offset.y + to.y - anchor.y,
    }),
  );
}

function moveGestureHandlers({
  page,
  block,
  controls,
  current,
  gesture,
  show,
  cancel,
}: {
  page: MangaPage;
  block: TranslationBlock;
  controls: Controls;
  current: React.RefObject<LetteringMoveDraft | null>;
  gesture: React.RefObject<Gesture | null>;
  show: (draft: LetteringMoveDraft) => void;
  cancel: () => void;
}) {
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const at = pagePointToLettering(
      letteringEventPagePoint(event),
      block,
      page,
    );
    return {
      x: Math.max(0, Math.min(1000, at.x)),
      y: Math.max(0, Math.min(1000, at.y)),
    };
  };
  const update = (event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const at = point(event);
    if (active.moving)
      show(
        clampLetteringMove(active.initial, {
          x: active.initial.offset.x + at.x - active.start.x,
          y: active.initial.offset.y + at.y - active.start.y,
        }),
      );
    else
      show({
        polygon: extendLetteringSelection(
          current.current?.polygon ?? [],
          at,
          controls.tool.selectionShape === "rectangle",
        ),
        offset: { x: 0, y: 0 },
      });
  };
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      event.button !== 0 ||
      (block.generatedLettering?.partMoves?.length ?? 0) >= 16
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event),
      selected = current.current;
    const moving = Boolean(selected && isInsideLetteringMove(at, selected));
    const initial =
      selected && moving ? selected : { polygon: [at], offset: { x: 0, y: 0 } };
    gesture.current = { pointer: event.pointerId, start: at, moving, initial };
    show(initial);
  };
  const end = (event: React.PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    update(event);
    gesture.current = null;
    if (!letteringSelectionSchema.safeParse(current.current?.polygon).success)
      cancel();
  };
  const lost = () => {
    if (gesture.current) cancel();
  };
  return { start, update, end, lost };
}
