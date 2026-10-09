import type { z } from "zod/v4";
import type { McpContextSnapshot } from "./mcpContextEditPolicy";
import type { MangaPage } from "../../shared/libraryTypes";
import type { McpLibraryReadPort } from "./mcpLibraryReadService";
import { McpEditError } from "./mcpEditPolicy";
import {
  createPageRevision,
  createSoundEffectReviewPageRevision,
} from "../../shared/pageRevision";
import { mcpContextRevision } from "../../shared/mcpContextEditing";
import { McpTranslationGuideInputSchema } from "../../shared/mcpTranslationGuide";
import {
  McpImageRouteInputSchema,
  selectMcpImageRoute,
} from "../../shared/mcpTranslationQuality";
import { inspectTranslationSavedQuality } from "./mcpTranslationQuality";

const steps = [
  {
    id: "detailed-default",
    tools: [
      "carrot_inspect_translation_source",
      "carrot_get_work_typography",
      "carrot_preview_work_typography",
      "carrot_apply_work_typography",
    ],
    instruction:
      "Default to meticulous translation and lettering unless the USER explicitly asks for quick processing. Existing user edits are a taste reference and a comparison floor, not human gold. Read whole-chapter context; work in chunks of at most 5 pages and persist inventory/progress in composite reports. Use meaning, comfortable readability, natural phrase breaks and spacing, then original expression as priorities. Korean dialogue starts with HORIZONTAL candidates independently of Japanese writing direction. Preserve deliberate vertical shouts/SFX with a reason. Compare 2–4 actual Korean font specimens per new expression family (use context for full sentences inside actual balloons); save a 3–6 core-font work palette with role, weight, specimen and reasons. Reuse it in later chapters; preserve user locks and justified special-effect exceptions. Do not repeatedly inspect satisfactory work.",
  },
  {
    id: "context",
    tools: ["carrot_get_work_context"],
    instruction:
      "Read saved rules, glossary, characters and previous chapter memory. Resolve speaker, honorific and terminology consistency. Finalize authorized context changes BEFORE preparing a composite; do not copy another work's names or lore.",
  },
  {
    id: "source",
    tools: [
      "carrot_get_page_preview",
      "carrot_get_page_crop",
      "carrot_get_page_blocks",
    ],
    instruction:
      "Read each original page once for BOTH meaning and lettering: identify the speaker, expression, visible glyph size/weight, writing direction and the usable space around each phrase. Plan a small chapter-wide font palette for dialogue, thought/narration, shouting, labels and SFX while reading; keep recurring styles consistent instead of inventing a style per block. Source direction describes the original writing, independently of Korean render direction. Inventory all text, including off-bubble writing and SFX; zero detector candidates never means no effects. Enlarge only ambiguous writing. OCR is a draft; do not invent unreadable text.",
  },
  {
    id: "physical-lettering-regions",
    tools: [
      "carrot_get_page_crop",
      "carrot_create_page_blocks",
      "carrot_update_page_blocks",
      "carrot_render_page_preview",
    ],
    instruction:
      "Identify physical lettering regions BEFORE choosing text boxes. Each lobe of a linked balloon is a separate usable region even when the same speaker continues one sentence. Split a short interjection and its following speech into their respective lobes; never span the narrow neck with one rectangular block, empty lines or inflated line spacing. Preserve every original phrase exactly once when splitting blocks through native creation/update tools. Source OCR columns are not Korean layout regions. Use horizontal Korean phrase groups inside the real contour; compare each line's visible ink against curved borders, necks, tails, hair and panel edges. A box inside the page and overflow=false do NOT certify balloon containment. Check returned image width/height and pixelMapping before using crop coordinates; image viewers may downscale further. Prefer a local crop of the full balloon with surrounding art when its contour is unclear, then inspect the final whole page at reading scale. Keep comfortable letter size by choosing natural wording and phrase breaks within each lobe, not by stretching the box over artwork or blindly shrinking. Paragraph-gap warnings require a physical-region check; waive only a genuinely intentional paragraph inside one visibly safe region. A tall/narrow multi-line paragraph is a contour-risk case even without overflow. After its LAST edit, retrieve a final crop containing the whole balloon plus surrounding art and inspect BOTH ends of EVERY line, especially the lowest lines where the contour tapers. The center of a text rectangle is not necessarily the center of usable balloon space. Move or reflow the paragraph into the actual interior; never acknowledge a contour warning based only on a small whole-page preview. This targeted crop check is part of the first final review, not an unnecessary extra pass. Then confirm comfortable size on the whole page. Fix observed defects locally and preserve satisfactory pages.",
  },
  {
    id: "plan",
    tools: ["carrot_prepare_composite", "carrot_prepare_workflow"],
    instruction:
      "Aim for one well-planned chapter pass and one final visual review. Decide wording and typography before writing; batch per-block choices across pages using the existing translation/format tools. Use qualityPolicy=complete-translation-v2 with existing composite/await-external contracts and fresh revisions. For direct tool editing, prepare a REVIEW-ONLY composite only AFTER all native saves, generated lettering, context and palette changes settle. A composite captures exact current revisions: preparing a review first and editing outside its bound phases makes that review stale. For a composite prepared before editing, bind/run the declared native or await-external workflow and acknowledge its current pages; do not edit outside it and then resume the old snapshot. Declare the work and final review actually needed; maxReviewPasses is a ceiling, NOT a target or an instruction to schedule repeated correction cycles. Only a specific observed defect justifies a targeted correction. Do not repeatedly generate, render or restyle satisfactory pages, or spend tool calls proving the same unchanged state.",
  },
  {
    id: "text-and-sfx",
    tools: [
      "carrot_preview_translation_batch",
      "carrot_create_page_blocks",
      "carrot_get_sound_effects",
      "carrot_prepare_sound_effect_batch",
    ],
    instruction:
      "Translate with chapter context. Preserve politeness, social hierarchy, sarcasm and character voice when rephrasing for fit; a shorter generic acknowledgment must not replace a formally deferential response just to avoid line breaks. Use native block creation for missed ordinary text; materialize detector/manual sound-effect regions with approved source and target text. Resolve every effect through translation, erasure and lettering; retain concrete unresolved reasons. Do not silently preserve Japanese SFX because translation was vaguely requested.",
  },
  {
    id: "images",
    tools: [
      "carrot_begin_image_upload",
      "carrot_write_image_upload",
      "carrot_finish_image_upload",
      "carrot_preview_external_image",
      "carrot_get_external_image_preview",
      "carrot_apply_external_image",
      "carrot_preview_image_edit",
      "carrot_generate_sound_effects",
      "carrot_run_page_erasure",
    ],
    instruction:
      "For artwork restoration, drawn text and SFX prefer the HOST image tool plus actual PNG byte delivery, then the configured app image controller, then local restoration/editable text. For app background restoration use carrot_run_page_erasure with engine=codex, blockId, allowExternalProcessing=true and expectedModel from get_sound_effects; omitting engine chooses local and is NOT the generative route. App lettering uses generate_sound_effects. Probe capabilities; never invent a model name, file handle or base64. Record per-region cumulative quality.imageHistory with hostAttempts/appAttempts, outcome and fallback reason; never drop prior attempts on correction or reconnect. Use exact-size region patches/protected masks; preserve surrounding art. Simple white bubbles may use native erasure. At most 4 generation attempts TOTAL per region across providers, calls and internal retries; pass prior attempts into app SFX generation. Policy refusal is terminal, not permission to switch providers.",
  },
  {
    id: "typography",
    tools: [
      "carrot_list_fonts",
      "carrot_get_font_samples",
      "carrot_preflight_typography",
      "carrot_run_typography_analysis",
      "carrot_preview_typography_batch",
      "carrot_apply_typography_batch",
      "carrot_preview_format_batch",
      "carrot_apply_format_batch",
    ],
    instruction:
      "Typeset as a manga letterer: preserve the original visual voice and make Korean comfortably readable at normal page-view scale. Keep dialogue editable. List fonts once, compare a few relevant samples once per style family, then explicitly apply the selected registered fontFamily, weight and per-block geometry in a chapter batch. Unset fontFamily is merely the app default, not a matched choice; there is no need for a different font in every block. Compare suitable weights as well as families: readability does not require maximum boldness. Preserve light motion versus heavy impact and restrained sarcasm versus shouting; a consistent palette must not flatten these expressive differences. fontSizePx is a nominal size in ORIGINAL IMAGE PIXELS, not browser UI pixels: an 18px font on a 1600px-tall page becomes about 9px when viewed at 800px tall. This illustrates scale, not a fixed minimum. Compare visible Korean glyphs with the original at the SAME scale, preserving emphasis and intentionally small asides. If source-size evidence would help, run one batched typography analysis and apply through preview/apply_typography_batch; measured face pixels are not fontSizePx. Do not hardcode a generic 18/20/22px palette or overwrite source matching with arbitrary manual sizes. For off-bubble text choose the usable clear region FIRST; retain a deliberate vertical composition or reflow horizontally without spreading onto faces, hair or panel borders. Fit phrase breaks and text density to that space; a tiny sentence floating in a large balloon is not good fitting. Do not solve overflow merely by shrinking all text or stretching a box across artwork. preserveManualFontSize=false is appropriate when the authorized task includes correcting those sizes; otherwise preserve the user's deliberate edits. Apply text, style and placement coherently, not as a chain of speculative tweaks.",
  },
  {
    id: "generated-hangul-repair",
    tools: [
      "carrot_get_sound_effect_candidates",
      "carrot_touchup_sound_effect_candidate",
      "carrot_prepare_lettering_batch",
      "carrot_verify_generated_lettering",
      "carrot_get_quality_evidence",
    ],
    instruction:
      "Small simple SFX may use sampled fonts. Large drawn/integrated SFX prioritize generated KOREAN LETTERING itself, not just erasing the source. Track background-restoration and korean-lettering purposes separately. Keep a correct retained candidate when only its placement or foreground geometry was rejected: prepare one candidateIds plan for all selected candidates from the same current page revision, inspect the proposed geometry and adjust native placement. Applying them together preserves revision protection without making their sibling candidates stale. Do not replace usable generated lettering with a font just because the first attempt needs a small repair. For wrong Hangul inspect retained failed candidates. DEFAULT: do not autonomously paint, erase strokes, move jamo or patch a generated image during a normal translation request. If a candidate is usable with a small manual repair, preserve its original pixels and confirmed wording, identify the page/block/candidate and defect, and leave it for user touchup instead of repeatedly attempting pixel repairs or replacing its style. Report this as pending manual repair, never as verified/completed lettering. Continue translation, readable typography and layout on the remaining content. Only perform the direct repair operations below when the user explicitly requests AI image touchup. Use the Unicode-derived targetStructure/letteringTargets components when repairing; a visual guess cannot change the approved initial, vowel or final consonant. A glyph that can be guessed is not necessarily well formed. Verify consonant strokes, vowel identity, final consonants and their relative positions separately; check detached initials, protruding or fused vowel stems and displaced finals. If the shape is intact but its position is wrong, use generated-touchup edits.moves:[{space,polygon,from,to}] to cut and move that part. Choose a tight freeform polygon that includes the entire intended stroke and excludes neighboring components; do not rely on a broad rectangle through adjacent ink. Normalize 0..1000 in asset/page space and map composed-crop locations through inspectionGeometry. Moves carry previous paint/masks, preserve the original PNG, and run before new strokes in the same edit. Repair missing/joined/extra strokes with native brushes. Both paths require exact asset SHA and current page revision. A candidate has at most two touchup passes; save only through explicit native plans. For a structurally broken syllable, use external lettering patch.rect in ASSET pixels to replace that region while preserving other pixels and decorations. Otherwise revise directions.creativeBrief/correctionInstruction, supply previousCandidateId and optionally glyphGuideFontId. Generate one candidate per call by default to allow repair; at most INITIAL + THREE revised attempts total per region across providers. Independent verification must read COMPOSED pixels after part moves, masks, paint, outline, transforms and occlusion, including imported assets. Require BOTH exact text readback and a valid version-2 shape review with all four component checks; missing, uncertain or failed checks block completion. Do not repeat verification on unchanged pixels to fish for a pass. A repair must visibly improve the reported defect before reinspection. Finish with final page inspection. If attempts fail, compare appropriate font specimens, complete readable editable lettering and disclose page/effect substitutions. Do not keep trying an unchanged prompt or claim corrected glyphs from the raw pre-touchup asset.",
  },
  {
    id: "detailed-completion",
    tools: ["carrot_render_page_preview", "carrot_submit_composite_review"],
    instruction:
      "Use complete-translation-v2. Record quality.detailed with full-page sourceEvidenceId, unique inventory entries (sourceRect ORIGINAL pixels, role, saved block, treatment, restoration, reason), selected fontEvidence specimen IDs, current paletteRevision and layoutReviewed=true. Link each generated item to fresh glyphEvidenceId. Inventory every source writing, including no-detector SFX. Call render_page_preview includeLayout=true; its actual em size, sampled Hangul ink bounds, lines, text scales and crop mapping are measurements, not stored nominal sizes. At normal reading scale review tiny text even if overflow=false. Resolve isolated endings/particles, punctuation-only lines, awkward name splits, sparse large balloons and art collisions. Rephrase without changing meaning, reflow, choose the usable bubble area and adjust spacing before shrinking. Never expand through faces or panel borders. Record intentional exceptions by block and reason; unresolved misspellings, clipping and omissions cannot be accepted. Submit current retrieved composite renders; stale fonts/palette/page or missing source/specimen/glyph receipts block acceptance. Quick mode is explicitly uncertified. After all chunks, call carrot_get_translation_guide once for the entire requested chapter. Its completion must cover every page at current revisions; a saved/exported page or the last completed chunk cannot stand in for a missing review. Resolve only pending/stale pages and disclose any incomplete scope. Missing completion evidence is not acceptance. Server receipts prove observable work, not aesthetic or professional quality.",
  },
  {
    id: "review",
    tools: [
      "carrot_accept_workflow_external",
      "carrot_get_composite_review_image",
      "carrot_submit_composite_review",
      "carrot_render_page_preview",
    ],
    instruction:
      "After native saves settle, acknowledge waiting external pages at CURRENT revisions and resume. Inspect each final rendered page once at normal reading scale beside its original; zoom only suspicious details. Ask whether the dialogue reads effortlessly, emphasis survives and lettering belongs in the artwork. Check generated glyphs against the approved wording. A successful save, reviewStatus=reviewed, overflow=false or readable zoomed crop does not answer those visual questions. Submit assessments tied to the actual images. If a specific defect remains, identify its cause and change only the affected text/style/placement, then inspect the changed result; do not rerun the chapter or repeat unchanged calls. Stop when the result is good, not after a prescribed number of passes. Unresolved issues remain partial completion. Poll asynchronous jobs to terminal without starting duplicate work.",
  },
];

