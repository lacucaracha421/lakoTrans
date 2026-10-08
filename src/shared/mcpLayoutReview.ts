import type { PageExportLayoutEvidence } from "./pageExportContracts";

/** Review candidates only; never changes text or the protected fitting algorithm. */
export function inspectMcpLayout(
  layout: PageExportLayoutEvidence,
  pageHeight?: number,
) {
  const sizes = layout
    .filter(
      (item) =>
        item.rendered === "text" &&
        item.direction === "horizontal" &&
        (item.lines?.join("").length ?? 0) >= 8,
    )
    .map((item) => item.fontSizePx * (item.textScaleY ?? 1))
    .sort((a, b) => a - b);
  const median = sizes.length >= 4 ? sizes[Math.floor(sizes.length / 2)] : null;
  return layout.flatMap((item) => {
    if (item.rendered === "generated" || item.rendered === "hidden") return [];
    const lines = item.lines?.map((line) => line.trim()).filter(Boolean) ?? [];
    const reasons = [
      ...(item.overflow ? ["overflow"] : []),
      ...lineWarnings(lines),
      ...sizeWarnings(item, lines, median),
      ...(pageHeight &&
      item.hangulInk &&
      (item.hangulInk.medianHeight * (item.textScaleY ?? 1) * 1000) /
        pageHeight <
        10
        ? ["small-ink-at-1000px-page-height"]
        : []),
      ...(item.direction === "vertical"
        ? ["vertical-korean-needs-composition-reason"]
        : []),
    ];
    return reasons.length ? [{ blockId: item.blockId, reasons }] : [];
  });
}

function lineWarnings(lines: string[]) {
  if (lines.length <= 1) return [];
  return [
    ...(lines.some((line) => /^[\p{P}\p{S}]+$/u.test(line))
      ? ["punctuation-only-line"]
      : []),
    ...(lines.some((line) => /^[가-힣][.!?…·。！？]*$/u.test(line))
      ? ["isolated-korean-syllable"]
      : []),
  ];
}
function sizeWarnings(
  item: PageExportLayoutEvidence[number],
  lines: string[],
  median: number | null,
) {
  return [
    ...(median &&
    item.fontSizePx * (item.textScaleY ?? 1) < median * 0.72 &&
    lines.join("").length >= 8
      ? ["small-relative-to-page-body"]
      : []),
    ...(lines.length > 0 &&
    item.innerHeight > 0 &&
    (lines.length * item.fontSizePx) / item.innerHeight < 0.25
      ? ["sparse-large-text-box"]
      : []),
  ];
}
