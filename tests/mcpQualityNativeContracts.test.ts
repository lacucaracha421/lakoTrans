import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { imageEditingFixture } from "./mcpImageEditing.fixture";
import { generatedFixturePng } from "./mcpDetailedQuality.fixture";
import type { McpTool } from "../src/main/mcp/mcpReadTools";

function requireTool(tools: McpTool[], name: string) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing native tool: ${name}`);
  return tool;
}

async function jsonResult(
  tool: McpTool,
  args: Record<string, unknown>,
  auth: Parameters<McpTool["invoke"]>[1],
) {
  const result = await tool.invoke(args, auth);
  const content = result.find((entry) => entry.type === "text");
  if (!content || content.type !== "text")
    throw new Error("Missing JSON tool output");
  return JSON.parse(content.text);
}

it("persists native quality receipts and validates identity, missing IDs and public output contracts", async () => {
  const f = await imageEditingFixture();
  try {
    const { saveMcpQualityEvidence, readMcpQualityEvidence } =
      await import("../src/main/mcp/mcpQualityEvidenceStore");
    const { createMcpSoundEffectCandidateTools } =
      await import("../src/main/mcp/mcpSoundEffectCandidateTools");
    const receipt = {
      id: randomUUID(),
      createdAt: 1,
      kind: "source-page" as const,
      chapterId: "chapter",
      pageId: "page",
      sourceSha256: "a".repeat(64),
      imageSha256: "b".repeat(64),
    };
    await saveMcpQualityEvidence(receipt);
    expect(await readMcpQualityEvidence(receipt.id)).toEqual(receipt);
    const tool = requireTool(
      createMcpSoundEffectCandidateTools(false),
      "carrot_get_quality_evidence",
    );
    expect(
      await jsonResult(tool, { evidenceId: receipt.id }, f.auth()),
    ).toEqual(receipt);
    await expect(readMcpQualityEvidence(randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(readMcpQualityEvidence("../outside")).rejects.toThrow();
    await writeFile(
      join(f.env.root, ".mcp-quality", `${receipt.id}.json`),
      JSON.stringify({ ...receipt, id: randomUUID() }),
    );
    await expect(readMcpQualityEvidence(receipt.id)).rejects.toThrow(
      /identity/,
    );
  } finally {
    await f.close();
  }
});

it("candidate commands preserve pages and PNGs, reject stale assets/pages and cap idempotent repairs at two", async () => {
  const f = await imageEditingFixture();
  try {
    const { McpSoundEffectCandidates } =
      await import("../src/main/mcp/mcpSoundEffectCandidates");
    const { createMcpSoundEffectCandidateTools } =
      await import("../src/main/mcp/mcpSoundEffectCandidateTools");
    const { compositeFingerprint } =
      await import("../src/main/application/mcpCompositeWorkflowPolicy");
    const { generatedAssetSha256 } =
      await import("../src/main/application/mcpGeneratedTouchup");
    const page = (await f.snapshot()).pages[0],
      block = structuredClone(page.blocks[0]);
    block.generatedLettering = {
      version: 1,
      dataUrl: generatedFixturePng(),
      sourceText: block.sourceText,
      translatedText: block.translatedText,
    };
    const store = new McpSoundEffectCandidates(f.env.root);
    const reserved = await store.reserve(
      "chapter",
      page,
      page.blocks[0],
      "a".repeat(64),
      0,
      "repair fixture",
    );
    const candidate = {
      ...reserved.candidate,
      block,
      status: "pending-repair" as const,
    };
    await store.save(candidate);
    const tools = createMcpSoundEffectCandidateTools(true);
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = requireTool(tools, name);
      const { mcpToolResult } = await import("../src/main/mcp/mcpToolResult");
      return mcpToolResult(tool, await tool.invoke(args, f.auth()));
    };
    expect(
      (
        await call("carrot_get_sound_effect_candidates", {
          chapterId: "chapter",
          pageId: page.id,
        })
      ).structuredContent,
    ).toMatchObject({
      total: 1,
      candidates: [{ id: candidate.id, touchupPasses: 0 }],
    });
    const edit = {
      blockId: block.id,
      assetSha256: generatedAssetSha256(block),
      outline: { width: 3, color: "#000000" },
    };
    const input = {
      candidateId: candidate.id,
      candidateRevision: compositeFingerprint(candidate),
      requestId: randomUUID(),
      edit,
    };
    await expect(
      call("carrot_touchup_sound_effect_candidate", {
        ...input,
        edit: { ...edit, assetSha256: "b".repeat(64) },
      }),
    ).rejects.toThrow();
    const first = await call("carrot_touchup_sound_effect_candidate", input);
    expect(first.structuredContent).toMatchObject({ touchupPasses: 1 });
    expect(await call("carrot_touchup_sound_effect_candidate", input)).toEqual(
      first,
    );
    await expect(
      call("carrot_touchup_sound_effect_candidate", {
        ...input,
        edit: { ...edit, outline: null },
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(
      call("carrot_touchup_sound_effect_candidate", {
        ...input,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await call("carrot_touchup_sound_effect_candidate", {
      ...input,
      requestId: randomUUID(),
      candidateRevision: compositeFingerprint(await store.read(candidate.id)),
    });
    await expect(
      call("carrot_touchup_sound_effect_candidate", {
        ...input,
        requestId: randomUUID(),
        candidateRevision: compositeFingerprint(await store.read(candidate.id)),
      }),
    ).rejects.toThrow(/Two direct repair/);
    expect(
      (await store.read(candidate.id)).block?.generatedLettering?.dataUrl,
    ).toBe(block.generatedLettering.dataUrl);
    expect((await f.snapshot()).pages[0].blocks).toEqual(page.blocks);
    const other = { ...candidate, id: randomUUID() };
    await store.save(other);
    const disk = JSON.parse(await readFile(f.chapterPath, "utf8"));
    disk.pages[0].blocks[0].translatedText = "User changed text";
    await writeFile(f.chapterPath, JSON.stringify(disk));
    await expect(
      call("carrot_touchup_sound_effect_candidate", {
        ...input,
        candidateId: other.id,
        candidateRevision: compositeFingerprint(other),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  } finally {
    await f.close();
  }
});

it("work palette previews enforce owner and profile CAS while repeated application stays idempotent", async () => {
  const f = await imageEditingFixture();
  try {
    const { createMcpWorkTypographyTools } =
      await import("../src/main/mcp/mcpWorkTypographyTools");
    const { saveMcpQualityEvidence } =
      await import("../src/main/mcp/mcpQualityEvidenceStore");
    const { readMcpCompositeFontEnvironment } =
      await import("../src/main/mcp/mcpCompositeNativeFonts");
    const fontFingerprint = await readMcpCompositeFontEnvironment(() => {});
    const specimenId = randomUUID();
    await saveMcpQualityEvidence({
      id: specimenId,
      createdAt: 1,
      kind: "font-specimen",
      fontFingerprint,
      catalogSnapshot: "test",
      text: "글꼴 비교",
      samples: ["nanum-gothic", "nanum-myeongjo"].map((fontId) => ({
        fontId,
        label: fontId,
        imageSha256: "a".repeat(64),
      })),
    });
    const tools = createMcpWorkTypographyTools(true);
    const invoke = async (
      name: string,
      args: Record<string, unknown>,
      owner?: string,
    ) => {
      return jsonResult(requireTool(tools, name), args, f.auth(owner));
    };
    const initial = await invoke("carrot_get_work_typography", {
      workId: "work",
    });
    expect(initial.revision).toBeNull();
    const input = {
      workId: "work",
      revision: null,
      selections: [
        {
          role: "dialogue",
          fontId: "nanum-gothic",
          candidateFontIds: ["nanum-gothic", "nanum-myeongjo"],
          specimenId,
          reason: "Fixture compares candidate receipts",
        },
      ],
    };
    const first = await invoke("carrot_preview_work_typography", input);
    const stale = await invoke("carrot_preview_work_typography", {
      ...input,
      selections: [{ ...input.selections[0], fontId: "nanum-myeongjo" }],
    });
    await expect(
      invoke(
        "carrot_apply_work_typography",
        { planId: first.planId },
        "foreign",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const applied = await invoke("carrot_apply_work_typography", {
      planId: first.planId,
    });
    expect(
      await invoke("carrot_apply_work_typography", { planId: first.planId }),
    ).toEqual(applied);
    await expect(
      invoke("carrot_apply_work_typography", { planId: stale.planId }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(
      (await invoke("carrot_get_work_typography", { workId: "work" })).revision,
    ).toBe(applied.revision);
  } finally {
    await f.close();
  }
});
