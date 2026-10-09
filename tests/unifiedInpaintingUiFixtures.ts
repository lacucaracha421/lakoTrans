import { vi } from "vitest";
import type { ComponentProps } from "react";
import type { AppRightRail } from "../src/renderer/src/components/AppRightRail";
import type { ChapterSnapshot, MangaPage } from "../src/shared/libraryTypes";
import type { TranslationBlock } from "../src/shared/textTypes";

export function makeChapter(): ChapterSnapshot {
  const page = makePage();
  return {
    id: "chapter-1",
    workId: "work-1",
    title: "1화",
    sourceKind: "images",
    status: "idle",
    pageOrder: [page.id],
    pages: [page],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makePage(): MangaPage {
  return {
    id: "page-1",
    name: "page-1.png",
    imagePath: "page-1.png",
    dataUrl: "",
    width: 1000,
    height: 1600,
    blocks: [],
    analysisStatus: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeBlock(): TranslationBlock {
  return {
    id: "block-1",
    type: "nonsolid",
    bbox: { x: 0, y: 0, w: 100, h: 100 },
    sourceText: "source",
    translatedText: "translated",
    confidence: 1,
    sourceDirection: "horizontal",
    renderDirection: "horizontal",
    fontSizePx: 24,
    lineHeight: 1.2,
    textAlign: "center",
    textColor: "#000000",
    backgroundColor: "#ffffff",
    opacity: 1,
  };
}

type RightRailProps = ComponentProps<typeof AppRightRail>;

export function makeRightRailProps(
  overrides: Partial<RightRailProps> = {},
): RightRailProps {
  return {
    blockReadingDirection: "rtl",
    brushColor: "#ffffff",
    brushRadius: 28,
    canRedo: true,
    canUndo: true,
    canRunBubbleLayout: false,
    compareAvailable: true,
    completionSoundMuted: true,
    completionSoundVolume: 0.55,
    currentChapter: makeChapter(),
    editorDisabled: false,
    flowActive: false,
    jobActive: false,
    jobState: {
      id: "",
      kind: "inpainting",
      progressText: "대기",
      status: "idle",
    },
    maskStrokeCount: 0,
    onBrushColorChange: vi.fn(),
    onBrushRadiusChange: vi.fn(),
    onCancelJob: vi.fn(),
    onClearStatusLines: vi.fn(),
    onCompletionSoundChange: vi.fn(),
    onClearPatternMask: vi.fn(),
    onOpenExport: vi.fn(),
    onOpenErrorReport: vi.fn(),
    onReviewResults: vi.fn(),
    onRetryPage: vi.fn(),
    onOpenStyleGuide: vi.fn(),
    onOpenTextView: vi.fn(),
    onOpenTranslateOptions: vi.fn(),
    onPeekToggle: vi.fn(),
    onRedo: vi.fn(),
    onResetPage: vi.fn(),
    onRunDrawnPattern: vi.fn(),
    onRunBubbleLayout: vi.fn(),
    onRetrySave: vi.fn(),
    onOpenAutoInpaintingOptions: vi.fn(),
    onOpenBlockEditor: vi.fn(),
    onSelectBlock: vi.fn(),
    onToggleBlocks: vi.fn(),
    onToggleChrome: vi.fn(),
    onUndo: vi.fn(),
    onUpdateBlock: vi.fn(),
    peeking: false,
    progressSnapshot: null,
    selectedBlock: null,
    selectedBlockId: null,
    selectedPage: makePage(),
    resetAvailable: true,
    showBlockChrome: true,
    showProgressBar: false,
    showTextBlocks: true,
    stageTool: "select",
    statusLines: [],
    rightRailMode: "block-editor",
    saveStatus: "idle",
    ...overrides,
  };
}
