import { z } from "zod/v4";
import {
  McpTranslationGuideInputSchema,
  McpTranslationGuideOutputSchema,
} from "../../shared/mcpTranslationGuide";
import { getTranslationGuide } from "../application/mcpTranslationGuide";
import type { McpLibraryReadPort } from "../application/mcpLibraryReadService";
import { textContent, type McpTool } from "./mcpReadTools";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import type { McpTranslationCompletionReader } from "../application/mcpTranslationCompletion";
import { authorizeMcpComposite } from "./mcpCompositeAuthorization";

export function createTranslationGuideTool(
  library: McpLibraryReadPort,
  toolNames: readonly string[],
  readCompletion?: McpTranslationCompletionReader,
): McpTool {
  return {
    name: "carrot_get_translation_guide",
    description:
      "START HERE for 'translate this chapter', '번역해줘' or a polished complete translation. Also call once AFTER all chunk reviews with the full chapter selection: completion lists current accepted and missing/stale pages across this connection's retained v2 composites. Only a whole-chapter accepted status supports detailed chapter completion; saving/exporting or completing the last chunk does not. Aim for one well-planned pass: read original expression, choose a consistent font palette and source-scale sizes, batch text/style/placement, then inspect final pages. Correct specific remaining defects only. Includes ALL text/SFX and real rendered review. Host generation AND PNG byte delivery must be checked. Read-only; no models, edits, quota or queue started.",
    inputSchema: z.toJSONSchema(McpTranslationGuideInputSchema),
    requiredScopes: ["carrot.read"],
    readOnly: true,
    invoke: async (args, context) => {
      const input = McpTranslationGuideInputSchema.parse(args);
      const guard = context?.assertAuthorized ?? (() => {});
      const result = await getTranslationGuide(
        library,
        input,
        context?.visibleToolNames ?? toolNames,
        guard,
      );
      guard();
      const profile = (await library.readTypography?.(result.workId)) ?? null;
      guard();
      const completion = await readGuideCompletion(
        readCompletion,
        result,
        context,
      );
      guard();
      return textContent(
        McpTranslationGuideOutputSchema.parse({
          ...result,
          ...(completion ? { completion } : {}),
          workTypography: {
            revision: profile ? compositeFingerprint(profile) : null,
            profile,
          },
        }),
      );
    },
  };
}

function readGuideCompletion(
  read: McpTranslationCompletionReader | undefined,
  result: Awaited<ReturnType<typeof getTranslationGuide>>,
  context: Parameters<McpTool["invoke"]>[1],
) {
  if (!read || !context?.principalId || result.mode === "quick")
    return undefined;
  return read(
    context.principalId,
    result,
    authorizeMcpComposite(context.assertAuthorized, (scopes) =>
      context.assertScopes?.(scopes),
    ),
  );
}
