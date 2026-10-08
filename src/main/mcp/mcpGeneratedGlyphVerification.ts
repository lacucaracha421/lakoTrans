import { createHash, randomUUID } from "node:crypto";
import { hasValidGeneratedGlyphShape } from "../../shared/generatedGlyphReview";
import type { GlyphInspectionGeometry } from "../../shared/generatedGlyphReview";
import { createPageRevision } from "../../shared/pageRevision";
import { getActiveGeneratedLettering } from "../../shared/generatedLettering";
import {
  inspectGeneratedLettering,
  matchesLetteringReadback,
} from "../application/codexTypesettingReadback";
import { generatedAssetSha256 } from "../application/mcpGeneratedTouchup";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { McpEditError } from "../application/mcpEditPolicy";
import { translatedPageReading } from "../codexImageEditing";
import { readMcpSoundEffectSettings } from "./mcpSoundEffectSettings";
import { withMcpSoundEffectClient } from "./mcpSoundEffectGeneration";
import { renderMcpLetteringPixels } from "./mcpGeneratedGlyphRendering";
import { saveMcpQualityEvidence } from "./mcpQualityEvidenceStore";

export async function verifyMcpGeneratedGlyphs(
  options: Parameters<typeof withMcpSoundEffectClient>[0],
) {
  const { input, page, paths, signal } = options;
  if (input.command.kind !== "verify" || !input.command.allowExternalProcessing)
    throw new McpEditError(
      "access_denied",
      "Explicit configured independent readback authorization required.",
    );
  const command = input.command;
  const settings = await readMcpSoundEffectSettings(
    paths,
    command.expectedModel,
  );
  const blocks = selectGeneratedBlocks(page, command.blockIds);
  const glyphEvidenceIds: string[] = [];
  const geometry = new Map<string, GlyphInspectionGeometry>();
  await withMcpSoundEffectClient(
    options,
    settings,
    options.guard,
    async (_client, _directory, ask) => {
      const selected = { ...page, blocks };
      const reading = translatedPageReading(selected, "image");
      await inspectGeneratedLettering(selected, reading, 1, {
        ask,
        blockId: (id) => id,
        targetLanguage: "target-script",
        renderAsset: (block) =>
          (options.runtime?.renderLettering ?? renderMcpLetteringPixels)(
            page,
            block,
            signal,
            (value) => geometry.set(block.id, value),
          ),
        onTranscript: async (
          blockId,
          readText,
          expectedText,
          dataUrl,
          shape,
        ) => {
          await options.guard();
          signal.throwIfAborted();
          const block = blocks.find((item) => item.id === blockId);
          if (!block) throw new Error("Readback returned an unknown block.");
          const assetSha256 = generatedAssetSha256(block);
          if (!assetSha256) throw new Error("Readback asset is missing.");
          const id = randomUUID();
          await saveMcpQualityEvidence({
            id,
            createdAt: Date.now(),
            kind: "generated-glyphs",
            chapterId: input.chapterId,
            pageId: page.id,
            blockId,
            revision: createPageRevision(page),
            assetSha256,
            compositionFingerprint: compositeFingerprint(block),
            imageSha256: createHash("sha256")
              .update(Buffer.from(dataUrl.split(",")[1], "base64"))
              .digest("hex"),
            expectedText,
            readText,
            shape,
            inspectionGeometry: geometry.get(block.id),
            passed:
              matchesLetteringReadback(readText, expectedText) &&
              hasValidGeneratedGlyphShape(shape),
          });
          glyphEvidenceIds.push(id);
        },
      });
    },
  );
  return glyphEvidenceIds;
}

function selectGeneratedBlocks(
  page: Parameters<typeof withMcpSoundEffectClient>[0]["page"],
  ids: string[],
) {
  return ids.map((id) => {
    const block = page.blocks.find((item) => item.id === id);
    if (!block || !getActiveGeneratedLettering(block))
      throw new McpEditError(
        "invalid_edit",
        "Glyph verification requires current active generated lettering, including imported assets.",
      );
    return block;
  });
}
