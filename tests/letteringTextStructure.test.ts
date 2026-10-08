import { expect, it } from "vitest";
import { describeLetteringText } from "../src/shared/letteringTextStructure";
import { serializeRichTextRuns } from "../src/shared/richTextMarkup";

it.each([
  ["가", "ㄱ", "ㅏ", null],
  ["쾅", "ㅋ", "ㅘ", "ㅇ"],
  ["꽝", "ㄲ", "ㅘ", "ㅇ"],
  ["욱", "ㅇ", "ㅜ", "ㄱ"],
  ["왜", "ㅇ", "ㅙ", null],
  ["괜", "ㄱ", "ㅙ", "ㄴ"],
  ["꿩", "ㄲ", "ㅝ", "ㅇ"],
  ["궤", "ㄱ", "ㅞ", null],
  ["쥐", "ㅈ", "ㅟ", null],
  ["의", "ㅇ", "ㅢ", null],
  ["닭", "ㄷ", "ㅏ", "ㄺ"],
  ["값", "ㄱ", "ㅏ", "ㅄ"],
  ["힣", "ㅎ", "ㅣ", "ㅎ"],
] as const)(
  "describes the exact Unicode syllable %s, not a phonetic guess",
  (syllable, initial, vowel, final) => {
    expect(describeLetteringText(syllable)).toEqual({
      text: syllable,
      hangul: [{ syllable, initial, vowel, final }],
    });
  },
);

it("keeps spelling and repetition while stripping markup and recognizing canonical decomposed Hangul", () => {
  const text = "쾅 욱 욱! BOOM♪ ㄷㄷ".normalize("NFD");
  const marked = serializeRichTextRuns([{ text, bold: true, italic: false }]);
  const described = describeLetteringText(marked);
  expect(described.text).toBe(text);
  expect(described.hangul).toEqual([
    { syllable: "쾅", initial: "ㅋ", vowel: "ㅘ", final: "ㅇ" },
    { syllable: "욱", initial: "ㅇ", vowel: "ㅜ", final: "ㄱ" },
    { syllable: "욱", initial: "ㅇ", vowel: "ㅜ", final: "ㄱ" },
  ]);
});

it.each(["", "BOOM!", "ドン", "ㄷㄷ", "😀"])(
  "does not invent Hangul components for %s",
  (text) => {
    expect(describeLetteringText(text)).toEqual({ text, hangul: [] });
  },
);
