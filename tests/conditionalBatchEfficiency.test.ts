/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchChapter } from "./fixtures/conditionalBatch";
import {
  createConditionalBatchPreview,
  applyConditionalBatchPreview,
} from "../src/shared/conditionalBatchEngine";
import { createBlankBatchSchemeDraft } from "../src/shared/conditionalBatchRules";
import {
  ConditionalTextMatcherV3Schema,
  createConditionalLiteralMatcher,
  findConditionalTextMatches,
  testConditionalTextMatcher,
  type ConditionalTextMatcherCache,
  type ConditionalTextMatcherV3,
} from "../src/shared/conditionalTextPattern";

afterEach(() => vi.restoreAllMocks());

describe("conditional batch evaluation reuse", () => {
  it("preserves first-index and fallback numbering for partial or duplicate orders", () => {
    const chapter = batchChapter();
    const first = chapter.pages[0];
    const second = {
      ...first,
      id: "second",
      blockOrder: ["missing", "b2", "b2"],
    };
    chapter.pages = [first, second];
    chapter.pageOrder = ["missing", "second", "second"];
    const rule = createBlankBatchSchemeDraft();
    rule.actions = [];
    rule.match = {
      mode: "all",
      groups: [],
      conditions: [
        {
          id: "page",
          enabled: true,
          field: "pageIndex",
          operator: "greaterThan",
          value: 0,
        },
        {
          id: "block",
          enabled: true,
          field: "blockIndex",
          operator: "greaterThan",
          value: 0,
        },
      ],
    };
    const pageScans = vi.spyOn(chapter.pageOrder, "indexOf");
    const blockScans = vi.spyOn(second.blockOrder, "indexOf");
    const preview = createConditionalBatchPreview(
      chapter,
      { kind: "chapter" },
      rule,
    );
    expect(
      preview.results.map((result) => [
        result.pageId,
        result.blockId,
        ...result.conditionEvaluations.map((item) => item.rawValue),
      ]),
    ).toEqual([
      ["second", "b2", 2, 2],
      ["second", "b2", 2, 2],
      ["second", "b1", 2, 3],
      ["second", "b2", 2, 2],
      ["second", "b2", 2, 2],
      ["second", "b1", 2, 3],
      ["page", "b1", 3, 1],
      ["page", "b2", 3, 2],
    ]);
    expect(pageScans).not.toHaveBeenCalled();
    expect(blockScans).not.toHaveBeenCalled();
  });

  it("retains selection-local fallback numbering when block order is absent", () => {
    const chapter = batchChapter();
    chapter.pages[0].blockOrder = undefined;
    const rule = createBlankBatchSchemeDraft();
    rule.actions = [];
    rule.match = {
      mode: "all",
      groups: [],
      conditions: [
        {
          id: "first",
          enabled: true,
          field: "blockIndex",
          operator: "equals",
          value: 1,
        },
      ],
    };
    expect(
      createConditionalBatchPreview(
        chapter,
        { kind: "selection", pageId: "page", blockIds: ["b2"] },
        rule,
      ).results.map((result) => result.blockId),
    ).toEqual(["b2"]);
  });

  it("compiles an unchanged matcher once per mode and invalidates between evaluations", () => {
    const chapter = batchChapter();
    const matcher = createConditionalLiteralMatcher("번역");
    const rule = createBlankBatchSchemeDraft();
    rule.match = {
      mode: "all",
      groups: [],
      conditions: [
        {
          id: "text",
          enabled: true,
          field: "translatedText",
          operator: "regex",
          matcher,
        },
      ],
    };
    rule.actions = [
      {
        id: "replace",
        enabled: true,
        type: "replaceText",
        target: "translatedText",
        allOccurrences: true,
        matcher,
        replacement: { mode: "raw", source: "교체" },
      },
    ];
    const parse = vi.spyOn(ConditionalTextMatcherV3Schema, "parse");
    const preview = createConditionalBatchPreview(
      chapter,
      { kind: "chapter" },
      rule,
    );
    expect(
      preview.results.map((result) => result.after.translatedText),
    ).toEqual(["교체문", "교체문"]);
    expect(parse).toHaveBeenCalledTimes(2);
    parse.mockClear();
    const applied = applyConditionalBatchPreview(
      chapter,
      rule,
      preview,
      new Set(),
      "now",
    );
    expect(applied.appliedCount).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
    if (matcher.mode !== "visual" || matcher.nodes[0].kind !== "literal")
      throw new Error("literal fixture");
    matcher.nodes[0].text = "없음";
    parse.mockClear();
    expect(
      createConditionalBatchPreview(chapter, { kind: "chapter" }, rule)
        .matchedCount,
    ).toBe(0);
    expect(parse).toHaveBeenCalledOnce();
  });

  it.each(["(?=.)", "(?<letter>a)?b", "^.$"])(
    "does not leak regexp lastIndex or capture state: %s",
    (source) => {
      const matcher: ConditionalTextMatcherV3 = {
        mode: "regex",
        source,
        caseSensitive: false,
        multiline: true,
      };
      const cache: ConditionalTextMatcherCache = new WeakMap();
      const replacement = { mode: "raw" as const, source: "$<letter>/$1/$&" };
      for (const text of ["😀ab\nB", "b", "😀ab\nB"]) {
        for (const all of [true, false])
          expect(
            findConditionalTextMatches(text, matcher, replacement, all, cache),
          ).toEqual(
            findConditionalTextMatches(text, matcher, replacement, all),
          );
        expect(testConditionalTextMatcher(text, matcher, cache)).toBe(
          testConditionalTextMatcher(text, matcher),
        );
      }
    },
  );
});
