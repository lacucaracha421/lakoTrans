import type { ChapterSnapshot } from "../../../shared/libraryTypes";
import type { AutoInpaintingEntryScope } from "../lib/autoInpaintingSelection";
import type { LinkedWorkspaceStatus } from "../../../shared/linkedWorkspaceTypes";

export type ChapterTaskHubProps = {
  currentChapter: ChapterSnapshot | null;
  jobActive: boolean;
  flowActive: boolean;
  linkedWorkspaceStatus: LinkedWorkspaceStatus | null;
  linkedWorkspaceViewBusy: boolean;
  onOpenExport: () => void;
  onOpenPsdExport: () => void;
  onViewLinkedResults: () => void;
  onOpenTranslateOptions: () => void;
  onOpenChat?: () => void;
  onOpenAutoInpaintingOptions: (scope: AutoInpaintingEntryScope) => void;
  onRunBubbleLayout: () => void;
  hasSelectedPage: boolean;
  canRunBubbleLayout: boolean;
};
