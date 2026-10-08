import type { TypesettingImage } from "../application/codexTypesettingContracts";
/** Character anatomy references and failed artwork carry separate instructions. */
export function letteringGenerationReferences(
  prompt: string,
  source: string,
  images: TypesettingImage[] = [],
  anchor?: string,
): [string, string[]] {
  const anchorInstruction = anchor
    ? "\nImage 2 is the FIRST completed target lettering in this same visual family. Use it as a fixed STYLE anchor (tone, texture, edge treatment and pen pressure), never as text or glyph anatomy to copy. The current approved text and its correct script structure remain authoritative, even if the anchor has malformed letters. Use the layout from image 1. Preserve differences that are visible in the current original; do not progressively invent a new style."
    : "";
  const correction = images.length
    ? `\nAdditional correction references: ${images.map((image) => image.label).join("; ")}. The failed candidate is only a texture/layout reference: repair its incorrect glyph anatomy. Exact Korean font specimens show character structure only; retain the source artwork's expressive treatment.`
    : "";
  return [
    prompt + anchorInstruction + correction,
    [
      source,
      ...(anchor ? [anchor] : []),
      ...images.map((image) => image.dataUrl),
    ],
  ];
}
