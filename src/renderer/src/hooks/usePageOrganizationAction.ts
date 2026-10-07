import React from "react";
import type { ChapterSnapshot } from "../../../shared/libraryTypes";
import type { EditPageOrganizationRequest } from "../../../shared/pageOrganization";
import { libraryGateway } from "../api/libraryGateway";
import type { UseLibraryActionsOptions } from "./libraryActionTypes";

export function usePageOrganizationAction(
  options: UseLibraryActionsOptions & { refreshLibrary: () => Promise<void> },
) {
  const [chapter, setChapter] = React.useState<ChapterSnapshot | null>(null);
  const open = () => {
    if (options.currentChapterRef.current)
      setChapter(options.currentChapterRef.current);
  };
  const onSave = async (request: EditPageOrganizationRequest) => {
    if (options.dirty) await options.saveNow();
    if (options.currentChapterRef.current?.id !== request.chapterId)
      throw new Error("편집 중인 화가 변경되었습니다.");
    const saved = await libraryGateway.editPageOrganization(request);
    if (options.currentChapterRef.current?.id === saved.id) {
      options.currentChapterRef.current = saved;
      options.setCurrentChapter(saved);
      options.resetSaveBaseline(saved);
      options.clearDirtyTracking();
    }
    void options
      .refreshLibrary()
      .catch((error: unknown) => options.pushStatus(String(error)));
  };
  return {
    openPageEditor: open,
    pageEditor: chapter
      ? {
          chapter,
          workTitle:
            options.library.works.find((work) => work.id === chapter.workId)
              ?.title ?? "",
          onSave,
          onClose: () => setChapter(null),
          onReload: async () => {
            if (options.dirty) await options.saveNow();
            const next = await libraryGateway.openChapter(
              chapter.id,
              chapter.workId,
            );
            if (!next) throw new Error("화를 찾지 못했습니다.");
            return next;
          },
        }
      : null,
  };
}
