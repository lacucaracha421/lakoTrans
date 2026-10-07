import type { MangaPage } from "../../../shared/libraryTypes";
import { createMangaDomainGateway } from "./mangaGateway";

export const libraryGateway = createMangaDomainGateway("Library", [
  "createImport",
  "cancelWebImportScan",
  "deleteChapter",
  "deletePage",
  "dismissSoundEffectReviewRegion",
  "deleteWork",
  "discardImportPreview",
  "discardWebImportSession",
  "exportReviewText",
  "exportWorkShare",
  "getChapterStoryMemory",
  "getPathForFile",
  "getLibrary",
  "getChapterPageMetadata",
  "getPageImageDataUrl",
  "getWorkContextUsage",
  "getWorkResearchTitle",
  "getWorkStyleGuide",
  "importReviewText",
  "importWorkShare",
  "openChapter",
  "prepareSoundEffectTranslation",
  "onWebImportProgress",
  "prepareWebImport",
  "previewFolderImport",
  "previewDroppedImport",
  "previewImagesImport",
  "previewPdfImport",
  "previewWorkShareImport",
  "previewZipFolderImport",
  "previewZipImport",
  "renameChapter",
  "renameWork",
  "reorderChapters",
  "reorderPages",
  "editPageOrganization",
  "resetWorkContext",
  "restoreSoundEffectReview",
  "saveChapterStoryMemory",
  "savePageBlocks",
  "savePagesBlocks",
  "savePagesBlocksPatch",
  "saveTextFile",
  "saveWorkResearchTitle",
  "saveWorkStyleGuide",
  "scanWebImport",
] as const);

/** Export selection needs presentation records; richer pickers keep full pages. */
export async function loadChapterPickerPages(
  workId: string,
  chapterId: string,
  metadataOnly: boolean,
): Promise<MangaPage[]> {
  if (!metadataOnly)
    return (await libraryGateway.openChapter(chapterId, workId)).pages;
  const metadata = await libraryGateway.getChapterPageMetadata(
    workId,
    chapterId,
  );
  return metadata.map((page) => ({ ...page, blocks: [], dataUrl: "" }));
}
