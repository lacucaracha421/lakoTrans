/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useQueuedChapterSave } from "../src/renderer/src/hooks/useQueuedChapterSave";
import { useChapterPersistenceRefs } from "../src/renderer/src/hooks/useChapterPersistenceRefs";
import type { ChapterSnapshot } from "../src/shared/libraryTypes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([30, 500])(
  "measures a %i-page save acknowledgement without intervening edits",
  async (count) => {
    const chapter: ChapterSnapshot = {
      id: "chapter",
      workId: "work",
      title: "Benchmark",
      sourceKind: "images",
      status: "idle",
      pageOrder: [],
      createdAt: "",
      updatedAt: "",
      pages: Array.from({ length: count }, (_, i) => ({
        id: `page-${i}`,
        name: `${i}.png`,
        imagePath: `${i}.png`,
        dataUrl: "",
        width: 1000,
        height: 1500,
        analysisStatus: "idle",
        createdAt: "",
        updatedAt: "",
        blocks: Array.from({ length: 20 }, (_, j) => ({
          id: `block-${j}`,
          type: "nonsolid",
          confidence: 1,
          sourceDirection: "vertical",
          renderDirection: "horizontal",
          fontSizePx: 18,
          lineHeight: 1.2,
          textAlign: "center",
          textColor: "#111111",
          backgroundColor: "#ffffff",
          opacity: 0.8,
          sourceText: "Original text ".repeat(10),
          translatedText: "번역할 문장입니다. ".repeat(10),
          bbox: { x: 100, y: 100, w: 200, h: 200 },
        })),
      })),
    };
    chapter.pageOrder = chapter.pages.map((p) => p.id);
    const currentChapterRef = { current: chapter as ChapterSnapshot | null };
    const saved = structuredClone(chapter);
    saved.pages.forEach((p) => {
      p.updatedAt = "saved";
    });
    const persistChapter = vi.fn(async () => saved);
    const setCurrentChapter = vi.fn();
    const syncServerPageVersions = vi.fn();
    const view = renderHook(() => {
      const refs = useChapterPersistenceRefs();
      const save = useQueuedChapterSave({
        currentChapterRef,
        persistChapter,
        refs,
        setCurrentChapter,
        setDirty: vi.fn(),
        syncServerPageVersions,
      });
      return { refs, save };
    });
    view.result.current.refs.dirtyPageIdsRef.current = new Set(
      chapter.pageOrder,
    );
    let sourceBlockReads = 0;
    for (const page of chapter.pages) {
      const blocks = page.blocks;
      Object.defineProperty(page, "blocks", {
        get: () => {
          sourceBlockReads++;
          return blocks;
        },
      });
    }
    const started = performance.now();
    await act(() => view.result.current.save("manual"));
    process.stdout.write(
      `save acknowledgement: ${count} pages, ${(performance.now() - started).toFixed(1)}ms` +
        "\n",
    );
    expect(sourceBlockReads).toBe(0);
    expect(persistChapter).toHaveBeenCalledOnce();
    expect(view.result.current.refs.dirtyPageIdsRef.current.size).toBe(0);
    expect(
      currentChapterRef.current?.pages.every((p) => p.updatedAt === "saved"),
    ).toBe(true);
  },
);

it("keeps a dirty draft when a persistence adapter omits its receipt and permits an explicit retry", async () => {
  const chapter: ChapterSnapshot = {
    id: "chapter",
    workId: "work",
    title: "Draft",
    sourceKind: "images",
    status: "idle",
    pageOrder: ["page"],
    createdAt: "",
    updatedAt: "",
    pages: [
      {
        id: "page",
        name: "draft.png",
        imagePath: "draft.png",
        dataUrl: "",
        width: 1000,
        height: 1500,
        analysisStatus: "idle",
        createdAt: "",
        updatedAt: "draft",
        blocks: [],
      },
    ],
  };
  const currentChapterRef = { current: chapter as ChapterSnapshot | null };
  const saved = {
    ...chapter,
    pages: chapter.pages.map((page) => ({ ...page, updatedAt: "saved" })),
  };
  const persistChapter = vi
    .fn(async () => saved)
    .mockResolvedValueOnce({ ...saved, pages: [] });
  const setCurrentChapter = vi.fn();
  const setDirty = vi.fn();
  const syncServerPageVersions = vi.fn();
  const { result } = renderHook(() => {
    const refs = useChapterPersistenceRefs();
    return {
      refs,
      save: useQueuedChapterSave({
        currentChapterRef,
        persistChapter,
        refs,
        setCurrentChapter,
        setDirty,
        syncServerPageVersions,
      }),
    };
  });
  result.current.refs.dirtyPageIdsRef.current.add("page");
  result.current.refs.dirtyVersionRef.current = 7;
  result.current.refs.blockedAutoSaveVersionRef.current = 7;

  await act(async () => {
    await expect(result.current.save("manual")).rejects.toThrow(
      "저장 응답에 편집한 페이지가 없습니다",
    );
  });
  expect(currentChapterRef.current).toBe(chapter);
  expect(result.current.refs.dirtyPageIdsRef.current).toEqual(
    new Set(["page"]),
  );
  expect(result.current.refs.blockedAutoSaveVersionRef.current).toBe(7);
  expect(result.current.refs.saveInFlightRef.current).toBe(false);
  expect(result.current.refs.saveQueuePromiseRef.current).toBeNull();
  expect(setCurrentChapter).not.toHaveBeenCalled();
  expect(setDirty).not.toHaveBeenCalled();
  expect(syncServerPageVersions).not.toHaveBeenCalled();

  await act(async () => result.current.save("manual"));
  expect(persistChapter).toHaveBeenCalledTimes(2);
  expect(currentChapterRef.current?.pages[0]?.updatedAt).toBe("saved");
  expect(result.current.refs.dirtyPageIdsRef.current.size).toBe(0);
  expect(result.current.refs.blockedAutoSaveVersionRef.current).toBeNull();
  expect(setDirty).toHaveBeenCalledWith(false);
  expect(syncServerPageVersions).toHaveBeenCalledExactlyOnceWith(
    currentChapterRef.current,
    { preserveDirtyPages: true },
  );
});
