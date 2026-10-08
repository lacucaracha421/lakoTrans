import { stripRichTextMarkup } from "./richTextMarkup";
import { z } from "zod/v4";

export const LetteringTextStructureSchema = z
  .object({
    text: z.string(),
    hangul: z.array(
      z
        .object({
          syllable: z.string(),
          initial: z.string(),
          vowel: z.string(),
          final: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** Text authority for generation/repair, never input to independent pixel readers. */
export function describeLetteringText(value: string) {
  const text = stripRichTextMarkup(value);
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const vowels = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
  const finals = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
  const hangul = Array.from(text.normalize("NFC")).flatMap((syllable) => {
    const offset = (syllable.codePointAt(0) ?? 0) - 0xac00;
    if (offset < 0 || offset >= 11172) return [];
    return [
      {
        syllable,
        initial: initials[Math.floor(offset / 588)],
        vowel: vowels[Math.floor(offset / 28) % 21],
        final: offset % 28 ? finals[offset % 28] : null,
      },
    ];
  });
  return { text, hangul };
}
