import { expect, it } from "vitest";
import { editingFixture } from "./mcpEditing.fixture";
import { createPageRevision } from "../src/shared/pageRevision";
import { McpBlockPatchSchema } from "../src/shared/mcpBlockEditing";
import { formatBatchFixture } from "./mcpFormatBatch.fixture";
import { detailedQualityFixture } from "./mcpDetailedQuality.fixture";
import { assertDetailedTranslationPage } from "../src/main/application/mcpDetailedTranslationQuality";
import {
  McpTranslationQualityAssessmentSchema,
  translationQualityPassed,
} from "../src/shared/mcpTranslationQuality";
import type { TranslationBlock } from "../src/shared/textTypes";

function detected(block: TranslationBlock) {
  block.renderBbox = { x: 100, y: 100, w: 200, h: 200 };
  block.renderBboxSpace = "normalized_1000";
  block.bubbleLayout = {
    version: 1,
    origin: "detected",
    direction: "horizontal",
    confidence: 0.99,
    modelId: "koharu-layout-rfdetr-test",
    sourceImageRevision: "source",
    insetRatio: 0.05,
    regions: [
      { spans: [{ blockStart: 0, blockEnd: 1, inlineStart: 0, inlineEnd: 1 }] },
    ],
  };
}
it("rejects accidental detected contour rescaling atomically but preserves style edits and explicit geometry overrides", async () => {
  const f = editingFixture(),
    page = f.chapter.pages[0],
    block = page.blocks[0];
  detected(block);
  const before = structuredClone(page);
  const input = McpBlockPatchSchema.parse({
    chapterId: f.chapter.id,
    pageId: page.id,
    revision: createPageRevision(page),
    edits: [
      {
        blockId: block.id,
        fields: { fontSizePx: 32 },
        renderRect: { x: 500, y: 500, w: 300, h: 300 },
      },
    ],
  });
  await expect(f.service.updateBlocks(input)).rejects.toThrow(
    /detected balloon geometry/,
  );
  expect(page).toEqual(before);
  expect(f.savePageBlocks).not.toHaveBeenCalled();
  const style = await f.service.updateBlocks({
    ...input,
    edits: [{ blockId: block.id, fields: { autoFitText: true } }],
  });
  expect(f.chapter.pages[0].blocks[0].bubbleLayout).toEqual(
    before.blocks[0].bubbleLayout,
  );
  expect(f.chapter.pages[0].blocks[0].renderBbox).toEqual(
    before.blocks[0].renderBbox,
  );
  const override = await f.service.updateBlocks({
    ...input,
    revision: style.revision,
    edits: [{ ...input.edits[0], allowDetectedLayoutOverride: true }],
  });
  expect(override.changedBlockIds).toEqual([block.id]);
});
it("does not drift detected geometry when integer coordinates merely round-trip fractional pixels", async () => {
  const f = editingFixture(),
    p = f.chapter.pages[0],
    b = p.blocks[0];
  detected(b);
  b.renderBbox = { x: 100.3, y: 100.2, w: 200.2, h: 200.2 };
  const original = structuredClone(b.renderBbox);
  await f.service.updateBlocks({
    chapterId: f.chapter.id,
    pageId: p.id,
    revision: createPageRevision(p),
    edits: [
      {
        blockId: b.id,
        renderRect: {
          x: Math.round((original.x * p.width) / 1000),
          y: Math.round((original.y * p.height) / 1000),
          w: Math.round((original.w * p.width) / 1000),
          h: Math.round((original.h * p.height) / 1000),
        },
      },
    ],
  });
  expect(f.chapter.pages[0].blocks[0].renderBbox).toEqual(original);
});
it("applies the same geometry guard to format batch preparation before any write", async () => {
  const f = formatBatchFixture();
  detected(f.chapter.pages[0].blocks[0]);
  const input = f.request();
  input.pages[0].edits[0].renderRect = { x: 500, y: 500, w: 300, h: 300 };
  await expect(f.service.preview(f.owner, input, f.guard)).rejects.toThrow(
    /detected balloon geometry/,
  );
});
it("protects detected legacy blocks whose frame falls back to the source pixel box", async () => {
  const f = editingFixture(),
    page = f.chapter.pages[0],
    block = page.blocks[0];
  detected(block);
  delete block.renderBbox;
  delete block.renderBboxSpace;
  block.bbox = { x: 100, y: 200, w: 200, h: 320 };
  block.bboxSpace = "pixels";
  const input = {
    chapterId: f.chapter.id,
    pageId: page.id,
    revision: createPageRevision(page),
    edits: [{ blockId: block.id, renderRect: { ...block.bbox } }],
  };
  const result = await f.service.updateBlocks(input);
  expect(result.changedBlockIds).toEqual([]);
  expect(f.savePageBlocks).not.toHaveBeenCalled();
  await expect(
    f.service.updateBlocks({
      ...input,
      edits: [{ blockId: block.id, renderRect: { ...block.bbox, w: 300 } }],
    }),
  ).rejects.toThrow(/detected balloon geometry/);
});
it("preserves explicitly excluded SFX without counting them as translated and retains the default translation requirement", async () => {
  const f = detailedQualityFixture();
  f.detail.inventory.push({
    itemId: "sfx-original",
    sourceRect: { x: 400, y: 500, w: 100, h: 100 },
    role: "sound",
    outcome: "intentional-original",
    restoration: "not-needed",
    reason:
      "SFX excluded by the requested translation scope; original retained",
  });
  f.quality.soundEffectsFound = 1;
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /SFX cannot/,
  );
  f.quality.soundEffectScope = "preserve-original";
  f.quality.soundEffectsPreserved = 1;
  await expect(assertDetailedTranslationPage(f.input)).resolves.toBeUndefined();
  expect(
    translationQualityPassed(
      McpTranslationQualityAssessmentSchema.parse(f.quality),
    ),
  ).toBe(true);
  f.quality.soundEffectsPreserved = 0;
  await expect(assertDetailedTranslationPage(f.input)).rejects.toThrow(
    /Preserved SFX/,
  );
  f.quality.soundEffectsPreserved = 1;
  f.quality.soundEffectsCompleted = 1;
  expect(
    McpTranslationQualityAssessmentSchema.safeParse(f.quality).success,
  ).toBe(false);
});
