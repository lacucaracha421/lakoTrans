import type { MangaPage } from "../../shared/libraryTypes";
import { inspectMcpReviewPage } from "./mcpReviewPage";
import { McpEditError } from "./mcpEditPolicy";
import { translationQualityPassed } from "../../shared/mcpTranslationQuality";
import type { McpCompositeRecord } from "./mcpCompositeWorkflowPorts";
import type { McpCompositeReviewReport } from "../../shared/mcpCompositeWorkflowReview";

export function inspectTranslationSavedQuality(page: MangaPage) {
  const { untranslated, missingSource, staleLettering, soundEffects } =
    inspectMcpReviewPage(page, 0).counts;
  const review = page.soundEffectReview;
  const resolved = new Set(
    review?.resolvedRegions
      .filter((item) =>
        page.blocks.some(
          (block) => block.id === item.blockId && block.translatedText.trim(),
        ),
      )
      .map((item) => item.regionId),
  );
  const dismissed = new Set(review?.dismissedRegionIds);
  const regions = [
    ...(review?.regions ?? []),
    ...(review?.manualRegions ?? []),
  ];
  const pendingSoundEffects = new Set(
    regions
      .filter((region) => !resolved.has(region.id) && !dismissed.has(region.id))
      .map((region) => region.id),
  ).size;
  return {
    blocks: page.blocks.length,
    generatedLettering: page.blocks.filter(
      (block) =>
        block.generatedLettering?.enabled !== false && block.generatedLettering,
    ).length,
    hasCleanedImage: Boolean(page.inpaintedImagePath),
    untranslated,
    missingSource,
    staleLettering,
    pendingSoundEffects,
    soundEffects,
  };
}

export function assertTranslationQualityReport(
  record: McpCompositeRecord,
  report: McpCompositeReviewReport,
) {
  if (!record.plan.qualityPolicy) return;
  for (const assessment of report.assessments) {
    const quality = assessment.quality;
    const evidence = record.phases
      .flatMap((phase) => phase.evidence ?? [])
      .find((item) => item.id === assessment.evidenceId);
    if (!quality || !evidence?.savedQuality)
      throw new McpEditError(
        "invalid_edit",
        "Quality translation requires every page's visual assessment and server-issued saved-quality evidence.",
      );
    assertImageHistory(record, assessment);
    assertLegacyBudget(record, quality);
    if (report.verdict !== "accepted") continue;
    const saved = evidence.savedQuality;
    const missingChecks = missingApplicableChecks(quality, saved);
    if (
      !translationQualityPassed(quality) ||
      [
        saved.untranslated,
        saved.missingSource,
        saved.staleLettering,
        pendingScopedSoundEffects(record, quality, saved.pendingSoundEffects),
      ].some((count) => count > 0) ||
      quality.soundEffectsFound < saved.soundEffects ||
      missingChecks.length > 0
    )
      throw new McpEditError(
        "invalid_edit",
        `Unresolved text, sound effects, artwork or visual checks require needs-correction/blocked, never accepted. Page ${assessment.pageId}: ${missingChecks.length ? `required visual checks are ${missingChecks.join(", ")}. Inspect the current render before marking them passed. not-applicable means the relevant asset is absent, not that its editing was skipped or done earlier` : "resolve the reported failures and saved-quality omissions"}.`,
      );
  }
}

function pendingScopedSoundEffects(
  record: McpCompositeRecord,
  quality: NonNullable<
    McpCompositeReviewReport["assessments"][number]["quality"]
  >,
  pending: number,
) {
  return quality.soundEffectScope === "preserve-original" &&
    record.plan.qualityPolicy === "complete-translation-v2" &&
    quality.detailed
    ? 0
    : pending;
}

function assertImageHistory(
  record: McpCompositeRecord,
  assessment: McpCompositeReviewReport["assessments"][number],
) {
  const previous = record.phases
    .flatMap((phase) => phase.report?.assessments ?? [])
    .filter(
      (item) =>
        item.chapterId === assessment.chapterId &&
        item.pageId === assessment.pageId,
    );
  const current = new Map(
    assessment.quality?.imageHistory.map((item) => [
      `${item.regionId}/${item.purpose ?? "legacy"}`,
      item,
    ]),
  );
  for (const prior of previous.flatMap(
    (item) => item.quality?.imageHistory ?? [],
  )) {
    const next = current.get(`${prior.regionId}/${prior.purpose ?? "legacy"}`);
    if (
      !next ||
      next.hostAttempts < prior.hostAttempts ||
      next.appAttempts < prior.appAttempts ||
      (prior.outcome === "policy-refused" && next.outcome !== "policy-refused")
    )
      throw new McpEditError(
        "invalid_edit",
        "Image generation history is cumulative: preserve prior attempts, fallback reasons and terminal policy refusals across review passes.",
      );
  }
}

function missingApplicableChecks(
  quality: NonNullable<
    McpCompositeReviewReport["assessments"][number]["quality"]
  >,
  saved: ReturnType<typeof inspectTranslationSavedQuality>,
) {
  return [
    ...(saved.blocks && quality.typography !== "passed" ? ["typography"] : []),
    ...(saved.generatedLettering && quality.generatedGlyphs !== "passed"
      ? ["generatedGlyphs"]
      : []),
    ...(saved.hasCleanedImage && quality.backgroundRestoration !== "passed"
      ? ["backgroundRestoration"]
      : []),
  ];
}

function assertLegacyBudget(
  record: McpCompositeRecord,
  quality: NonNullable<
    McpCompositeReviewReport["assessments"][number]["quality"]
  >,
) {
  if (
    record.plan.qualityPolicy === "complete-translation-v1" &&
    (quality.soundEffectScope === "preserve-original" ||
      quality.soundEffectsPreserved)
  )
    throw new McpEditError(
      "invalid_edit",
      "Explicit SFX preservation requires v2 inventory evidence; legacy v1 still requires translation.",
    );
  if (
    record.plan.qualityPolicy === "complete-translation-v1" &&
    quality.imageHistory.some(
      (item) => item.hostAttempts + item.appAttempts > 3,
    )
  )
    throw new McpEditError(
      "invalid_edit",
      "Legacy v1 retains its three-generation budget; use v2 for the four-attempt detailed workflow.",
    );
}