export async function getTranslationGuide(
  library: McpLibraryReadPort,
  input: z.infer<typeof McpTranslationGuideInputSchema>,
  visibleTools: readonly string[],
  guard: () => void,
) {
  guard();
  const saved = await library.readContext?.(input.chapterId);
  const chapter =
    saved?.chapter ?? (await library.openChapter(input.chapterId));
  const index = await library.listLibrary();
  guard();
  const selected = new Set(
    input.pageIds ?? chapter.pages.map((page) => page.id),
  );
  const pages = chapter.pages.filter((page) => selected.has(page.id));
  if (
    chapter.id !== input.chapterId ||
    pages.length !== selected.size ||
    pages.length > 50
  )
    throw new McpEditError(
      "invalid_edit",
      "Select at most 50 existing pages in the identified chapter; no silent truncation.",
    );
  const work = index.works.find((item) => item.id === chapter.workId);
  const previousChapterId = previousChapter(
    work?.chapterOrder ?? [],
    chapter.id,
  );
  const available = new Set(visibleTools);
  const capabilities = McpImageRouteInputSchema.parse(
    input.imageCapabilities ?? {},
  );
  const required = [...new Set(steps.flatMap((step) => step.tools))];
  return {
    chapterId: chapter.id,
    workId: chapter.workId,
    chapterPageCount: chapter.pages.length,
    previousChapterId,
    context: contextSummary(saved),
    pages: pages.map(guidePage),
    ...qualityGuide(input.mode),
    maxReviewPasses: 3 as const,
    imageRoute: availableImageRoute(capabilities, available),
    capabilityOrigin:
      "mcp-tools-server-observed; image-capabilities-host-reported" as const,
    availableTools: required.filter((name) => available.has(name)),
    missingTools: required.filter((name) => !available.has(name)),
    steps: (input.mode === "quick" ? quickSteps() : steps).map((step) => ({
      ...step,
      tools: step.tools.filter((name) => available.has(name)),
    })),
    modelStarted: false as const,
    qualityVerified: false as const,
  };
}

