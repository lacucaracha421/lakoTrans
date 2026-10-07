import {
  buildPanelFormatSelection,
  createPanelSelectionKey,
  type PanelSyncState,
} from "../../../../shared/panelBridgeTypes";
import type { TranslationBlock } from "../../../../shared/textTypes";
import type { AppSessionViewModel } from "./appSessionViewModel";
import { isWorkspaceImageReadyForSelectedPage } from "./appSessionSelectors";
import { resolvePageSourceFontFaceFallbacks } from "../../lib/sourceFontSizeMatching";
import { isChapterMutationBlocked } from "./workspaceActivity";

export function buildPanelSyncState({
  blockEditingActions,
  core,
  derivedState,
  inpaintingBridge,
  uiState,
  workspaceHistory,
}: Pick<
  AppSessionViewModel,
  | "blockEditingActions"
  | "core"
  | "derivedState"
  | "inpaintingBridge"
  | "uiState"
  | "workspaceHistory"
>): PanelSyncState {
  const interactionBusy = isAreaTranslationBusy(
    derivedState,
    uiState,
    workspaceHistory,
  );
  const selectedIds = resolvePanelSelectedIds(derivedState);
  const selectedIdSet = new Set(selectedIds);
  const selectedBlocks =
    derivedState.selectedPage?.blocks.filter((block) =>
      selectedIdSet.has(block.id),
    ) ?? [];
  const selectedPageSize = derivedState.selectedPage
    ? {
        width: derivedState.selectedPage.width,
        height: derivedState.selectedPage.height,
      }
    : null;
  const selectedBlockSourceFontFaceFallbackPx =
    resolveSelectedBlockSourceFontFaceFallbackPx(
      derivedState,
      selectedPageSize,
    );
  return {
    editPage: resolveEditPage(core, derivedState),
    aiUnavailable: inpaintingBridge.contextValue.aiUnavailable,
    areaTranslateAvailable: panelRegionAvailable(
      derivedState,
      interactionBusy,
      inpaintingBridge.contextValue.aiUnavailable,
    ),
    areaTranslateSelecting: Boolean(core.regionSelection?.active),
    disableChapterApply: isChapterMutationBlocked({
      core,
      derivedState,
      workspaceHistory,
    }),
    letteringTool: uiState.letteringTool,
    editorDisabled:
      derivedState.selectedPageEditLocked || workspaceHistory.busy,
    blockStylePresets: blockEditingActions.stylePresetSummaries,
    selectedBlock: derivedState.selectedBlock,
    selectedBlockCount: selectedIds.length,
    selectionKey: createPanelSelectionKey(selectedIds),
    formatSelection: buildPanelFormatSelection(selectedBlocks),
    editorTextTabRequestToken: uiState.editorTextTabRequestToken,
    transformMode:
      uiState.stageTool === "perspective" ||
      uiState.stageTool === "curve" ||
      uiState.stageTool === "warp"
        ? uiState.stageTool
        : "select",
    selectedPageSize,
    selectedBlockSourceFontFaceFallbackPx,
    selectedPageBlocks: resolvePanelTypographyPeers(
      derivedState.selectedPage?.blocks,
    ),
  };
}

function resolveSelectedBlockSourceFontFaceFallbackPx(
  derivedState: AppSessionViewModel["derivedState"],
  selectedPageSize: { width: number; height: number } | null,
): number | null {
  if (
    !derivedState.selectedBlock ||
    !derivedState.selectedPage ||
    !selectedPageSize
  ) {
    return null;
  }
  return (
    resolvePageSourceFontFaceFallbacks(
      derivedState.selectedPage.blocks,
      selectedPageSize,
    ).get(derivedState.selectedBlock.id) ?? null
  );
}

function resolvePanelSelectedIds(
  derivedState: AppSessionViewModel["derivedState"],
): readonly string[] {
  if (derivedState.selectedBlockIds.length > 0) {
    return derivedState.selectedBlockIds;
  }
  return derivedState.selectedBlock ? [derivedState.selectedBlock.id] : [];
}

/**
 * Area translation is its own job: it only waits for work the current
 * provider cannot run beside, for this page, or for the renderer's own flow.
 */
function isAreaTranslationBusy(
  derivedState: AppSessionViewModel["derivedState"],
  uiState: AppSessionViewModel["uiState"],
  workspaceHistory: AppSessionViewModel["workspaceHistory"],
): boolean {
  return (
    derivedState.translationModelBusy ||
    derivedState.selectedPageEditLocked ||
    uiState.exclusiveFlowActive ||
    workspaceHistory.busy
  );
}

function panelRegionAvailable(
  derived: AppSessionViewModel["derivedState"],
  busy: boolean,
  unavailable?: boolean,
) {
  return !busy && !unavailable && isWorkspaceImageReadyForSelectedPage(derived);
}

function resolveEditPage(
  core: AppSessionViewModel["core"],
  derived: AppSessionViewModel["derivedState"],
): PanelSyncState["editPage"] {
  return core.currentChapter && derived.selectedPage
    ? { chapterId: core.currentChapter.id, pageId: derived.selectedPage.id }
    : null;
}

// Page blocks are immutable renderer snapshots. Weak keys avoid retaining old
// pages and preserve peer identity during unrelated session renders.
const typographyPeers = new WeakMap<
  readonly TranslationBlock[],
  readonly TranslationBlock[]
>();

function resolvePanelTypographyPeers(
  blocks: readonly TranslationBlock[] | undefined,
): readonly TranslationBlock[] | undefined {
  if (!blocks) return undefined;
  const cached = typographyPeers.get(blocks);
  if (cached) return cached;
  // Typography does not consume generated lettering. Omit its complete optional
  // payload so peers still satisfy TranslationBlockSchema; selectedBlock above
  // keeps the original portable artwork for editing and library actions.
  const peers = blocks.map((block) => {
    if (!block.generatedLettering) return block;
    const { generatedLettering: _artwork, ...peer } = block;
    return peer;
  });
  typographyPeers.set(blocks, peers);
  return peers;
}
