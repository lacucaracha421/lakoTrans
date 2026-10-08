import { expect, it, vi } from "vitest";
import { editingChapter } from "./mcpEditing.fixture";
import { createMcpToolSet } from "../src/main/mcp/mcpToolSet";
import { mcpToolResult } from "../src/main/mcp/mcpToolResult";
import { McpTranslationGuideOutputSchema } from "../src/shared/mcpTranslationGuide";
import { migrateWorkTypographyProfile } from "../src/shared/fontMatchingProfileCodec";
import type { WorkTypographyProfileV2 } from "../src/shared/fontMatchingProfileTypes";
import { compositeFingerprint } from "../src/main/application/mcpCompositeWorkflowPolicy";
import {
  inspectMcpTranslationCompletion,
  type McpTranslationCompletionReader,
} from "../src/main/application/mcpTranslationCompletion";
import { createTranslationGuideTool } from "../src/main/mcp/mcpTranslationGuideTool";
import {
  McpImageRouteInputSchema,
  selectMcpImageRoute,
} from "../src/shared/mcpTranslationQuality";

function fixture(profile?: WorkTypographyProfileV2) {
  const chapter = editingChapter();
  const openChapter = vi.fn(async () => structuredClone(chapter));
  const tools = createMcpToolSet({
    openChapter,
    listLibrary: async () => ({ works: [], workOrder: [] }),
    ...(profile ? { readTypography: async () => profile } : {}),
  });
  const guide = tools.find(
    (tool) => tool.name === "carrot_get_translation_guide",
  );
  if (!guide) throw new Error("Guide not registered");
  return { chapter, guide, openChapter };
}
it("returns owned whole-chapter pending pages without equating saved text or exports with completion", async () => {
  const chapter = editingChapter();
  const list = vi.fn(async () => []);
  const reader = vi.fn(
    (...args: Parameters<McpTranslationCompletionReader>) => {
      args[2](["carrot.read"]);
      return inspectMcpTranslationCompletion(...args, {
        list,
        verifySources: async () => {},
      });
    },
  );
  const guide = createTranslationGuideTool(
    {
      openChapter: async () => chapter,
      listLibrary: async () => ({ works: [], workOrder: [] }),
    },
    [],
    reader,
  );
  const context = {
    principalId: "reader",
    assertAuthorized: vi.fn(),
    assertScopes: vi.fn(),
  };
  const read = async (mode?: "quick") =>
    McpTranslationGuideOutputSchema.parse(
      mcpToolResult(
        guide,
        await guide.invoke(
          { chapterId: chapter.id, ...(mode ? { mode } : {}) },
          context,
        ),
      ).structuredContent,
    );
  expect(await read()).toMatchObject({
    chapterPageCount: chapter.pages.length,
    completion: {
      scope: "whole-chapter",
      status: "incomplete",
      acceptedPages: 0,
    },
    qualityVerified: false,
  });
  expect(reader).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledWith("reader");
  expect(context.assertScopes).toHaveBeenCalledWith(["carrot.read"]);
  expect((await read("quick")).completion).toBeUndefined();
  expect(reader).toHaveBeenCalledTimes(1);
  context.assertScopes.mockImplementation(() => {
    throw new Error("read scope revoked");
  });
  await expect(read()).rejects.toThrow("read scope revoked");
  expect(list).toHaveBeenCalledTimes(1);
});
it("returns the actual work palette with a revision that changes when the palette changes", async () => {
  const profile = migrateWorkTypographyProfile({
    schemaVersion: 1,
    workId: "work",
    dialogueAnchorFontId: "nanum-gothic",
    evidenceCount: 1,
    confidence: 0,
    catalogVersion: "fixture",
    modelVersion: "fixture",
    rendererHash: "a".repeat(64),
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  });
  const f = fixture(profile);
  const read = async () =>
    McpTranslationGuideOutputSchema.parse(
      mcpToolResult(f.guide, await f.guide.invoke({ chapterId: "chapter" }))
        .structuredContent,
    );
  const first = await read();
  expect(first.workTypography).toEqual({
    profile,
    revision: compositeFingerprint(profile),
  });
  profile.updatedAt = "2026-10-08T06:00:00.000Z";
  expect((await read()).workTypography?.revision).not.toBe(
    first.workTypography?.revision,
  );
});
it("registers a read-only complete translation guide and exposes no source paths or pixels", async () => {
  const f = fixture(),
    before = structuredClone(f.chapter);
  const content = await f.guide.invoke({ chapterId: "chapter" });
  const result = McpTranslationGuideOutputSchema.parse(
    mcpToolResult(f.guide, content).structuredContent,
  );
  expect(result).toMatchObject({
    qualityPolicy: "complete-translation-v2",
    maxReviewPasses: 3,
    modelStarted: false,
    qualityVerified: false,
    imageRoute: { route: "local" },
  });
  expect(result.pages[0]).toMatchObject({
    blocks: 2,
    requiresVisualSourceInspection: true,
    savedQuality: { soundEffects: 2 },
  });
  expect(result.steps.map((step) => step.id)).toEqual([
    "detailed-default",
    "context",
    "source",
    "plan",
    "text-and-sfx",
    "images",
    "typography",
    "generated-hangul-repair",
    "detailed-completion",
    "review",
  ]);
  expect(result.availableTools).toEqual([]);
  expect(result.missingTools).toContain("carrot_generate_sound_effects");
  expect(f.guide.readOnly).toBe(true);
  expect(JSON.stringify(content)).not.toMatch(/PRIVATE|\/private\//);
  expect(f.chapter).toEqual(before);
});
it("rejects absent/duplicate pages and excessive scope without silently truncating", async () => {
  const f = fixture();
  await expect(
    f.guide.invoke({ chapterId: "chapter", pageIds: ["missing"] }),
  ).rejects.toThrow();
  await expect(
    f.guide.invoke({ chapterId: "chapter", pageIds: ["page", "page"] }),
  ).rejects.toThrow();
  f.chapter.pages = Array.from({ length: 51 }, (_, index) => ({
    ...f.chapter.pages[0],
    id: String(index),
  }));
  await expect(f.guide.invoke({ chapterId: "chapter" })).rejects.toThrow(/50/);
  const result = await f.guide.invoke({ chapterId: "chapter", pageIds: ["1"] });
  expect(
    JSON.parse(result[0].type === "text" ? result[0].text : "{}").pages,
  ).toHaveLength(1);
});
it("keeps an explicitly requested quick run outside detailed certification", async () => {
  const f = fixture();
  const content = await f.guide.invoke({ chapterId: "chapter", mode: "quick" });
  const result = McpTranslationGuideOutputSchema.parse(
    mcpToolResult(f.guide, content).structuredContent,
  );
  expect(result.qualityPolicy).toBeNull();
  expect(result.requiredEvidence).toEqual([]);
  expect(result.steps.map((step) => step.id)).toContain("quick-review");
  expect(
    result.steps.some((step) =>
      step.tools.includes("carrot_submit_composite_review"),
    ),
  ).toBe(false);
});
it("rechecks authorization after reads and filters tools to this connection", async () => {
  const f = fixture();
  let revoked = false;
  f.openChapter.mockImplementation(async () => {
    revoked = true;
    return f.chapter;
  });
  await expect(
    f.guide.invoke(
      { chapterId: "chapter" },
      {
        assertAuthorized: () => {
          if (revoked) throw new Error("revoked");
        },
        visibleToolNames: [],
      },
    ),
  ).rejects.toThrow("revoked");
});
it.each([
  [{}, "check-host"],
  [{ hostGeneration: "available", hostFileTransfer: "available" }, "host"],
  [
    { hostGeneration: "available", hostFileTransfer: "unavailable" },
    "check-app",
  ],
  [
    {
      hostGeneration: "unavailable",
      hostFileTransfer: "unavailable",
      appGeneration: "available",
    },
    "app",
  ],
  [
    {
      hostGeneration: "unavailable",
      hostFileTransfer: "unavailable",
      appGeneration: "unavailable",
    },
    "local",
  ],
  [{ attemptsUsed: 4 }, "local"],
  [{ hostFailure: "delivery-failed", appGeneration: "available" }, "app"],
  [
    { hostFailure: "quality-rejected", appFailure: "generation-failed" },
    "local",
  ],
  [{ hostGeneration: "unavailable", hostFileTransfer: "unknown" }, "check-app"],
  [{ policyRefused: true, appGeneration: "available" }, "blocked"],
])(
  "selects an explicit image route without assuming host generation or transfer: %j",
  (input, route) => {
    expect(
      selectMcpImageRoute(McpImageRouteInputSchema.parse(input)).route,
    ).toBe(route);
  },
);

it("does not recommend a host file route when this connection lacks upload/apply tools", async () => {
  const f = fixture();
  const content = await f.guide.invoke(
    {
      chapterId: "chapter",
      imageCapabilities: {
        hostGeneration: "available",
        hostFileTransfer: "available",
        appGeneration: "available",
      },
    },
    {
      visibleToolNames: ["carrot_get_page_preview"],
      assertAuthorized: () => {},
    },
  );
  const result = McpTranslationGuideOutputSchema.parse(
    mcpToolResult(f.guide, content).structuredContent,
  );
  expect(result.availableTools).toEqual(["carrot_get_page_preview"]);
  expect(result.imageRoute.route).toBe("local");
});
