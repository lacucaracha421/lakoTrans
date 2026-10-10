import type { getTranslationGuide } from "../application/mcpTranslationGuide";

/** Coaching only: never changes tool permissions, editing rules or review gates. */
export function usesClaudeClientGuidance(name: string | undefined): boolean {
  return /claude|anthropic/i.test(name ?? "");
}

const CLAUDE_BALLOON_GUIDANCE =
  "Read originals and saved blocks, then save draft Korean translations in one chunk using fields only; OMIT renderRect. Save non-empty translatedText BEFORE geometry preparation: the current native layout path excludes empty translations. Do not save guessed placement or hard line breaks just to make this draft. Establish each physical balloon's usable region before final typography. For wording, font, size and line-break edits, OMIT renderRect and preserve a correct saved region. OCR letter columns alone are NOT usable balloon geometry. For ordinary closed balloons without usable geometry, first call carrot_prepare_lettering_batch with command={kind:layout,mode:geometry,policy:safe,locale:ko,allowAssetDownloads:true}, poll carrot_get_job, inspect carrot_get_lettering_batch and apply the useful proposal with carrot_apply_lettering_batch. The current detector requires allowAssetDownloads=true even when assets may already be installed; it permits installation of missing detector assets. Respect explicit user download restrictions. A missing permission flag is not evidence that detection failed or a download is actually needed: correct authorized arguments rather than immediately abandoning the detector. Prepare only missing or visibly incorrect geometry in ONE batch across the current chunk, read fresh revisions after saving the draft, and inspect exclusions as well as proposed changes. Do not redetect correct regions or guess coordinates block by block instead. This layout tool handles dialogue, not just sound effects. Detection is a proposal, not ground truth. If it fails or mismatches the artwork, inspect a crop containing the ENTIRE balloon and surrounding art before choosing a manual alternative. Use original image pixels and pixelMapping. For linked balloons establish each lobe separately: upper and lower paragraphs may need different horizontal centers. Never align them to one shared center merely for consistency; the lower lobe may move left or right and taper against a character. Preserve every phrase exactly once. A manual renderRect is appropriate for a verified correction or the user's requested composition; allowDetectedLayoutOverride=true remains available when intentionally replacing detected geometry. Explain the observed reason, not a generic style excuse.";

export const CLAUDE_CLIENT_TRANSLATION_GUIDANCE = [
  "Follow this Claude-specific working order for ordinary translation: original and blocks → draft translation saved without moving blocks → missing balloon regions → final typography → saved render of EACH changed page → existing quality review. These are strong defaults, not tool restrictions. Explicit user choices take precedence. Keep manual alternatives available and judge them from actual output. Do not ask permission for routine authorized edits or downgrade a difficult ordinary request to quick mode.",
  CLAUDE_BALLOON_GUIDANCE,
  "Choose horizontal Korean phrase groups, source-scale readable type and actual font specimens; reuse the work palette. Prefer wordBreak=keep-all for ordinary dialogue. Do not assign one fixed size to every balloon or turn autoFitText off throughout a chunk by habit. Manual size and explicit line breaks are valid when verified. If text does not fit, reconsider wording, phrase breaks and the usable region before shrinking. A larger rectangle over artwork is not extra balloon space; auto-fit cannot repair that geometry. Do not equate fitting a rectangle with fitting the balloon. Compare ORIGINAL and final text at the SAME reading scale: being readable only in a zoomed crop is a failure to resolve, not a pass. Check for unnecessarily small letters and excessive empty space as well as intrusion. For ordinary dialogue, if a much smaller paragraph leaves broad usable space, compare a larger, naturally reflowed alternative in that region before accepting it. Keep intentional quiet speech and user-chosen small type. Do not impose a universal minimum size or enlarge into artwork. Use the existing source-size analysis when size is uncertain; do not choose a small arbitrary size merely to avoid overflow.",
  "After the LAST edit of EACH page, call carrot_render_page_preview with includeLayout=true and inspect the image at reading scale. For linked, tall, narrow, visibly undersized or manually repositioned balloons, also inspect a final render crop of the ENTIRE balloon with surrounding art. Check BOTH ends of EVERY line, especially bottom lines, against borders, necks, hair and panel edges. Check legibility, natural word endings, spacing and source-erasure remnants together. overflow=false or shapeFlow=contained does not prove visual containment; layout evidence does not contain per-line ink coordinates. If a line crosses artwork, correct that specific region and inspect its new render before leaving the page. Successful editing and successful erasure are not visual review.",
  "Track page IDs and current revisions as saved-but-unreviewed, visually reviewed, or still needing correction. Review every changed page before advancing to the next chunk; checking pages 1, 2, 3 and 5 never covers page 4. If interrupted, retain and report unreviewed pages, then resume from saved receipts without replaying edits. Settle palette and page edits before final evidence. Once a page is satisfactory, reuse its current evidence and do not repeatedly inspect unchanged pages. Batch independent reads and per-page edits; poll jobs at a sensible interval instead of a tight loop. Spend extra comparison only on a specific uncertain balloon, then re-render only changed pages. Do not generate several variants for every block or repeat a full-chunk review after a local correction. After changes settle, finish the existing complete-translation-v2 review and read the whole-scope guide; claim completion only from its actual status. A pause or saved draft is not a completed translation. Follow the guide's soundEffectScope and image route; this client profile does not change them.",
].join("\n\n");

export function claudeClientTranslationSteps(
  steps: Awaited<ReturnType<typeof getTranslationGuide>>["steps"],
) {
  return steps.map((step) =>
    step.id === "physical-lettering-regions"
      ? {
          ...step,
          instruction: `${CLAUDE_BALLOON_GUIDANCE}\n\n${step.instruction}`,
          tools: [
            ...new Set([
              ...step.tools,
              "carrot_get_page_blocks",
              "carrot_prepare_lettering_batch",
              "carrot_get_job",
              "carrot_get_lettering_batch",
              "carrot_apply_lettering_batch",
            ]),
          ],
        }
      : step,
  );
}
