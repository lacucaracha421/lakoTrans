import { randomBytes } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { retentionFixture } from "./mcpRetention.fixture";
import { capturePageRecovery } from "../src/shared/pageRecoverySnapshot";

for (const bytes of [1024, 2 * 1024 * 1024]) {
  it(`preserves ${bytes}-byte native lettering exactly through edit, reconnect and recovery`, async () => {
    const f = await retentionFixture();
    try {
      const stored = JSON.parse(await readFile(f.chapterPath, "utf8"));
      const block = stored.pages[0].blocks[1];
      // Opaque image bytes: this test exercises persistence, never a raster decoder.
      block.generatedLettering = {
        version: 1,
        dataUrl: `data:image/png;base64,${randomBytes(bytes).toString("base64")}`,
        translatedText: block.translatedText,
        sourceText: block.sourceText,
        paintStrokes: [],
      };
      await writeFile(f.chapterPath, JSON.stringify(stored));
      const before = capturePageRecovery((await f.snapshot()).pages[0]);
      await f.edit("exact large-lettering recovery");
      const after = capturePageRecovery((await f.snapshot()).pages[0]);
      const id = (await f.list()).items[0].id;
      const directory = dirname(await f.storage.path(id));
      const assets = (await readdir(directory)).filter((name) =>
        name.endsWith(".lettering"),
      );
      expect(assets).toHaveLength(1);
      const recordBytes = await readFile(await f.storage.path(id));
      expect(recordBytes.length).toBeLessThan(20_000);
      const assetPath = join(directory, assets[0]);
      const assetBytes = await readFile(assetPath);
      expect(assetBytes.toString()).toBe(block.generatedLettering.dataUrl);
      expect((await f.storage.index()).entries[0].bytes).toBe(
        recordBytes.length + assetBytes.length,
      );
      await f.restart();
      await f.recover(id, "undo");
      expect(capturePageRecovery((await f.snapshot()).pages[0])).toEqual(
        before,
      );
      await f.restart();
      await f.recover(id, "redo");
      expect(capturePageRecovery((await f.snapshot()).pages[0])).toEqual(after);
      expect(after.blocks[1]).toEqual(before.blocks[1]);
      // A corrupt same-length asset must never be restored into the saved page.
      const corrupted = Buffer.from(assetBytes);
      corrupted[corrupted.length - 1] ^= 1;
      await writeFile(assetPath, corrupted);
      const saved = await readFile(f.chapterPath);
      await expect(f.recover(id, "undo")).rejects.toThrow(/bytes changed/);
      expect((await readFile(f.chapterPath)).equals(saved)).toBe(true);
      await writeFile(assetPath, assetBytes);
      expect(f.acquireEngine).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }, 30_000); // Several encrypted native commits with multi-MiB images under V8 coverage.
}

it("reads legacy inline recovery records and atomically migrates them on the next action", async () => {
  const f = await retentionFixture();
  try {
    const stored = JSON.parse(await readFile(f.chapterPath, "utf8"));
    const block = stored.pages[0].blocks[1];
    block.generatedLettering = {
      version: 1,
      dataUrl: "data:image/png;base64,YWJjZA==",
      translatedText: block.translatedText,
      sourceText: block.sourceText,
    };
    await writeFile(f.chapterPath, JSON.stringify(stored));
    const before = capturePageRecovery((await f.snapshot()).pages[0]);
    await f.edit("legacy inline record");
    const id = (await f.list()).items[0].id;
    const native = await f.storage.record(id);
    // This is exactly the pre-change encrypted v1 payload, without an asset envelope.
    const recordPath = await f.storage.path(id);
    const legacyText = JSON.stringify(await f.codec.seal(native));
    await writeFile(recordPath, legacyText);
    for (const name of (await readdir(dirname(recordPath))).filter((n) =>
      n.endsWith(".lettering"),
    ))
      await unlink(join(dirname(recordPath), name));
    const index = await f.storage.index();
    index.entries[0].bytes = Buffer.byteLength(legacyText);
    await writeFile(
      await f.storage.path(),
      JSON.stringify(await f.codec.seal(index)),
    );
    await f.restart();
    await f.recover(id, "undo");
    expect(capturePageRecovery((await f.snapshot()).pages[0])).toEqual(before);
    await f.restart();
    await f.recover(id, "redo");
    expect((await f.snapshot()).pages[0].blocks[0].translatedText).toBe(
      "legacy inline record",
    );
  } finally {
    await f.close();
  }
});
