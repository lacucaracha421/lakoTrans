import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { McpCompositePrepareSchema } from "../src/shared/mcpCompositeWorkflow";
import { workFileFixture } from "./mcpWorkFileImport.fixture";
import { mutation } from "./mcpCompositeWorkflow.fixture";

it("admits a native work-file publication with remapped blocks and processed images", async () => {
  const f = await workFileFixture();
  const { createMcpCompositeNative } =
    await import("../src/main/mcp/mcpCompositeNativeAdapter");
  const { McpCompositeRepository } =
    await import("../src/main/mcp/mcpCompositeRepository");
  const { McpCompositeWorkflowService } =
    await import("../src/main/application/mcpCompositeWorkflowService");
  const { getAppSettings } = await import("../src/main/settingsStore");
  const session = f.current().session;
  const guard = () => {};
  const owner = "import-owner";
  const native = createMcpCompositeNative({
    tools: session.tools,
    operations: f.current().operations,
    batches: {},
    imageReviewMapping: session.reviewMapping,
    workFileReviewMapping: session.workFileReviewMapping,
    settings: () => getAppSettings(f.app.appPaths),
    preferences: f.preferences,
    readContext: f.library.readWorkContextForEdit,
    readFonts: async () => "a".repeat(64),
    readSoundEffectPlan: () => {
      throw new Error("No SFX preparation in this import");
    },
  });
  const service = new McpCompositeWorkflowService(
    new McpCompositeRepository(f.storage),
    native,
  );
  try {
    const { command } = await f.prepareWorkFile();
    const action = { kind: "work-file-import" as const, input: command };
    const targets = await native.importPreflight(
      owner,
      { phaseId: "import", action },
      guard,
    );
    const plan = McpCompositePrepareSchema.parse({
      requestId: randomUUID(),
      reason: "Verify editable native publication",
      targets,
      phases: [{ kind: "native", id: "import", action: action.kind }],
      budgets: { admissions: 1, pageAttempts: targets.maxPages, models: {} },
    });
    const prepared = await service.prepare(owner, plan, guard);
    const bound = await service.bind(
      owner,
      {
        ...mutation(prepared),
        phaseId: "import",
        action,
        expectedSnapshot: prepared.snapshot.fingerprint,
        predecessorReceipts: [],
      },
      guard,
    );
    await service.run(owner, mutation(bound), guard);
    const completed = await service.waitForCompletion(
      owner,
      prepared.id,
      guard,
    );
    expect(completed.status).toBe("completed");
    expect(completed.targets).toHaveLength(f.originalChapter.pages.length);
    const imported = await f.library.openChapter(
      completed.targets[0].chapterId,
    );
    expect(imported.pages[0].blocks).toHaveLength(
      f.originalChapter.pages[0].blocks.length,
    );
    expect(imported.pages[0].blocks.length).toBeGreaterThan(0);
    expect(imported.pages[0].blocks[0].id).not.toBe(
      f.originalChapter.pages[0].blocks[0].id,
    );
    expect(imported.pages[0].inpaintedImagePath).toBeTruthy();
    expect(completed.used.admissions).toBe(1);
  } finally {
    await service.close();
    await native.close();
    await f.close();
  }
});
