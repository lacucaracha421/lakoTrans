import type { PageExportLayoutEvidence } from "../../shared/pageExportContracts";
import { segmentNaturalTextEojeols } from "../../shared/naturalTextLayoutSegmentation";
import type { getTranslationGuide } from "../application/mcpTranslationGuide";

/** Presentation only: client-supplied labels never change scopes, tools or quality gates. */
export function usesOtherClientGuidance(name: string | undefined): boolean {
  return (
    Boolean(name?.trim()) &&
    !/chatgpt|codex|openai|claude|anthropic/i.test(name ?? "")
  );
}

export const OTHER_CLIENT_TRANSLATION_GUIDANCE = [
  "These are strong DEFAULT working guidelines, not restrictions on MCP editing tools. Specific user instructions take precedence over this style guidance. Keep the LLM responsible for translation and composition: use native measurements as evidence, compare alternatives and choose the better actual render. Do not request permission for routine edits or force every page through one preset. Default to meticulous complete-translation-v2 unless the user chooses otherwise. Work in small page batches and preserve successful work.",
  "1. Read the originals and chapter context. Inventory each physical balloon/lobe, narration, aside and label. Preserve meaning and voice; breathing/interjections need natural Korean, not phonetic copying of Japanese kana. Other clients default to preserving original SFX; include them when the user requests it by setting soundEffectScope=translate. SourceRect covers original letters including furigana, not the Korean writing region. Map crops through pixelMapping rather than viewer size.",
  "2. Prefer native typography analysis to guessed pixel sizes. Inspect source-size results and apply useful matches through preview/apply_typography_batch before changing the same pages again. A stale proposal must be refreshed. Compare 2–4 real font specimens for a new role and reuse the work palette, including weight. Source matching is a starting point: adjust for readable Korean and expression, preserve deliberate user choices, and avoid a generic small-font palette.",
  "3. Read the existing blocks first and typeset in their saved writing regions. Do not send renderRect while changing wording, font, size or line breaks: omitting it preserves the current position. Do not replace an existing correct position with a visual coordinate guess. For ordinary closed balloons missing usable geometry start with prepare_lettering_batch kind=layout, mode=geometry, policy=safe. Inspect the proposal and apply it when it matches the real balloon. Geometry-only avoids importing unwanted word splits. Start with horizontal Korean, wordBreak=keep-all and natural phrase groups. Keep correct detected geometry while adjusting text and typography. If detection is wrong, compare a manually placed alternative; allowDetectedLayoutOverride=true is available for that correction or a user's preferred placement. Off-balloon writing and deliberate vertical/rotated expression remain valid choices. Do not discard useful geometry merely to make letters bigger, but never treat detector output as the answer by definition.",
  "4. Erase source lettering with the configured engine and compare omitText=true with the original. Remaining kana, gray patches and damaged borders are separate defects. Repair only the verified failed area with protected artwork; inspect the mask and result. Avoid broad white patches, painting over borders or hiding remnants under Korean text. If a repair cannot be verified, preserve the candidate and report the specific remaining problem.",
  "5. Render with includeLayout=true and use its actual sizes, lines, sampled glyph ink and shapeFlow. contained means native shape slots were used, not that the real contour was correctly detected. unverified means inspect the image; it does not prohibit the placement. The API does NOT provide per-line ink coordinates. Compare the whole balloon crop and the full page: size, weight, whitespace, word endings, both paragraph edges, artwork and erasure. Change wording, line breaks, spacing, font or position based on the actual defect, then inspect the changed result. Do not solve every problem by shrinking. An intentional user-requested composition may differ from the default; describe it honestly rather than calling it a detected defect or silently undoing it.",
  "6. Finish the existing review at current saved revisions after text, layout and palette changes settle. Do not use a generic intentional-style explanation to dismiss a defect you can still see. Preserve user-directed exceptions and distinguish them from accidental omissions, clipping or restoration damage. Use the existing manual workflow when the user wants a result outside precise-review criteria; keep inspecting the result and disclose the scope, without pretending it passed criteria that were not met. This is not permission to downgrade an ordinary translation request because the model found it difficult.",
  "7. Pass tool arguments as top-level JSON objects, not strings inside value/input. Correct the specific reported field after an error instead of repeating it. Read the final whole-scope guide and report the actual completion state, remaining issues and any user-directed departures. Do not repeat paid generation or unchanged inspections to fish for a pass.",
].join("\n\n");

