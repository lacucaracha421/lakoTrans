// @vitest-environment jsdom
import React, { useRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChapterSnapshot } from "../src/shared/libraryTypes";
import type { InpaintingMaskStroke } from "../src/shared/inpaintingTypes";
import type { SavePagesBlocksRequest } from "../src/shared/shareTypes";
import { useOpenChapterAction } from "../src/renderer/src/hooks/useOpenChapterAction";
import { useChapterPersistence } from "../src/renderer/src/hooks/useChapterPersistence";
import { useConfirmDialog } from "../src/renderer/src/hooks/useConfirmDialog";
import { ConfirmModal } from "../src/renderer/src/components/ConfirmModal";
import { TransformNumberField } from "../src/renderer/src/components/TransformNumberField";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";
import { appendMaskStroke } from "../src/renderer/src/hooks/workspaceInpaintingPointerState";

const date = "2026-01-01T00:00:00.000Z";
type Api = {
  open: (id: string) => Promise<void>;
  current: () => ChapterSnapshot | null;
  dirty: boolean;
  masks: Record<string, InpaintingMaskStroke[]>;
  addMask: () => void;
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "mangaApi");
});

function Harness({
  initial,
  committed,
  errors,
  onReady,
}: {
  initial: ChapterSnapshot;
  committed: number[];
  errors: string[];
  onReady: (api: Api) => void;
}) {
  const [current, setCurrent] = useState<ChapterSnapshot | null>(initial);
  const currentChapterRef = useRef(current);
  const [masks, setMasks] = useState(() =>
    appendMaskStroke({}, "page-1", [{ x: 10, y: 20 }], 12),
  );
  const persistence = useChapterPersistence({
    currentChapter: current,
    currentChapterRef,
    setCurrentChapter: setCurrent,
  });
  const confirm = useConfirmDialog();
  const open = useOpenChapterAction({
    askConfirm: confirm.askConfirm,
    clearDirtyTracking: persistence.clearDirtyTracking,
    currentChapterRef,
    dirty: persistence.dirty,
    library: { works: [], workOrder: [] },
    hasPendingInpaintingMask: Object.values(masks).some(
      (strokes) => strokes.length > 0,
    ),
    patternMaskStrokesByPage: masks,
    saveNow: persistence.saveNow,
    resetSaveBaseline: persistence.resetSaveBaseline,
    clearPendingInpaintingMasks: () => setMasks({}),
    pushStatus: (error) => errors.push(error),
    setCurrentChapter: setCurrent,
    setSelectedBlockId: () => {},
    setSelectedPageId: () => {},
  });
  onReady({
    open,
    current: () => currentChapterRef.current,
    dirty: persistence.dirty,
    masks,
    addMask: () =>
      setMasks((current) =>
        appendMaskStroke(current, "page-1", [{ x: 30, y: 40 }], 18),
      ),
  });
  return (
    <>
      <TransformNumberField
        label="Rotation"
        value={current?.pages[0].blocks[0].rotationDeg ?? 0}
        min={-360}
        max={360}
        hasSlider
        onCommit={(rotationDeg) => {
          const source = currentChapterRef.current;
          if (!source) return;
          committed.push(rotationDeg);
          const next = {
            ...source,
            pages: source.pages.map((page) => ({
              ...page,
              blocks: page.blocks.map((block) => ({ ...block, rotationDeg })),
            })),
          };
          currentChapterRef.current = next;
          setCurrent(next);
          persistence.markDirty("page-1");
        }}
      />
      {confirm.confirmDialog && (
        <ConfirmModal
          {...confirm.confirmDialog}
          confirmLabel="Continue"
          onConfirm={() => confirm.resolveConfirmDialog(true)}
          onCancel={() => confirm.resolveConfirmDialog(false)}
        />
      )}
    </>
  );
}

function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const original = chapter("22222222-2222-4222-8222-222222222222");
  const next = chapter("33333333-3333-4333-8333-333333333333");
  const reading = deferred<ChapterSnapshot>();
  const committed: number[] = [];
  const errors: string[] = [];
  let api: Api | undefined;
  let disk = structuredClone(original);
  const savePagesBlocksPatch = vi.fn(
    async (request: SavePagesBlocksRequest) => {
      disk = {
        ...disk,
        pages: disk.pages.map((page) => {
          const update = request.pages.find(
            (candidate) => candidate.pageId === page.id,
          );
          return update ? { ...page, blocks: update.blocks } : page;
        }),
      };
      return structuredClone(disk);
    },
  );
  window.mangaApi = createTestMangaGatewayStub({
    openChapter: async () => reading.promise,
    savePagesBlocksPatch,
  });
  render(
    <Harness
      initial={original}
      committed={committed}
      errors={errors}
      onReady={(value) => {
        api = value;
      }}
    />,
  );
  return {
    original,
    next,
    reading,
    committed,
    errors,
    savePagesBlocksPatch,
    disk: () => disk,
    api: () => {
      if (!api) throw new Error("Chapter harness did not initialize");
      return api;
    },
  };
}

