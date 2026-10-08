import { expect, it } from "vitest";
import { packMcpSnapshot } from "../src/main/application/mcpSnapshotPayload";

it("counts repeated native images as memory, but deduplicates persistence without mutating the snapshot", () => {
  const generatedLettering = {
    version: 1,
    dataUrl: "data:image/png;base64,YWJjZA==",
    translatedText: "쿠웅",
  };
  const value = [{ generatedLettering }, { generatedLettering }];
  const before = JSON.stringify(value);
  const packed = packMcpSnapshot(value);
  expect(packed.totalBytes).toBe(Buffer.byteLength(before));
  expect(packed.images.size).toBe(1);
  expect(JSON.stringify(value)).toBe(before);
  expect(packed.json).not.toContain(generatedLettering.dataUrl);
});

it("does not classify arbitrary dataUrl/text fields or invalid native PNG strings as image capacity", () => {
  const value = {
    dataUrl: "data:image/png;base64,YQ==",
    generatedLettering: { dataUrl: "PRIVATE".repeat(1024) },
    note: "한글",
  };
  const packed = packMcpSnapshot(value);
  expect(packed.images.size).toBe(0);
  expect(packed.metadataBytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(packed.totalBytes).toBe(packed.metadataBytes);
});
