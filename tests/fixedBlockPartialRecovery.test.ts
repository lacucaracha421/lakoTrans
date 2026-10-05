import { describe, expect, it } from "vitest";

const fixed =
  require("../src/main/runtime/semantic-ocr/fixed-block-translation.cjs") as {
    parseFixedBlockTranslationDraft: (
      raw: string,
      plan: FixedBlockPlan,
      options: Record<string, unknown>,
    ) => unknown;
    parseFixedBlockTranslationPartialResponse: (
      raw: string,
      plan: FixedBlockPlan,
      options: Record<string, unknown>,
    ) => Record<string, unknown>;
  };
const fallback =
  require("../src/main/runtime/semantic-ocr/fixed-block-repair-fallback.cjs") as {
    completeFixedBlockFallbacks: (
      repaired: Record<string, unknown>,
      fallbacks: Record<string, Map<string, unknown>>,
      blocks: Array<{ blockId: string; jp: string }>,
    ) => {
      translations: { items: Array<{ blockId: string; ko: string }> };
      sourceTextFallbackBlockIds: string[];
      needsReviewBlockIds: string[];
    };
  };

type FixedBlockPlan = {
  version: string;
  blocks: Array<{
    blockId: string;
    jp?: string;
    ordinaryOnly?: boolean;
    candidateIds: string[];
    directionVoterCandidateIds: string[];
    sourceTexts: string[];
    bbox: { x: number; y: number; width: number; height: number };
  }>;
};

const baseOptions = {
  sourceLanguage: "Japanese",
  targetLanguage: "Korean",
};

