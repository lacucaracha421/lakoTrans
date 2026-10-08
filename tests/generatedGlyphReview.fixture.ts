import type { GeneratedGlyphShape } from "../src/shared/generatedGlyphReview";

export const validGlyphShape: GeneratedGlyphShape = {
  version: 2,
  verdict: "valid",
  reason: "Every visible character has intact, unambiguous components.",
  issues: [],
  checks: {
    consonants: { verdict: "valid", reason: "Distinct initial strokes." },
    vowels: { verdict: "valid", reason: "Complete vowel components." },
    finalConsonants: { verdict: "valid", reason: "Intact final strokes." },
    placement: {
      verdict: "valid",
      reason: "Components occupy coherent syllable positions.",
    },
  },
};
export function validGlyphShapes(ids: string[]) {
  return {
    regions: ids.map((regionId) => ({
      regionId,
      shape: structuredClone(validGlyphShape),
    })),
  };
}
