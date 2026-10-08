import { expect, it, vi } from "vitest";
import {
  validGlyphShape,
  validGlyphShapes,
} from "./generatedGlyphReview.fixture";
import { inspectGeneratedLettering } from "../src/main/application/codexTypesettingReadback";
import { translatedPageReading } from "../src/main/codexImageEditing";
import {
  detailedQualityFixture,
  generatedFixturePng,
} from "./mcpDetailedQuality.fixture";

it.each([
  ["쩌적…", "쩌적...", true],
  ["쿠구궁...", "쿠구궁…", true],
  ["쿠구궁……", "쿠구궁......", true],
  ["쩌적…", "쩌적..", false],
  ["쩌적…", "쩌적......", false],
  ["쿠웅…", "쿠우...", false],
  ["쩌적…!", "쩌적...", false],
  ["쿠웅", "쿠\n웅", true],
])(
  "compares rendered %s with transcript %s without hiding glyph errors",
  async (expected, readText, matches) => {
    const f = detailedQualityFixture();
    f.block.translatedText = expected;
    f.block.generatedLettering = {
      version: 1,
      dataUrl: generatedFixturePng(),
      sourceText: f.block.sourceText,
      translatedText: expected,
    };
    const onTranscript = vi.fn(async () => {});
    const issues = await inspectGeneratedLettering(
      f.page,
      translatedPageReading(f.page, "image"),
      1,
      {
        ask: async (stage) =>
          stage.startsWith("glyph-shape-")
            ? validGlyphShapes([f.block.id])
            : {
                regions: [{ regionId: f.block.id, text: readText }],
              },
        blockId: (id) => id,
        targetLanguage: "Korean",
        onTranscript,
      },
    );
    expect(issues).toHaveLength(matches ? 0 : 1);
    expect(onTranscript.mock.calls[0]?.slice(1, 3)).toEqual([
      readText,
      expected,
    ]);
  },
);

it("sends only composed corrected pixels to the blind reader, including generated ordinary blocks", async () => {
  const f = detailedQualityFixture();
  f.block.generatedLettering = {
    version: 1,
    dataUrl: generatedFixturePng(),
    sourceText: f.block.sourceText,
    translatedText: f.block.translatedText,
    paintStrokes: [
      {
        color: "#000000",
        points: [{ x: 300, y: 300 }],
        radiusX: 10,
        radiusY: 10,
        shape: "circle",
        softness: 0,
      },
    ],
  };
  const corrected = "data:image/png;base64,Y29ycmVjdGVkLXBpeGVscw==";
  const renderAsset = vi.fn(async () => corrected);
  const onTranscript = vi.fn(async () => {});
  const ask = vi.fn(async (stage: string) =>
    stage.startsWith("glyph-shape-")
      ? validGlyphShapes([f.block.id])
      : {
          regions: [{ regionId: f.block.id, text: f.block.translatedText }],
        },
  );
  const result = await inspectGeneratedLettering(
    f.page,
    translatedPageReading(f.page, "image"),
    1,
    {
      ask,
      blockId: (id) => id,
      targetLanguage: "Korean",
      renderAsset,
      onTranscript,
    },
  );
  expect(result).toEqual([]);
  expect(renderAsset).toHaveBeenCalledWith(f.block);
  expect(JSON.stringify(ask.mock.calls)).not.toContain(f.block.translatedText);
  expect(JSON.stringify(ask.mock.calls)).not.toContain(
    f.block.generatedLettering.dataUrl,
  );
  expect(JSON.stringify(ask.mock.calls)).toContain(corrected);
  expect(onTranscript).toHaveBeenCalledWith(
    f.block.id,
    f.block.translatedText,
    f.block.translatedText,
    corrected,
    validGlyphShape,
  );
});

it.each(["repair-needed", "uncertain"] as const)(
  "blocks a correct OCR guess when the separate shape inspection is %s",
  async (verdict) => {
    const f = detailedQualityFixture();
    f.block.translatedText = "욱";
    f.block.generatedLettering = {
      version: 1,
      dataUrl: generatedFixturePng(),
      sourceText: f.block.sourceText,
      translatedText: "욱",
    };
    const shape = {
      version: 1 as const,
      verdict,
      reason: "The vowel and final consonant are malformed.",
      issues: [
        {
          kind: "malformed-jamo" as const,
          reason: "The lower vowel stroke merges into the final consonant.",
          rect: { x: 50, y: 400, w: 900, h: 550 },
        },
      ],
    };
    const prompts: string[] = [],
      onTranscript = vi.fn(async () => {});
    const issues = await inspectGeneratedLettering(
      f.page,
      translatedPageReading(f.page, "image"),
      1,
      {
        ask: async (stage, prompt) => {
          prompts.push(prompt);
          return stage.startsWith("glyph-shape-")
            ? { regions: [{ regionId: f.block.id, shape }] }
            : { regions: [{ regionId: f.block.id, text: "욱" }] };
        },
        blockId: (id) => id,
        targetLanguage: "Korean",
        onTranscript,
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain("자형 검수");
    expect(prompts).toHaveLength(2);
    expect(prompts.join(" ")).not.toContain("욱");
    expect(onTranscript).toHaveBeenCalledWith(
      f.block.id,
      "욱",
      "욱",
      f.block.generatedLettering.dataUrl,
      shape,
    );
  },
);
