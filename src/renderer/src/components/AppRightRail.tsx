import React from "react";
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconMessageCircle,
  IconPencil,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  UnifiedRightRail,
  type UnifiedRightRailProps,
} from "./rightRailPanels";
import { useEventCallback } from "../hooks/useEventCallback";
import { IconButton } from "./ui/IconButton";
import { useContextRailExpansion } from "./useContextRailExpansion";
import { ChapterTaskHeader } from "./ChapterTaskHeader";
import { Tabs } from "./ui/Tabs";
import styles from "./AppRightRail.module.css";

type AppRightRailProps = UnifiedRightRailProps & {
  /** Receives the header slot where the chat panel places its own controls. */
  chatPanel?:
    React.ReactNode | ((headerSlot: HTMLElement | null) => React.ReactNode);
  onChatPage?: (chapterId: string, pageId: string) => void;
};

// The text-block editor is rendered by EditorPanelContainer, which reads the
// selected block and edit actions from the panel session context rather than
// from these rail props.
export function AppRightRail(props: AppRightRailProps): React.JSX.Element {
  const { t } = useTranslation("components");
  const stableActions = useStableRightRailActions(props);
  const panelOpen = Boolean(props.currentChapter || props.chatOpen);
  const [chatHeaderSlot, setChatHeaderSlot] =
    React.useState<HTMLDivElement | null>(null);
  const { contextExpanded, toggleContextExpanded, toggleRef } =
    useContextRailExpansion(props.currentChapter?.id);

  const toggleLabel = t(
    contextExpanded ? "runPanel.hideInspector" : "runPanel.showInspector",
  );
  const ToggleIcon = contextExpanded
    ? IconLayoutSidebarRightCollapse
    : IconLayoutSidebarRightExpand;
  return (
    <aside
      className={rightRailClasses(panelOpen, contextExpanded, props.chatOpen)}
      aria-hidden={panelOpen ? undefined : true}
    >
      {panelOpen && !props.chatOpen ? (
        <IconButton
          ref={toggleRef}
          className="right-rail-context-toggle"
          label={toggleLabel}
          title={toggleLabel}
          aria-expanded={contextExpanded}
          onClick={toggleContextExpanded}
        >
          <ToggleIcon size={19} stroke={2} aria-hidden="true" />
        </IconButton>
      ) : null}
      <RightRailHeader
        chatOpen={Boolean(props.chatOpen)}
        currentChapter={props.currentChapter}
        saveStatus={props.saveStatus}
        onOpenChat={props.onOpenChat}
        onCloseChat={props.onCloseChat}
        onRetrySave={stableActions.onRetrySave}
        chatSlotRef={setChatHeaderSlot}
      />
      <div
        id="right-editor-panel"
        role="tabpanel"
        aria-labelledby="right-editor-tab"
        hidden={props.chatOpen}
        className={styles.editor}
      >
        <UnifiedRightRail {...props} {...stableActions} />
      </div>
      <div
        id="right-chat-panel"
        role="tabpanel"
        aria-labelledby="right-chat-tab"
        hidden={!props.chatOpen}
        className={styles.chatBody}
      >
        {typeof props.chatPanel === "function"
          ? props.chatPanel(chatHeaderSlot)
          : props.chatPanel}
      </div>
    </aside>
  );
}

/** One row: the mode tabs, then the active mode's own header controls. */
function RightRailHeader({
  chatSlotRef,
  ...props
}: {
  chatOpen: boolean;
  currentChapter: AppRightRailProps["currentChapter"];
  saveStatus: AppRightRailProps["saveStatus"];
  onOpenChat?: () => void;
  onCloseChat?: () => void;
  onRetrySave: () => void;
  chatSlotRef: React.RefCallback<HTMLDivElement>;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <div className={styles.header}>
      <Tabs
        ariaLabel={t("chat.panelMode")}
        className={styles.tabs}
        tabClassName={styles.tab}
        value={props.chatOpen ? "chat" : "editor"}
        onChange={(value) =>
          value === "chat" ? props.onOpenChat?.() : props.onCloseChat?.()
        }
        items={[
          {
            value: "editor",
            label: t("chat.editor"),
            icon: <IconPencil size={16} stroke={2} aria-hidden="true" />,
            id: "right-editor-tab",
            panelId: "right-editor-panel",
          },
          {
            value: "chat",
            label: t("chat.open"),
            icon: <IconMessageCircle size={16} stroke={2} aria-hidden="true" />,
            id: "right-chat-tab",
            panelId: "right-chat-panel",
          },
        ]}
      />
      <div className={styles.headerSlot} hidden={props.chatOpen}>
        {props.currentChapter ? (
          <ChapterTaskHeader
            currentChapter={props.currentChapter}
            saveStatus={props.saveStatus}
            onRetrySave={props.onRetrySave}
          />
        ) : null}
      </div>
      <div
        ref={chatSlotRef}
        className={styles.headerSlot}
        hidden={!props.chatOpen}
      />
    </div>
  );
}

