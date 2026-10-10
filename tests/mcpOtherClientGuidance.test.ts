import { expect, it } from "vitest";
import { editingChapter } from "./mcpEditing.fixture";
import { createTranslationGuideTool } from "../src/main/mcp/mcpTranslationGuideTool";
import { mcpToolResult } from "../src/main/mcp/mcpToolResult";
import { McpTranslationGuideOutputSchema } from "../src/shared/mcpTranslationGuide";
import { otherClientLayoutWarnings } from "../src/main/mcp/mcpOtherClientGuidance";
import type { PageExportLayoutEvidence } from "../src/shared/pageExportContracts";

const observed = (
  displayText?: string,
  lines: string[] | null = [],
): PageExportLayoutEvidence => [
  {
    blockId: "bubble",
    rendered: "text",
    direction: "horizontal",
    displayText,
    lines,
    fontSizePx: 44,
    innerWidth: 198,
    innerHeight: 276,
    overflow: false,
  },
];

it("reports Korean words actually split by rendering even when overflow is false", () => {
  const layout = observed("그리고 반역자들의 동조자를 색출해", [
    "그리고 반",
    "역자들의 ",
    "동조자를 ",
    "색출해",
  ]);
  const before = structuredClone(layout);
  const warnings = otherClientLayoutWarnings("OpenCode", layout);
  expect(warnings).toHaveLength(1);
  expect(warnings[0].reasons[0]).toContain('"반역자들의"');
  expect(warnings[0].reasons[0]).not.toContain('"동조자를"');
  expect(layout).toEqual(before);
  for (const client of [
    undefined,
    "ChatGPT",
    "Codex",
    "codex_cli_rs",
    "OpenAI",
    "Claude Code",
  ])
    expect(otherClientLayoutWarnings(client, layout)).toEqual([]);
});

it("does not invent word-split findings for phrase breaks, excluded render modes or unaligned text", () => {
  for (const layout of [
    undefined,
    observed(),
    observed("문장", null),
    observed("문장", ["문장"]),
    observed("그들에게도 걸맞은 처벌을", ["그들에게도", "걸맞은", "처벌을"]),
    observed("그들에게도\n걸맞은 처벌을", ["그들에게도", "", "걸맞은 처벌을"]),
    observed("그들에게도 처벌을", ["그들에게도"]),
    observed("그들에게도 처벌을", ["다른 문장", "처벌을"]),
    observed("<b>반역자들의</b>", ["반", "역자들의"]),
    observed("그들에게도 처벌을 남김", ["그들에게도", "처벌을"]),
    observed("日本語の文章", ["日本語", "の文章"]),
    observed("가".repeat(81), ["가".repeat(40), "가".repeat(41)]),
    [
      {
        ...observed("반역자들의", ["반", "역자들의"])[0],
        rendered: "generated" as const,
      },
    ],
    [
      {
        ...observed("반역자들의", ["반", "역자들의"])[0],
        direction: "vertical" as const,
      },
    ],
  ])
    expect(otherClientLayoutWarnings("OpenCode", layout)).toEqual([]);
});