function contextSummary(saved: McpContextSnapshot | undefined) {
  return {
    revision: saved ? mcpContextRevision(saved) : null,
    glossaryEntries:
      saved?.styleGuide.glossary.filter((item) => item.enabled).length ?? 0,
    characters:
      saved?.styleGuide.characters.filter((item) => item.enabled).length ?? 0,
    memoryPages: saved?.storyMemory.pages.length ?? 0,
    state: saved ? ("available" as const) : ("unavailable" as const),
  };
}
function guidePage(page: MangaPage) {
  return {
    pageId: page.id,
    revision: createPageRevision(page),
    reviewRevision: createSoundEffectReviewPageRevision(page),
    width: page.width,
    height: page.height,
    blocks: page.blocks.length,
    explicitFonts: page.blocks.filter((block) => block.fontFamily).length,
    savedQuality: inspectTranslationSavedQuality(page),
    requiresVisualSourceInspection: true as const,
  };
}

function previousChapter(order: string[], chapterId: string) {
  const index = order.indexOf(chapterId);
  return index > 0 ? order[index - 1] : null;
}

function availableImageRoute(
  capabilities: ReturnType<typeof McpImageRouteInputSchema.parse>,
  tools: Set<string>,
) {
  const imageTools = [
    "carrot_begin_image_upload",
    "carrot_write_image_upload",
    "carrot_finish_image_upload",
    "carrot_preview_external_image",
    "carrot_apply_external_image",
  ];
  const scoped = { ...capabilities };
  if (!imageTools.every((name) => tools.has(name)))
    scoped.hostFileTransfer = "unavailable";
  if (
    !tools.has("carrot_generate_sound_effects") &&
    !tools.has("carrot_run_page_erasure")
  )
    scoped.appGeneration = "unavailable";
  return selectMcpImageRoute(scoped);
}

