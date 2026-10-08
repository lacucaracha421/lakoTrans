import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { editingChapter } from "./mcpEditing.fixture";
import { createPageRevision } from "../src/shared/pageRevision";
import { McpCompositeRenderEvidenceSchema } from "../src/shared/mcpCompositeWorkflowReview";
import { McpTranslationQualityAssessmentSchema } from "../src/shared/mcpTranslationQuality";
import type { McpQualityEvidence } from "../src/shared/mcpQualityEvidence";
import { assertDetailedTranslationPage } from "../src/main/application/mcpDetailedTranslationQuality";

export function generatedFixturePng() {
  const png = new PNG({ width: 4, height: 4 });
  png.data.fill(255, 0, 16);
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}
export function detailedQualityFixture() {
  const page = editingChapter().pages[0];
  page.blocks = [page.blocks[0]];
  const block = page.blocks[0];
  delete block.generatedLettering;
  block.translatedText = "그분께 인사를 드리겠습니다.";
  block.textRole = "ordinary";
  const sourceId = randomUUID(),
    specimenId = randomUUID();
  const fingerprint = "f".repeat(64),
    sourceSha256 = "a".repeat(64),
    paletteRevision = "b".repeat(64);
  const receipts = new Map<string, McpQualityEvidence>([
    [
      sourceId,
      {
        id: sourceId,
        kind: "source-page",
        createdAt: 1,
        chapterId: "chapter",
        pageId: page.id,
        sourceSha256,
        imageSha256: sourceSha256,
      },
    ],
    [
      specimenId,
      {
        id: specimenId,
        kind: "font-specimen",
        createdAt: 1,
        fontFingerprint: fingerprint,
        catalogSnapshot: "catalog",
        text: block.translatedText,
        samples: ["local-font", "other-font"].map((fontId) => ({
          fontId,
          label: fontId,
          imageSha256: sourceSha256,
        })),
      },
    ],
  ]);
  const evidence = McpCompositeRenderEvidenceSchema.parse({
    id: randomUUID(),
    owner: "owner",
    compositeId: randomUUID(),
    phaseId: "review",
    pass: 1,
    kind: "rendered-page",
    workId: "work",
    chapterId: "chapter",
    pageId: page.id,
    revision: createPageRevision(page),
    reviewRevision: createPageRevision(page),
    sourceFingerprint: sourceSha256,
    contextFingerprint: paletteRevision,
    settingsFingerprint: fingerprint,
    fontFingerprint: fingerprint,
    fontEvidence: {
      appManaged: "bytes-sha256",
      systemFallback: "native-render-pixels-only",
    },
    sha256: fingerprint,
    width: 1000,
    height: 1600,
    pixelMapping: { originX: 0, originY: 0, scaleX: 1, scaleY: 1 },
    renderOptionsFingerprint: fingerprint,
    createdAt: 1,
    paletteRevision,
    layout: [
      {
        blockId: block.id,
        rendered: "text",
        displayText: block.translatedText,
        lines: [block.translatedText],
        fontSizePx: 28,
        innerWidth: 200,
        innerHeight: 80,
        overflow: false,
        direction: "horizontal",
        hangulInk: {
          sampleCount: 5,
          medianHeight: 25,
          medianWidth: 25,
          minimumHeight: 24,
          maximumHeight: 26,
        },
      },
    ],
  });
  const quality = McpTranslationQualityAssessmentSchema.parse({
    sourceCoverage: "passed",
    translationAccuracy: "passed",
    contextConsistency: "passed",
    soundEffectCoverage: "passed",
    backgroundRestoration: "passed",
    typography: "passed",
    generatedGlyphs: "not-applicable",
    soundEffectsFound: 0,
    soundEffectsCompleted: 0,
    unresolved: [],
    detailed: {
      sourceEvidenceId: sourceId,
      inventory: [
        {
          itemId: "item",
          blockId: block.id,
          sourceRect: { x: 10, y: 20, w: 90, h: 120 },
          role: "dialogue",
          outcome: "editable-text",
          restoration: "completed",
          reason: "Translated and inspected",
        },
      ],
      fontEvidence: [{ fontId: "local-font", specimenId }],
      paletteRevision,
      layoutReviewed: true,
      exceptions: [],
    },
  });
  const input: Parameters<typeof assertDetailedTranslationPage>[0] = {
    page,
    evidence,
    sourceSha256,
    paletteRevision,
    assessment: {
      chapterId: "chapter",
      pageId: page.id,
      evidenceId: evidence.id,
      quality,
    },
    readEvidence: async (id) => {
      const result = receipts.get(id);
      if (!result) throw new Error("Receipt missing");
      return result;
    },
  };
  if (!quality.detailed || !evidence.layout)
    throw new Error("Fixture evidence required");
  return {
    input,
    page,
    block,
    quality,
    detail: quality.detailed,
    layout: evidence.layout,
    receipts,
    sourceId,
    specimenId,
    fingerprint,
  };
}
