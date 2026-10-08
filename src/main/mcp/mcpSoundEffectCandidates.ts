import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import { TranslationBlockSchema } from "../../shared/ipcSchemaPrimitives";
import { McpSoundEffectCandidateMetadataSchema } from "../../shared/mcpQualityOutputs";
import { createPageRevision } from "../../shared/pageRevision";
import type { MangaPage } from "../../shared/libraryTypes";
import type { TranslationBlock } from "../../shared/textTypes";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { McpEditError } from "../application/mcpEditPolicy";
import { withLibraryMutation } from "../library/lock";
import {
  assertPathWithinRootWithoutSymlinks,
  writeDurableJsonFile,
} from "../libraryStore/libraryTransactionStorage";

const candidateSchema = McpSoundEffectCandidateMetadataSchema.extend({
  block: TranslationBlockSchema.optional(),
}).strict();
export type McpSoundEffectCandidate = z.infer<typeof candidateSchema>;

export class McpSoundEffectCandidates {
  constructor(private readonly dataRoot: string) {}
  private async path(file: string) {
    const path = join(this.dataRoot, ".mcp-quality", "sfx", file);
    await assertPathWithinRootWithoutSymlinks(this.dataRoot, path, {
      allowMissingTarget: true,
    });
    return path;
  }
  async read(id: string) {
    z.uuid().parse(id);
    return candidateSchema.parse(
      JSON.parse(await readFile(await this.path(`${id}.json`), "utf8")),
    );
  }
  async save(candidate: McpSoundEffectCandidate) {
    await writeDurableJsonFile(
      await this.path(`${candidate.id}.json`),
      candidateSchema.parse(candidate),
    );
  }
  async list(chapterId: string, pageId: string) {
    const dir = await this.path(".");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const items: Omit<McpSoundEffectCandidate, "block">[] = [];
    for (const file of files.filter((file) =>
      /^[a-f0-9-]{36}\.json$/.test(file),
    )) {
      const item = await this.read(file.slice(0, -5));
      if (item.chapterId === chapterId && item.pageId === pageId) {
        const { block: _pixels, ...metadata } = item;
        items.push(metadata);
      }
    }
    return items.sort((a, b) => a.attempt - b.attempt);
  }
  async reserve(
    chapterId: string,
    page: MangaPage,
    block: TranslationBlock,
    sourceSha256: string,
    priorAttempts: number,
    instructions: string,
  ) {
    const key = budgetKey(chapterId, page, block, sourceSha256);
    return withLibraryMutation(async () => {
      const path = await this.path(`budget-${key}.json`);
      let used = priorAttempts;
      try {
        const saved = z
          .object({
            used: z.number().int().min(0).max(4),
            refused: z.boolean(),
            promptHash: z.string().optional(),
          })
          .parse(JSON.parse(await readFile(path, "utf8")));
        if (saved.refused)
          throw new McpEditError(
            "invalid_edit",
            "Image policy refusal is terminal for this region.",
          );
        used = Math.max(used, saved.used);
        if (
          !instructions.trim() ||
          saved.promptHash === compositeFingerprint(instructions)
        )
          throw new McpEditError(
            "invalid_edit",
            "Revise the prompt with a concrete correction before another generation attempt.",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (used >= 4)
        throw new McpEditError(
          "invalid_edit",
          "Four generation attempts exhausted. Repair a retained candidate or use a sampled font and disclose substitution.",
        );
      const candidate: McpSoundEffectCandidate = {
        id: randomUUID(),
        chapterId,
        pageId: page.id,
        blockId: block.id,
        baseRevision: createPageRevision(page),
        baseBlockFingerprint: compositeFingerprint(block),
        attempt: used + 1,
        touchupPasses: 0,
        instructions,
        issues: [],
        status: "reserved",
      };
      // Debit before external work. Interrupted/unknown calls are not refunded on reconnect.
      await writeDurableJsonFile(path, {
        used: candidate.attempt,
        refused: false,
        promptHash: compositeFingerprint(instructions),
      });
      await this.save(candidate);
      return {
        candidate,
        refuse: () =>
          withLibraryMutation(async () => {
            const saved = JSON.parse(await readFile(path, "utf8"));
            await writeDurableJsonFile(path, { ...saved, refused: true });
          }),
      };
    });
  }
}

function budgetKey(
  chapterId: string,
  page: MangaPage,
  block: TranslationBlock,
  sourceSha256: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        chapterId,
        page.id,
        block.id,
        block.sourceText,
        block.translatedText,
        sourceSha256,
      ]),
    )
    .digest("hex");
}
