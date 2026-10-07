import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatErrorMessage } from "../lib/errorPresentation";
import { libraryGateway } from "../api/libraryGateway";
import type { UseLibraryActionsOptions } from "./libraryActionTypes";
import { useEventCallback } from "./useEventCallback";

type OpenChapterOptions = Pick<
  UseLibraryActionsOptions,
  | "clearDirtyTracking"
  | "clearPendingInpaintingMasks"
  | "currentChapterRef"
  | "dirty"
  | "library"
  | "hasPendingInpaintingMask"
  | "patternMaskStrokesByPage"
  | "askConfirm"
  | "onChapterOpened"
  | "pushStatus"
  | "resetSaveBaseline"
  | "saveNow"
  | "setCurrentChapter"
  | "setSelectedBlockId"
  | "setSelectedPageId"
>;

export function useOpenChapterAction({
  askConfirm,
  clearDirtyTracking,
  clearPendingInpaintingMasks,
  currentChapterRef,
  dirty,
  library,
  hasPendingInpaintingMask,
  patternMaskStrokesByPage,
  onChapterOpened,
  pushStatus,
  resetSaveBaseline,
  saveNow,
  setCurrentChapter,
  setSelectedBlockId,
  setSelectedPageId,
}: OpenChapterOptions): (chapterId: string) => Promise<void> {
  const { t } = useTranslation("renderer");
  const latestRequestIdRef = useRef(0);
  const readPendingMask = useEventCallback(() => ({
    hasPending: hasPendingInpaintingMask,
    revision: patternMaskStrokesByPage,
  }));
  return useCallback(
    async (chapterId) => {
      const requestId = ++latestRequestIdRef.current;
      const isLatestRequest = () => latestRequestIdRef.current === requestId;
      try {
        await performOpenChapterRequest({
          askConfirm,
          chapterId,
          clearDirtyTracking,
          clearPendingInpaintingMasks,
          currentChapterRef,
          dirty,
          library,
          readPendingMask,
          isLatestRequest,
          onChapterOpened,
          resetSaveBaseline,
          saveNow,
          setCurrentChapter,
          setSelectedBlockId,
          setSelectedPageId,
          t,
        });
      } catch (error) {
        if (isLatestRequest()) {
          pushStatus(formatErrorMessage(error, t("library.openChapterFailed")));
        }
      }
    },
    [
      clearDirtyTracking,
      clearPendingInpaintingMasks,
      currentChapterRef,
      dirty,
      library,
      readPendingMask,
      askConfirm,
      onChapterOpened,
      pushStatus,
      resetSaveBaseline,
      saveNow,
      setCurrentChapter,
      setSelectedBlockId,
      setSelectedPageId,
      t,
    ],
  );
}

type PerformOpenChapterRequestOptions = Pick<
  OpenChapterOptions,
  | "askConfirm"
  | "clearDirtyTracking"
  | "clearPendingInpaintingMasks"
  | "currentChapterRef"
  | "dirty"
  | "library"
  | "onChapterOpened"
  | "resetSaveBaseline"
  | "saveNow"
  | "setCurrentChapter"
  | "setSelectedBlockId"
  | "setSelectedPageId"
> & {
  readPendingMask: () => {
    hasPending: boolean | undefined;
    revision: OpenChapterOptions["patternMaskStrokesByPage"];
  };
  chapterId: string;
  isLatestRequest: () => boolean;
  t: TFunction<"renderer">;
};

async function performOpenChapterRequest(
  options: PerformOpenChapterRequestOptions,
): Promise<void> {
  if (options.currentChapterRef.current?.id === options.chapterId) {
    return;
  }
  if (!(await saveDirtyChapter(options))) {
    return;
  }
  const owner = options.library.works.find((work) =>
    work.chapterOrder.includes(options.chapterId),
  );
  const chapter = await libraryGateway.openChapter(
    options.chapterId,
    owner?.id,
  );
  if (!options.isLatestRequest()) {
    return;
  }
  await options.saveNow();
  if (!options.isLatestRequest()) {
    return;
  }
  if (
    !(await confirmPendingMaskDiscard(options)) ||
    !options.isLatestRequest()
  ) {
    return;
  }
  installOpenedChapter(options, chapter);
}

async function confirmPendingMaskDiscard(
  options: PerformOpenChapterRequestOptions,
): Promise<boolean> {
  while (options.isLatestRequest()) {
    const before = options.readPendingMask();
    if (before.hasPending) {
      const confirmed = await options.askConfirm(
        options.t("inpainting.maskDiscard.title"),
        options.t("inpainting.maskDiscard.message"),
        options.t("inpainting.maskDiscard.detail"),
      );
      if (!confirmed || !options.isLatestRequest()) return false;
    }
    await options.saveNow();
    if (!options.isLatestRequest()) return false;
    const after = options.readPendingMask();
    if (
      !after.hasPending ||
      (before.hasPending && before.revision === after.revision)
    ) {
      return true;
    }
  }
  return false;
}

async function saveDirtyChapter(
  options: PerformOpenChapterRequestOptions,
): Promise<boolean> {
  if (!options.dirty) {
    return true;
  }
  await options.saveNow();
  return options.isLatestRequest();
}

function installOpenedChapter(
  options: PerformOpenChapterRequestOptions,
  chapter: Awaited<ReturnType<typeof libraryGateway.openChapter>>,
): void {
  options.clearDirtyTracking();
  options.currentChapterRef.current = chapter;
  options.resetSaveBaseline(chapter);
  options.setCurrentChapter(chapter);
  options.setSelectedPageId(chapter.pages[0]?.id ?? null);
  options.setSelectedBlockId(null);
  options.clearPendingInpaintingMasks?.();
  options.onChapterOpened?.();
}
