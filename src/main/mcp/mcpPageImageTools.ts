import { z } from "zod";
import type { McpPageImageService } from "../application/mcpPageImageService";
import {
  allowArguments,
  identifierSchema,
  readIdentifier,
  McpInvalidParams,
} from "./mcpArguments";
import { textContent, type McpTool } from "./mcpReadTools";

const pixelRect = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict();
export function createMcpPageImageTools(
  service: McpPageImageService,
): McpTool[] {
  return [false, true].map((crop) => ({
    name: crop ? "carrot_get_page_crop" : "carrot_render_page_preview",
    requiredScopes: ["carrot.read", "carrot.images"],
    description: crop
      ? "Read an enlarged source-page region. Rectangle x,y,w,h is in ORIGINAL IMAGE PIXELS, not normalized block coordinates. Returns mapping from returned-image pixels to original pixels. Does not run OCR or modify anything."
      : "Render the saved page with the actual app renderer, including saved text, styles and inpainting. Inspect once after the planned edits settle: compare source and translation at the same normal reading scale for readable glyph size/weight, text density, emphasis and artwork overlaps. Zoom only suspicious details; repeated unchanged previews or legibility only when enlarged are not quality improvements. includeLayout=true returns actual layout lines, em/ink sizes and review warnings. These check rectangular text layout, NOT containment in the curved balloon: inspect every lobe of linked balloons, each line end, narrow necks and adjacent artwork. A paragraph-gap warning requires checking whether the block must be split. A multiline-narrow-region warning requires a final balloon crop AFTER the last edit: inspect every line end against the tapering contour, including the lowest lines; a small whole-page view is insufficient. These are risk checks, not automatic detection of a balloon collision. crop optionally crops the FINAL render in ORIGINAL IMAGE PIXELS, unlike get_page_crop which crops source. Generated assets include SHA for bounded touchup. Does NOT erase, OCR, translate or change layout. Returns a reduced PNG and pixel mapping, not an original-resolution export.",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: identifierSchema,
        pageId: identifierSchema,
        ...(crop
          ? {
              rect: {
                type: "object",
                properties: {
                  x: { type: "integer", minimum: 0 },
                  y: { type: "integer", minimum: 0 },
                  w: { type: "integer", minimum: 1 },
                  h: { type: "integer", minimum: 1 },
                },
                required: ["x", "y", "w", "h"],
                additionalProperties: false,
              },
            }
          : {
              includeLayout: { type: "boolean", default: false },
              crop: z.toJSONSchema(pixelRect),
            }),
      },
      required: ["chapterId", "pageId", ...(crop ? ["rect"] : [])],
      additionalProperties: false,
    },
    invoke: async (args) => {
      allowArguments(args, [
        "chapterId",
        "pageId",
        ...(crop ? ["rect"] : ["includeLayout", "crop"]),
      ]);
      const rect = readRect(args, crop);
      const { imageData, ...metadata } = await service.read(
        readIdentifier(args.chapterId, "chapterId"),
        readIdentifier(args.pageId, "pageId"),
        crop ? rect?.data : undefined,
        crop || (args.includeLayout === undefined && args.crop === undefined)
          ? undefined
          : { includeLayout: args.includeLayout === true, crop: rect?.data },
      );
      return [
        ...textContent(metadata),
        { type: "image", data: imageData, mimeType: "image/png" },
      ];
    },
  }));
}

function readRect(args: Record<string, unknown>, crop: boolean) {
  const rect =
    crop || args.crop !== undefined
      ? pixelRect.safeParse(crop ? args.rect : args.crop)
      : undefined;
  if (
    !crop &&
    args.includeLayout !== undefined &&
    typeof args.includeLayout !== "boolean"
  )
    throw new McpInvalidParams([
      {
        code: "invalid_type",
        path: ["includeLayout"],
        expected: "boolean",
      },
    ]);
  if (rect && !rect.success)
    throw new McpInvalidParams(
      rect.error.issues.map((issue) => ({
        ...issue,
        path: ["rect", ...issue.path],
      })),
    );
  return rect;
}
