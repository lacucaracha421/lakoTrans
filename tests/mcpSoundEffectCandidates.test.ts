import { expect, it } from "vitest";
import { mcpAppEnvironment } from "./mcpAppEnvironment.fixture";
import { detailedQualityFixture } from "./mcpDetailedQuality.fixture";
import { soundEffectFixture } from "./mcpSoundEffect.fixture";
import { readFile, writeFile } from "node:fs/promises";
import { generatedFixturePng } from "./mcpDetailedQuality.fixture";

it("persists a four-call cross-provider budget across reconnects and refuses unchanged retries", async () => {
  const env = await mcpAppEnvironment();
  const root = env.root;
  const { McpSoundEffectCandidates } =
    await import("../src/main/mcp/mcpSoundEffectCandidates");
  const f = detailedQualityFixture();
  try {
    const first = await new McpSoundEffectCandidates(root).reserve(
      "chapter",
      f.page,
      f.block,
      f.input.sourceSha256,
      1,
      "Exact phrase, textured strokes",
    );
    expect(first.candidate.attempt).toBe(2);
    const reopened = new McpSoundEffectCandidates(root);
    await expect(
      reopened.reserve(
        "chapter",
        f.page,
        f.block,
        f.input.sourceSha256,
        0,
        "Exact phrase, textured strokes",
      ),
    ).rejects.toThrow(/Revise/);
    expect(
      (
        await reopened.reserve(
          "chapter",
          f.page,
          f.block,
          f.input.sourceSha256,
          0,
          "Fix the vowel stroke",
        )
      ).candidate.attempt,
    ).toBe(3);
    expect(
      (
        await reopened.reserve(
          "chapter",
          f.page,
          f.block,
          f.input.sourceSha256,
          0,
          "Open the merged counters",
        )
      ).candidate.attempt,
    ).toBe(4);
    await expect(
      reopened.reserve(
        "chapter",
        f.page,
        f.block,
        f.input.sourceSha256,
        0,
        "One more",
      ),
    ).rejects.toThrow(/Four/);
    expect(await reopened.list("chapter", f.page.id)).toHaveLength(3);
  } finally {
    await env.close();
  }
});
it("retains a PNG before a reader failure, without applying it to the saved page", async () => {
  const f = await soundEffectFixture();
  try {
    const page = (await f.snapshot()).pages[0],
      block = page.blocks[0];
    f.readerTurn.mockRejectedValue(new Error("Reader disconnected"));
    await f.preview({
      kind: "generate",
      blockIds: [block.id],
      expectedProvider: "codex",
      expectedModel: f.settings.codex.imageModel,
      allowExternalProcessing: true,
      replaceExisting: false,
      allowRenderAdjustment: true,
      invertColors: false,
    });
    const { McpSoundEffectCandidates } =
      await import("../src/main/mcp/mcpSoundEffectCandidates");
    const stored = await new McpSoundEffectCandidates(
      f.app.appPaths.dataRoot,
    ).list("chapter", page.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("pending-repair");
    expect(stored[0]).not.toHaveProperty("block");
    const candidate = await new McpSoundEffectCandidates(
      f.app.appPaths.dataRoot,
    ).read(stored[0].id);
    expect(candidate.block?.generatedLettering?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
  } finally {
    await f.close();
  }
});

it("adopts only a current retained candidate and recovers exact saved blocks with Undo/Redo", async () => {
  const f = await soundEffectFixture();
  try {
    const { McpSoundEffectCandidates } =
      await import("../src/main/mcp/mcpSoundEffectCandidates");
    const page = (await f.snapshot()).pages[0],
      block = page.blocks[0],
      store = new McpSoundEffectCandidates(f.env.root);
    const candidate = (
      await store.reserve(
        "chapter",
        page,
        block,
        "a".repeat(64),
        0,
        "Native retained candidate",
      )
    ).candidate;
    await store.save({
      ...candidate,
      status: "pending-repair",
      block: {
        ...block,
        generatedLettering: {
          version: 1,
          dataUrl: generatedFixturePng(),
          sourceText: block.sourceText,
          translatedText: block.translatedText,
        },
      },
    });
    const plan = await f.preview({
      kind: "candidate",
      candidateId: candidate.id,
    });
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    expect((await f.action(plan.batchId, "apply")).result.status).toBe(
      "completed",
    );
    expect((await f.snapshot()).pages[0].blocks[1]).toEqual(page.blocks[1]);
    await expect(
      f.preview({ kind: "candidate", candidateId: candidate.id }),
    ).rejects.toThrow(/unchanged saved block/);
    await f.action(plan.batchId, "undo");
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    await f.action(plan.batchId, "redo");
    expect(
      (await f.snapshot()).pages[0].blocks[0].generatedLettering,
    ).toBeDefined();
    const disk = JSON.parse(await readFile(f.chapterPath, "utf8"));
    disk.pages[0].blocks = [];
    await writeFile(f.chapterPath, JSON.stringify(disk));
    await expect(
      f.preview({ kind: "candidate", candidateId: candidate.id }),
    ).rejects.toThrow();
  } finally {
    await f.close();
  }
});

it("adopts sibling candidates atomically without weakening page revision or one-candidate-per-block checks", async () => {
  const f = await soundEffectFixture();
  try {
    const { McpSoundEffectCandidates } =
      await import("../src/main/mcp/mcpSoundEffectCandidates");
    const disk = JSON.parse(await readFile(f.chapterPath, "utf8"));
    disk.pages[0].blocks.push({
      ...disk.pages[0].blocks[0],
      id: "second-sound",
    });
    await writeFile(f.chapterPath, JSON.stringify(disk));
    const page = (await f.snapshot()).pages[0];
    const store = new McpSoundEffectCandidates(f.env.root);
    const retain = async (index: number, instructions: string) => {
      const block = page.blocks[index];
      const { candidate } = await store.reserve(
        "chapter",
        page,
        block,
        "a".repeat(64),
        0,
        instructions,
      );
      const saved = {
        ...candidate,
        status: "pending-repair" as const,
        block: {
          ...block,
          generatedLettering: {
            version: 1 as const,
            dataUrl: generatedFixturePng(),
            sourceText: block.sourceText,
            translatedText: block.translatedText,
          },
        },
      };
      await store.save(saved);
      return saved;
    };
    const first = await retain(0, "First effect");
    const second = await retain(2, "Second effect");
    const duplicateBlock = await retain(0, "Alternative first effect");
    await expect(
      f.preview({ kind: "candidate", candidateIds: [] }),
    ).rejects.toThrow();
    await expect(
      f.preview({
        kind: "candidate",
        candidateId: first.id,
        candidateIds: [second.id],
      }),
    ).rejects.toThrow();
    await expect(
      f.preview({ kind: "candidate", candidateIds: [first.id, first.id] }),
    ).rejects.toThrow();
    await expect(
      f.preview({
        kind: "candidate",
        candidateIds: [first.id, duplicateBlock.id],
      }),
    ).rejects.toThrow(/one candidate per block/);
    await store.save({ ...second, baseRevision: "page-v1:0000000000000000" });
    await expect(
      f.preview({ kind: "candidate", candidateIds: [first.id, second.id] }),
    ).rejects.toThrow(/unchanged saved block/);
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    await store.save(second);
    const plan = await f.preview({
      kind: "candidate",
      candidateIds: [first.id, second.id],
    });
    await f.action(plan.batchId, "apply");
    const after = (await f.snapshot()).pages[0].blocks;
    expect(after[0].generatedLettering).toBeDefined();
    expect(after[2].generatedLettering).toBeDefined();
    expect(after[1]).toEqual(page.blocks[1]);
    await f.action(plan.batchId, "undo");
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    await f.action(plan.batchId, "redo");
    expect((await f.snapshot()).pages[0].blocks).toEqual(after);
  } finally {
    await f.close();
  }
});
