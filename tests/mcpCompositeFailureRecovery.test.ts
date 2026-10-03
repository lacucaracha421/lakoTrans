import { expect, it } from "vitest";
import { renderCompositeReview } from "../src/main/application/mcpCompositeWorkflowReviewRunner";
import { acceptCompositeReport } from "../src/main/application/mcpCompositeWorkflowReviewPolicy";
import {
  compositeFixture,
  compositePlan,
  deferred,
  guard,
  mutation,
  owner,
  reviewReport,
} from "./mcpCompositeWorkflow.fixture";

it("rejects pause during host review and all controls after completion", async () => {
  const f = compositeFixture();
  const prepared = await f.service.prepare(owner, compositePlan(true), guard);
  await f.service.run(owner, mutation(prepared), guard);
  const awaiting = await f.service.waitForCompletion(owner, prepared.id, guard);
  await expect(
    f.service.control(owner, mutation(awaiting), "pause", guard),
  ).rejects.toThrow("pending-review");
  const report = reviewReport(awaiting);
  const completed = await f.service.report(owner, report, guard);
  await expect(f.service.report(owner, report, guard)).resolves.toEqual(
    completed,
  );
  await expect(
    f.service.control(owner, mutation(completed), "cancel", guard),
  ).rejects.toThrow("Completed parents");
  expect((await f.service.get(owner, prepared.id, guard)).status).toBe(
    "completed",
  );
});

it("does not reserve issued review phases or exceed the authorized review pass budget", async () => {
  const f = compositeFixture();
  const plan = compositePlan(true);
  const prepared = await f.service.prepare(owner, plan, guard);
  await f.service.run(owner, mutation(prepared), guard);
  const awaiting = await f.service.waitForCompletion(owner, prepared.id, guard);
  await expect(
    renderCompositeReview.reserve(f.repository, awaiting, guard),
  ).rejects.toThrow("unissued phase");
  // Exercise the defensive boundary if authorization narrows after evidence was issued.
  awaiting.plan.maxReviewPasses = 1;
  acceptCompositeReport(awaiting, reviewReport(awaiting, "needs-correction"));
  const held = awaiting;
  expect(held).toMatchObject({ status: "held", stopReason: "review-blocked" });
  await expect(
    renderCompositeReview.reserve(f.repository, held, guard),
  ).rejects.toThrow("pass budget is exhausted");
  expect(f.events).toEqual(["rendered"]);
});

it("rejects incomplete, out-of-envelope and falsely accepted host findings", async () => {
  const f = compositeFixture();
  const plan = compositePlan(true);
  if (plan.targets.kind !== "saved") throw new Error("Expected saved targets");
  plan.targets.pages.push({ ...plan.targets.pages[0], pageId: "second-page" });
  const prepared = await f.service.prepare(owner, plan, guard);
  await f.service.run(owner, mutation(prepared), guard);
  const awaiting = await f.service.waitForCompletion(owner, prepared.id, guard);
  const report = reviewReport(awaiting);
  const correction = reviewReport(awaiting, "needs-correction");
  await expect(
    f.service.report(
      owner,
      { ...report, assessments: report.assessments.slice(0, 1) },
      guard,
    ),
  ).rejects.toThrow("every selected rendered page");
  await expect(
    f.service.report(
      owner,
      {
        ...correction,
        findings: [{ ...correction.findings[0], blockId: "foreign-block" }],
      },
      guard,
    ),
  ).rejects.toThrow("page or block envelope");
  await expect(
    f.service.report(
      owner,
      { ...report, findings: correction.findings },
      guard,
    ),
  ).rejects.toThrow("blocking findings");
  expect((await f.service.get(owner, prepared.id, guard)).status).toBe(
    "awaiting-review",
  );
});

it("keeps unresolved recovery held and replays reconciliation without another native lookup", async () => {
  const cleanup = deferred();
  const f = compositeFixture({ failCheckpoint: true, cleanup });
  const bound = await f.bind(
    await f.service.prepare(owner, compositePlan(), guard),
  );
  await f.service.run(owner, mutation(bound), guard);
  await f.entered.promise;
  const waiting = expect(
    f.service.waitForCompletion(owner, bound.id, guard),
  ).rejects.toThrow("Checkpoint write failed");
  cleanup.resolve();
  await waiting;
  const held = await f.service.get(owner, bound.id, guard);
  const request = mutation(held);
  let lookups = 0;
  f.native.reconcile = async () => {
    lookups += 1;
    return null;
  };
  const unresolved = await f.service.reconcile(owner, request, guard);
  expect(unresolved).toMatchObject({
    status: "held",
    usageUnknown: true,
    stopReason: "interrupted",
  });
  expect(unresolved.phases[0].status).toBe("held");
  await expect(f.service.reconcile(owner, request, guard)).resolves.toEqual(
    unresolved,
  );
  expect(lookups).toBe(1);
  f.native.reconcile = async (binding) => ({
    status: "interrupted",
    receipt: {
      kind: "workflow",
      id: bound.id,
      requestId: binding.nativeRequestId,
      family: binding.family,
      inputFingerprint: binding.inputFingerprint,
    },
    resultFingerprint: "a".repeat(64),
  });
  const interrupted = await f.service.reconcile(
    owner,
    mutation(unresolved),
    guard,
  );
  expect(interrupted).toMatchObject({
    status: "held",
    stopReason: "native-outcome",
  });
  expect(interrupted.phases[0].outcome?.status).toBe("interrupted");
  expect(f.events.filter((event) => event === "admitted")).toHaveLength(1);
});

