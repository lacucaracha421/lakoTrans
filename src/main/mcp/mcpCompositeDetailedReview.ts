import { assertDetailedTranslationPage } from "../application/mcpDetailedTranslationQuality";
import { McpEditError } from "../application/mcpEditPolicy";
import type { McpCompositeGuard } from "../application/mcpCompositeWorkflowPorts";
import type {
  McpCompositeReviewReport,
  McpCompositeRenderEvidence,
} from "../../shared/mcpCompositeWorkflowReview";
import type { McpCompositeNativePage } from "./mcpCompositeNativePages";
import { readMcpQualityEvidence } from "./mcpQualityEvidenceStore";
import { hashMcpOriginalImage } from "./mcpTypographySourceEvidence";

export async function verifyMcpDetailedReview(
  values: McpCompositeNativePage[],
  assessments: Array<{
    assessment: McpCompositeReviewReport["assessments"][number];
    evidence: McpCompositeRenderEvidence;
  }>,
  guard: McpCompositeGuard,
) {
  for (const { assessment, evidence } of assessments) {
    const value = values.find(
      (entry) =>
        entry.page.id === assessment.pageId &&
        entry.target.chapterId === assessment.chapterId,
    );
    if (!value)
      throw new McpEditError(
        "revision_conflict",
        "Detailed review page changed.",
      );
    await assertDetailedTranslationPage({
      page: value.page,
      assessment,
      evidence,
      sourceSha256: await hashMcpOriginalImage(value.page.imagePath, () =>
        guard(),
      ),
      paletteRevision: value.paletteRevision ?? null,
      readEvidence: readMcpQualityEvidence,
    });
  }
  guard();
}
