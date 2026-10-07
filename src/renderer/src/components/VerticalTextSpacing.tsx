import React from "react";
import type { RenderTextDirection } from "../../../shared/textTypes";
import {
  tokenizeVerticalTextSpacing,
  segmentVerticalTextGraphemes,
  resolveDefaultVerticalGraphemeAdvancePx,
  resolveVerticalGraphemeAdvancePx,
  VERTICAL_WAVE_GLYPH_PATH,
  VERTICAL_WAVE_GLYPH_TRANSFORM,
} from "../lib/verticalTextSpacing";

type VerticalTextTokenValue = ReturnType<
  typeof tokenizeVerticalTextSpacing
>[number];

type VerticalSpacing = {
  fontSizePx: number;
  lineHeight: number;
  letterSpacingEm: number;
};

export function TextWithVerticalSpacing({
  bold = false,
  direction,
  text,
  spacing,
}: {
  bold?: boolean;
  direction: RenderTextDirection;
  text: string;
  spacing?: VerticalSpacing;
}): React.JSX.Element {
  if (direction !== "vertical") return <>{text}</>;
  return (
    <>
      {tokenizeVerticalTextSpacing(text)
        .flatMap((token) =>
          spacing && token.kind === undefined
            ? segmentVerticalTextGraphemes(token.text).map((text) => ({ text }))
            : [token],
        )
        .map((token, index) =>
          spacing ? (
            <VerticalTextCell
              bold={bold}
              key={index}
              token={token}
              spacing={spacing}
            />
          ) : (
            <VerticalTextToken bold={bold} key={index} token={token} />
          ),
        )}
    </>
  );
}

function VerticalTextCell({
  bold,
  token,
  spacing,
}: {
  bold: boolean;
  token: VerticalTextTokenValue;
  spacing: VerticalSpacing;
}): React.JSX.Element {
  if (token.text === "\n") return <br />;
  const { fontSizePx, lineHeight, letterSpacingEm } = spacing;
  const tracking = fontSizePx * letterSpacingEm;
  const advance = resolveDefaultVerticalGraphemeAdvancePx(
    fontSizePx,
    fontSizePx * lineHeight,
    tracking,
  );
  const height = segmentVerticalTextGraphemes(token.text).reduce(
    (sum, grapheme) =>
      sum +
      resolveVerticalGraphemeAdvancePx(grapheme, fontSizePx, advance, tracking),
    0,
  );
  return (
    <span
      data-vertical-cell=""
      style={{
        display: "inline-flex",
        inlineSize: height,
        blockSize: fontSizePx,
        alignItems: "center",
        justifyContent: "center",
        letterSpacing: 0,
        verticalAlign: "middle",
      }}
    >
      <VerticalTextToken bold={bold} token={token} />
    </span>
  );
}

function VerticalTextToken({
  bold,
  token,
}: {
  bold: boolean;
  token: VerticalTextTokenValue;
}): React.JSX.Element {
  if (token.kind === undefined) return <>{token.text}</>;
  if (token.kind === "ascii" || token.kind === "ideographic") {
    return <VerticalSpaceToken token={token} />;
  }
  if (token.presentation) {
    return <VerticalPunctuationShape bold={bold} token={token} />;
  }
  return <VerticalPresentationSymbol token={token} />;
}

function VerticalSpaceToken({
  token,
}: {
  token: VerticalTextTokenValue;
}): React.JSX.Element {
  return (
    <span
      data-vertical-space={token.kind}
      style={{
        display: "inline-block",
        inlineSize: `${token.advanceEm}em`,
        whiteSpace: "pre",
      }}
    >
      {token.text}
    </span>
  );
}

function VerticalPresentationSymbol({
  token,
}: {
  token: VerticalTextTokenValue;
}): React.JSX.Element {
  return (
    <span
      data-vertical-symbol={token.kind}
      data-vertical-source={token.text}
      style={{
        textCombineUpright: token.kind === "combine" ? "all" : undefined,
        textOrientation: "upright",
      }}
    >
      {token.displayText}
    </span>
  );
}

function VerticalPunctuationShape({
  bold,
  token,
}: {
  bold: boolean;
  token: VerticalTextTokenValue;
}): React.JSX.Element {
  if (token.presentation === "wave") {
    return <VerticalWaveGlyph token={token} />;
  }
  const cellCount =
    token.presentation === "dash" ? Array.from(token.text).length : 1;
  const path = resolveVerticalPunctuationPath(token.presentation, cellCount);
  const baseStrokeWidth =
    token.presentation === "dash" ? (bold ? "0.085em" : "0.055em") : "0.1em";
  return (
    <span
      aria-label={token.text}
      data-vertical-presentation={token.presentation}
      data-vertical-symbol={token.kind}
      data-vertical-source={token.text}
      role="img"
      style={{
        blockSize: "1em",
        display: "inline-block",
        inlineSize: `${cellCount}em`,
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 100 ${cellCount * 100}`}
        style={{
          display: "block",
          height: `${cellCount}em`,
          width: "1em",
        }}
      >
        <path
          d={path}
          fill="none"
          stroke="var(--mgt-vertical-symbol-outline-color, transparent)"
          strokeLinecap="round"
          style={{
            strokeWidth: `calc(${baseStrokeWidth} + var(--mgt-vertical-symbol-outline-width, 0px) + var(--mgt-vertical-symbol-outline-width, 0px))`,
            vectorEffect: "non-scaling-stroke",
          }}
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          style={{
            strokeWidth: baseStrokeWidth,
            vectorEffect: "non-scaling-stroke",
          }}
        />
      </svg>
    </span>
  );
}

function VerticalWaveGlyph({
  token,
}: {
  token: VerticalTextTokenValue;
}): React.JSX.Element {
  const outlineWidth = "var(--mgt-vertical-symbol-outline-width, 0px)";
  return (
    <span
      aria-label={token.text}
      data-vertical-presentation="wave"
      data-vertical-symbol={token.kind}
      data-vertical-source={token.text}
      role="img"
      style={{
        blockSize: "1em",
        display: "inline-block",
        inlineSize: "1em",
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 100 100"
        style={{ display: "block", height: "1em", width: "1em" }}
      >
        <path
          d={VERTICAL_WAVE_GLYPH_PATH}
          fill="var(--mgt-vertical-symbol-outline-color, transparent)"
          stroke="var(--mgt-vertical-symbol-outline-color, transparent)"
          strokeLinejoin="round"
          transform={VERTICAL_WAVE_GLYPH_TRANSFORM}
          style={{
            strokeWidth: `calc(${outlineWidth} + ${outlineWidth})`,
            vectorEffect: "non-scaling-stroke",
          }}
        />
        <path
          d={VERTICAL_WAVE_GLYPH_PATH}
          fill="currentColor"
          transform={VERTICAL_WAVE_GLYPH_TRANSFORM}
        />
      </svg>
    </span>
  );
}

function resolveVerticalPunctuationPath(
  presentation: VerticalTextTokenValue["presentation"],
  cellCount: number,
): string {
  if (presentation === "dash") return `M50 0V${cellCount * 100}`;
  return "M50 24h0.01M50 50h0.01M50 76h0.01";
}
