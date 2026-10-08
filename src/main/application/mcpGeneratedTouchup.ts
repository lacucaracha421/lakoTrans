import { createHash } from "node:crypto";
import { generatedLettering } from "../../shared/blockFormatValueSchemas";
import { hashStableValue } from "../../shared/blockFingerprint";
import { pagePointToLettering } from "../../shared/generatedLetteringMask";
import { appendLetteringPartMove } from "../../shared/generatedLetteringPartMove";
import { normalizeBboxTo1000 } from "../../shared/bboxNormalization";
import type { McpGeneratedTouchup } from "../../shared/mcpGeneratedTouchup";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { McpEditError } from "./mcpEditPolicy";

export function generatedAssetSha256(block: TranslationBlock): string | null {
  const encoded = block.generatedLettering?.dataUrl.split(",")[1];
  return encoded
    ? createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")
    : null;
}

export function applyGeneratedTouchup(
  page: MangaPage,
  block: TranslationBlock,
  edit: McpGeneratedTouchup["edits"][number],
): TranslationBlock {
  const asset = block.generatedLettering;
  if (!asset || generatedAssetSha256(block) !== edit.assetSha256)
    throw new McpEditError(
      "revision_conflict",
      "Generated asset changed or is missing. Inspect its current SHA before touchup.",
    );
  let next = structuredClone(asset);
  const box = normalizeBboxTo1000(
    block.renderBbox ?? block.bbox,
    page,
    block.renderBbox
      ? (block.renderBboxSpace ?? block.bboxSpace)
      : block.bboxSpace,
  );
  for (const move of edit.moves) {
    const map = (point: { x: number; y: number }) =>
      move.space === "asset"
        ? point
        : pagePointToLettering(point, { ...block, renderBbox: box }, page);
    const from = map(move.from),
      to = map(move.to);
    next = appendLetteringPartMove(next, move.polygon.map(map), {
      x: to.x - from.x,
      y: to.y - from.y,
    });
  }
  for (const stroke of edit.strokes) {
    appendStroke(next, stroke, block, page, box);
  }
  for (const key of ["outline", "occlusionPolygons"] as const) {
    if (edit[key] === null) delete next[key];
    else if (edit[key] !== undefined)
      Object.assign(next, { [key]: structuredClone(edit[key]) });
  }
  return { ...block, generatedLettering: generatedLettering.parse(next) };
}

function appendStroke(
  next: NonNullable<TranslationBlock["generatedLettering"]>,
  stroke: McpGeneratedTouchup["edits"][number]["strokes"][number],
  block: TranslationBlock,
  page: MangaPage,
  box: ReturnType<typeof normalizeBboxTo1000>,
) {
  if (stroke.mode === "paint") {
    if (!stroke.color)
      throw new McpEditError("invalid_edit", "Paint requires a color.");
    const points =
      stroke.space === "asset"
        ? stroke.points
        : stroke.points.map((point) =>
            pagePointToLettering(point, { ...block, renderBbox: box }, page),
          );
    const paint = {
      shape: stroke.shape,
      softness: stroke.softness,
      points,
      radiusX: stroke.radiusX * (stroke.space === "page" ? 1000 / box.w : 1),
      radiusY: stroke.radiusY * (stroke.space === "page" ? 1000 / box.h : 1),
      color: stroke.color,
    };
    next.paintStrokes = [...(next.paintStrokes ?? []), paint];
    const { color: _color, ...mask } = paint;
    next.maskStrokes = [
      ...(next.maskStrokes ?? []),
      { ...mask, space: "asset", mode: "restore" },
    ];
  } else {
    const { color: _color, ...mask } = stroke;
    next.maskStrokes = [
      ...(next.maskStrokes ?? []),
      { ...mask, mode: stroke.mode },
    ];
  }
}

/** Apply, undo and redo have identical protection; only native touchup fields may differ. */
export function assertGeneratedTouchupOnly(
  before: TranslationBlock,
  after: TranslationBlock,
) {
  const protectedState = (block: TranslationBlock) => {
    if (!block.generatedLettering)
      throw new McpEditError(
        "invalid_edit",
        "Touchup requires an existing generated layer.",
      );
    const {
      maskStrokes: _m,
      paintStrokes: _p,
      partMoves: _moves,
      outline: _o,
      occlusionPolygons: _c,
      ...asset
    } = block.generatedLettering;
    return { ...block, generatedLettering: asset };
  };
  if (
    hashStableValue(protectedState(before)) !==
    hashStableValue(protectedState(after))
  )
    throw new McpEditError(
      "invalid_edit",
      "Touchup cannot replace image bytes, text, geometry or unrelated properties.",
    );
  generatedLettering.parse(after.generatedLettering);
}