it("preserves both native and checkpoint failures while close drains the child", async () => {
  const f = compositeFixture();
  const entered = deferred();
  const release = deferred();
  const nativeError = new Error("native failed");
  const checkpointError = new Error("checkpoint failed");
  f.native.execute = async () => {
    entered.resolve();
    await release.promise;
    throw nativeError;
  };
  const reserve = f.repository.reserve;
  f.repository.reserve = async (...args) => {
    const reservation = await reserve(...args);
    reservation.settlement.hold = async () => {
      throw checkpointError;
    };
    return reservation;
  };
  const bound = await f.bind(
    await f.service.prepare(owner, compositePlan(), guard),
  );
  await f.service.run(owner, mutation(bound), guard);
  await entered.promise;
  const waiting = f.service.waitForCompletion(owner, bound.id, guard);
  const closing = f.service.close();
  const settled = Promise.allSettled([waiting, closing]);
  release.resolve();
  const results = await settled;
  expect(results[0]).toMatchObject({
    status: "rejected",
    reason: {
      errors: [nativeError, checkpointError],
      cause: checkpointError,
    },
  });
  expect(results[1]).toMatchObject({
    status: "rejected",
    reason: {
      message: "Composite admission or native cleanup could not settle.",
      errors: [
        expect.objectContaining({ errors: [nativeError, checkpointError] }),
      ],
    },
  });
});

it("reports failed durable holding when shutdown interrupts a committed reservation", async () => {
  const f = compositeFixture();
  const checkpointError = new Error("hold failed");
  const reserve = f.repository.reserve;
  f.repository.reserve = async (...args) => {
    const reservation = await reserve(...args);
    reservation.settlement.hold = async () => {
      throw checkpointError;
    };
    f.service.stop();
    return reservation;
  };
  const bound = await f.bind(
    await f.service.prepare(owner, compositePlan(), guard),
  );
  await expect(
    f.service.run(owner, mutation(bound), guard),
  ).rejects.toMatchObject({
    message: "Cancelled admission could not be durably held.",
    cause: checkpointError,
    errors: [expect.any(Error), checkpointError],
  });
  expect(f.events).toEqual([]);
  await f.service.close();
});

it("retains render and checkpoint failures instead of publishing review evidence", async () => {
  const f = compositeFixture();
  const entered = deferred();
  const release = deferred();
  const renderError = new Error("render failed");
  const checkpointError = new Error("review hold failed");
  f.native.renderEvidence = async () => {
    entered.resolve();
    await release.promise;
    throw renderError;
  };
  const save = f.repository.save;
  f.repository.save = async (...args) => {
    if (args[0].status === "held") throw checkpointError;
    return save(...args);
  };
  const prepared = await f.service.prepare(owner, compositePlan(true), guard);
  await f.service.run(owner, mutation(prepared), guard);
  await entered.promise;
  const waiting = expect(
    f.service.waitForCompletion(owner, prepared.id, guard),
  ).rejects.toMatchObject({
    message: "Rendered evidence could not be durably checkpointed.",
    errors: [renderError, checkpointError],
    cause: checkpointError,
  });
  release.resolve();
  await waiting;
  expect(f.records.get(prepared.id)?.phases[0].evidence).toBeUndefined();
  await f.service.close();
});

it.each(["owner", "sourceFingerprint"] as const)(
  "holds review when rendered evidence has the wrong %s",
  async (field) => {
    const f = compositeFixture();
    const render = f.native.renderEvidence;
    const entered = deferred();
    const release = deferred();
    f.native.renderEvidence = async (...args) => {
      entered.resolve();
      await release.promise;
      const evidence = await render(...args);
      evidence[0][field] = field === "owner" ? "foreign-owner" : "0".repeat(64);
      return evidence;
    };
    const prepared = await f.service.prepare(owner, compositePlan(true), guard);
    await f.service.run(owner, mutation(prepared), guard);
    await entered.promise;
    const waiting = expect(
      f.service.waitForCompletion(owner, prepared.id, guard),
    ).rejects.toThrow(
      field === "owner"
        ? "exact parent review selection"
        : "refreshed source snapshot",
    );
    release.resolve();
    await waiting;
    const held = await f.service.get(owner, prepared.id, guard);
    expect(held.status).toBe("held");
    expect(held.phases[0].evidence).toBeUndefined();
    await f.service.close();
  },
);

it("refuses reconciliation before an exact native attempt has been admitted", async () => {
  const f = compositeFixture();
  const bound = await f.bind(
    await f.service.prepare(owner, compositePlan(), guard),
  );
  await expect(
    f.service.reconcile(owner, mutation(bound), guard),
  ).rejects.toThrow("No exact native attempt");
  expect((await f.service.get(owner, bound.id, guard)).used.admissions).toBe(0);
  expect(f.events).toEqual([]);
});
