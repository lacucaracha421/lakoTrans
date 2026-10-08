import { letteringMaskSvg, letteringPaintSvg } from "./generatedLetteringMask";
import type { TranslationBlock } from "./textTypes";

type Artwork = NonNullable<TranslationBlock["generatedLettering"]>;
const image = (href: string) =>
  `<image width="1000" height="1000" preserveAspectRatio="none" href="${href}"/>`;
const svgImage = (svg: string) =>
  image(`data:image/svg+xml,${encodeURIComponent(svg)}`);

/** Only the new cut/move path uses this compositor. Legacy rendering stays unchanged. */
export function letteringMovedSvg(artwork: Artwork): string {
  const masks =
    artwork.maskStrokes?.filter((stroke) => stroke.space === "asset") ?? [];
  const paints = artwork.paintStrokes ?? [];
  const definitions: string[] = [`<g id="base">${image(artwork.dataUrl)}</g>`];
  let previous = "base",
    paintStart = 0,
    maskStart = 0;
  const moves = artwork.partMoves ?? [];
  for (let index = 0; index <= moves.length; index++) {
    const move = moves[index];
    const paintEnd = move?.paintCount ?? paints.length;
    const maskEnd = move?.maskCount ?? masks.length;
    const composed = `composed${index}`;
    definitions.push(
      brushStageSvg(
        composed,
        previous,
        paints.slice(paintStart, paintEnd),
        masks.slice(maskStart, maskEnd),
      ),
    );
    previous = composed;
    if (move) {
      const polygon = move.polygon.map((p) => `${p.x},${p.y}`).join(" ");
      definitions.push(
        `<clipPath id="part${index}"><polygon points="${polygon}"/></clipPath>`,
      );
      definitions.push(
        `<mask id="cut${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="white"/><polygon points="${polygon}" fill="black"/></mask>`,
      );
      previous = `moved${index}`;
      definitions.push(
        `<g id="${previous}"><use href="#${composed}" mask="url(#cut${index})"/><g transform="translate(${move.offset.x} ${move.offset.y})"><use href="#${composed}" clip-path="url(#part${index})"/></g></g>`,
      );
    }
    paintStart = paintEnd;
    maskStart = maskEnd;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs>${definitions.join("")}</defs><use href="#${previous}"/></svg>`;
}

function brushStageSvg(
  id: string,
  previous: string,
  paints: NonNullable<Artwork["paintStrokes"]>,
  masks: NonNullable<Artwork["maskStrokes"]>,
) {
  const painted = paints.length ? svgImage(letteringPaintSvg(paints)) : "";
  const maskId = `${id}-mask`;
  const mask = masks.length
    ? `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">${svgImage(letteringMaskSvg(masks))}</mask>`
    : "";
  return `${mask}<g id="${id}"${mask ? ` mask="url(#${maskId})"` : ""}><use href="#${previous}"/>${painted}</g>`;
}
