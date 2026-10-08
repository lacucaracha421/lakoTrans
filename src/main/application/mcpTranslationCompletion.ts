import type { McpTranslationCompletion } from "../../shared/mcpTranslationGuide";
import type {
  McpCompositeGuard,
  McpCompositeRecord,
} from "./mcpCompositeWorkflowPorts";
import { compositeWorkflowView } from "./mcpCompositeWorkflowProjection";
import { McpEditError } from "./mcpEditPolicy";

type Selection = {
  chapterId: string;
  workId: string;
  chapterPageCount: number;
  pages: Array<{ pageId: string; revision: string; reviewRevision: string }>;
};
export type McpTranslationCompletionReader = (
  owner: string,
  selection: Selection,
  guard: McpCompositeGuard,
) => Promise<McpTranslationCompletion>;
type Ports = {
  list: (owner: string) => Promise<McpCompositeRecord[]>;
  verifySources: (
    record: McpCompositeRecord,
    guard: McpCompositeGuard,
  ) => Promise<void>;
  now?: () => number;
};

/** Reuses retained reviews; observing a chapter never creates a plan, render or new verdict. */
export async function inspectMcpTranslationCompletion(
  owner: string,
  selection: Selection,
  guard: McpCompositeGuard,
  ports: Ports,
): Promise<McpTranslationCompletion> {
  guard();
  const now = ports.now?.() ?? Date.now();
  const records = (await ports.list(owner))
    .filter(
      (record) =>
        record.owner === owner &&
        record.expiresAt > now &&
        record.plan.qualityPolicy === "complete-translation-v2",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  guard();
  const verified = new Map<string, boolean>();
  const pages: McpTranslationCompletion["pages"] = [];
  const fontSubstitutions: McpTranslationCompletion["fontSubstitutions"] = [];
  for (const page of selection.pages) {
    guard();
    const record = records.find((record) =>
      record.targets.some(
        (target) =>
          target.workId === selection.workId &&
          target.chapterId === selection.chapterId &&
          target.pageId === page.pageId,
      ),
    );
    const status = await inspectPage(
      record,
      page,
      selection.chapterId,
      verified,
      guard,
      ports,
    );
    pages.push({ pageId: page.pageId, revision: page.revision, ...status });
    if (record && status.status === "accepted") {
      fontSubstitutions.push(
        ...(compositeWorkflowView(record).fontSubstitutions ?? [])
          .filter(
            (item) =>
              item.chapterId === selection.chapterId &&
              item.pageId === page.pageId,
          )
          .map(({ pageId, itemId, reason }) => ({ pageId, itemId, reason })),
      );
    }
  }
  guard();
  const acceptedPages = pages.filter(
    (page) => page.status === "accepted",
  ).length;
  const complete = pages.length > 0 && acceptedPages === pages.length;
  return {
    scope:
      pages.length === selection.chapterPageCount
        ? "whole-chapter"
        : "selected-pages",
    status: complete
      ? fontSubstitutions.length
        ? "accepted-with-font-substitutions"
        : "accepted-at-current-revisions"
      : "incomplete",
    chapterPageCount: selection.chapterPageCount,
    checkedPages: pages.length,
    acceptedPages,
    pages,
    fontSubstitutions,
    nextAction: complete
      ? "These selected pages have current owned v2 review evidence. Disclose font substitutions and the exact scope; this is not a professional-quality guarantee."
      : "Inspect pending/stale pages and their composite states. Resolve their findings and obtain current v2 reviews before claiming completion. Preserve accepted work; exporting PNGs does not certify missing pages. Do not reset failed native attempts or consumed budgets.",
    observation: "current-owned-v2-evidence; not-an-aesthetic-guarantee",
  };
}

async function inspectPage(
  record: McpCompositeRecord | undefined,
  page: Selection["pages"][number],
  chapterId: string,
  verified: Map<string, boolean>,
  guard: McpCompositeGuard,
  ports: Ports,
): Promise<
  Omit<McpTranslationCompletion["pages"][number], "pageId" | "revision">
> {
  if (!record)
    return {
      status: "pending",
      reason: "No retained v2 review from this connection covers this page.",
    };
  const compositeId = record.id;
  const issue = reviewIssue(record, page, chapterId);
  if (issue) return { compositeId, ...issue };
  if (!verified.has(record.id))
    verified.set(record.id, await currentSources(record, guard, ports));
  guard();
  return verified.get(record.id)
    ? {
        status: "accepted",
        compositeId,
        reason:
          "Completed v2 review; current page, source, fonts, context, palette and policy binding checked.",
      }
    : {
        status: "stale",
        compositeId,
        reason:
          "The review source, fonts, context, palette, membership or policy binding changed.",
      };
}

function reviewIssue(
  record: McpCompositeRecord,
  page: Selection["pages"][number],
  chapterId: string,
): { status: "pending" | "stale"; reason: string } | undefined {
  const view = compositeWorkflowView(record);
  if (
    record.status !== "completed" ||
    record.usageUnknown ||
    !view.qualityReview?.startsWith("accepted-")
  )
    return {
      status: "pending",
      reason: `Latest v2 composite is ${record.status}${record.stopReason ? ` (${record.stopReason})` : ""}; it is not completed review evidence.`,
    };
  const expected = record.snapshot.pages.find(
    (item) => item.chapterId === chapterId && item.pageId === page.pageId,
  );
  if (
    expected?.revision !== page.revision ||
    expected.reviewRevision !== page.reviewRevision
  )
    return {
      status: "stale",
      reason: "The saved page changed after its accepted review.",
    };
  if (!hasDetailedPageReview(record, page.pageId, chapterId))
    return {
      status: "pending",
      reason:
        "This page lacks its own detailed assessment and issued render evidence.",
    };
}

function hasDetailedPageReview(
  record: McpCompositeRecord,
  pageId: string,
  chapterId: string,
) {
  const phase = record.phases.filter((phase) => phase.report).at(-1);
  const assessment = phase?.report?.assessments.find(
    (item) => item.chapterId === chapterId && item.pageId === pageId,
  );
  return Boolean(
    assessment?.quality?.detailed &&
    phase?.evidence?.some(
      (item) =>
        item.id === assessment.evidenceId &&
        item.pageId === pageId &&
        item.chapterId === chapterId,
    ),
  );
}

async function currentSources(
  record: McpCompositeRecord,
  guard: McpCompositeGuard,
  ports: Ports,
) {
  try {
    await ports.verifySources(record, guard);
    return true;
  } catch (error) {
    if (
      error instanceof McpEditError &&
      ["revision_conflict", "invalid_edit", "not_found"].includes(error.code)
    )
      return false;
    throw error;
  }
}
