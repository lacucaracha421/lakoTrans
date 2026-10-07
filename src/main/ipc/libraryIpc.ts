import { chapterPageIpcContracts } from "../../shared/ipcChapterPageContracts";
import { editPageOrganization } from "../library/pageOrganizationFacade";
import { shell } from "electron";
import {
  DeleteChapterRequestSchema,
  DeletePageRequestSchema,
  DeleteWorkRequestSchema,
  ImageDataUrlRequestSchema,
  OpenChapterRequestSchema,
  RenameChapterRequestSchema,
  RenameWorkRequestSchema,
  ReorderChaptersRequestSchema,
  ReorderPagesRequestSchema,
  SavePageBlocksRequestSchema,
  parseIpcPayload,
} from "../../shared/ipcSchemas";
import {
  DismissSoundEffectReviewRegionRequestSchema,
  PrepareSoundEffectTranslationRequestSchema,
  RestoreSoundEffectReviewRequestSchema,
} from "../../shared/ipcSoundEffectReviewSchemas";
import { libraryIpcContracts } from "../../shared/ipcContracts";
import {
  deleteChapter,
  deletePage,
  dismissSoundEffectReviewRegion,
  deleteWork,
  getLibraryRoot,
  getChapterPageMetadata,
  listLibrary,
  openChapter,
  prepareSoundEffectTranslation,
  restoreSoundEffectReview,
  renameChapter,
  renameWork,
  reorderChapters,
  reorderPages,
  savePageBlocks,
  savePagesBlocks,
  savePagesBlocksPatch,
} from "../library";
import { createLibraryImageUrl } from "../imageProtocol";
import type { IpcContext } from "./context";
import { tMain } from "./localization";
import { trustedHandleContract } from "./trustedIpc";

export function registerLibraryIpc(context: IpcContext): void {
  registerLibraryReadIpc(context);
  registerLibraryRenameIpc(context);
  registerLibraryDeleteIpc(context);
  registerLibraryReorderIpc(context);
  registerSoundEffectReviewIpc(context);
}

function registerLibraryReadIpc(context: IpcContext): void {
  trustedHandleContract(context, libraryIpcContracts.getLibrary, async () =>
    listLibrary(),
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.openLibraryFolder,
    async () => {
      const error = await shell.openPath(getLibraryRoot());
      return {
        opened: !error,
        libraryPath: getLibraryRoot(),
        ...(error ? { error } : {}),
      };
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.openChapter,
    async (_event, chapterId: unknown, workId?: unknown) => {
      const request = parseIpcPayload(
        OpenChapterRequestSchema,
        { chapterId, workId },
        tMain("ipc.labels.chapterOpen"),
      );
      return openChapter(request.chapterId, request.workId);
    },
  );
  trustedHandleContract(
    context,
    chapterPageIpcContracts.getChapterPageMetadata,
    async (_event, workId, chapterId) =>
      getChapterPageMetadata(workId, chapterId),
  );
  trustedHandleContract(
    context,
    chapterPageIpcContracts.savePagesBlocksPatch,
    async (_event, request) => savePagesBlocksPatch(request),
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.getPageImageDataUrl,
    async (_event, imagePath: unknown, thumbnailMaxEdge?: unknown) => {
      const request = parseIpcPayload(
        ImageDataUrlRequestSchema,
        { imagePath, thumbnailMaxEdge },
        tMain("ipc.labels.pageImageOpen"),
      );
      return createLibraryImageUrl(request.imagePath, request.thumbnailMaxEdge);
    },
  );
  trustedHandleContract(
    context,
    chapterPageIpcContracts.savePageBlocks,
    async (_event, raw: unknown) =>
      savePageBlocks(
        parseIpcPayload(
          SavePageBlocksRequestSchema,
          raw,
          tMain("ipc.labels.pageBlocksSave"),
        ),
      ),
  );
  trustedHandleContract(
    context,
    chapterPageIpcContracts.savePagesBlocks,
    async (_event, request) => savePagesBlocks(request),
  );
}

function registerLibraryRenameIpc(context: IpcContext): void {
  trustedHandleContract(
    context,
    libraryIpcContracts.renameWork,
    async (_event, workId: unknown, title: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        RenameWorkRequestSchema,
        { workId, title },
        tMain("ipc.labels.workRename"),
      );
      return renameWork(request.workId, request.title);
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.renameChapter,
    async (_event, chapterId: unknown, title: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        RenameChapterRequestSchema,
        { chapterId, title },
        tMain("ipc.labels.chapterRename"),
      );
      return renameChapter(request.chapterId, request.title);
    },
  );
}

