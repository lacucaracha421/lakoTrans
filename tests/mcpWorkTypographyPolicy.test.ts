import { expect, it } from "vitest";
import { detailedQualityFixture } from "./mcpDetailedQuality.fixture";
import { previewWorkTypography } from "../src/main/application/mcpWorkTypographyPolicy";
import { compositeFingerprint } from "../src/main/application/mcpCompositeWorkflowPolicy";
import { McpWorkTypographyChangeSchema } from "../src/shared/mcpWorkTypography";

const timestamp = "2026-10-08T00:00:00.000Z";
function paletteFixture() {
  const f = detailedQualityFixture();
  const input = McpWorkTypographyChangeSchema.parse({
    workId: "work",
    revision: null,
    selections: [
      {
        role: "dialogue",
        fontId: "local-font",
        candidateFontIds: ["local-font", "other-font"],
        specimenId: f.specimenId,
        reason:
          "Read the Korean sentence inside its balloon and compared stroke weight.",
      },
    ],
  });
  const environment = {
    catalogVersion: "catalog",
    modelVersion: "test-model",
    rendererHash: "e".repeat(64),
  };
  const preview = (
    current: Parameters<typeof previewWorkTypography>[1] = null,
  ) =>
    previewWorkTypography(
      input,
      current,
      f.fingerprint,
      f.input.readEvidence,
      timestamp,
      environment,
    );
  return { ...f, input, preview };
}
it("persists role, actual specimen provenance and AI origin without claiming human gold", async () => {
  const f = paletteFixture();
  const next = await f.preview();
  expect(next.dialogueAnchor).toMatchObject({
    primaryFontId: "local-font",
    origin: "connected-ai",
    confidence: 0,
  });
  expect(next.visualSelections?.[0]).toMatchObject({
    specimenId: f.specimenId,
    fontFingerprint: f.fingerprint,
    origin: "connected-ai",
  });
  expect(next.userLocks).toEqual([]);
});
it("rejects stale/wrong specimens and preserves user locks including weight and italics", async () => {
  const f = paletteFixture();
  const current = await f.preview();
  current.userLocks = [
    {
      id: "lock",
      scope: { type: "role", role: "dialogue" },
      selection: { fontId: "local-font", fontWeight: 700, italic: true },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  f.input.revision = compositeFingerprint(current);
  const next = await f.preview(current);
  expect(next.userLocks).toEqual(current.userLocks);
  expect(next.visualSelections?.[0].selection).toMatchObject({
    fontWeight: 700,
    italic: true,
  });
  f.input.selections[0].italic = false;
  await expect(f.preview(current)).rejects.toThrow(/lock/);
  delete f.input.selections[0].italic;
  f.input.selections[0].candidateFontIds[1] = "never-sampled";
  await expect(f.preview(current)).rejects.toThrow(/specimens/);
  f.input.selections[0].candidateFontIds[1] = "other-font";
  f.input.revision = "c".repeat(64);
  await expect(f.preview(current)).rejects.toThrow(/changed/);
});
