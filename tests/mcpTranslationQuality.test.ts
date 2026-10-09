import { expect, it } from "vitest";
import {
  compositeFixture,
  compositePlan,
  guard,
  mutation,
  owner,
  reviewReport,
} from "./mcpCompositeWorkflow.fixture";
import { editingChapter } from "./mcpEditing.fixture";
import { McpCompositePrepareSchema } from "../src/shared/mcpCompositeWorkflow";
import { McpTranslationQualityAssessmentSchema } from "../src/shared/mcpTranslationQuality";
import { inspectTranslationSavedQuality } from "../src/main/application/mcpTranslationQuality";
import { assertTranslationQualityReport } from "../src/main/application/mcpTranslationQuality";
import { compositeWorkflowView } from "../src/main/application/mcpCompositeWorkflowProjection";
import { detailedQualityFixture } from "./mcpDetailedQuality.fixture";

const quality = () =>
  McpTranslationQualityAssessmentSchema.parse({
    sourceCoverage: "passed",
    translationAccuracy: "passed",
    contextConsistency: "passed",
    soundEffectCoverage: "passed",
    backgroundRestoration: "passed",
    typography: "passed",
    generatedGlyphs: "not-applicable",
    soundEffectsFound: 1,
    soundEffectsCompleted: 1,
    unresolved: [],
  });