function rightRailClasses(open: boolean, expanded: boolean, chat?: boolean) {
  return `right-rail ${open ? "is-open" : "is-hidden"} ${expanded || chat ? "is-context-expanded" : ""} ${chat ? styles.chatRail : ""}`.trim();
}

function useStableRightRailActions(
  props: AppRightRailProps,
): Pick<
  AppRightRailProps,
  | "onBrushColorChange"
  | "onBrushRadiusChange"
  | "onAdjustPatternMask"
  | "onCancelJob"
  | "onClearStatusLines"
  | "onClearPatternMask"
  | "onChangeBlockSelection"
  | "onOpenBlockEditor"
  | "onOpenAutoInpaintingOptions"
  | "onOpenExport"
  | "onOpenPsdExport"
  | "onViewLinkedResults"
  | "onOpenStyleGuide"
  | "onOpenTextView"
  | "onOpenTranslateOptions"
  | "onMoveBlockInReadingOrder"
  | "onPeekToggle"
  | "onRedo"
  | "onResetPage"
  | "onRetrySave"
  | "onRunBubbleLayout"
  | "onRunDrawnPattern"
  | "onSelectBlock"
  | "onSortReadingOrder"
  | "onToggleBlocks"
  | "onToggleChrome"
  | "onUndo"
  | "onUpdateBlock"
> {
  return {
    onBrushColorChange: useEventCallback(props.onBrushColorChange),
    onBrushRadiusChange: useEventCallback(props.onBrushRadiusChange),
    onAdjustPatternMask: useEventCallback(
      props.onAdjustPatternMask ?? NOOP_ADJUST_MASK,
    ),
    onCancelJob: useEventCallback(props.onCancelJob),
    onClearStatusLines: useEventCallback(props.onClearStatusLines),
    onClearPatternMask: useEventCallback(props.onClearPatternMask),
    onChangeBlockSelection: useEventCallback(
      props.onChangeBlockSelection ?? NOOP_SELECTION_CHANGE,
    ),
    onOpenBlockEditor: useEventCallback(props.onOpenBlockEditor),
    onOpenAutoInpaintingOptions: useEventCallback(
      props.onOpenAutoInpaintingOptions,
    ),
    onOpenExport: useEventCallback(props.onOpenExport),
    onOpenPsdExport: useEventCallback(props.onOpenPsdExport ?? NOOP),
    onViewLinkedResults: useEventCallback(props.onViewLinkedResults ?? NOOP),
    onOpenStyleGuide: useEventCallback(props.onOpenStyleGuide),
    onOpenTextView: useEventCallback(props.onOpenTextView),
    onOpenTranslateOptions: useEventCallback(props.onOpenTranslateOptions),
    onMoveBlockInReadingOrder: useEventCallback(
      props.onMoveBlockInReadingOrder ?? NOOP_MOVE_BLOCK,
    ),
    onPeekToggle: useEventCallback(props.onPeekToggle),
    onRedo: useEventCallback(props.onRedo),
    onResetPage: useEventCallback(props.onResetPage),
    onRetrySave: useEventCallback(props.onRetrySave),
    onRunBubbleLayout: useEventCallback(props.onRunBubbleLayout),
    onRunDrawnPattern: useEventCallback(props.onRunDrawnPattern),
    onSelectBlock: useEventCallback(props.onSelectBlock),
    onSortReadingOrder: useEventCallback(props.onSortReadingOrder ?? NOOP),
    onToggleBlocks: useEventCallback(props.onToggleBlocks),
    onToggleChrome: useEventCallback(props.onToggleChrome),
    onUndo: useEventCallback(props.onUndo),
    onUpdateBlock: useEventCallback(props.onUpdateBlock),
  };
}

const NOOP = (): void => undefined;
const NOOP_ADJUST_MASK = (): void => undefined;
const NOOP_MOVE_BLOCK = (): void => undefined;
const NOOP_SELECTION_CHANGE = (): void => undefined;
