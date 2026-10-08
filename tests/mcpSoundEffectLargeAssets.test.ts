import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { soundEffectFixture } from "./mcpSoundEffect.fixture";

for (const count of [1, 8]) {
  it(`admits large real-metadata plans within the existing session budget (assets=${count})`, async () => {
    // The renderer is an external boundary here; actual PageArtwork/readback is
    // covered by the native acceptance. No generated image bytes are decoded.
    const renderLettering = vi.fn(
      async (page) =>
        `data:image/png;base64,${(await readFile(page.imagePath)).toString("base64")}`,
    );
    const f = await soundEffectFixture({ renderLettering });
    try {
      const raw = JSON.parse(await readFile(f.chapterPath, "utf8"));
      const source = raw.pages[0].blocks[0];
      const dataUrl = `data:image/png;base64,${randomBytes(2 * 1024 * 1024).toString("base64")}`;
      raw.pages[0].blocks = Array.from({ length: count }, (_, i) => ({
        ...source,
        id: `large-${i}`,
        generatedLettering: {
          version: 1,
          dataUrl,
          sourceText: source.sourceText,
          translatedText: source.translatedText,
        },
      }));
      raw.pages[0].blockOrder = raw.pages[0].blocks.map(
        (b: { id: string }) => b.id,
      );
      await writeFile(f.chapterPath, JSON.stringify(raw));
      const before = await readFile(f.chapterPath);
      const command = {
        kind: "verify" as const,
        blockIds: ["large-0"],
        expectedModel: f.settings.codex.imageModel,
        allowExternalProcessing: true,
      };
      if (count === 8) {
        await expect(f.preview(command)).rejects.toThrow(/32 MiB/);
        expect(renderLettering).not.toHaveBeenCalled();
        expect(f.startReader).not.toHaveBeenCalled();
      } else {
        const plan = await f.preview(command);
        expect(
          f.service.readOwnedPlan(f.owner, plan.batchId, () => {})
            .glyphEvidenceIds,
        ).toHaveLength(1);
        expect(renderLettering).toHaveBeenCalledOnce();
        expect(f.readerTurn).toHaveBeenCalledTimes(2); // Blind transcription and separate shape inspection.
      }
      expect((await readFile(f.chapterPath)).equals(before)).toBe(true);
      expect(f.turn).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
}
