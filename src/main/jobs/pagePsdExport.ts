import { resolveBlockDisplayText } from "../../shared/blockDisplayText";
import type { PageExportLayoutEvidence } from "../../shared/pageExportContracts";
import {
  writePsdBuffer,
  type Layer,
  type LayerTextData,
  type PixelData,
  type Psd,
} from "ag-psd";
import { PNG } from "pngjs";
import { resolveBlockRenderBbox } from "../../shared/geometry";
import type { MangaPage } from "../../shared/libraryTypes";
import { parseRichText, type TextStyleRun } from "../../shared/richTextMarkup";
import type { TranslationBlock } from "../../shared/textTypes";
import { resolveTextEffectFilter } from "../../shared/textEffect";
import { resolveEffectiveTextOutlineWidthPx } from "../../shared/textOutline";
import { getActiveGeneratedLettering } from "../../shared/generatedLettering";

type PagePsdTextLayerInput = {
  block: TranslationBlock;
  png: Buffer;
  layout?: PageExportLayoutEvidence[number];
};

export type BuildPagePsdInput = {
  cleanedBackgroundPng?: Buffer;
  compositePng: Buffer;
  originalBackgroundPng: Buffer;
  page: MangaPage;
  textLayers: PagePsdTextLayerInput[];
  resolveFontName?: (fontId: string | undefined) => string | null;
};

export function buildPagePsd({
  cleanedBackgroundPng,
  compositePng,
  originalBackgroundPng,
  page,
  textLayers,
  resolveFontName,
}: BuildPagePsdInput): Buffer {
  const composite = decodePagePng(compositePng, page);
  const original = decodePagePng(originalBackgroundPng, page);
  // ag-psd serializes children in PSD record order: bottom layer first. Keep
  // the backgrounds at the beginning and append text in visual paint order so
  // Photoshop presents text above cleanup, and cleanup above the original.
  const children: Layer[] = [
    {
      name: "원본 배경 (Original)",
      imageData: original,
      protected: { composite: true, position: true, transparency: true },
    },
  ];
  if (cleanedBackgroundPng) {
    children.push({
      name: "정리 배경 (Inpaint)",
      imageData: decodePagePng(cleanedBackgroundPng, page),
    });
  }
  const text = buildTextLayers(page, textLayers, resolveFontName);
  children.push(...text.rasters);

  const psd: Psd = {
    width: page.width,
    height: page.height,
    imageData: composite,
    children: [
      {
        name: "개별 이미지 · 편집 시 표시 (Raster layers)",
        hidden: true,
        opened: false,
        children,
      },
      {
        name: "편집용 글자 · 글꼴 설치 필요 (Editable text)",
        hidden: true,
        opened: false,
        children: text.editable,
      },
      {
        name: "완성 이미지 · 편집 시 숨김 (Exact output)",
        imageData: composite,
      },
    ],
    imageResources: {
      versionInfo: {
        hasRealMergedData: true,
        writerName: "Carrot Manga Translator",
        readerName: "Carrot Manga Translator",
        fileVersion: 1,
      },
    },
  };
  return writePsdBuffer(psd, {
    compress: true,
    generateThumbnail: false,
    noBackground: true,
    trimImageData: true,
  });
}

function buildTextLayers(
  page: MangaPage,
  inputs: PagePsdTextLayerInput[],
  resolveFontName?: BuildPagePsdInput["resolveFontName"],
): { rasters: Layer[]; editable: Layer[] } {
  const editable: Layer[] = [];
  const rasters = inputs.flatMap((input, index) => {
    const full = decodePagePng(input.png, page);
    const cropped = cropTransparentPixelData(full);
    if (!cropped) return [];
    if (!cropped.hasTransparentPixel) {
      throw new Error(
        `PSD text layer capture is fully opaque for block ${input.block.id} on ${page.name}.`,
      );
    }
    const displayText = resolveBlockDisplayText(input.block);
    const text = resolveEditablePsdText(
      input.block,
      page,
      displayText,
      resolveFontName?.(input.block.fontFamily),
      input.layout,
    );
    if (text)
      editable.push({
        name: formatTextLayerName(index, displayText, true),
        left: cropped.left,
        top: cropped.top,
        imageData: cropped.imageData,
        text,
      });
    return [
      {
        name: formatTextLayerName(index, displayText, false),
        left: cropped.left,
        top: cropped.top,
        imageData: cropped.imageData,
      } satisfies Layer,
    ];
  });
  return { rasters, editable };
}

