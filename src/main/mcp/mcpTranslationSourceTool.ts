import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { openChapter } from "../library";
import { hashMcpOriginalImage } from "./mcpTypographySourceEvidence";
import { cropMcpPage } from "./mcpPageImageAdapter";
import { saveMcpQualityEvidence } from "./mcpQualityEvidenceStore";
import { McpEditError } from "../application/mcpEditPolicy";
import { textContent, type McpTool } from "./mcpReadTools";

export function createMcpTranslationSourceTool(): McpTool {
  const schema = z
    .object({
      chapterId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      pageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    })
    .strict();
  return {
    name: "carrot_inspect_translation_source",
    readOnly: true,
    requiredScopes: ["carrot.read", "carrot.images"],
    inputSchema: z.toJSONSchema(schema),
    description:
      "Read the WHOLE original page and receive durable sourceEvidenceId for detailed translation. Inventory dialogue, thoughts, labels, handwriting and every SFX visually, including OCR misses. Returned-image pixels are reduced; sourceRect uses original image pixels. Zoom uncertain regions with get_page_crop. This receipt proves image delivery, not exhaustive human-quality recognition.",
    invoke: async (args, context) => {
      const input = schema.parse(args);
      const guard = () => context?.assertAuthorized();
      guard();
      const page = (await openChapter(input.chapterId)).pages.find(
        (item) => item.id === input.pageId,
      );
      if (!page) throw new McpEditError("not_found", "Source page missing.");
      const sourceSha256 = await hashMcpOriginalImage(page.imagePath, guard);
      const image = await cropMcpPage(page, {
        x: 0,
        y: 0,
        w: page.width,
        h: page.height,
      });
      if (sourceSha256 !== (await hashMcpOriginalImage(page.imagePath, guard)))
        throw new McpEditError(
          "revision_conflict",
          "Original image changed during inspection.",
        );
      const id = randomUUID();
      await saveMcpQualityEvidence({
        id,
        createdAt: Date.now(),
        kind: "source-page",
        ...input,
        sourceSha256,
        imageSha256: createHash("sha256")
          .update(Buffer.from(image.data, "base64"))
          .digest("hex"),
      });
      guard();
      return [
        ...textContent({
          ...input,
          sourceEvidenceId: id,
          sourceSha256,
          sourceWidth: page.width,
          sourceHeight: page.height,
          width: image.width,
          height: image.height,
          inventoryOrigin: "host-visual-interpretation-required",
        }),
        { type: "image", data: image.data, mimeType: "image/png" },
      ];
    },
  };
}
