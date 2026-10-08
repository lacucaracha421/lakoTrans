import { createWarpPreset } from "../src/shared/warpTransformMath";
import { expect, it } from "vitest";
import { editingChapter } from "./mcpEditing.fixture";
import { generatedFixturePng } from "./mcpDetailedQuality.fixture";
import { letteringFixture } from "./mcpLettering.fixture";
import { McpGeneratedTouchupSchema } from "../src/shared/mcpGeneratedTouchup";
import {
  applyGeneratedTouchup,
  assertGeneratedTouchupOnly,
  generatedAssetSha256,
} from "../src/main/application/mcpGeneratedTouchup";
import { createPerspectivePreset } from "../src/shared/blockTransformPresets";
import { pagePointToLettering } from "../src/shared/generatedLetteringMask";

function fixture() {
  const page = editingChapter().pages[0],
    block = page.blocks[0];
  block.textRole = "ordinary";
  block.bbox = { x: 100, y: 100, w: 400, h: 400 };
  block.renderBbox = block.bbox;
  block.bboxSpace = block.renderBboxSpace = "normalized_1000";
  block.generatedLettering = {
    version: 1,
    dataUrl: generatedFixturePng(),
    sourceText: block.sourceText,
    translatedText: block.translatedText,
  };
  const command = McpGeneratedTouchupSchema.parse({
    kind: "generated-touchup",
    edits: [
      {
        blockId: block.id,
        assetSha256: generatedAssetSha256(block),
        strokes: [
          {
            space: "page",
            mode: "paint",
            color: "#123456",
            shape: "circle",
            softness: 0.2,
            radiusX: 10,
            radiusY: 10,
            points: [{ x: 300, y: 300 }],
          },
        ],
        outline: { width: 2, color: "#ffffff" },
      },
    ],
  });
  return { page, block, command, edit: command.edits[0] };
}
it("repairs existing generated dialogue without relabeling it or replacing original bytes", () => {
  const f = fixture(),
    before = structuredClone(f.block);
  const after = applyGeneratedTouchup(f.page, f.block, f.edit);
  expect(f.block).toEqual(before);
  expect(after.textRole).toBe("ordinary");
  expect(after.generatedLettering?.dataUrl).toBe(
    before.generatedLettering?.dataUrl,
  );
  expect(after.generatedLettering?.paintStrokes?.[0]).toMatchObject({
    color: "#123456",
    radiusX: 25,
    radiusY: 25,
    points: [{ x: 500, y: 500 }],
  });
  expect(after.generatedLettering?.maskStrokes?.[0]).toMatchObject({
    space: "asset",
    mode: "restore",
    points: [{ x: 500, y: 500 }],
  });
  expect(() => assertGeneratedTouchupOnly(before, after)).not.toThrow();
  expect(() =>
    assertGeneratedTouchupOnly(before, {
      ...after,
      translatedText: "different",
    }),
  ).toThrow();
  expect(() =>
    applyGeneratedTouchup(f.page, after, {
      ...f.edit,
      assetSha256: "a".repeat(64),
    }),
  ).toThrow(/changed/);
});
it("cuts a named polygon using native move commands before new strokes and protects original bytes", () => {
  const f = fixture();
  f.edit.moves = [
    {
      space: "asset",
      polygon: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ],
      from: { x: 200, y: 200 },
      to: { x: 270, y: 250 },
    },
  ];
  const after = applyGeneratedTouchup(f.page, f.block, f.edit);
  expect(after.generatedLettering?.partMoves?.[0]).toMatchObject({
    offset: { x: 70, y: 50 },
    paintCount: 0,
    maskCount: 0,
  });
  expect(after.generatedLettering?.paintStrokes).toHaveLength(1);
  expect(after.generatedLettering?.dataUrl).toBe(
    f.block.generatedLettering?.dataUrl,
  );
  expect(() => assertGeneratedTouchupOnly(f.block, after)).not.toThrow();
  f.edit.moves[0].to.x = 950;
  expect(() => applyGeneratedTouchup(f.page, f.block, f.edit)).toThrow(/clip/);
});
it("shares native inverse coordinates for rotated, perspective and warped lettering; page masks retain page space", () => {
  const f = fixture();
  f.block.rotationDeg = 25;
  f.block.perspectiveTransform = createPerspectivePreset("topNarrow");
  f.block.warpTransform = createWarpPreset("archUp");
  f.edit.strokes[0].points = [{ x: 330, y: 280 }];
  f.edit.strokes.push({ ...f.edit.strokes[0], mode: "hide" });
  const after = applyGeneratedTouchup(f.page, f.block, f.edit);
  expect(after.generatedLettering?.paintStrokes?.[0].points).toEqual([
    pagePointToLettering({ x: 330, y: 280 }, f.block, f.page),
  ]);
  expect(after.generatedLettering?.maskStrokes?.[1]).toMatchObject({
    space: "page",
    points: [{ x: 330, y: 280 }],
  });
});
it("uses the existing batch for preview/apply/undo/redo and rejects a changed page", async () => {
  const f = letteringFixture(),
    sample = fixture();
  for (const page of f.chapter.pages)
    Object.assign(page.blocks[0], structuredClone(sample.block));
  const before = structuredClone(f.chapter.pages);
  try {
    const plan = await f.service.preview(
      f.owner,
      f.request(sample.command),
      f.guard,
    );
    expect(f.save).not.toHaveBeenCalled();
    f.start(plan.batchId, "apply");
    expect((await f.done(plan.batchId)).status).toBe("completed");
    const after = structuredClone(f.chapter.pages);
    expect(after[0].blocks[0].generatedLettering?.paintStrokes).toHaveLength(1);
    expect(after[0].blocks[1]).toEqual(before[0].blocks[1]);
    f.start(plan.batchId, "undo");
    await f.done(plan.batchId);
    expect(f.chapter.pages).toEqual(before);
    f.start(plan.batchId, "redo");
    await f.done(plan.batchId);
    expect(f.chapter.pages).toEqual(after);
    const stale = await f.service.preview(
      f.owner,
      f.request(sample.command),
      f.guard,
    );
    f.chapter.pages[0].blocks[1].translatedText = "User edited another block";
    f.start(stale.batchId, "apply");
    expect((await f.done(stale.batchId)).status).not.toBe("completed");
    expect(f.chapter.pages[0].blocks[0]).toEqual(after[0].blocks[0]);
  } finally {
    await f.close();
  }
});
it("rejects repair commands for blocks outside the selected batch", async () => {
  const f = letteringFixture();
  try {
    const command = fixture().command;
    command.edits[0].blockId = "not-selected";
    await expect(
      f.service.preview(f.owner, f.request(command), f.guard),
    ).rejects.toThrow(/exactly match/);
    expect(f.save).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
