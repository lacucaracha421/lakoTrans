import { expect, it } from "vitest";
import {
  hasValidGeneratedGlyphShape,
  GeneratedGlyphShapeSchema,
} from "../src/shared/generatedGlyphReview";
import { validGlyphShape } from "./generatedGlyphReview.fixture";

it("requires component inspection even for a correct or previously accepted OCR result", () => {
  const requiredChecks = validGlyphShape.checks;
  if (!requiredChecks) throw new Error("Missing fixture checks");
  expect(hasValidGeneratedGlyphShape(validGlyphShape)).toBe(true);
  expect(hasValidGeneratedGlyphShape()).toBe(false);
  expect(hasValidGeneratedGlyphShape({ ...validGlyphShape, version: 1 })).toBe(
    false,
  );
  expect(
    hasValidGeneratedGlyphShape({ ...validGlyphShape, checks: undefined }),
  ).toBe(false);
  for (const key of [
    "consonants",
    "vowels",
    "finalConsonants",
    "placement",
  ] as const) {
    for (const verdict of ["uncertain", "repair-needed"] as const) {
      const checks = {
        ...requiredChecks,
        [key]: { verdict, reason: "Visible component defect" },
      };
      expect(hasValidGeneratedGlyphShape({ ...validGlyphShape, checks })).toBe(
        false,
      );
    }
  }
  expect(
    hasValidGeneratedGlyphShape({
      ...validGlyphShape,
      checks: {
        ...requiredChecks,
        placement: { verdict: "not-applicable", reason: "Skip" },
      },
    }),
  ).toBe(false);
  expect(
    hasValidGeneratedGlyphShape({
      ...validGlyphShape,
      checks: {
        ...requiredChecks,
        finalConsonants: {
          verdict: "not-applicable",
          reason: "Syllable has no final consonant",
        },
      },
    }),
  ).toBe(true);
});

it("retains structured failures without allowing invalid or unlocated defects", () => {
  const issue = {
    kind: "misplaced-jamo",
    reason: "Initial is displaced",
    rect: { x: 10, y: 20, w: 600, h: 500 },
  };
  expect(
    GeneratedGlyphShapeSchema.safeParse({ ...validGlyphShape, issues: [issue] })
      .success,
  ).toBe(false);
  expect(
    GeneratedGlyphShapeSchema.safeParse({
      ...validGlyphShape,
      verdict: "repair-needed",
    }).success,
  ).toBe(false);
  expect(
    GeneratedGlyphShapeSchema.safeParse({
      ...validGlyphShape,
      verdict: "repair-needed",
      issues: [{ ...issue, rect: { x: 900, y: 20, w: 600, h: 500 } }],
    }).success,
  ).toBe(false);
});