async function openWithPendingNumericDraft(h: ReturnType<typeof setup>) {
  let opening: Promise<void> = Promise.resolve();
  await act(async () => {
    opening = h.api().open(h.next.id);
  });
  const input = screen.getByRole("spinbutton", { name: "Rotation" });
  act(() => {
    input.focus();
  });
  fireEvent.change(input, { target: { value: "45" } });
  expect(h.committed).toEqual([]);
  expect(h.api().dirty).toBe(false);
  await act(async () => {
    h.reading.resolve(h.next);
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(h.committed).toEqual([45]);
  expect(h.api().current()?.pages[0].blocks[0].rotationDeg).toBe(45);
  expect(h.api().dirty).toBe(true);
  expect(h.savePagesBlocksPatch).not.toHaveBeenCalled();
  return { opening };
}

it("saves the real blur commit triggered by the mask confirmation before installing the next chapter", async () => {
  const h = setup();
  const { opening } = await openWithPendingNumericDraft(h);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await opening;
  });
  expect(h.savePagesBlocksPatch).toHaveBeenCalledOnce();
  expect(
    h.savePagesBlocksPatch.mock.calls[0][0].pages[0].blocks[0].rotationDeg,
  ).toBe(45);
  expect(h.disk().pages[0].blocks[0].rotationDeg).toBe(45);
  expect(h.api().current()?.id).toBe(h.next.id);
  expect(h.api().dirty).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(h.savePagesBlocksPatch).toHaveBeenCalledOnce();
  expect(h.errors).toEqual([]);
});

it("keeps the original chapter and dirty blur edit when the post-confirm save fails", async () => {
  const h = setup();
  const { opening } = await openWithPendingNumericDraft(h);
  h.savePagesBlocksPatch.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await opening;
  });
  expect(h.api().current()?.id).toBe(h.original.id);
  expect(h.api().current()?.pages[0].blocks[0].rotationDeg).toBe(45);
  expect(h.api().dirty).toBe(true);
  expect(h.disk().pages[0].blocks[0].rotationDeg).toBe(0);
  expect(h.errors).toHaveLength(1);
  expect(h.errors[0]).toBe("화를 열지 못했습니다.");
});

it("does not replace the latest reselected chapter after a post-confirm save resolves", async () => {
  const h = setup();
  const { opening } = await openWithPendingNumericDraft(h);
  const saving = deferred<ChapterSnapshot>();
  h.savePagesBlocksPatch.mockReturnValueOnce(saving.promise);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
  expect(h.savePagesBlocksPatch).toHaveBeenCalledOnce();
  expect(h.api().current()?.id).toBe(h.original.id);
  await act(async () => {
    await h.api().open(h.original.id);
  });
  const saved = structuredClone(h.original);
  saved.pages[0].blocks[0].rotationDeg = 45;
  await act(async () => {
    saving.resolve(saved);
    await opening;
  });
  expect(h.api().current()?.id).toBe(h.original.id);
  expect(h.api().current()?.pages[0].blocks[0].rotationDeg).toBe(45);
  expect(h.api().dirty).toBe(false);
  expect(h.errors).toEqual([]);
});

it.each([false, true])(
  "asks again for a new mask added during the post-confirm save and respects confirmation=%s",
  async (confirmed) => {
    const h = setup();
    const { opening } = await openWithPendingNumericDraft(h);
    const saving = deferred<void>();
    const persist = h.savePagesBlocksPatch.getMockImplementation();
    if (!persist) throw new Error("Missing owned gateway save boundary");
    h.savePagesBlocksPatch.mockImplementationOnce(async (request) => {
      await saving.promise;
      return persist(request);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.savePagesBlocksPatch).toHaveBeenCalledOnce();
    act(() => h.api().addMask());
    const latestMasks = h.api().masks;
    expect(latestMasks["page-1"]).toHaveLength(2);
    await act(async () => {
      saving.resolve(undefined);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.api().current()?.id).toBe(h.original.id);
    expect(h.api().current()?.pages[0].blocks[0].rotationDeg).toBe(45);
    expect(h.disk().pages[0].blocks[0].rotationDeg).toBe(45);
    expect(h.api().masks).toEqual(latestMasks);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: confirmed ? "Continue" : "취소" }),
      );
      await opening;
    });
    expect(h.api().current()?.id).toBe(confirmed ? h.next.id : h.original.id);
    expect(h.api().masks).toEqual(confirmed ? {} : latestMasks);
    if (!confirmed)
      expect(h.api().current()?.pages[0].blocks[0].rotationDeg).toBe(45);
    expect(h.api().dirty).toBe(false);
    expect(h.savePagesBlocksPatch).toHaveBeenCalledOnce();
    expect(h.errors).toEqual([]);
  },
);

function chapter(id: string): ChapterSnapshot {
  return {
    id,
    workId: "11111111-1111-4111-8111-111111111111",
    title: id,
    sourceKind: "images",
    status: "idle",
    pageOrder: ["page-1"],
    createdAt: date,
    updatedAt: date,
    pages: [
      {
        id: "page-1",
        name: "page.png",
        imagePath: "page.png",
        dataUrl: "",
        width: 1000,
        height: 1000,
        analysisStatus: "idle",
        createdAt: date,
        updatedAt: date,
        blocks: [
          {
            id: "block-1",
            type: "nonsolid",
            bbox: { x: 100, y: 100, w: 200, h: 200 },
            sourceText: "source",
            translatedText: "text",
            confidence: 1,
            sourceDirection: "horizontal",
            renderDirection: "horizontal",
            fontSizePx: 32,
            lineHeight: 1.2,
            textAlign: "center",
            textColor: "#ffffff",
            backgroundColor: "transparent",
            opacity: 1,
            rotationDeg: 0,
          },
        ],
      },
    ],
  };
}
