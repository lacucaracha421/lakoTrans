import { hashStableValue } from "../../shared/blockFingerprint";
import {
  McpCompositeViewSchema,
  mcpCompositeWorkflowOutputs,
} from "../../shared/mcpCompositeWorkflowOutputs";
import type {
  McpCompositeRecord,
  McpCompositePhaseState,
} from "./mcpCompositeWorkflowPorts";
import { parseCompositeRecord } from "./mcpCompositeWorkflowRecord";
import { McpEditError } from "./mcpEditPolicy";
import { nextCompositePhase } from "./mcpCompositeWorkflowPolicy";

type Window = { offset: number; limit: number; snapshot?: string };

/** Only declared plan/evidence metadata crosses transport; native inputs and internal references stay private. */
export function compositeWorkflowView(value: McpCompositeRecord) {
  const record = parseCompositeRecord(value);
  const { pageEdits: _pageEdits, ...used } = record.used;
  return McpCompositeViewSchema.parse({
    ...summary(record),
    plan: record.plan,
    snapshot: record.snapshot.fingerprint,
    targets: record.targets,
    used,
    phases: record.phases.map((phase, index) => ({
      descriptor: record.plan.phases[index],
      status: phase.status,
      ...(phase.binding
        ? {
            binding: {
              family: phase.binding.family,
              nativeRequestId: phase.binding.nativeRequestId,
              inputFingerprint: phase.binding.inputFingerprint,
              snapshot: phase.binding.snapshot.fingerprint,
            },
          }
        : {}),
      ...(phase.attemptId ? { attemptId: phase.attemptId } : {}),
      ...(phase.child ? { child: phase.child } : {}),
      ...(phase.outcome ? { outcome: phase.outcome } : {}),
      evidenceCount: phase.evidence?.length ?? 0,
      ...(phase.report ? { report: reportSummary(phase.report) } : {}),
    })),
  });
}

export function compositeWorkflowList(
  records: McpCompositeRecord[],
  input: Window,
) {
  const checked = records.map(parseCompositeRecord);
  const snapshot = hashStableValue(
    checked.map((record) => [record.id, record.version, record.status]),
  );
  const page = paginate(checked, input, snapshot);
  return mcpCompositeWorkflowOutputs.carrot_list_composites.parse({
    ...page,
    items: page.items.map(summary),
  });
}

export function compositeWorkflowReview(
  value: McpCompositeRecord,
  phaseId: string,
  input: Window,
) {
  const record = parseCompositeRecord(value);
  const phase = compositeReviewPhase(record, phaseId);
  const snapshot = hashStableValue([record.id, record.version, phase]);
  return mcpCompositeWorkflowOutputs.carrot_get_composite_review.parse({
    id: record.id,
    version: record.version,
    phaseId,
    status: phase.status,
    evidence: (phase.evidence ?? []).map(({ owner: _owner, ...item }) => item),
    ...(phase.report ? { report: reportSummary(phase.report) } : {}),
    findings: paginate(phase.report?.findings ?? [], input, snapshot),
    observation:
      "metadata-only; retrieve-issued-render-image-before-host-assessment",
  });
}

export function compositeReviewPhase(
  record: McpCompositeRecord,
  phaseId: string,
) {
  const index = record.plan.phases.findIndex(
    (phase) => phase.id === phaseId && phase.kind === "review",
  );
  const phase = record.phases[index];
  if (!phase)
    throw new McpEditError(
      "not_found",
      "The owned composite has no such review phase.",
    );
  return phase;
}

