import { describe, expect, it } from "vitest";
type Plan = {
  blocks: Array<{ blockId: string; candidateIds: number[]; jp: string }>;
};
const fixed =
  require("../src/main/runtime/semantic-ocr/fixed-block-translation.cjs") as {
    shouldUseFixedBlockTranslation: (
      options: Record<string, unknown>,
    ) => boolean;
    buildFixedBlockPlan: (
      options: Record<string, unknown>,
      images: Record<string, unknown>[],
    ) => Plan;
    buildFixedBlockTranslationPrompt: (
      plan: Plan,
      options: Record<string, unknown>,
    ) => string;
    buildFixedBlockTranslationSystemPrompt: (
      options: Record<string, unknown>,
    ) => string;
    buildFixedBlockOverlayPayload: (
      plan: Plan,
      result: { items: Array<{ blockId: string; ko: string }> },
    ) => { items: Array<Record<string, unknown>> };
  };
const baseOptions = {
  modelProvider: "gemma",
  sourceLanguage: "ja",
  targetLanguage: "ko",
  ocrQualityMode: "economy",
  ocrMergeMode: "semantic",
  imageWidth: 1000,
  imageHeight: 1000,
};

const baseVariant = {
  role: "original",
  width: 1000,
  height: 1000,
  originalWidth: 1000,
  originalHeight: 1000,
};

describe("committed Hayai source ownership", () => {
  it("keeps source records and slots immutable while allowing bounded visual reading", () => {
    const options = {
      ...baseOptions,
      ocrPipeline: "hayai",
      keepBlocksMode: true,
      ocrBboxHints: [
        semanticHint(4, "同じ学校だから教えてあげて", 400, 100, 480, 300, 1, 2),
        semanticHint(2, "今日から新しい人が入る", 500, 100, 580, 300, 2, 2),
        semanticHint(9, "了解です", 300, 100, 380, 300, 1, 1),
        semanticHint(7, "……！", 200, 100, 280, 300, 1, 1),
      ],
    };
    expect(fixed.shouldUseFixedBlockTranslation(options)).toBe(true);
    const plan = fixed.buildFixedBlockPlan(options, [baseVariant]);
    expect(plan.blocks.map((block) => block.candidateIds)).toEqual([
      [4],
      [2],
      [9],
      [7],
    ]);
    expect(plan.blocks.map((block) => block.jp)).toEqual(
      options.ocrBboxHints.map((hint) => hint.ocrText),
    );
    const prompt = fixed.buildFixedBlockTranslationPrompt(plan, options);
    expect(prompt).toContain("leaving the stored jp untouched");
    expect(prompt).toContain("only the text inside each slot's own bbox");
    expect(prompt).toContain("prefer the supplied jp and established glossary");
    expect(prompt).toContain("Keep unfinished clauses as fragments");
    expect(prompt).toContain("not by transliterating kana into Hangul");
    expect(prompt).not.toContain("Correct Hayai OCR mistakes");
    expect(
      fixed.buildFixedBlockTranslationPrompt(plan, {
        ...options,
        autoFontMatching: true,
      }),
    ).toContain("Never return an sfx_ fontRole");
    expect(fixed.buildFixedBlockTranslationSystemPrompt(options)).not.toContain(
      "correct its Hayai reading",
    );
    const result = fixed.buildFixedBlockOverlayPayload(plan, {
      items: plan.blocks.map((block, index) => ({
        blockId: block.blockId,
        ko: [
          "같은 학교니까 가르쳐 줘",
          "오늘부터 새 사람이 와",
          "알겠습니다",
          "……!",
        ][index],
      })),
    });
    expect(result.items.map((item) => item.id)).toEqual([4, 2, 9, 7]);
    expect(result.items.map((item) => item.jp)).toEqual(
      options.ocrBboxHints.map((hint) => hint.ocrText),
    );
  });

  it("keeps source ownership even when committed hints carry geometry locks", () => {
    const options = {
      ...baseOptions,
      ocrPipeline: "hayai",
      keepBlocksMode: true,
      ocrBboxHints: [
        {
          ...semanticHint(1, "確定した原文", 100, 100, 200, 300, 1, 1),
          geometryLocked: true,
        },
      ],
    };
    const plan = fixed.buildFixedBlockPlan(options, [baseVariant]);
    expect(fixed.buildFixedBlockTranslationPrompt(plan, options)).toContain(
      "leaving the stored jp untouched",
    );
    expect(fixed.buildFixedBlockTranslationSystemPrompt(options)).not.toContain(
      "correct its Hayai reading",
    );
  });

  it("applies a visually corrected translation without rewriting its OCR evidence", () => {
    const options = {
      ...baseOptions,
      ocrPipeline: "hayai",
      keepBlocksMode: true,
      ocrBboxHints: [
        semanticHint(8, "思命!!", 600, 100, 680, 300, 1, 1),
        semanticHint(3, "ここにいる", 400, 100, 480, 300, 1, 1),
      ],
    };
    const plan = fixed.buildFixedBlockPlan(options, [baseVariant]);
    const before = structuredClone(plan);
    const payload = fixed.buildFixedBlockOverlayPayload(plan, {
      items: [
        { blockId: plan.blocks[1].blockId, ko: "여기 있어" },
        { blockId: plan.blocks[0].blockId, ko: "흑제!!" },
      ],
    });
    expect(payload.items.map(({ id, jp, ko }) => ({ id, jp, ko }))).toEqual([
      { id: 8, jp: "思命!!", ko: "흑제!!" },
      { id: 3, jp: "ここにいる", ko: "여기 있어" },
    ]);
    expect(plan).toEqual(before);
  });

  it("does not change Paddle, region-crop, or unread keep-mode routing", () => {
    const options = {
      ...baseOptions,
      ocrPipeline: "hayai",
      keepBlocksMode: true,
      ocrBboxHints: [semanticHint(1, "原文", 100, 100, 200, 300, 1, 1)],
    };
    expect(
      fixed.shouldUseFixedBlockTranslation({
        ...options,
        ocrPipeline: "paddle-legacy",
      }),
    ).toBe(false);
    expect(
      fixed.shouldUseFixedBlockTranslation({
        ...options,
        regionCropMode: true,
      }),
    ).toBe(false);
    expect(
      fixed.shouldUseFixedBlockTranslation({ ...options, ocrBboxHints: [] }),
    ).toBe(false);
    expect(
      fixed.shouldUseFixedBlockTranslation({
        ...options,
        ocrBboxHints: [{ ...options.ocrBboxHints[0], ocrText: "" }],
      }),
    ).toBe(false);
  });
});

function semanticHint(
  id: number,
  text: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  orderInGroup: number,
  groupSize: number,
) {
  return {
    id,
    label: "ocr_textline",
    x1,
    y1,
    x2,
    y2,
    score: 0.95,
    ocrText: text,
    groupId: "G001",
    orderInGroup,
    groupSize,
    rolePrior: "ordinary_mergeable",
    containerType: "same_text_container",
    semanticGroup: true,
  };
}
