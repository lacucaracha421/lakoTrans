import { expect, it, vi } from "vitest";
import { inspectMcpTranslationCompletion } from "../src/main/application/mcpTranslationCompletion";
import { McpTranslationCompletionSchema } from "../src/shared/mcpTranslationGuide";
import { McpEditError } from "../src/main/application/mcpEditPolicy";
import type { McpCompositeRecord } from "../src/main/application/mcpCompositeWorkflowPorts";
import {
  compositeFixture,
  compositePlan,
  guard,
  mutation,
  owner,
  reviewReport,
} from "./mcpCompositeWorkflow.fixture";
import { detailedQualityFixture } from "./mcpDetailedQuality.fixture";
import { inspectTranslationSavedQuality } from "../src/main/application/mcpTranslationQuality";

async function completed(pageIds: string[]) {
  const f = compositeFixture();
  const plan = compositePlan(true);
  plan.mode = "detailed";
  plan.qualityPolicy = "complete-translation-v2";
  plan.targets = {
    kind: "saved",
    pages: pageIds.map((pageId) => ({
      workId: "work",
      chapterId: "chapter",
      pageId,
      blockIds: [],
    })),
  };
  const detail = detailedQualityFixture();
  const render = f.native.renderEvidence;
  f.native.renderEvidence = async (...args) =>
    (await render(...args)).map((evidence) => ({
      ...evidence,
      savedQuality: inspectTranslationSavedQuality(detail.page),
    }));
  const prepared = await f.service.prepare(owner, plan, guard);
  await f.service.run(owner, mutation(prepared), guard);
  const awaiting = await f.service.waitForCompletion(owner, prepared.id, guard);
  const report = reviewReport(awaiting);
  const record = await f.service.report(
    owner,
    {
      ...report,
      assessments: report.assessments.map((item) => ({
        ...item,
        quality: detail.quality,
      })),
    },
    guard,
  );
  expect(record.status).toBe("completed");
  await f.service.close();
  return record;
}
function selection(records: McpCompositeRecord[], count = 7) {
  const snapshot = records[0].snapshot.pages[0];
  return {
    workId: "work",
    chapterId: "chapter",
    chapterPageCount: count,
    pages: Array.from({ length: count }, (_, index) => ({
      pageId: `page-${index + 1}`,
      revision: snapshot.revision,
      reviewRevision: snapshot.reviewRevision,
    })),
  };
}
function ports(records: McpCompositeRecord[]) {
  return {
    list: vi.fn(async () => structuredClone(records)),
    verifySources: vi.fn(async () => {}),
  };
}
it("keeps the whole chapter incomplete when five-page and one-page successful chunks omit the sixth page", async () => {
  const records = [
    await completed(["page-1", "page-2", "page-3", "page-4", "page-5"]),
    await completed(["page-7"]),
  ];
  const before = structuredClone(records),
    input = selection(records),
    p = ports(records);
  const result = McpTranslationCompletionSchema.parse(
    await inspectMcpTranslationCompletion(owner, input, guard, p),
  );
  expect(result).toMatchObject({
    scope: "whole-chapter",
    status: "incomplete",
    checkedPages: 7,
    acceptedPages: 6,
  });
  expect(result.pages.filter((page) => page.status !== "accepted")).toEqual([
    {
      pageId: "page-6",
      revision: input.pages[5].revision,
      status: "pending",
      reason: expect.any(String),
    },
  ]);
  expect(p.list).toHaveBeenCalledWith(owner);
  expect(p.verifySources).toHaveBeenCalledTimes(2);
  expect(records).toEqual(before);
  records.push(await completed(["page-6"]));
  expect(
    await inspectMcpTranslationCompletion(owner, input, guard, ports(records)),
  ).toMatchObject({
    status: "accepted-at-current-revisions",
    acceptedPages: 7,
  });
});
it("separates selected-page completion and discloses font substitutions", async () => {
  const record = await completed(["page-1"]);
  const detail = record.phases[0].report?.assessments[0].quality?.detailed;
  if (!detail) throw new Error("Missing fixture quality");
  detail.inventory[0].outcome = "font-fallback";
  const input = selection([record]);
  input.pages = input.pages.slice(0, 1);
  expect(
    await inspectMcpTranslationCompletion(owner, input, guard, ports([record])),
  ).toMatchObject({
    scope: "selected-pages",
    status: "accepted-with-font-substitutions",
    chapterPageCount: 7,
    acceptedPages: 1,
    fontSubstitutions: [{ pageId: "page-1", itemId: "item" }],
  });
});
it("invalidates changed page revisions and source/font/palette/policy bindings", async () => {
  const record = await completed(["page-1", "page-2"]),
    input = selection([record], 2),
    p = ports([record]);
  input.pages[0].revision = "page-v1:" + "0".repeat(16);
  p.verifySources.mockRejectedValue(
    new McpEditError("revision_conflict", "Palette bytes changed"),
  );
  const result = await inspectMcpTranslationCompletion(owner, input, guard, p);
  expect(result.acceptedPages).toBe(0);
  expect(result.pages.map((page) => page.status)).toEqual(["stale", "stale"]);
  expect(p.verifySources).toHaveBeenCalledTimes(1);
});
it("does not borrow another owner, expired or legacy records, or bypass a newer held review", async () => {
  const valid = await completed(["page-1"]),
    input = selection([valid], 1);
  const foreign = { ...structuredClone(valid), owner: "another" };
  const expired = { ...structuredClone(valid), expiresAt: 1 };
  const legacy = structuredClone(valid);
  legacy.plan.qualityPolicy = "complete-translation-v1";
  const p = ports([foreign, expired, legacy]);
  expect(
    (await inspectMcpTranslationCompletion(owner, input, guard, p))
      .acceptedPages,
  ).toBe(0);
  expect(p.verifySources).not.toHaveBeenCalled();
  const held = structuredClone(valid);
  held.status = "held";
  held.stopReason = "review-blocked";
  held.updatedAt += 10;
  expect(
    (
      await inspectMcpTranslationCompletion(
        owner,
        input,
        guard,
        ports([valid, held]),
      )
    ).pages[0],
  ).toMatchObject({
    status: "pending",
    reason: expect.stringContaining("review-blocked"),
  });
});
it("does not certify missing per-page assessments and propagates revoked authorization or storage faults", async () => {
  const record = await completed(["page-1"]),
    input = selection([record], 1);
  const missing = structuredClone(record);
  delete missing.phases[0].report?.assessments[0].quality?.detailed;
  expect(
    (
      await inspectMcpTranslationCompletion(
        owner,
        input,
        guard,
        ports([missing]),
      )
    ).acceptedPages,
  ).toBe(0);
  const p = ports([record]);
  p.verifySources.mockRejectedValue(
    new McpEditError("access_denied", "Revoked"),
  );
  await expect(
    inspectMcpTranslationCompletion(owner, input, guard, p),
  ).rejects.toThrow("Revoked");
  p.verifySources.mockRejectedValue(new Error("Storage unavailable"));
  await expect(
    inspectMcpTranslationCompletion(owner, input, guard, p),
  ).rejects.toThrow("Storage unavailable");
  let revoked = false;
  p.list.mockImplementation(async () => {
    revoked = true;
    return [record];
  });
  await expect(
    inspectMcpTranslationCompletion(
      owner,
      input,
      () => {
        if (revoked) throw new Error("revoked during read");
      },
      p,
    ),
  ).rejects.toThrow("revoked during read");
});