describe("fixed-block partial recovery", () => {
  it("retries an absent numeric translation without discarding valid neighbors", () => {
    const plan = singletonPlan(2);
    Object.assign(plan.blocks[0], { jp: "123456", ordinaryOnly: true });
    const partial = fixed.parseFixedBlockTranslationPartialResponse(
      JSON.stringify({
        items: [{ blockId: "B001" }, { blockId: "B002", ko: "기다려" }],
      }),
      plan,
      baseOptions,
    );
    expect(partial).toMatchObject({
      translations: { items: [{ blockId: "B002", ko: "기다려" }] },
      retryBlockIds: ["B001"],
    });
    expect(partial.readableTextFallbackTranslations).toBeUndefined();
  });

  it("rejects dialogue invented from long numeric OCR, including every readable fallback", () => {
    const plan = singletonPlan(2);
    Object.assign(plan.blocks[0], {
      jp: "００００００００",
      ordinaryOnly: true,
    });
    Object.assign(plan.blocks[1], { jp: "待って", ordinaryOnly: true });
    const raw = JSON.stringify({
      items: [
        { blockId: "B001", ko: "잠깐만 기다려 봐", layoutIntent: "vertical" },
        { blockId: "B002", ko: "기다려" },
      ],
    });
    const partial = fixed.parseFixedBlockTranslationPartialResponse(
      raw,
      plan,
      baseOptions,
    );
    expect(partial).toEqual({
      translations: { items: [{ blockId: "B002", ko: "기다려" }] },
      retryBlockIds: ["B001"],
      retryReasons: {
        B001: ["fixed-block-translation-numeric-text-expansion"],
      },
    });
    const strictRaw = JSON.stringify({
      items: [
        { blockId: "B001", ko: "잠깐만 기다려 봐" },
        { blockId: "B002", ko: "기다려" },
      ],
    });
    expect(() =>
      fixed.parseFixedBlockTranslationDraft(strictRaw, plan, baseOptions),
    ).toThrow("invents words for a numeric-only source");
    const recovered = fallback.completeFixedBlockFallbacks(
      {
        translations: partial.translations,
        pendingBlockIds: ["B001"],
        responses: [],
        history: [],
        retryReasons: partial.retryReasons,
      },
      Object.fromEntries(
        [
          "horizontal",
          "fontIntent",
          "targetTypography",
          "sourceScript",
          "readableText",
        ].map((kind) => [kind, new Map()]),
      ),
      plan.blocks.map((block) => ({
        blockId: block.blockId,
        jp: block.jp ?? "",
      })),
    );
    expect(recovered.translations.items).toEqual([
      { blockId: "B001", ko: "００００００００" },
      { blockId: "B002", ko: "기다려" },
    ]);
    expect(recovered.needsReviewBlockIds).toEqual(["B001"]);
  });

  it.each([
    ["123456", "123,456", true],
    ["12", "열둘", true],
    ["第123456号", "제123456호", true],
    ["000000", "검토된 효과음", false],
  ])(
    "retains numeric notation and ordinary translation: %s",
    (jp, ko, ordinaryOnly) => {
      const plan = singletonPlan(1);
      Object.assign(plan.blocks[0], { jp, ordinaryOnly });
      expect(
        fixed.parseFixedBlockTranslationPartialResponse(
          JSON.stringify({ items: [{ blockId: "B001", ko }] }),
          plan,
          baseOptions,
        ),
      ).toMatchObject({
        translations: { items: [{ blockId: "B001", ko }] },
        retryBlockIds: [],
      });
    },
  );

  it("salvages only unique contract-valid expected ids", () => {
    const partial = fixed.parseFixedBlockTranslationPartialResponse(
      JSON.stringify({
        items: [
          { blockId: "B002", ko: "둘째" },
          { blockId: "B001", ko: "첫째" },
          { blockId: "B001", ko: "중복" },
          { blockId: "B003", ko: "俺" },
          { blockId: "B999", ko: "예상하지 않은 항목" },
          null,
        ],
        pageContext: { visualSummary: "유효한 장면 정보" },
        commentary: "금지된 최상위 필드는 복구 과정에서 무시한다.",
      }),
      singletonPlan(3),
      { ...baseOptions, collectPageContext: true },
    );

    expect(partial).toEqual({
      translations: {
        items: [{ blockId: "B002", ko: "둘째" }],
        pageContext: { visualSummary: "유효한 장면 정보" },
      },
      retryBlockIds: ["B001", "B003"],
      retryReasons: {
        B001: ["fixed-block-translation-duplicate"],
        B003: ["fixed-block-translation-source-script-leak"],
      },
      sourceScriptFallbackTranslations: {
        items: [{ blockId: "B003", ko: "俺" }],
      },
      readableTextFallbackTranslations: {
        items: [{ blockId: "B001", ko: "첫째" }],
      },
    });
  });

  it("keeps Korean-safe elongation without accepting Japanese words", () => {
    const partial = fixed.parseFixedBlockTranslationPartialResponse(
      JSON.stringify({
        items: [
          { blockId: "B001", ko: "무리예요ーー!!" },
          { blockId: "B002", ko: "원작에서는 瘴気の 항체약" },
        ],
      }),
      singletonPlan(2),
      baseOptions,
    );

    expect(partial).toMatchObject({
      translations: { items: [] },
      retryBlockIds: ["B001", "B002"],
      retryReasons: {
        B001: ["fixed-block-translation-source-script-leak"],
        B002: ["fixed-block-translation-source-script-leak"],
      },
      targetTypographyFallbackTranslations: {
        items: [{ blockId: "B001", ko: "무리예요~~!!" }],
      },
    });
  });

  it("keeps an inspectable placeholder when even immutable source text is empty", () => {
    const emptyFallbacks = Object.fromEntries(
      [
        "horizontal",
        "fontIntent",
        "targetTypography",
        "sourceScript",
        "readableText",
      ].map((kind) => [kind, new Map()]),
    );
    const completed = fallback.completeFixedBlockFallbacks(
      {
        translations: { items: [] },
        pendingBlockIds: ["B001"],
        responses: [],
        history: [],
        retryReasons: {
          B001: ["fixed-block-translation-empty-text"],
        },
      },
      emptyFallbacks,
      [{ blockId: "B001", jp: "" }],
    );

    expect(completed.translations.items).toEqual([
      { blockId: "B001", ko: "…" },
    ]);
    expect(completed.sourceTextFallbackBlockIds).toEqual(["B001"]);
  });
});

function singletonPlan(count: number): FixedBlockPlan {
  return {
    version: "fixed-block-v6",
    blocks: Array.from({ length: count }, (_, index) => ({
      blockId: `B${String(index + 1).padStart(3, "0")}`,
      candidateIds: [`C${index + 1}`],
      directionVoterCandidateIds: [`C${index + 1}`],
      sourceTexts: ["原文"],
      bbox: { x: index * 20, y: 0, width: 10, height: 10 },
    })),
  };
}