export function resolveEditablePsdText(
  block: TranslationBlock,
  page: Pick<MangaPage, "width" | "height">,
  displayText = resolveBlockDisplayText(block),
  resolvedFontName?: string | null,
  layout?: PageExportLayoutEvidence[number],
): LayerTextData | null {
  if (resolvedFontName === null || !supportsEditablePsdText(block, displayText))
    return null;
  const bbox = resolveBlockRenderBbox(block, page);
  const left = (bbox.x / 1000) * page.width;
  const top = (bbox.y / 1000) * page.height;
  const width = Math.max(1, (bbox.w / 1000) * page.width);
  const height = Math.max(1, (bbox.h / 1000) * page.height);
  const right = left + width;
  const bottom = top + height;
  const radians = ((block.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const fontSize = Math.max(1, layout?.fontSizePx ?? block.fontSizePx);
  const bounds = {
    top: { units: "Pixels" as const, value: top },
    left: { units: "Pixels" as const, value: left },
    right: { units: "Pixels" as const, value: right },
    bottom: { units: "Pixels" as const, value: bottom },
  };
  return {
    text: layout?.lines?.length ? layout.lines.join("\r") : displayText,
    transform: [cos, sin, -sin, cos, left, top],
    left,
    top,
    right,
    bottom,
    bounds,
    boundingBox: bounds,
    antiAlias: "smooth",
    orientation: "horizontal",
    shapeType: "box",
    boxBounds: [0, 0, width, height],
    style: resolveEditablePsdTextStyle(block, fontSize, resolvedFontName),
    paragraphStyle: { justification: block.textAlign },
  };
}

function resolveEditablePsdTextStyle(
  block: TranslationBlock,
  fontSize: number,
  resolvedFontName: string | null | undefined,
): NonNullable<LayerTextData["style"]> {
  return {
    font: { name: resolvedFontName ?? resolvePsdFontName(block.fontFamily) },
    fontSize,
    fauxBold: Boolean(block.bold),
    fauxItalic: Boolean(block.italic),
    autoLeading: false,
    leading: fontSize * Math.max(0.5, block.lineHeight || 1),
    horizontalScale: Math.max(0.01, block.fontWidthScale ?? 1),
    tracking: (block.letterSpacing ?? 0) * 1000,
    fillColor: parseHexColor(block.textColor, { r: 17, g: 17, b: 17 }),
    ...(block.outlineColor
      ? {
          strokeColor: parseHexColor(block.outlineColor, {
            r: 255,
            g: 255,
            b: 255,
          }),
          strokeFlag: true,
          fillFlag: true,
          outlineWidth: resolveEffectiveTextOutlineWidthPx(block, fontSize),
        }
      : {}),
  };
}

function supportsEditablePsdText(
  block: TranslationBlock,
  displayText: string,
): boolean {
  if (
    !displayText ||
    getActiveGeneratedLettering(block) ||
    hasUnsupportedBlockTextFeatures(block)
  ) {
    return false;
  }
  const parsed = parseRichText(displayText);
  if (
    parsed.plainText !== displayText ||
    parsed.runs.some(hasUnsupportedRunStyle)
  ) {
    // ag-psd exposes only one text style for this editable layer contract.
    // Keep the faithfully rendered raster layer instead of leaking markup or
    // flattening per-character styles into the wrong editable appearance.
    return false;
  }
  return (
    !block.curveLayout && !block.perspectiveTransform && !block.warpTransform
  );
}

function hasUnsupportedBlockTextFeatures(block: TranslationBlock): boolean {
  return [
    block.renderDirection === "vertical",
    Boolean(resolveTextEffectFilter(block.textEffect)),
    block.textGlow?.enabled,
    block.textBackgroundEnabled,
    block.underline,
    block.strikethrough,
    block.emphasisMark,
    (block.outerOutlineWidthPx ?? 0) > 0,
  ].some(Boolean);
}

function hasUnsupportedRunStyle(run: TextStyleRun): boolean {
  const enabledStyles = [
    run.bold,
    run.italic,
    run.underline,
    run.strikethrough,
    run.emphasisMark,
  ];
  const optionalStyles = [
    run.sizePx,
    run.fontFamily,
    run.opacity,
    run.widthScale,
    run.color,
    run.backgroundColor,
    run.outlineColor,
    run.outlineWidthPx,
    run.outerOutlineColor,
    run.outerOutlineWidthPx,
    run.glowColor,
    run.glowBlurPx,
    run.glowOpacity,
  ];
  return (
    enabledStyles.some(Boolean) ||
    optionalStyles.some((value) => value !== undefined)
  );
}

export function cropTransparentPixelData(imageData: PixelData): {
  imageData: PixelData;
  left: number;
  top: number;
  hasTransparentPixel: boolean;
} | null {
  const { data, width, height } = imageData;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let hasTransparentPixel = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) {
        hasTransparentPixel = true;
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  const croppedWidth = right - left + 1;
  const croppedHeight = bottom - top + 1;
  const cropped = new Uint8Array(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y += 1) {
    const sourceStart = ((top + y) * width + left) * 4;
    const sourceEnd = sourceStart + croppedWidth * 4;
    cropped.set(data.subarray(sourceStart, sourceEnd), y * croppedWidth * 4);
  }
  return {
    left,
    top,
    hasTransparentPixel,
    imageData: { data: cropped, width: croppedWidth, height: croppedHeight },
  };
}

function decodePagePng(
  png: Buffer,
  page: Pick<MangaPage, "width" | "height" | "name">,
): PixelData {
  const decoded = PNG.sync.read(png, { skipRescale: true });
  if (decoded.width !== page.width || decoded.height !== page.height) {
    throw new Error(
      `PSD layer dimensions changed for ${page.name}: ${decoded.width}x${decoded.height}`,
    );
  }
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

function resolvePsdFontName(fontFamily: string | undefined): string {
  const value = String(fontFamily ?? "").trim();
  return value && value !== "default" ? value : "ArialMT";
}

function parseHexColor(
  value: string | undefined,
  fallback: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? ""));
  if (!match?.[1]) return fallback;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
}

function formatTextLayerName(
  index: number,
  text: string,
  editable: boolean,
): string {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 42) || "빈 블록";
  const order = String(index + 1).padStart(3, "0");
  return `${order} ${compact}${editable ? "" : " [raster]"}`;
}