function summary(record: McpCompositeRecord) {
  return {
    kind: record.kind,
    format: record.format,
    id: record.id,
    version: record.version,
    status: record.status,
    ...(record.stopReason ? { stopReason: record.stopReason } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    pageCount: record.targets.length,
    phaseCount: record.phases.length,
    completedPhases: record.phases.filter(
      (phase) => phase.status === "completed" || phase.status === "skipped",
    ).length,
    usageUnknown: record.usageUnknown,
    ...reviewRecovery(record),
    ...(record.plan.qualityPolicy
      ? {
          qualityReview: qualityReviewStatus(record),
          fontSubstitutions: fontSubstitutions(record),
        }
      : {}),
    retention:
      "seven-days; same-profile-and-owner; no-automatic-reexecution" as const,
    automaticResume: false as const,
    crossOwnerHandoff: false as const,
  };
}

function reviewRecovery(record: McpCompositeRecord) {
  const phase = nextCompositePhase(record);
  const descriptor = record.plan.phases.find((item) => item.id === phase?.id);
  if (
    record.status !== "held" ||
    record.stopReason !== "interrupted" ||
    record.usageUnknown ||
    descriptor?.kind !== "review" ||
    !phase ||
    phase.attemptId ||
    phase.binding ||
    phase.evidence?.length ||
    phase.report
  )
    return {};
  return {
    reviewRecovery: {
      kind: "unissued-review" as const,
      phaseId: phase.id,
      instruction:
        "The review render did not issue evidence; there is no native edit receipt for carrot_reconcile_composite. Keep the saved translation and this failed record. Inspect current pages and wait for active saves to settle, then prepare a new review-only composite at current revisions and retrieve its actual renders. Do not repeat translation, erasure or generation, reuse old evidence, or treat this held review as completed. Native attempts, unknown usage and blocked quality findings cannot use this recovery path.",
    },
  };
}

function reportSummary(report: NonNullable<McpCompositePhaseState["report"]>) {
  return {
    reviewerKind: report.reviewerKind,
    verdictOrigin: report.verdictOrigin,
    verdict: report.verdict,
    findingsCount: report.findings.length,
    findingsOverflow: report.findingsOverflow,
    ...(report.assessments.some((item) => item.quality)
      ? { assessments: report.assessments }
      : {}),
  };
}

function paginate<T>(items: T[], input: Window, snapshot: string) {
  if (
    (input.offset > 0 && !input.snapshot) ||
    (input.snapshot && input.snapshot !== snapshot)
  )
    throw new McpEditError(
      "revision_conflict",
      "Composite metadata changed. Restart pagination from offset zero.",
    );
  return {
    total: items.length,
    offset: input.offset,
    limit: input.limit,
    snapshot,
    nextOffset:
      input.offset + input.limit < items.length
        ? input.offset + input.limit
        : null,
    items: items.slice(input.offset, input.offset + input.limit),
  };
}

function qualityReviewStatus(record: McpCompositeRecord) {
  const reviewed = record.phases.filter((phase) => phase.report).at(-1);
  if (!reviewed)
    return record.status === "held"
      ? ("partial" as const)
      : ("pending" as const);
  const matches = reviewed.evidence?.every((evidence) =>
    record.snapshot.pages.some(
      (page) =>
        page.chapterId === evidence.chapterId &&
        page.pageId === evidence.pageId &&
        page.revision === evidence.revision &&
        page.reviewRevision === evidence.reviewRevision &&
        page.contextFingerprint === evidence.contextFingerprint &&
        page.fontFingerprint === evidence.fontFingerprint &&
        page.settingsFingerprint === evidence.settingsFingerprint &&
        page.sourceFingerprint === evidence.sourceFingerprint,
    ),
  );
  return reviewed.report?.verdict === "accepted" && matches
    ? fontSubstitutions(record).length
      ? ("accepted-with-font-substitutions" as const)
      : ("accepted-at-reviewed-revision" as const)
    : ("partial" as const);
}

function fontSubstitutions(record: McpCompositeRecord) {
  return (
    record.phases
      .filter((phase) => phase.report)
      .at(-1)
      ?.report?.assessments.flatMap(
        (assessment) =>
          assessment.quality?.detailed?.inventory
            .filter((item) => item.outcome === "font-fallback")
            .map((item) => ({
              chapterId: assessment.chapterId,
              pageId: assessment.pageId,
              itemId: item.itemId,
              reason: item.reason,
            })) ?? [],
      ) ?? []
  );
}