function registerLibraryDeleteIpc(context: IpcContext): void {
  trustedHandleContract(
    context,
    libraryIpcContracts.deleteWork,
    async (_event, workId: unknown, removeCustomOutputs = false) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        DeleteWorkRequestSchema,
        { workId },
        tMain("ipc.labels.workDelete"),
      );
      return context.linkedWorkspaceSync
        ? context.linkedWorkspaceSync.deleteLibraryTarget(
            { kind: "work", id: request.workId },
            removeCustomOutputs,
            () => deleteWork(request.workId),
          )
        : deleteWork(request.workId);
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.deleteChapter,
    async (_event, chapterId: unknown, removeCustomOutputs = false) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        DeleteChapterRequestSchema,
        { chapterId },
        tMain("ipc.labels.chapterDelete"),
      );
      return context.linkedWorkspaceSync
        ? context.linkedWorkspaceSync.deleteLibraryTarget(
            { kind: "chapter", id: request.chapterId },
            removeCustomOutputs,
            () => deleteChapter(request.chapterId),
          )
        : deleteChapter(request.chapterId);
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.deletePage,
    async (_event, chapterId: unknown, pageId: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        DeletePageRequestSchema,
        { chapterId, pageId },
        tMain("ipc.labels.pageDelete"),
      );
      return deletePage(request.chapterId, request.pageId);
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.dismissSoundEffectReviewRegion,
    async (_event, chapterId: unknown, pageId: unknown, regionId: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        DismissSoundEffectReviewRegionRequestSchema,
        { chapterId, pageId, regionId },
        "효과음 검토 대상 제외",
      );
      return dismissSoundEffectReviewRegion(
        request.chapterId,
        request.pageId,
        request.regionId,
      );
    },
  );
}

function registerLibraryReorderIpc(context: IpcContext): void {
  trustedHandleContract(
    context,
    libraryIpcContracts.editPageOrganization,
    async (_event, request) => {
      assertLibraryStructureMutationAvailable(context);
      return editPageOrganization(
        request,
        (chapter) =>
          context.linkedWorkspaceSync?.validatePageOrganization(chapter) ??
          Promise.resolve(),
      );
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.reorderChapters,
    async (_event, workId: unknown, chapterIds: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        ReorderChaptersRequestSchema,
        { workId, chapterIds },
        tMain("ipc.labels.chapterReorder"),
      );
      return reorderChapters(request.workId, request.chapterIds);
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.reorderPages,
    async (_event, chapterId: unknown, pageIds: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      const request = parseIpcPayload(
        ReorderPagesRequestSchema,
        { chapterId, pageIds },
        tMain("ipc.labels.pageReorder"),
      );
      return reorderPages(request.chapterId, request.pageIds);
    },
  );
}

function registerSoundEffectReviewIpc(context: IpcContext): void {
  trustedHandleContract(
    context,
    libraryIpcContracts.restoreSoundEffectReview,
    async (_event, raw: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      return restoreSoundEffectReview(
        parseIpcPayload(
          RestoreSoundEffectReviewRequestSchema,
          raw,
          "효과음 제외 후보 복원",
        ),
      );
    },
  );
  trustedHandleContract(
    context,
    libraryIpcContracts.prepareSoundEffectTranslation,
    async (_event, raw: unknown) => {
      assertLibraryStructureMutationAvailable(context);
      return prepareSoundEffectTranslation(
        parseIpcPayload(
          PrepareSoundEffectTranslationRequestSchema,
          raw,
          "효과음 번역 검토 저장",
        ),
      );
    },
  );
}

function assertLibraryStructureMutationAvailable(context: IpcContext): void {
  context.jobs.gate.assertAvailable([]);
}