/** Put the existing layout tools in the ordinary-dialogue step, not only the SFX step. */
export function otherClientTranslationSteps(
  steps: Awaited<ReturnType<typeof getTranslationGuide>>["steps"],
) {
  return steps.map((step) => {
    if (step.id !== "physical-lettering-regions") return step;
    return {
      ...step,
      instruction:
        "Default ordinary-balloon workflow: read existing blocks and KEEP their correct saved writing regions. For translation/font/size/line-break edits, send fields only and OMIT renderRect; never recalculate the position merely because you are restyling. Create blocks only for genuinely missing source text. For balloons without a usable writing region, prepare ONE lettering batch for the chunk with command={kind:layout,mode:geometry,policy:safe,locale:ko}. This existing tool handles DIALOGUE too, even when SFX are excluded. Poll the job, get_lettering_batch, inspect the proposed balloon geometry and apply the useful proposal before choosing final line breaks/sizes. Do not spend repeated crop calls guessing coordinates when a native proposal can establish the interior. Detection is a candidate, not a verdict: correct bad regions manually with allowDetectedLayoutOverride=true; preserve explicit user placement. Source letter columns are not usable Korean balloon space. Split linked lobes and keep small characters/hair outside the writing area. Use horizontal Korean phrase groups and keep-all; compare source-scale lettering before inventing small fixed sizes. Batch planned edits across blocks, inspect the whole saved page, and crop only unresolved regions. Compare BOTH ends of every line with the real balloon; overflow=false and shapeFlow=contained do not prove visual containment. Fix the observed defect, then inspect only changed pages. Reuse already legible source crops and font specimens; do not reread unchanged regions. User instructions override these defaults; no tool choice is prohibited.",
      tools: [
        "carrot_get_page_blocks",
        "carrot_create_page_blocks",
        "carrot_prepare_lettering_batch",
        "carrot_get_job",
        "carrot_get_lettering_batch",
        "carrot_apply_lettering_batch",
        "carrot_update_page_blocks",
        "carrot_render_page_preview",
      ],
    };
  });
}

/** Diagnostic only; never adjusts text, fonts, geometry or common review acceptance. */
export function otherClientLayoutWarnings(
  clientName: string | undefined,
  layout: PageExportLayoutEvidence | undefined,
) {
  if (!usesOtherClientGuidance(clientName)) return [];
  return (layout ?? []).flatMap((item) => {
    if (item.rendered !== "text" || item.direction !== "horizontal") return [];
    const words = splitWords(item.displayText, item.lines);
    return words.length
      ? [
          {
            blockId: item.blockId,
            reasons: [
              `korean-word-split-across-lines: ${words.map((word) => JSON.stringify(word)).join(", ")}. Reflow at spaces or explicit phrase breaks; do not use character wrapping to conceal overflow. Preserve comfortable reading size and the detected balloon geometry.`,
            ],
          },
        ]
      : [];
  });
}

function splitWords(text: string | undefined, lines: string[] | null) {
  if (!text || !lines || lines.length < 2) return [];
  const units = segmentNaturalTextEojeols(text);
  const words = new Set<string>();
  let offset = 0;
  for (const line of lines) {
    const fragment = line.trim();
    if (!fragment) continue;
    const start = text.indexOf(fragment, offset);
    if (start < 0 || text.slice(offset, start).trim()) return [];
    offset = start + fragment.length;
    if (!/^[가-힣]{2}$/u.test(text.slice(offset - 1, offset + 1))) continue;
    const unit = units.find(
      (word) =>
        word.index < offset && offset < word.index + word.segment.length,
    );
    if (unit && unit.segment.length <= 80) words.add(unit.segment);
  }
  return text.slice(offset).trim() ? [] : [...words].slice(0, 6);
}
