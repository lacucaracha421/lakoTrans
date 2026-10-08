import { z } from "zod/v4";
import { McpFontSamplesInput } from "../../shared/mcpTypographyRead";
import type { McpFontCatalog } from "../application/mcpTypographyReadService";
import { McpEditError } from "../application/mcpEditPolicy";
import { McpInvalidParams } from "./mcpArguments";
import { textContent, type McpTool } from "./mcpReadTools";
import { createHash, randomUUID } from "node:crypto";
import type { McpQualityEvidence } from "../../shared/mcpQualityEvidence";

type Sample = { label: string; dataUrl: string };
type Ports = {
  catalog: () => Promise<McpFontCatalog>;
  render: (
    fontIds: string[],
    text: string,
    guard: () => void,
    context?: z.infer<typeof McpFontSamplesInput>["context"],
  ) => Promise<Sample[]>;
  fontFingerprint?: (guard: () => void) => Promise<string>;
  saveEvidence?: (value: McpQualityEvidence) => Promise<unknown>;
};
export function createMcpFontSamplesTool(ports: Ports): McpTool {
  const scopes = ["carrot.read", "carrot.images"];
  return {
    name: "carrot_get_font_samples",
    description:
      "Visually compare 1–4 app fonts using the actual page renderer, without saving or running any local/remote model. First list_fonts and retain its snapshot; only available registered IDs are accepted. Provide context={chapterId,pageId,blockId,revision} to render the FULL supplied sentence inside the current saved block using each candidate font, without saving. Without context each image shows regular (left), bold (right), and 24/40/60px rows. The provided literal text is shortened to at most 8 graphemes to fit; each label states the actual specimen. Read source crops and previous-chapter rendered pages, choose fonts by visible strokes, apply with update_page_blocks or a format batch, then render and check. A server-issued evidenceId binds text, context, actual PNG hashes and font bytes for work palette and detailed completion. This is visual evidence, not an automatic match score or full glyph-coverage guarantee.",
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    requiredScopes: scopes,
    inputSchema: z.toJSONSchema(McpFontSamplesInput),
    invoke: async (args, context) => {
      const parsed = McpFontSamplesInput.safeParse(args);
      if (!parsed.success) throw new McpInvalidParams(parsed.error.issues);
      const input = parsed.data;
      const guard = () => context?.assertAuthorized();
      guard();
      const before = await ports.catalog();
      const fontFingerprint = await ports.fontFingerprint?.(guard);
      assertCatalog(before, input);
      const images = input.context
        ? await ports.render(input.fontIds, input.text, guard, input.context)
        : await ports.render(input.fontIds, input.text, guard);
      guard();
      if ((await ports.catalog()).snapshot !== input.snapshot)
        throw new McpEditError(
          "revision_conflict",
          "Font inventory changed while rendering. List fonts again.",
        );
      if (
        images.length !== input.fontIds.length ||
        images.some(
          (image) =>
            !image.dataUrl.startsWith("data:image/png;base64,") ||
            image.dataUrl.length > 3 * 1024 * 1024,
        )
      )
        throw new Error("Invalid font sample images.");
      guard();
      const evidenceId = await issueSpecimen(
        ports,
        input,
        images,
        fontFingerprint,
        guard,
      );
      guard();
      return [
        ...textContent({
          snapshot: before.snapshot,
          ...(evidenceId ? { evidenceId, fontFingerprint } : {}),
          samples: images.map((image, index) => ({
            fontId: input.fontIds[index],
            label: image.label,
            contentIndex: index + 1,
          })),
          notes: [
            "visual_comparison_only_no_model_or_save",
            "specimen_may_be_shortened_see_each_label",
          ],
        }),
        ...images.map((image) => ({
          type: "image" as const,
          mimeType: "image/png" as const,
          data: image.dataUrl.slice("data:image/png;base64,".length),
        })),
      ];
    },
  };
}

async function issueSpecimen(
  ports: Ports,
  input: z.infer<typeof McpFontSamplesInput>,
  images: Sample[],
  fontFingerprint: string | undefined,
  guard: () => void,
) {
  let evidenceId: string | undefined;
  if (fontFingerprint && ports.saveEvidence) {
    if (fontFingerprint !== (await ports.fontFingerprint?.(guard)))
      throw new McpEditError(
        "revision_conflict",
        "Font bytes changed during specimen rendering.",
      );
    evidenceId = randomUUID();
    await ports.saveEvidence({
      id: evidenceId,
      createdAt: Date.now(),
      kind: "font-specimen",
      fontFingerprint,
      catalogSnapshot: input.snapshot,
      text: input.text,
      ...(input.context ? { context: input.context } : {}),
      samples: images.map((image, index) => ({
        fontId: input.fontIds[index],
        label: image.label,
        imageSha256: createHash("sha256")
          .update(Buffer.from(image.dataUrl.split(",")[1], "base64"))
          .digest("hex"),
      })),
    });
  }

  return evidenceId;
}

function assertCatalog(
  before: McpFontCatalog,
  input: z.infer<typeof McpFontSamplesInput>,
) {
  if (before.snapshot !== input.snapshot)
    throw new McpEditError(
      "revision_conflict",
      "Font inventory changed. List fonts again.",
    );
  for (const id of input.fontIds)
    if (
      !before.fonts.some(
        (font) => font.fontId === id && font.availability === "available",
      )
    )
      throw new McpEditError(
        "invalid_edit",
        "Choose available font IDs from list_fonts; no fallback font is substituted.",
      );
}