it("discloses accepted font substitutions by page and keeps their explanation", async () => {
  const f = await awaitingQuality();
  try {
    const detail = detailedQualityFixture().input.assessment.quality?.detailed;
    if (!detail) throw Error("Missing detailed fixture");
    detail.inventory[0].outcome = "font-fallback";
    detail.inventory[0].reason =
      "Four retained attempts could not preserve the approved syllable";
    f.report.assessments[0].quality.detailed = detail;
    f.awaiting.phases[0].report = f.report;
    const view = compositeWorkflowView(f.awaiting);
    expect(view.qualityReview).toBe("accepted-with-font-substitutions");
    expect(view.fontSubstitutions).toEqual([
      {
        chapterId: f.report.assessments[0].chapterId,
        pageId: f.report.assessments[0].pageId,
        itemId: detail.inventory[0].itemId,
        reason: detail.inventory[0].reason,
      },
    ]);
  } finally {
    await f.service.close();
  }
});
async function awaitingQuality() {
  const f = compositeFixture();
  const render = f.native.renderEvidence;
  f.native.renderEvidence = async (...args) =>
    (await render(...args)).map((item) => ({
      ...item,
      savedQuality: {
        blocks: 1,
        generatedLettering: 0,
        hasCleanedImage: true,
        untranslated: 0,
        missingSource: 0,
        staleLettering: 0,
        pendingSoundEffects: 0,
        soundEffects: 1,
      },
    }));
  const plan = {
    ...compositePlan(true),
    qualityPolicy: "complete-translation-v1" as const,
  };
  const record = await f.service.prepare(owner, plan, guard);
  await f.service.run(owner, mutation(record), guard);
  const awaiting = await f.service.waitForCompletion(owner, record.id, guard);
  const report = reviewReport(awaiting);
  return {
    ...f,
    awaiting,
    report: {
      ...report,
      assessments: report.assessments.map((item) => ({
        ...item,
        quality: quality(),
      })),
    },
  };
}
it("requires a final render review for quality plans while retaining manual workflows", () => {
  expect(McpCompositePrepareSchema.safeParse(compositePlan()).success).toBe(
    true,
  );
  expect(
    McpCompositePrepareSchema.safeParse({
      ...compositePlan(),
      qualityPolicy: "complete-translation-v1",
    }).success,
  ).toBe(false);
});
it("requires v2 inventory for preserved SFX without ignoring ordinary omissions", async () => {
  const f = await awaitingQuality();
  try {
    const assessment = f.report.assessments[0];
    Object.assign(assessment.quality, {
      soundEffectScope: "preserve-original",
      soundEffectsCompleted: 0,
      soundEffectsPreserved: 1,
    });
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /v2 inventory/,
    );
    f.awaiting.plan.qualityPolicy = "complete-translation-v2";
    const evidence = f.awaiting.phases
      .flatMap((phase) => phase.evidence ?? [])
      .find((item) => item.id === assessment.evidenceId);
    if (!evidence?.savedQuality) throw Error("Missing saved quality");
    evidence.savedQuality.pendingSoundEffects = 1;
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /Unresolved/,
    );
    const detail = detailedQualityFixture().input.assessment.quality?.detailed;
    if (!detail) throw Error("Missing inventory fixture");
    Object.assign(assessment.quality, { detailed: detail });
    expect(() =>
      assertTranslationQualityReport(f.awaiting, f.report),
    ).not.toThrow();
    evidence.savedQuality.untranslated = 1;
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /Unresolved/,
    );
  } finally {
    await f.service.close();
  }
});
it("requires per-page quality and accepts fresh complete review with replay-safe receipts", async () => {
  const f = await awaitingQuality();
  try {
    expect(compositeWorkflowView(f.awaiting).qualityReview).toBe("pending");
    expect(
      compositeWorkflowView({ ...f.awaiting, status: "held" }).qualityReview,
    ).toBe("partial");
    await expect(
      f.service.report(owner, reviewReport(f.awaiting), guard),
    ).rejects.toThrow(/every page/);
    const result = await f.service.report(owner, f.report, guard);
    expect(result.status).toBe("completed");
    expect(compositeWorkflowView(result).qualityReview).toBe(
      "accepted-at-reviewed-revision",
    );
    expect(await f.service.report(owner, f.report, guard)).toEqual(result);
    const edited = structuredClone(result);
    edited.snapshot.pages[0].revision = "page-v1:" + "c".repeat(16);
    expect(compositeWorkflowView(edited).qualityReview).toBe("partial");
  } finally {
    await f.service.close();
  }
});
it.each([
  "sourceCoverage",
  "translationAccuracy",
  "contextConsistency",
  "soundEffectCoverage",
  "backgroundRestoration",
  "typography",
  "generatedGlyphs",
] as const)("rejects accepted reports with unverified %s", async (key) => {
  const f = await awaitingQuality();
  try {
    f.report.assessments[0].quality[key] = "unverified";
    await expect(f.service.report(owner, f.report, guard)).rejects.toThrow(
      /Unresolved/,
    );
    expect((await f.service.get(owner, f.awaiting.id, guard)).status).toBe(
      "awaiting-review",
    );
  } finally {
    await f.service.close();
  }
});
it("reports incomplete SFX as partial and rejects stale render assessments", async () => {
  const f = await awaitingQuality();
  try {
    f.report.assessments[0].quality.soundEffectsCompleted = 0;
    f.report.assessments[0].quality.unresolved = [
      "Untranslated drawn effect beside the character",
    ];
    await expect(f.service.report(owner, f.report, guard)).rejects.toThrow(
      /Unresolved/,
    );
    const result = await f.service.report(
      owner,
      { ...f.report, verdict: "needs-correction" },
      guard,
    );
    expect(compositeWorkflowView(result).qualityReview).toBe("partial");
  } finally {
    await f.service.close();
  }
  const stale = await awaitingQuality();
  try {
    stale.staleEvidence();
    await expect(
      stale.service.report(owner, stale.report, guard),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  } finally {
    await stale.service.close();
  }
});
it("counts detector and manual omissions, stale resolutions and untranslated saved effects", () => {
  const page = editingChapter().pages[0];
  page.blocks[0].translatedText = "";
  page.soundEffectReview = {
    contractVersion: 3,
    producer: "hayai-regions-v1",
    regions: [
      { id: "r", bbox: { x: 0, y: 0, w: 50, h: 50 }, detectorConfidence: 1 },
    ],
    regionOverrides: [],
    manualRegions: [
      {
        id: "m",
        bbox: { x: 50, y: 50, w: 50, h: 50 },
        detectorConfidence: 1,
        createdAt: "now",
      },
    ],
    resolvedRegions: [{ regionId: "r", blockId: "missing", resolvedAt: "now" }],
  };
  expect(inspectTranslationSavedQuality(page)).toMatchObject({
    untranslated: 1,
    pendingSoundEffects: 2,
    soundEffects: 2,
  });
  page.soundEffectReview.dismissedRegionIds = ["m"];
  page.soundEffectReview.resolvedRegions[0].blockId = "b";
  expect(inspectTranslationSavedQuality(page).pendingSoundEffects).toBe(0);
});

it.each([
  "untranslated",
  "missingSource",
  "staleLettering",
  "pendingSoundEffects",
] as const)(
  "saved %s prevents accepted even when the host claims success",
  async (key) => {
    const f = await awaitingQuality();
    try {
      const saved = f.awaiting.phases[0].evidence?.[0].savedQuality;
      if (!saved) throw new Error("Missing saved quality evidence");
      saved[key] = 1;
      expect(() =>
        assertTranslationQualityReport(f.awaiting, f.report),
      ).toThrow(/Unresolved/);
    } finally {
      await f.service.close();
    }
  },
);

it("requires applicable glyph, restoration and typography checks", async () => {
  const f = await awaitingQuality();
  try {
    const saved = f.awaiting.phases[0].evidence?.[0].savedQuality;
    if (!saved) throw new Error("Missing saved quality evidence");
    saved.generatedLettering = 1;
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /required visual checks are generatedGlyphs/,
    );
    f.report.assessments[0].quality.generatedGlyphs = "passed";
    expect(() =>
      assertTranslationQualityReport(f.awaiting, f.report),
    ).not.toThrow();
    f.report.assessments[0].quality.backgroundRestoration = "not-applicable";
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /required visual checks are backgroundRestoration.*done earlier/,
    );
    f.report.assessments[0].quality.typography = "not-applicable";
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      `Page ${f.report.assessments[0].pageId}: required visual checks are typography, backgroundRestoration`,
    );
  } finally {
    await f.service.close();
  }
});