function quickSteps() {
  return [
    {
      id: "quick-explicit",
      tools: [],
      instruction:
        "User explicitly requested quick processing. Use mode=quick without a qualityPolicy. Translate all requested text and disclose omissions; do not label the result detailed-review-complete. Source accuracy and preserving original artwork still apply.",
    },
    ...steps.filter((step) =>
      ["context", "source", "text-and-sfx", "images"].includes(step.id),
    ),
    {
      id: "quick-review",
      tools: ["carrot_render_page_preview"],
      instruction:
        "Inspect final saved pages at normal reading scale. Fix observed omissions, overlap and unreadable text. Report unresolved items and state that the explicitly requested quick result has not passed detailed evidence review.",
    },
  ];
}

function qualityGuide(mode: "detailed" | "quick" | undefined) {
  return {
    completionCriteria:
      mode === "quick"
        ? [
            "Requested text and effects processed with explicit omissions and unresolved items.",
            "Inspect the saved page for source preservation, readability and overlap; quick results are not detailed-review-complete.",
          ]
        : [
            "Every original page visually inspected, including unrecognized/off-bubble text.",
            "All dialogue and sound effects translated, erased and typeset, or explicitly unresolved.",
            "Fresh retrieved native render evidence plus every page quality assessment; host visual judgment is not server certification.",
            "No unresolved blocking checks. Aim to pass the first final review; only observed defects warrant targeted corrections within the existing review ceiling.",
            "No generated image is accepted from a filename; validate actual PNG bytes and final transformed rendering.",
          ],
    qualityPolicy:
      mode === "quick" ? null : ("complete-translation-v2" as const),
    mode: mode ?? "detailed",
    recommendedChunkPages: 5 as const,
    requiredEvidence:
      mode === "quick"
        ? []
        : [
            "whole-original-source-receipt-and-item-inventory",
            "actual-font-specimens-and-current-work-palette",
            "current-native-page-render-with-layout",
            "independent-composed-generated-glyph-readback",
            "lettering-generation-versus-background-restoration-history",
            "explicit-font-substitutions-and-no-unresolved-items",
          ],
  };
}
