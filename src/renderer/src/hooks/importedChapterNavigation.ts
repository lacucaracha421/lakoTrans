import type { ChapterSnapshot } from "../../../shared/libraryTypes";
import type { UseImportShareActionsOptions } from "./importShareActionTypes";
import { libraryGateway } from "../api/libraryGateway";

export async function finishImportedChapterNavigation({
  applyChapter,
  chapter,
  getNavigationKey,
  navigationKey,
  openTranslateOptions,
  openWorkTranslation,
  addedPageIds,
  refreshChapter = false,
  pushStatus,
  resetWorkspaceHistory,
  saveNow,
  status,
}: {
  applyChapter: UseImportShareActionsOptions["applyChapter"];
  chapter: ChapterSnapshot | undefined;
  getNavigationKey: () => string;
  navigationKey: string;
  openTranslateOptions: UseImportShareActionsOptions["openTranslateOptions"];
  openWorkTranslation: boolean;
  addedPageIds?: string[];
  refreshChapter?: boolean;
  pushStatus: UseImportShareActionsOptions["pushStatus"];
  resetWorkspaceHistory: UseImportShareActionsOptions["resetWorkspaceHistory"];
  saveNow: UseImportShareActionsOptions["saveNow"];
  status: string;
}): Promise<void> {
  if (!chapter) {
    pushStatus(status);
    return;
  }
  try {
    await saveNow();
    if (refreshChapter)
      chapter = await libraryGateway.openChapter(chapter.id, chapter.workId);
  } catch (_error) {
    pushStatus(status);
    return;
  }
  if (getNavigationKey() !== navigationKey) {
    pushStatus(status);
    return;
  }
  resetWorkspaceHistory();
  applyChapter(chapter, status);
  if (addedPageIds?.length)
    openTranslateOptions({ chapterId: chapter.id, pageIds: addedPageIds });
  else if (openWorkTranslation) openTranslateOptions("work-all");
}
