import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  detailedQualityFixture,
  generatedFixturePng,
} from "./mcpDetailedQuality.fixture";
import { assertDetailedTranslationPage } from "../src/main/application/mcpDetailedTranslationQuality";
import { generatedAssetSha256 } from "../src/main/application/mcpGeneratedTouchup";
import { compositeFingerprint } from "../src/main/application/mcpCompositeWorkflowPolicy";
import { inspectMcpLayout } from "../src/shared/mcpLayoutReview";

it("accepts current native receipts and independent horizontal Korean composition", async () => {
  const f = detailedQualityFixture();
  expect(f.block.sourceDirection).toBe("vertical");
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
});
it("keeps manual placement available when native shape flow is unverified", async () => {
  const f = detailedQualityFixture();
  f.layout[0].shapeFlow = "unverified";
  delete f.block.bubbleLayout;
  f.block.autoFitText = false;
  const before = structuredClone(f.page);
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  expect(f.page).toEqual(before);
});
it.each([
  "missing-source",
  "wrong-source",
  "missing-font",
  "wrong-font",
  "changed-font-bytes",
  "changed-palette",
  "missing-layout",
  "hidden-text",
  "source-only",
  "no-ink",
  "unresolved",
  "missing-block",
  "unrecorded-sfx",
])("rejects %s evidence instead of marking completion", async (kind) => {
  const f = detailedQualityFixture();
  if (kind === "missing-source") f.receipts.delete(f.sourceId);
  if (kind === "wrong-source") f.input.sourceSha256 = "c".repeat(64);
  if (kind === "missing-font") f.detail.fontEvidence = [];
  if (kind === "wrong-font") f.block.fontFamily = "unseen-font";
  if (kind === "changed-font-bytes")
    f.input.evidence.fontFingerprint = "d".repeat(64);
  if (kind === "changed-palette") f.input.paletteRevision = "c".repeat(64);
  if (kind === "missing-layout") f.input.evidence.layout = [];
  if (kind === "hidden-text") f.layout[0].rendered = "hidden";
  if (kind === "source-only") f.layout[0].displayText = f.block.sourceText;
  if (kind === "no-ink") f.layout[0].hangulInk = null;
  if (kind === "unresolved") f.detail.inventory[0].outcome = "unresolved";
  if (kind === "missing-block") f.detail.inventory = [];
  if (kind === "unrecorded-sfx") f.quality.soundEffectsFound = 1;
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow();
});
it("flags tiny text with overflow=false and isolates bad Korean endings and punctuation", async () => {
  const f = detailedQualityFixture();
  f.layout[0].fontSizePx = 10;
  for (let i = 0; i < 4; i++)
    f.layout.push({ ...f.layout[0], blockId: `peer${i}`, fontSizePx: 40 });
  expect(inspectMcpLayout(f.layout)[0].reasons).toContain(
    "small-relative-to-page-body",
  );
  f.layout[0].lines = ["뵙겠습니", "다", "!"];
  expect(inspectMcpLayout(f.layout)[0].reasons).toEqual(
    expect.arrayContaining([
      "isolated-korean-syllable",
      "punctuation-only-line",
    ]),
  );
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /layout warning/,
  );
  f.detail.exceptions = [
    {
      blockId: f.block.id,
      reason: "Intentional tiny whisper inspected at normal reading size.",
    },
  ];
  f.layout.splice(1);
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  f.layout[0].overflow = true;
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    `overflow for block ${f.block.id}`,
  );
});
it("detects uniformly tiny ink at a stated reading scale even without peer blocks", async () => {
  const f = detailedQualityFixture();
  f.layout[0].hangulInk = {
    sampleCount: 4,
    medianHeight: 8,
    medianWidth: 8,
    minimumHeight: 7,
    maximumHeight: 9,
  };
  expect(inspectMcpLayout(f.layout, 1600)[0].reasons).toContain(
    "small-ink-at-1000px-page-height",
  );
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /layout warning/,
  );
});
it("requires review of separate paragraphs even when the rectangular layout fits", async () => {
  const f = detailedQualityFixture();
  f.layout[0].displayText = "흐흥\n \n제 아름다움을\n새삼 말할 필요는 없겠죠";
  f.block.translatedText = f.layout[0].displayText;
  f.layout[0].overflow = false;
  const before = structuredClone(f.layout);
  expect(inspectMcpLayout(f.layout)[0].reasons).toContain(
    "paragraph-gap-needs-balloon-region-check",
  );
  expect(f.layout).toEqual(before);
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /layout warning/,
  );
  f.detail.exceptions = [
    {
      blockId: f.block.id,
      reason:
        "Actual source and final crop confirm two intentional paragraphs inside a single safe narration panel.",
    },
  ];
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  f.layout[0].displayText = "흐흥\n제 아름다움을\n새삼 말할 필요는 없겠죠";
  f.block.translatedText = f.layout[0].displayText;
  f.detail.exceptions = [];
  expect(inspectMcpLayout(f.layout)).toEqual([]);
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
});
it("requires contour review for long narrow paragraphs even when rectangular fitting passes", async () => {
  const f = detailedQualityFixture();
  f.block.translatedText =
    "상관의 명령이라\n내키지 않아도\n따를 수밖에 없던\n자들에 대해서는";
  Object.assign(f.layout[0], {
    displayText: f.block.translatedText,
    lines: f.block.translatedText.split("\n"),
    innerWidth: 255,
    innerHeight: 320,
    overflow: false,
  });
  expect(inspectMcpLayout(f.layout)).toContainEqual({
    blockId: f.block.id,
    reasons: ["multiline-narrow-region-needs-contour-review"],
  });
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /layout warning/i,
  );
  f.detail.exceptions = [
    {
      blockId: f.block.id,
      reason:
        "The current final crop was checked line by line inside the curved contour, including both ends of the lowest line.",
    },
  ];
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  f.layout[0].innerHeight = 200;
  expect(inspectMcpLayout(f.layout)).toEqual([]);
});
it("requires actual generated letters, independent corrected-pixel evidence and separate purpose history", async () => {
  const f = detailedQualityFixture();
  const item = f.detail.inventory[0];
  item.outcome = "generated-lettering";
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /erasure alone/,
  );
  f.block.generatedLettering = {
    version: 1,
    dataUrl: generatedFixturePng(),
    sourceText: f.block.sourceText,
    translatedText: f.block.translatedText,
  };
  f.layout[0].rendered = "generated";
  item.glyphEvidenceId = randomUUID();
  const assetSha256 = generatedAssetSha256(f.block);
  if (!assetSha256) throw new Error("PNG required");
  f.receipts.set(item.glyphEvidenceId, {
    id: item.glyphEvidenceId,
    createdAt: 1,
    kind: "generated-glyphs",
    chapterId: "chapter",
    pageId: f.page.id,
    blockId: f.block.id,
    revision: f.input.evidence.revision,
    assetSha256,
    compositionFingerprint: compositeFingerprint(f.block),
    imageSha256: "e".repeat(64),
    expectedText: f.block.translatedText,
    readText: f.block.translatedText,
    passed: true,
    shape: structuredClone(validGlyphShape),
  });
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /separately/,
  );
  f.quality.imageHistory = [
    {
      regionId: item.itemId,
      purpose: "korean-lettering",
      hostAttempts: 1,
      appAttempts: 0,
      outcome: "generated",
      reason: "Generated the approved Korean wording.",
    },
  ];
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  const receipt = f.receipts.get(item.glyphEvidenceId);
  if (receipt?.kind !== "generated-glyphs")
    throw Error("Glyph fixture required");
  delete receipt.shape;
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /shape inspection/,
  );
  receipt.shape = {
    version: 1,
    verdict: "uncertain",
    reason: "Vowel anatomy cannot be verified.",
    issues: [],
  };
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /OCR guess/,
  );
  receipt.shape = structuredClone(validGlyphShape);
  f.block.generatedLettering.outline = { width: 2, color: "#ffffff" };
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(/stale/);
});
it("identifies the inventory item when a font substitution history mistakenly uses its block ID", async () => {
  const f = detailedQualityFixture();
  f.detail.inventory[0].outcome = "font-fallback";
  f.quality.imageHistory = [
    {
      regionId: f.block.id,
      purpose: "korean-lettering",
      hostAttempts: 0,
      appAttempts: 1,
      outcome: "local-fallback",
      reason: "A compared font replaced an unusable generated candidate.",
    },
  ];
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /Inventory item item requires imageHistory.regionId.*itemId.*outcome=local-fallback/,
  );
  f.quality.imageHistory[0].regionId = f.detail.inventory[0].itemId;
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
});
import { validGlyphShape } from "./generatedGlyphReview.fixture";
