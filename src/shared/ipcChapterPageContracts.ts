import { z } from "zod";
import { defineIpcContract, MAX_PAGES_PER_REQUEST } from "./ipcContractCore";
import {
  ChapterSnapshotSchema,
  OpenChapterRequestSchema,
  SavePageBlocksRequestSchema,
  SavePagesBlocksRequestSchema,
} from "./ipcLibrarySchemas";
import type {
  ChapterSnapshot,
  ChapterPageMetadata,
  ChapterPagesPatch,
} from "./libraryTypes";
import type {
  SavePageBlocksRequest,
  SavePagesBlocksRequest,
} from "./shareTypes";

// Select the validated page input fields before full-page normalization.
const ChapterPageMetadataSchema = ChapterSnapshotSchema.shape.pages.element.in
  .pick({
    id: true,
    name: true,
    imagePath: true,
    width: true,
    height: true,
    analysisStatus: true,
    createdAt: true,
    updatedAt: true,
  })
  .strict();
const ChapterPagesPatchSchema = ChapterSnapshotSchema.pick({
  id: true,
  workId: true,
  status: true,
  updatedAt: true,
  pageOrder: true,
  pages: true,
}).strict();

export const chapterPageIpcContracts = {
  getChapterPageMetadata: defineIpcContract<
    [string, string],
    ChapterPageMetadata[]
  >({
    apiKey: "getChapterPageMetadata",
    channel: "library:get-chapter-page-metadata",
    args: z.tuple([
      OpenChapterRequestSchema.shape.workId.unwrap(),
      OpenChapterRequestSchema.shape.chapterId,
    ]),
    result: z.array(ChapterPageMetadataSchema).max(MAX_PAGES_PER_REQUEST),
  }),
  savePagesBlocksPatch: defineIpcContract<
    [SavePagesBlocksRequest],
    ChapterPagesPatch
  >({
    apiKey: "savePagesBlocksPatch",
    channel: "library:save-pages-blocks-patch",
    args: z.tuple([SavePagesBlocksRequestSchema]),
    result: ChapterPagesPatchSchema,
  }),
  savePageBlocks: defineIpcContract<[SavePageBlocksRequest], ChapterSnapshot>({
    apiKey: "savePageBlocks",
    channel: "library:save-page-blocks",
    args: z.tuple([SavePageBlocksRequestSchema]),
    result: ChapterSnapshotSchema,
  }),
  savePagesBlocks: defineIpcContract<[SavePagesBlocksRequest], ChapterSnapshot>(
    {
      apiKey: "savePagesBlocks",
      channel: "library:save-pages-blocks",
      args: z.tuple([SavePagesBlocksRequestSchema]),
      result: ChapterSnapshotSchema,
    },
  ),
} as const;