it("separates Claude and other-client coaching while preserving shared tools, scope and quick mode", async () => {
  const chapter = editingChapter();
  const tool = createTranslationGuideTool(
    {
      openChapter: async () => chapter,
      listLibrary: async () => ({ works: [], workOrder: [] }),
    },
    ["carrot_get_page_crop", "carrot_prepare_composite"],
  );
  const read = async (
    clientName?: string,
    mode?: "quick",
    soundEffectScope?: "translate" | "preserve-original",
  ) =>
    McpTranslationGuideOutputSchema.parse(
      mcpToolResult(
        tool,
        await tool.invoke(
          {
            chapterId: chapter.id,
            ...(mode ? { mode } : {}),
            ...(soundEffectScope ? { soundEffectScope } : {}),
          },
          { assertAuthorized: () => {}, clientName },
        ),
      ).structuredContent,
    );
  const baseline = await read();
  const quick = await read(undefined, "quick");
  const preserveOriginal = await read(
    undefined,
    undefined,
    "preserve-original",
  );
  for (const name of [
    undefined,
    "",
    "  ",
    "ChatGPT",
    "Codex",
    "Codex Desktop",
    "codex_cli_rs",
    "OpenAI",
    "  CODEX  ",
  ]) {
    expect(await read(name)).toEqual(baseline);
    expect(await read(name, "quick")).toEqual(quick);
    expect(await read(name, undefined, "preserve-original")).toEqual(
      preserveOriginal,
    );
  }
  await assertClaudeGuidance(read);
  for (const name of [
    "OpenCode",
    "OpenCode Go",
    "DeepSeek",
    "MCP client",
    "Another HTTP app",
  ]) {
    const { clientGuidance, ...rest } = await read(name);
    expect(clientGuidance).toMatchObject({
      profile: "other",
      instruction: expect.any(String),
    });
    expect(rest.soundEffectScope).toBe("preserve-original");
    expect(rest.qualityPolicy).toBe(baseline.qualityPolicy);
    expect(rest.availableTools).toEqual(baseline.availableTools);
    const explicit = await read(name, undefined, "translate");
    const { clientGuidance: ignored, ...explicitRest } = explicit;
    expect(ignored?.profile).toBe("other");
    expect({ ...explicitRest, steps: baseline.steps }).toEqual(baseline);
    expect(
      explicitRest.steps.filter(
        (step) => step.id !== "physical-lettering-regions",
      ),
    ).toEqual(
      baseline.steps.filter((step) => step.id !== "physical-lettering-regions"),
    );
    const layout = explicitRest.steps.find(
      (step) => step.id === "physical-lettering-regions",
    );
    expect(layout?.tools).toContain("carrot_prepare_lettering_batch");
    expect(layout?.tools).toContain("carrot_apply_lettering_batch");
    expect(layout?.tools).toContain("carrot_get_page_blocks");
    expect(layout?.instruction).toContain("OMIT renderRect");
    expect(layout?.instruction).toContain("User instructions override");
    expect(layout?.instruction).toContain(
      "First save non-empty translatedText",
    );
    expect(layout?.instruction).toContain("allowAssetDownloads:true");
    expect(layout?.instruction).toContain("different horizontal centers");
    expect(clientGuidance?.instruction).toContain(
      "excessive unused balloon space",
    );
    expect(clientGuidance?.instruction).toContain(
      "re-render only changed pages",
    );
    const fast = await read(name, "quick");
    expect(fast.soundEffectScope).toBe("preserve-original");
    expect(fast.qualityPolicy).toBe(quick.qualityPolicy);
  }
  expect(baseline.qualityPolicy).toBe("complete-translation-v2");
  expect(tool.requiredScopes).toEqual(["carrot.read"]);
  expect(tool.readOnly).toBe(true);
});

async function assertClaudeGuidance(
  read: (
    clientName?: string,
    mode?: "quick",
    soundEffectScope?: "translate" | "preserve-original",
  ) => Promise<ReturnType<typeof McpTranslationGuideOutputSchema.parse>>,
) {
  for (const name of [
    "Claude Code",
    "Anthropic Claude",
    "claude-ai",
    "  CLAUDE  ",
  ]) {
    for (const mode of [undefined, "quick"] as const) {
      for (const soundEffectScope of [
        undefined,
        "translate",
        "preserve-original",
      ] as const) {
        const expected = await read(undefined, mode, soundEffectScope);
        const actual = await read(name, mode, soundEffectScope);
        const { clientGuidance, steps, ...rest } = actual;
        expect({ ...rest, steps: expected.steps }).toEqual(expected);
        expect(clientGuidance?.profile).toBe("claude");
        expect(clientGuidance?.instruction).toContain("includeLayout=true");
        expect(clientGuidance?.instruction).toContain("saved-but-unreviewed");
        expect(clientGuidance?.instruction).toContain("never covers page 4");
        expect(clientGuidance?.instruction).toContain(
          "Explicit user choices take precedence",
        );
        expect(
          steps.filter((step) => step.id !== "physical-lettering-regions"),
        ).toEqual(
          expected.steps.filter(
            (step) => step.id !== "physical-lettering-regions",
          ),
        );
        if (mode === "quick") {
          expect(steps).toEqual(expected.steps);
          continue;
        }
        const layout = steps.find(
          (step) => step.id === "physical-lettering-regions",
        );
        expect(layout?.tools).toEqual(
          expect.arrayContaining([
            "carrot_get_page_blocks",
            "carrot_prepare_lettering_batch",
            "carrot_get_lettering_batch",
            "carrot_apply_lettering_batch",
          ]),
        );
        expect(layout?.instruction).toContain("OMIT renderRect");
        expect(layout?.instruction).toContain("mode:geometry");
        expect(layout?.instruction).toContain("BEFORE geometry preparation");
        expect(layout?.instruction).toContain("allowAssetDownloads:true");
        expect(layout?.instruction).not.toContain("Before writing Korean");
        expect(layout?.instruction).toContain("different horizontal centers");
        expect(layout?.instruction).toContain("manual alternative");
        expect(layout?.instruction).toContain(
          "allowDetectedLayoutOverride=true",
        );
      }
    }
  }
}
