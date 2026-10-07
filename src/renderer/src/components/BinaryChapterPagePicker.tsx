import React from "react";
import { useTranslation } from "react-i18next";
import type {
  ChapterSnapshot,
  LibraryChapterSummary,
  LibraryWorkSummary,
  MangaPage,
} from "../../../shared/libraryTypes";
import {
  applyPageRangeSelection,
  resolveChapterTriState,
  resolveSelectedPageIds,
  setChapterSelection,
  togglePageSelection,
  type BinaryPageSelectionMap,
} from "../lib/pageSelection";
import { Button } from "./ui/Button";
import { WorkPagePicker } from "./WorkPagePicker";
import { usePageRangeAnchor } from "./usePageRangeAnchor";

const SELECT_ALL = { kind: "all" } as const;

type BinaryPickerActions = {
  selectCurrentChapter: () => void;
  selectAll: () => void;
  clear: () => void;
};

export type BinaryChapterPagePickerProps = {
  work: LibraryWorkSummary;
  currentChapter: ChapterSnapshot;
  currentPageId?: string | null;
  selection: BinaryPageSelectionMap;
  onChange: (next: BinaryPageSelectionMap) => void;
  renderHeader: (actions: BinaryPickerActions) => React.ReactNode;
  getChapterSummary: (
    chapter: LibraryChapterSummary,
    pages: MangaPage[] | undefined,
  ) => string;
  renderSelectionSummary: () => React.ReactNode;
  pageMetadataOnly?: boolean;
};

/** Binary page selection adapter shared by output, inpainting, and page work. */
export function BinaryChapterPagePicker({
  work,
  currentChapter,
  currentPageId,
  selection,
  onChange,
  renderHeader,
  getChapterSummary,
  renderSelectionSummary,
  pageMetadataOnly = false,
}: BinaryChapterPagePickerProps): React.JSX.Element {
  const {
    reset: resetAnchor,
    togglePage,
    toggleRange,
  } = usePageRangeAnchor(
    (chapterId, pageId, pages) =>
      onChange(
        togglePageSelection(selection, chapterId, pageId, pages, {
          collapseFullPageSetToAll: true,
          selectAll: SELECT_ALL,
        }),
      ),
    (chapterId, anchorPageId, targetPageId, pages) =>
      onChange(
        applyPageRangeSelection(
          selection,
          chapterId,
          anchorPageId,
          targetPageId,
          pages,
          { collapseFullPageSetToAll: true, selectAll: SELECT_ALL },
        ),
      ),
  );
  React.useEffect(
    () => resetAnchor(),
    [resetAnchor, work.id, currentChapter.id],
  );
  const actions = createBinaryPickerActions(
    work,
    currentChapter,
    onChange,
    resetAnchor,
  );
  return (
    <WorkPagePicker
      work={work}
      currentChapter={currentChapter}
      currentPageId={currentPageId}
      header={renderHeader(actions)}
      getChapterTriState={(chapter, pages) =>
        resolveChapterTriState(
          selection.get(chapter.id),
          chapter.pageCount,
          pages,
        )
      }
      getSelectedPageIds={(chapter, pages) =>
        resolveSelectedPageIds(selection.get(chapter.id), pages)
      }
      getChapterSummary={getChapterSummary}
      renderSelectionSummary={renderSelectionSummary}
      onToggleChapter={(chapterId, checked) => {
        resetAnchor();
        onChange(
          setChapterSelection(selection, chapterId, SELECT_ALL, checked),
        );
      }}
      onTogglePage={togglePage}
      onTogglePageRange={toggleRange}
      showTranslatedStatus={false}
      pageMetadataOnly={pageMetadataOnly}
    />
  );
}

function createBinaryPickerActions(
  work: LibraryWorkSummary,
  currentChapter: ChapterSnapshot,
  onChange: BinaryChapterPagePickerProps["onChange"],
  resetAnchor: () => void,
): BinaryPickerActions {
  const replace = (next: BinaryPageSelectionMap) => {
    resetAnchor();
    onChange(next);
  };
  return {
    selectCurrentChapter: () =>
      replace(new Map([[currentChapter.id, SELECT_ALL]])),
    selectAll: () =>
      replace(
        new Map(work.chapters.map((chapter) => [chapter.id, SELECT_ALL])),
      ),
    clear: () => replace(new Map()),
  };
}

type PageSelectionPickerCopy = {
  prompt: string;
  currentChapter: string;
  chapterSummary: (pageCount: number) => string;
  noSelectedPages: string;
  selectionSummary: (chapterCount: number, pageCount: number) => string;
};

export type PageSelectionPickerProps = Pick<
  BinaryChapterPagePickerProps,
  | "work"
  | "currentChapter"
  | "currentPageId"
  | "selection"
  | "onChange"
  | "pageMetadataOnly"
> & { copy: PageSelectionPickerCopy };

export function PageSelectionPicker({
  work,
  currentChapter,
  currentPageId,
  selection,
  onChange,
  copy,
  pageMetadataOnly,
}: PageSelectionPickerProps): React.JSX.Element {
  return (
    <BinaryChapterPagePicker
      work={work}
      currentChapter={currentChapter}
      currentPageId={currentPageId}
      selection={selection}
      onChange={onChange}
      renderHeader={(actions) => (
        <PickerHeader work={work} copy={copy} actions={actions} />
      )}
      getChapterSummary={(chapter) => copy.chapterSummary(chapter.pageCount)}
      renderSelectionSummary={() => summarizeSelection(work, selection, copy)}
      pageMetadataOnly={pageMetadataOnly}
    />
  );
}

function PickerHeader({
  work,
  copy,
  actions,
}: {
  work: LibraryWorkSummary;
  copy: PageSelectionPickerCopy;
  actions: BinaryPickerActions;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <div className="translate-picker-head">
      <div className="translate-picker-heading">
        <div className="translate-picker-worktitle">{work.title}</div>
        <div className="translate-picker-subtitle">{copy.prompt}</div>
      </div>
      <div className="translate-picker-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={actions.selectCurrentChapter}
        >
          {copy.currentChapter}
        </Button>
        <Button variant="ghost" size="sm" onClick={actions.selectAll}>
          {t("common.selectAll")}
        </Button>
        <Button variant="ghost" size="sm" onClick={actions.clear}>
          {t("common.clearAll")}
        </Button>
      </div>
    </div>
  );
}

function summarizeSelection(
  work: LibraryWorkSummary,
  selection: BinaryPageSelectionMap,
  copy: PageSelectionPickerCopy,
): string {
  let chapterCount = 0;
  let pageCount = 0;
  for (const chapter of work.chapters) {
    const selected = selection.get(chapter.id);
    if (!selected) continue;
    chapterCount += 1;
    pageCount +=
      selected.kind === "all" ? chapter.pageCount : selected.pageIds.size;
  }
  return chapterCount === 0
    ? copy.noSelectedPages
    : copy.selectionSummary(chapterCount, pageCount);
}
