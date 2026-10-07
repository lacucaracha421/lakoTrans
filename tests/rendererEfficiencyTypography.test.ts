/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelSyncStateSchema } from "../src/shared/panelBridgeSchemas";
import { batchChapter } from "./fixtures/conditionalBatch";
import { DEFAULT_BLOCK_FONT_CATALOG } from "../src/renderer/src/lib/fonts";
import {
  adjustBlocksFontSizeInChapter,
  resolveBlockFontSizeAtNaturalPageScale,
} from "../src/renderer/src/lib/blockFontSizeAdjustment";
import * as dialogue from "../src/renderer/src/lib/dialogueFontSizeMatching";
import { resolvePageSourceFontFaceFallbacks } from "../src/renderer/src/lib/sourceFontSizeMatching";
import { buildPanelSyncState } from "../src/renderer/src/app/session/buildPanelSyncState";

type PanelInput = Parameters<typeof buildPanelSyncState>[0];
// The fixture checks each field it supplies against the production contract.
// Unrelated session actions are never read by the projection under test.
type PanelProjectionFixture = {
  blockEditingActions: Pick<
    PanelInput["blockEditingActions"],
    "stylePresetSummaries"
  >;
  core: Pick<PanelInput["core"], "currentChapter">;
  derivedState: Pick<
    PanelInput["derivedState"],
    | "selectedPage"
    | "selectedBlock"
    | "selectedBlockIds"
    | "selectedPageEditLocked"
  >;
  inpaintingBridge: {
    contextValue: Pick<
      PanelInput["inpaintingBridge"]["contextValue"],
      "aiUnavailable"
    >;
  };
  uiState: Pick<
    PanelInput["uiState"],
    "stageTool" | "editorTextTabRequestToken"
  >;
  workspaceHistory: Pick<PanelInput["workspaceHistory"], "busy">;
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText(this: { font: string }, text: string) {
      const size = Number(/([\d.]+)px/u.exec(this.font)?.[1] ?? 16);
      return {
        width: Array.from(text).length * size,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
  } as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

function typographyChapter() {
  const chapter = batchChapter();
  chapter.pages[0].blocks = Array.from({ length: 6 }, (_, index) => ({
    ...chapter.pages[0].blocks[0],
    id: `block-${index}`,
    fontSizeIntent: "source-match" as const,
    autoFitText: true,
    textRole: "ordinary" as const,
    fontRole: "dialogue" as const,
    sourceFontFacePx: 24,
    sourceFontSizeConfidence: 0.9,
    sourceFontSizeMethod: "raster-core-v1" as const,
  }));
  return chapter;
}

describe("renderer typography work reuse", () => {
  it("resolves selected blocks against unchanged peers with one dialogue pass", () => {
    const chapter = typographyChapter();
    const page = chapter.pages[0];
    const fallbacks = resolvePageSourceFontFaceFallbacks(page.blocks, page);
    const expected = page.blocks.map(
      (block) =>
        resolveBlockFontSizeAtNaturalPageScale(
          block,
          page,
          DEFAULT_BLOCK_FONT_CATALOG,
          fallbacks.get(block.id),
          page.blocks,
        ) + 0.5,
    );
    const original = structuredClone(chapter);
    const resolve = vi.spyOn(dialogue, "resolvePageDialogueFontSizes");
    const next = adjustBlocksFontSizeInChapter(
      chapter,
      page.id,
      page.blocks.map((block) => block.id),
      1,
      DEFAULT_BLOCK_FONT_CATALOG,
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(next.pages[0].blocks.map((block) => block.fontSizePx)).toEqual(
      expected,
    );
    expect(chapter).toEqual(original);
    expect(
      next.pages[0].blocks.every((block) => block.fontSizeIntent === "manual"),
    ).toBe(true);
  });

  it("retains manual no-op identity and skips unused page typography", () => {
    const chapter = typographyChapter();
    for (const block of chapter.pages[0].blocks) {
      block.autoFitText = false;
      block.fontSizeIntent = "manual";
      block.fontSizePx = 512;
    }
    const resolve = vi.spyOn(dialogue, "resolvePageDialogueFontSizes");
    expect(
      adjustBlocksFontSizeInChapter(
        chapter,
        chapter.pages[0].id,
        chapter.pages[0].blocks.map((block) => block.id),
        1,
        DEFAULT_BLOCK_FONT_CATALOG,
      ),
    ).toBe(chapter);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("omits peer raster bytes without changing panel typography or active artwork", () => {
    const chapter = typographyChapter();
    const page = chapter.pages[0];
    for (const block of page.blocks)
      block.generatedLettering = {
        version: 1,
        dataUrl: `data:image/png;base64,${"A".repeat(100000)}`,
        translatedText: block.translatedText,
        sourceText: block.sourceText,
        enabled: true,
        outline: { width: 2, color: "#ffffff" },
      };
    const active = page.blocks[0];
    const model: PanelProjectionFixture = {
      blockEditingActions: { stylePresetSummaries: [] },
      core: { currentChapter: chapter },
      derivedState: {
        selectedPage: page,
        selectedBlock: active,
        selectedBlockIds: [active.id],
        selectedPageEditLocked: false,
      },
      inpaintingBridge: { contextValue: {} },
      uiState: { stageTool: "select", editorTextTabRequestToken: 0 },
      workspaceHistory: { busy: false },
    };
    const input = model as PanelInput;
    const state = buildPanelSyncState(input);
    expect(buildPanelSyncState(input).selectedPageBlocks).toBe(
      state.selectedPageBlocks,
    );
    expect(state.selectedBlock).toBe(active);
    expect(state.selectedBlock?.generatedLettering?.dataUrl).toBe(
      active.generatedLettering?.dataUrl,
    );
    expect(JSON.stringify(state.selectedPageBlocks).length).toBeLessThan(10000);
    expect(
      state.selectedPageBlocks?.every((block) => !block.generatedLettering),
    ).toBe(true);
    expect(PanelSyncStateSchema.safeParse(state).success).toBe(true);
    expect(
      resolveBlockFontSizeAtNaturalPageScale(
        active,
        page,
        DEFAULT_BLOCK_FONT_CATALOG,
        undefined,
        state.selectedPageBlocks,
      ),
    ).toBe(
      resolveBlockFontSizeAtNaturalPageScale(
        active,
        page,
        DEFAULT_BLOCK_FONT_CATALOG,
        undefined,
        page.blocks,
      ),
    );
    expect(
      page.blocks.every(
        (block) => block.generatedLettering?.dataUrl.length === 100022,
      ),
    ).toBe(true);
  });
});
