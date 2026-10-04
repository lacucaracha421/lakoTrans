/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportModal } from "../src/renderer/src/components/ImportModal";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";
import type { ChapterSnapshot, LibraryIndex } from "../src/shared/libraryTypes";
import type { ImportPreviewResult } from "../src/shared/importTypes";
import type { ImportModalSubmit } from "../src/renderer/src/lib/importFlowTypes";
import { chooseCustomSelectOption } from "./testUtils/customSelect";

const stamp = "2026-10-01T00:00:00.000Z";
function chapter(id: string, workId: string, title: string): ChapterSnapshot {
  return {
    id,
    workId,
    title,
    sourceKind: "images",
    status: "idle",
    createdAt: stamp,
    updatedAt: stamp,
    pageOrder: [`${id}-page`],
    pages: [
      {
        id: `${id}-page`,
        name: "1.png",
        imagePath: "1.png",
        dataUrl: "",
        width: 10,
        height: 10,
        blocks: [],
        analysisStatus: "idle",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
  };
}
const first = chapter("one", "work-one", "1화");
const second = chapter("two", "work-one", "2화");
const third = chapter("three", "work-two", "다른 화");
const chapters = [first, second, third];
const library: LibraryIndex = {
  workOrder: ["work-one", "work-two"],
  works: ["work-one", "work-two"].map((id, index) => ({
    id,
    title: index === 0 ? "첫 작품" : "다른 작품",
    createdAt: stamp,
    updatedAt: stamp,
    chapterOrder: chapters
      .filter((item) => item.workId === id)
      .map((item) => item.id),
    chapters: chapters
      .filter((item) => item.workId === id)
      .map((item) => ({ ...item, pageCount: item.pages.length })),
  })),
};
const preview: ImportPreviewResult = {
  mode: "batch",
  sourceKind: "images",
  suggestedWorkTitle: "원본 작품",
  chapters: ["a", "b"].map((id) => ({
    draftId: id,
    title: `원본 ${id}`,
    sourceKind: "images",
    pages: [{ name: `${id}.png`, sourcePath: `${id}.png`, sourceKind: "file" }],
  })),
};
const openChapter = vi.fn(async (id: string) => {
  const result = chapters.find((item) => item.id === id);
  if (!result) throw new Error("missing chapter");
  return result;
});
beforeEach(() => {
  openChapter.mockClear();
  window.mangaApi = createTestMangaGatewayStub({ openChapter });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.mangaApi = createTestMangaGatewayStub();
});

function setup(props: Partial<React.ComponentProps<typeof ImportModal>> = {}) {
  const onSubmit = vi.fn();
  const options = {
    library,
    currentWorkId: first.workId,
    currentChapterId: second.id,
    preview,
    busy: false,
    onCancel: vi.fn(),
    onSubmit,
    ...props,
  };
  return { ...render(<ImportModal {...options} />), onSubmit, options };
}
function switchToPages() {
  fireEvent.click(screen.getByRole("radio", { name: "페이지 추가" }));
}

describe("library import destination modes", () => {
  it.each([first.workId, null])(
    "skips stale chapter order entries with current work %s and no current chapter",
    async (currentWorkId) => {
      setup({
        currentWorkId,
        currentChapterId: null,
        library: {
          ...library,
          works: library.works.map((work) =>
            work.id === first.workId
              ? { ...work, chapterOrder: ["missing", second.id, first.id] }
              : work,
          ),
        },
      });
      switchToPages();
      await screen.findByRole("combobox", { name: "추가 위치" });
      expect(screen.getByRole("combobox", { name: "화 선택" })).toHaveProperty(
        "value",
        second.id,
      );
      expect(openChapter).toHaveBeenLastCalledWith(second.id);
    },
  );
  it("defaults to a new chapter and retains edited inputs and selected sources through page mode", async () => {
    const { onSubmit } = setup();
    expect(
      screen
        .getByRole("radio", { name: "새 화 추가" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(openChapter).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue("원본 a"), {
      target: { value: "수정한 제목" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "원본 b · 1페이지" }));
    switchToPages();
    await screen.findByRole("combobox", { name: "추가 위치" });
    expect(screen.getByRole("combobox", { name: "화 선택" })).toHaveProperty(
      "value",
      second.id,
    );
    expect(
      screen.queryByRole("switch", { name: "결과물 폴더에 자동 저장" }),
    ).toBeNull();
    chooseCustomSelectOption("추가 위치", "페이지 뒤");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "추가한 페이지만 번역" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "페이지 추가" }));
    expect(onSubmit).toHaveBeenLastCalledWith({
      target: {
        mode: "chapter",
        workId: second.workId,
        chapterId: second.id,
        position: { kind: "after", pageId: second.pages[0].id },
      },
      selections: [
        { draftId: "a", title: "수정한 제목", enabled: true },
        { draftId: "b", title: "원본 b", enabled: false },
      ],
      translateAddedPages: true,
    });
    fireEvent.click(screen.getByRole("radio", { name: "새 화 추가" }));
    expect(screen.getByDisplayValue("수정한 제목")).not.toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "원본 b · 1페이지" }),
    ).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("button", { name: "추가 후 번역" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { mode: "existing", workId: first.workId },
        linkedWorkspace: expect.objectContaining({ enabled: true }),
      }),
    );
    switchToPages();
    await screen.findByRole("combobox", { name: "기준 페이지" });
    expect(screen.getByRole("combobox", { name: "추가 위치" })).toHaveProperty(
      "value",
      "after",
    );
  });

  it("chooses a different work and chapter and resets the insertion anchor", async () => {
    const { onSubmit } = setup();
    switchToPages();
    await screen.findByRole("combobox", { name: "추가 위치" });
    chooseCustomSelectOption("추가 위치", "페이지 앞");
    chooseCustomSelectOption("화 선택", "1화");
    await waitFor(() => expect(openChapter).toHaveBeenLastCalledWith(first.id));
    await screen.findByRole("combobox", { name: "추가 위치" });
    expect(screen.getByRole("combobox", { name: "추가 위치" })).toHaveProperty(
      "value",
      "end",
    );
    chooseCustomSelectOption("작품 선택", /다른 작품/);
    await waitFor(() => expect(openChapter).toHaveBeenLastCalledWith(third.id));
    await screen.findByRole("combobox", { name: "추가 위치" });
    fireEvent.click(screen.getByRole("button", { name: "페이지 추가" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: {
          mode: "chapter",
          workId: third.workId,
          chapterId: third.id,
          position: { kind: "end" },
        },
        translateAddedPages: false,
      }),
    );
  });

  it("ignores late chapter reads and blocks submission while the chosen chapter is loading", async () => {
    let finishFirst: (value: ChapterSnapshot) => void = () => {
      throw new Error("uninitialized promise");
    };
    const pending = new Promise<ChapterSnapshot>((resolve) => {
      finishFirst = resolve;
    });
    const read = vi.fn((id: string) =>
      id === second.id ? pending : Promise.resolve(third),
    );
    window.mangaApi = createTestMangaGatewayStub({ openChapter: read });
    const { onSubmit } = setup();
    switchToPages();
    expect(screen.getByRole("button", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      true,
    );
    chooseCustomSelectOption("작품 선택", /다른 작품/);
    await screen.findByRole("combobox", { name: "추가 위치" });
    await act(async () => {
      finishFirst(second);
      await pending;
    });
    chooseCustomSelectOption("추가 위치", "페이지 앞");
    fireEvent.click(screen.getByRole("button", { name: "페이지 추가" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: {
          mode: "chapter",
          workId: third.workId,
          chapterId: third.id,
          position: { kind: "before", pageId: third.pages[0].id },
        },
      }),
    );
  });

  it("keeps the page target and exact submission after an interrupted import", async () => {
    const draft: ImportModalSubmit = {
      target: {
        mode: "chapter",
        workId: third.workId,
        chapterId: third.id,
        position: { kind: "after", pageId: third.pages[0].id },
      },
      selections: [
        { draftId: "a", title: "a", enabled: false },
        { draftId: "b", title: "", enabled: true },
      ],
      translateAddedPages: true,
    };
    const { onSubmit } = setup({
      initialDraft: draft,
      feedback: { variant: "danger", message: "가져오기 실패" },
    });
    expect(
      screen
        .getByRole("radio", { name: "페이지 추가" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await screen.findByRole("combobox", { name: "기준 페이지" });
    fireEvent.click(screen.getByRole("button", { name: "페이지 추가" }));
    expect(onSubmit).toHaveBeenCalledWith(draft);
  });

  it("shows a failed read and can retry without losing the target", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue(second);
    window.mangaApi = createTestMangaGatewayStub({ openChapter: read });
    setup();
    switchToPages();
    await screen.findByText("화를 열지 못했습니다.");
    expect(screen.getByRole("button", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await screen.findByRole("combobox", { name: "추가 위치" });
    expect(screen.getByRole("button", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(read).toHaveBeenNthCalledWith(2, second.id);
  });

  it("does not allow page addition when there are no chapters or the selected chapter was removed", async () => {
    setup({
      library: { works: [], workOrder: [] },
    });
    expect(screen.getByRole("radio", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      true,
    );
    cleanup();
    const view = setup();
    switchToPages();
    await screen.findByRole("combobox", { name: "추가 위치" });
    view.rerender(
      <ImportModal {...view.options} library={{ works: [], workOrder: [] }} />,
    );
    expect(screen.getByRole("button", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("combobox", { name: "추가 위치" })).toBeNull();
  });

  it("locks mode and target controls while an import is submitting", () => {
    setup({ busy: true, addPagesChapter: second });
    for (const name of ["새 화 추가", "페이지 추가"])
      expect(screen.getByRole("radio", { name })).toHaveProperty(
        "disabled",
        true,
      );
    for (const name of ["작품 선택", "화 선택", "추가 위치"])
      expect(screen.getByRole("combobox", { name })).toHaveProperty(
        "disabled",
        true,
      );
    expect(screen.getByRole("button", { name: "페이지 추가" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
