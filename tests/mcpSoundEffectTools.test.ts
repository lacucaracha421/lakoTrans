import { readFile, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { generatedFixturePng } from "./mcpDetailedQuality.fixture";
import { createHash } from "node:crypto";
import { createPageRevision } from "../src/shared/pageRevision";
import { compositeFingerprint } from "../src/main/application/mcpCompositeWorkflowPolicy";
import { soundEffectToolsFixture } from "./mcpSoundEffectTools.fixture";
import {
  persistedMcpJobResult,
  publicMcpJobResult,
} from "../src/main/application/mcpJobJournal";

it.each([true, false])(
  "public verification returns independent composed-pixel receipts and saves no page (passed=%s)",
  async (passed) => {
    const rendered = generatedFixturePng();
    const renderLettering = vi.fn(async () => rendered);
    const f = await soundEffectToolsFixture({ renderLettering });
    try {
      const disk = JSON.parse(await readFile(f.chapterPath, "utf8"));
      const block = disk.pages[0].blocks[0];
      block.generatedLettering = {
        version: 1,
        dataUrl: rendered,
        sourceText: block.sourceText,
        translatedText: block.translatedText,
        outline: { width: 2, color: "#ffffff" },
      };
      block.textRole = "ordinary";
      await writeFile(f.chapterPath, JSON.stringify(disk));
      const before = await readFile(f.chapterPath);
      f.readerTurn.mockResolvedValueOnce({
        itemId: "read",
        threadId: "read",
        turnId: "read",
        text: JSON.stringify({
          regions: [
            { regionId: block.id, text: passed ? block.translatedText : "쿠□" },
          ],
        }),
      });
      const plan = await f.preparePlan({
        kind: "verify",
        blockIds: [block.id],
        expectedModel: f.settings.codex.imageModel,
        allowExternalProcessing: true,
      });
      expect(plan.glyphEvidenceIds).toHaveLength(1);
      const { readMcpQualityEvidence } =
        await import("../src/main/mcp/mcpQualityEvidenceStore");
      const id = plan.glyphEvidenceIds?.[0];
      if (!id) throw Error("Missing glyph receipt");
      const receipt = await readMcpQualityEvidence(id);
      expect(receipt).toMatchObject({
        kind: "generated-glyphs",
        passed,
        expectedText: block.translatedText,
        revision: createPageRevision((await f.snapshot()).pages[0]),
        compositionFingerprint: compositeFingerprint(block),
      });
      expect(renderLettering).toHaveBeenCalledOnce();
      const request = f.readerTurn.mock.calls[0][0];
      expect(JSON.stringify(request)).not.toContain(block.translatedText);
      expect(request.input.some((item) => item.type === "image")).toBe(true);
      expect(receipt).toHaveProperty(
        "imageSha256",
        createHash("sha256")
          .update(Buffer.from(rendered.split(",")[1], "base64"))
          .digest("hex"),
      );
      expect(f.turn).not.toHaveBeenCalled();
      expect(await readFile(f.chapterPath)).toEqual(before);
    } finally {
      await f.close();
    }
  },
);

it("connects preparation, bounded inspection, native application and exact recovery through registered tools", async () => {
  const f = await soundEffectToolsFixture();
  try {
    const before = await readFile(f.chapterPath),
      page = (await f.snapshot()).pages[0];
    expect(f.soundSession.tools).toHaveLength(11);
    expect(
      f.soundSession.tools.some(
        (tool) => tool.name === "carrot_get_image_budget",
      ),
    ).toBe(true);
    const plan = await f.preparePlan({
      kind: "text",
      edits: [{ blockId: page.blocks[0].id, translatedText: "BANG!" }],
    });
    expect(plan.job.result).toMatchObject({
      pagesChanged: 0,
      performed: ["sound_effect_preparation"],
    });
    expect(await readFile(f.chapterPath)).toEqual(before);
    expect((await f.inspectPlan(plan.batchId)).canApply).toBe(true);
    expect((await f.toolAction(plan.batchId, "apply")).result.status).toBe(
      "completed",
    );
    expect((await f.snapshot()).pages[0].blocks[0].translatedText).toBe(
      "BANG!",
    );
    expect((await f.toolAction(plan.batchId, "undo")).result.status).toBe(
      "completed",
    );
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    expect((await f.toolAction(plan.batchId, "redo")).result.status).toBe(
      "completed",
    );
    await expect(
      f.invoke(
        "carrot_get_sound_effect_batch",
        { batchId: plan.batchId },
        f.auth("other"),
      ),
    ).rejects.toThrow();
    expect(f.startClient).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
it("returns generation as an owned job and explicit image only, without another call on retry or recovery", async () => {
  const f = await soundEffectToolsFixture();
  try {
    const page = (await f.snapshot()).pages[0];
    const plan = await f.preparePlan({
      kind: "generate",
      blockIds: [page.blocks[0].id],
      expectedProvider: "codex",
      expectedModel: f.settings.codex.imageModel,
      allowExternalProcessing: true,
      replaceExisting: false,
      allowRenderAdjustment: true,
      invertColors: false,
    });
    expect(plan.generationCalls).toBe(1);
    expect(plan.job.result).toMatchObject({
      pagesChanged: 0,
      performed: ["sound_effect_generation"],
    });
    expect(JSON.stringify(plan.job)).not.toMatch(
      /dataUrl|data:image|imagePath/,
    );
    const repeated = await f.invoke(
      "carrot_generate_sound_effects",
      plan.input,
    );
    expect(repeated.structuredContent).toMatchObject({ jobId: plan.job.jobId });
    expect(f.turn).toHaveBeenCalledTimes(1);
    const image = await f.invoke("carrot_get_sound_effect_image", {
      batchId: plan.batchId,
      blockId: page.blocks[0].id,
    });
    expect(image.content.some((part) => part.type === "image")).toBe(true);
    expect(image.structuredContent).toMatchObject({
      kind: "sound-effect-asset",
    });
    expect((await f.toolAction(plan.batchId, "apply")).result.status).toBe(
      "completed",
    );
    expect((await f.toolAction(plan.batchId, "undo")).result.status).toBe(
      "completed",
    );
    expect((await f.toolAction(plan.batchId, "redo")).result.status).toBe(
      "completed",
    );
    expect(f.turn).toHaveBeenCalledTimes(1);
    const persisted = persistedMcpJobResult(plan.job.result);
    expect(persisted?.proposalExpired).toBe(true);
    expect(persisted).not.toHaveProperty("soundEffectPlan");
    expect(publicMcpJobResult(plan.job.result, plan.expiresAt)).toMatchObject({
      proposalExpired: true,
    });
    const redaction = await import("../src/main/imageRedactionStore");
    await redaction.setImageRedactionEnabled(true, f.env.root);
    await expect(
      f.invoke("carrot_get_sound_effect_image", {
        batchId: plan.batchId,
        blockId: page.blocks[0].id,
      }),
    ).rejects.toThrow("redaction");
  } finally {
    await f.close();
  }
});
it("disables/removes image layers without deleting their text and detects stale images after text edits", async () => {
  const f = await soundEffectToolsFixture();
  try {
    const page = (await f.snapshot()).pages[0];
    const generated = await f.preparePlan({
      kind: "generate",
      blockIds: [page.blocks[0].id],
      expectedProvider: "codex",
      expectedModel: f.settings.codex.imageModel,
      allowExternalProcessing: true,
      replaceExisting: false,
      allowRenderAdjustment: true,
      invertColors: false,
    });
    await f.toolAction(generated.batchId, "apply");
    const withImage = (await f.snapshot()).pages[0];
    for (const state of ["disable", "remove"] as const) {
      const edit = await f.preparePlan({
        kind: "image-state",
        blockIds: [page.blocks[0].id],
        state,
      });
      expect((await f.toolAction(edit.batchId, "apply")).result.status).toBe(
        "completed",
      );
      const after = (await f.snapshot()).pages[0].blocks[0];
      expect(after.translatedText).toBe(page.blocks[0].translatedText);
      expect(
        state === "remove"
          ? after.generatedLettering
          : after.generatedLettering?.enabled,
      ).toBe(state === "remove" ? undefined : false);
      expect((await f.toolAction(edit.batchId, "undo")).result.status).toBe(
        "completed",
      );
      expect((await f.snapshot()).pages[0].blocks).toEqual(withImage.blocks);
    }
    const text = await f.preparePlan({
      kind: "text",
      edits: [
        { blockId: page.blocks[0].id, translatedText: "different sound" },
      ],
    });
    await f.toolAction(text.batchId, "apply");
    const item = (await f.query()).items.find(
      (item) => item.blockId === page.blocks[0].id,
    );
    expect(item?.imageState).toBe("stale");
    await expect(
      f.preparePlan({
        kind: "image-state",
        blockIds: [page.blocks[0].id],
        state: "enable",
      }),
    ).rejects.toThrow("stale");
    expect(f.turn).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
it("preserves acknowledged saves after notification failure and refuses later user edits during undo", async () => {
  const f = await soundEffectToolsFixture();
  try {
    const page = (await f.snapshot()).pages[0];
    const plan = await f.preparePlan({
      kind: "text",
      edits: [{ blockId: page.blocks[0].id, translatedText: "BANG" }],
    });
    f.editing.notifySaved.mockImplementationOnce(() => {
      throw new Error("synthetic UI failure");
    });
    const result = (await f.toolAction(plan.batchId, "apply")).result;
    expect(result.status).toBe("partial");
    expect(result.canUndo).toBe(true);
    expect((await f.snapshot()).pages[0].blocks[0].translatedText).toBe("BANG");
    const raw = JSON.parse(await readFile(f.chapterPath, "utf8"));
    raw.pages[0].blocks[0].translatedText = "later user edit";
    await writeFile(f.chapterPath, JSON.stringify(raw));
    expect((await f.toolAction(plan.batchId, "undo")).result.status).toBe(
      "failed",
    );
    expect((await f.snapshot()).pages[0].blocks[0].translatedText).toBe(
      "later user edit",
    );
  } finally {
    await f.close();
  }
});
