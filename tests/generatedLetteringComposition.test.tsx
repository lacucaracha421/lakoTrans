/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GeneratedLetteringImage } from "../src/renderer/src/components/GeneratedLetteringImage";
import { appendLetteringPartMove } from "../src/shared/generatedLetteringPartMove";
import {
  detailedQualityFixture,
  generatedFixturePng,
} from "./mcpDetailedQuality.fixture";

afterEach(cleanup);
it("renders a composed cut/move once, retaining outline and opacity without reapplying brushes", () => {
  const { block } = detailedQualityFixture();
  const stroke = {
    shape: "circle" as const,
    radiusX: 4,
    radiusY: 4,
    softness: 0,
    points: [{ x: 200, y: 200 }],
  };
  const asset = {
    version: 1 as const,
    dataUrl: generatedFixturePng(),
    sourceText: block.sourceText,
    translatedText: block.translatedText,
    paintStrokes: [{ ...stroke, color: "#123456" }],
    maskStrokes: [
      { ...stroke, space: "asset" as const, mode: "hide" as const },
    ],
    outline: { width: 3, color: "#ffffff" },
  };
  block.generatedLettering = appendLetteringPartMove(
    asset,
    [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ],
    { x: 150, y: 60 },
  );
  block.textOpacity = 0.75;
  const view = render(
    <GeneratedLetteringImage
      block={block}
      className="artwork"
      nativeSize={{ width: 1000, height: 1000 }}
    />,
  );
  const image = screen.getByRole("img", { name: block.translatedText });
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  const source = image.getAttribute("src") ?? "";
  const svg = decodeURIComponent(source.slice("data:image/svg+xml,".length));
  expect(svg.split(asset.dataUrl)).toHaveLength(2);
  expect(svg).toContain("translate(150 60)");
  expect(image.parentElement?.style.maskImage).toBe("");
  expect(image.parentElement?.parentElement?.style.opacity).toBe("0.75");
  expect(
    view.container.querySelector("feMorphology")?.getAttribute("radius"),
  ).toBe("0.003 0.003");
});
