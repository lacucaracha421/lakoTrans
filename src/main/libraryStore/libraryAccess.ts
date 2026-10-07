import { join } from "node:path";
import type {
  ChapterSnapshot,
  ChapterPageMetadata,
  LibraryChapterSummary,
  LibraryIndex,
  LibraryWorkSummary,
  MangaPage,
} from "../../shared/libraryTypes";
import { hydrateChapter } from "./chapterSnapshots";
import { reorderRecords } from "./chapterRecords";
import { readChapterSummaryFile } from "./libraryChapterSummaries";
import {
  findChapterLocation,
  readChapterFile,
  readIndexFile,
  readWorkFile,
} from "./libraryFiles";
import { getWorksRoot } from "./libraryPaths";
import { logLibraryWarning } from "./libraryLogger";
import { loadTranslationCheckpointArtifact } from "./translationCheckpointStore";

export async function listLibrary(): Promise<LibraryIndex> {
  const index = await readIndexFile();
  const workCandidates = await mapLibraryReads(
    index.workOrder,
    loadLibraryWorkSummary,
  );
  const works = workCandidates.filter(
    (work): work is LibraryWorkSummary => work !== null,
  );

  return {
    workOrder: works.map((work) => work.id),
    works,
  };
}

async function loadLibraryWorkSummary(
  workId: string,
): Promise<LibraryWorkSummary | null> {
  const work = await readWorkFile(workId);
  if (!work) {
    return null;
  }
  const chapterCandidates = await mapLibraryReads(
    work.chapterOrder,
    (chapterId) => readChapterSummaryFile(workId, chapterId),
  );
  const chapters = chapterCandidates.filter(
    (chapter): chapter is LibraryChapterSummary => chapter !== null,
  );
  return { ...work, chapters };
}

async function readNavigationChapter(
  chapterId: string,
  expectedWorkId?: string,
) {
  const owner = expectedWorkId ? await readWorkFile(expectedWorkId) : null;
  const index = expectedWorkId ? await readIndexFile() : null;
  const locator = expectedWorkId
    ? index?.workOrder.includes(expectedWorkId) &&
      owner?.chapterOrder.includes(chapterId)
      ? { workId: expectedWorkId, chapterId }
      : null
    : await findChapterLocation(chapterId);
  if (!locator) {
    throw new Error("열려는 화를 찾지 못했습니다.");
  }
  const chapter = await readChapterFile(locator.workId, locator.chapterId);
  if (!chapter) {
    throw new Error("열려는 화를 찾지 못했습니다.");
  }
  return chapter;
}

export async function openChapter(
  chapterId: string,
  expectedWorkId?: string,
): Promise<ChapterSnapshot> {
  const chapter = await readNavigationChapter(chapterId, expectedWorkId);
  const snapshot = hydrateChapter(chapter);
  const chapterDir = join(
    getWorksRoot(),
    chapter.workId,
    "chapters",
    chapter.id,
  );
  const pages = await Promise.all(
    snapshot.pages.map(async (page) => {
      if (!page.translationCheckpoint) return page;
      try {
        await loadTranslationCheckpointArtifact(chapterDir, page);
        return page;
      } catch (error) {
        logLibraryWarning(
          "Translation checkpoint rejected while opening chapter",
          {
            chapterId,
            pageId: page.id,
            reason: error instanceof Error ? error.message : String(error),
          },
        );
        const { translationCheckpoint: _checkpoint, ...withoutCheckpoint } =
          page;
        return withoutCheckpoint;
      }
    }),
  );
  return { ...snapshot, pages };
}

export async function resolvePagesForRun(
  chapterId: string,
  runMode: "pending" | "all" | "single-page" | "page-set",
  pageId?: string,
  pageIds?: string[],
): Promise<{
  chapter: ChapterSnapshot;
  pages: MangaPage[];
}> {
  const chapter = await openChapter(chapterId);
  return {
    chapter,
    pages: selectRunPages(chapter, runMode, pageId, pageIds),
  };
}

function selectRunPages(
  chapter: ChapterSnapshot,
  runMode: "pending" | "all" | "single-page" | "page-set",
  pageId: string | undefined,
  pageIds: string[] | undefined,
): MangaPage[] {
  switch (runMode) {
    case "all":
      return chapter.pages;
    case "single-page":
      return chapter.pages.filter((page) => page.id === pageId);
    case "page-set": {
      const ids = new Set(pageIds ?? []);
      return chapter.pages.filter((page) => ids.has(page.id));
    }
    default:
      return chapter.pages.filter(
        (page) => page.analysisStatus !== "completed",
      );
  }
}

/** A display-only projection; the validated chapter remains the editing authority. */
export async function getChapterPageMetadata(
  workId: string,
  chapterId: string,
): Promise<ChapterPageMetadata[]> {
  const chapter = await readNavigationChapter(chapterId, workId);
  const ordered = reorderRecords(chapter.pages, chapter.pageOrder);
  return ordered.map(
    ({
      id,
      name,
      imagePath,
      width,
      height,
      analysisStatus,
      createdAt,
      updatedAt,
    }) => ({
      id,
      name,
      imagePath,
      width,
      height,
      analysisStatus,
      createdAt,
      updatedAt,
    }),
  );
}

/** Bound cold-start payload reads while preserving index order and failures. */
async function mapLibraryReads<T, R>(
  items: readonly T[],
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await read(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return results;
}