it("bounds combined generation attempts and preserves cumulative history and refusal on correction", async () => {
  const f = await awaitingQuality();
  try {
    const prior = {
      regionId: "effect",
      hostAttempts: 2,
      appAttempts: 1,
      outcome: "policy-refused" as const,
      reason: "Provider refused this region",
    };
    expect(
      McpTranslationQualityAssessmentSchema.safeParse({
        ...quality(),
        imageHistory: [{ ...prior, appAttempts: 3 }],
      }).success,
    ).toBe(false);
    expect(
      McpTranslationQualityAssessmentSchema.safeParse({
        ...quality(),
        imageHistory: [prior, prior],
      }).success,
    ).toBe(false);
    const report = structuredClone(f.report);
    report.verdict = "needs-correction";
    report.assessments[0].quality.imageHistory = [prior];
    f.awaiting.phases[0].report = report;
    expect(() =>
      assertTranslationQualityReport(f.awaiting, {
        ...f.report,
        verdict: "needs-correction",
      }),
    ).toThrow(/cumulative/);
    f.report.assessments[0].quality.imageHistory = [
      { ...prior, outcome: "local-fallback" },
    ];
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /cumulative/,
    );
    f.report.assessments[0].quality.imageHistory = [
      { ...prior, hostAttempts: 1 },
    ];
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /cumulative/,
    );
    f.report.assessments[0].quality.imageHistory = [prior];
    expect(() => assertTranslationQualityReport(f.awaiting, f.report)).toThrow(
      /Unresolved/,
    );
    expect(() =>
      assertTranslationQualityReport(f.awaiting, {
        ...f.report,
        verdict: "needs-correction",
      }),
    ).not.toThrow();
  } finally {
    await f.service.close();
  }
});
