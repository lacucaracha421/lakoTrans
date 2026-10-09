import type { RedactionPreparationActions } from "../../lib/redactionPreparation";
import { type Dispatch, type SetStateAction } from "react";
import type { ChapterSnapshot } from "../../../../shared/libraryTypes";
import type { AppCommandRegistry } from "../../lib/appCommandTypes";
import { useAppCommands } from "../../hooks/useAppCommands";

type UseAppSessionCommandControllerArgs = {
  redactionPreparation: RedactionPreparationActions;
  startRegionTranslation: () => void;
  cancelJob: () => void;
  currentChapter: ChapterSnapshot | null;
  jobActive: boolean;
  /** A running job the current translation provider cannot run beside. */
  translationBlocked?: boolean;
  aiUnavailable?: boolean;
  openImportPreview: (mode: "zip-folder") => Promise<void>;
  openLibraryFolder: () => void;
  openLogFolder: () => void;
  openErrorReport: () => void;
  openSettings: () => Promise<void> | void;
  openShareImportPreview: () => Promise<void>;
  runAnalysis: (runMode: "pending" | "all") => void;
  runCurrentPageInpainting: () => void;
  setShareExportOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutHelpOpen: Dispatch<SetStateAction<boolean>>;
  openTextView: () => void;
  openPageEditor?: () => void;
  setShowBlockChrome: Dispatch<SetStateAction<boolean>>;
  setShowTextBlocks: Dispatch<SetStateAction<boolean>>;
  openTranslateOptions: () => void;
  openChat?: () => void;
  setTranslationSourceOpen: Dispatch<SetStateAction<boolean>>;
  setAddPagesChapter: Dispatch<SetStateAction<ChapterSnapshot | null>>;
};

export function useAppSessionCommandController({
  redactionPreparation,
  startRegionTranslation,
  cancelJob,
  currentChapter,
  jobActive,
  translationBlocked,
  aiUnavailable,
  openImportPreview,
  openLibraryFolder,
  openLogFolder,
  openErrorReport,
  openSettings,
  openShareImportPreview,
  runAnalysis,
  runCurrentPageInpainting,
  setShareExportOpen,
  setShortcutHelpOpen,
  openTextView,
  openPageEditor,
  setShowBlockChrome,
  setShowTextBlocks,
  openTranslateOptions,
  openChat,
  setTranslationSourceOpen,
  setAddPagesChapter,
}: UseAppSessionCommandControllerArgs): AppCommandRegistry {
  return useAppCommands({
    redactionPreparation,
    startRegionTranslation,
    cancelJob,
    currentChapter,
    jobActive,
    translationUnavailable:
      Boolean(aiUnavailable) || (translationBlocked ?? jobActive),
    openImportPreview: (mode) => {
      setAddPagesChapter(null);
      return openImportPreview(mode);
    },
    openLibraryFolder,
    openLogFolder,
    openErrorReport,
    openSettings,
    openShareExport: () => setShareExportOpen(true),
    openShareImportPreview,
    openShortcutHelp: () => setShortcutHelpOpen(true),
    openTextView,
    openPageEditor,
    toggleBlockChrome: () => setShowBlockChrome((visible) => !visible),
    toggleTextBlocks: () => setShowTextBlocks((visible) => !visible),
    openTranslateOptions,
    openChat,
    openTranslationSource: () => {
      setAddPagesChapter(null);
      setTranslationSourceOpen(true);
    },
    openAddChapterPages: () => {
      setAddPagesChapter(currentChapter);
      setTranslationSourceOpen(true);
    },
    runAnalysis,
    runCurrentPageInpainting,
  });
}
