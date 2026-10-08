import type { GlyphInspectionGeometry } from "../../shared/generatedGlyphReview";
import type { MangaPage } from "../../shared/libraryTypes";
import { z } from "zod/v4";
import { McpGeneratedTouchupSchema } from "../../shared/mcpGeneratedTouchup";
import { createPageRevision } from "../../shared/pageRevision";
import { openChapter } from "../library";
import { getAppPaths } from "../appPaths";
import { withLibraryMutation } from "../library/lock";
import {
  applyGeneratedTouchup,
  generatedAssetSha256,
} from "../application/mcpGeneratedTouchup";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { McpEditError } from "../application/mcpEditPolicy";
import { McpSoundEffectCandidates } from "./mcpSoundEffectCandidates";
import { renderMcpLetteringPixels } from "./mcpGeneratedGlyphRendering";
import { readMcpQualityEvidence } from "./mcpQualityEvidenceStore";
import { createMcpBatchTool } from "./mcpBatchTool";
import { textContent } from "./mcpReadTools";

const store = () => new McpSoundEffectCandidates(getAppPaths().dataRoot);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const candidateReadSchema = z
  .object({
    chapterId: id,
    pageId: id,
    candidateId: z.uuid().optional(),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();
function qualityEvidenceTool() {
  return createMcpBatchTool({
    name: "carrot_get_quality_evidence",
    schema: z.object({ evidenceId: z.uuid() }).strict(),
    scopes: ["carrot.read"],
    write: false,
    description:
      "Read a server-issued source/specimen/glyph receipt. Glyph results include independent transcription, exact expected wording and passed status; metadata alone does not establish aesthetic quality.",
    execute: async (args, _owner, guard) => {
      const value = await readMcpQualityEvidence(
        (args as { evidenceId: string }).evidenceId,
      );
      guard();
      return value;
    },
  });
}
function candidatesTool() {
  return createMcpBatchTool({
    name: "carrot_get_sound_effect_candidates",
    schema: candidateReadSchema,
    scopes: ["carrot.read", "carrot.images"],
    write: false,
    description:
      "Inspect retained generation attempts after failure or reconnect. Without candidateId returns 25 metadata entries; with candidateId returns actual composed pixels, asset SHA and candidateRevision for targeted touchup. Reserved attempts may have been interrupted and still consume budget. Candidates are not saved page changes. Adopt using prepare_sound_effect_batch command=candidate, then verify_generated_lettering on the saved final pixels.",
    execute: async (args, _owner, guard) => {
      const input = args as z.infer<typeof candidateReadSchema>;
      const page = (await openChapter(input.chapterId)).pages.find(
        (item) => item.id === input.pageId,
      );
      if (!page) throw new McpEditError("not_found", "Candidate page missing.");
      guard();
      if (input.candidateId) {
        const candidate = await store().read(input.candidateId);
        if (
          candidate.chapterId !== input.chapterId ||
          candidate.pageId !== input.pageId ||
          !candidate.block
        )
          throw new McpEditError(
            "not_found",
            "Candidate has no generated pixels.",
          );
        const { block, ...metadata } = candidate;
        const { image, inspectionGeometry } = await candidatePixels(
          page,
          block,
        );
        guard();
        return {
          metadata: {
            ...metadata,
            candidateRevision: compositeFingerprint(candidate),
            assetSha256: generatedAssetSha256(block),
            expectedText: block.translatedText,
            inspectionGeometry,
          },
          image,
        };
      }
      const values = await store().list(input.chapterId, input.pageId);
      guard();
      return {
        metadata: {
          total: values.length,
          nextOffset:
            input.offset + 25 < values.length ? input.offset + 25 : null,
          candidates: values.slice(input.offset, input.offset + 25),
        },
        image: undefined,
      };
    },
    formatResult: (value) => [
      ...textContent(value.metadata),
      ...(value.image
        ? [
            {
              type: "image" as const,
              mimeType: "image/png" as const,
              data: value.image.split(",")[1],
            },
          ]
        : []),
    ],
  });
}
async function candidatePixels(
  page: MangaPage,
  block: MangaPage["blocks"][number],
) {
  let inspectionGeometry: GlyphInspectionGeometry | undefined;
  const image = await renderMcpLetteringPixels(
    page,
    block,
    undefined,
    (value) => {
      inspectionGeometry = value;
    },
  );
  return { image, inspectionGeometry };
}

function touchupCandidateTool() {
  return createMcpBatchTool({
    name: "carrot_touchup_sound_effect_candidate",
    schema: z
      .object({
        candidateId: z.uuid(),
        candidateRevision: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: z.uuid(),
        edit: McpGeneratedTouchupSchema.shape.edits.element,
      })
      .strict(),
    scopes: ["carrot.read", "carrot.edit", "carrot.images"],
    write: true,
    description:
      "Repair a retained generated candidate with native paint/mask/outline or polygon cut/move commands. edit.moves uses explicit asset/page space, polygon and from/to anchors; it preserves original PNG bytes. Inspect the composed candidate image and its inspectionGeometry before mapping coordinates. At most two touchup passes per candidate. Requires exact candidate revision and image SHA. Does not change the saved page. Re-read composed pixels after repair; adopt and independently verify before detailed completion. Replayed requestId does not add strokes again.",
    execute: async (args, _owner, guard) =>
      withLibraryMutation(async () => {
        const input = args as TouchupInput;
        const repository = store();
        const candidate = await repository.read(input.candidateId);
        const fingerprint = compositeFingerprint(input);
        const prior = candidate.touchupRequests?.find(
          (item) => item.id === input.requestId,
        );
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new McpEditError(
              "revision_conflict",
              "Touchup requestId was used for different commands.",
            );
          return {
            candidateId: candidate.id,
            candidateRevision: compositeFingerprint(candidate),
            touchupPasses: candidate.touchupPasses,
          };
        }
        if (
          compositeFingerprint(candidate) !== input.candidateRevision ||
          !candidate.block ||
          candidate.block.id !== input.edit.blockId
        )
          throw new McpEditError(
            "revision_conflict",
            "Candidate changed before repair.",
          );
        if (candidate.touchupPasses >= 2)
          throw new McpEditError(
            "invalid_edit",
            "Two direct repair passes exhausted; revise the generation prompt or choose a sampled font.",
          );
        const page = (await openChapter(candidate.chapterId)).pages.find(
          (item) => item.id === candidate.pageId,
        );
        if (!page)
          throw new McpEditError("not_found", "Candidate page missing.");
        if (createPageRevision(page) !== candidate.baseRevision)
          throw new McpEditError(
            "revision_conflict",
            "The saved page changed after generation. Inspect the new page before preparing another candidate.",
          );
        const next = {
          ...candidate,
          block: applyGeneratedTouchup(page, candidate.block, input.edit),
          status: "pending-repair" as const,
          touchupPasses: candidate.touchupPasses + 1,
          touchupRequests: [
            ...(candidate.touchupRequests ?? []),
            { id: input.requestId, fingerprint },
          ],
        };
        guard();
        await repository.save(next);
        return {
          candidateId: next.id,
          candidateRevision: compositeFingerprint(next),
          touchupPasses: next.touchupPasses,
        };
      }),
  });
}
export function createMcpSoundEffectCandidateTools(editing: boolean) {
  return [
    qualityEvidenceTool(),
    candidatesTool(),
    ...(editing ? [touchupCandidateTool()] : []),
  ];
}

type TouchupInput = {
  candidateId: string;
  candidateRevision: string;
  requestId: string;
  edit: ReturnType<typeof McpGeneratedTouchupSchema.parse>["edits"][number];
};
