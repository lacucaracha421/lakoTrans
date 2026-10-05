import type { KoharuTypographySegmentation } from "../bubbleLayout/contracts";
import type {
  InpaintingWindowMask,
  InpaintingEngine,
} from "./inpaintingEngine";
import type { MangaPage } from "../../shared/libraryTypes";
import type { PatternSourceGlyphResidualDiagnostic } from "./sourceGlyphResidual";
import type { PatternSourceGlyphEvidenceReceipt } from "./sourceGlyphEvidenceReceipt";

export type PatternPageInpaintingResult = {
  page: MangaPage;
  blocksErased: number;
  blocksIncomplete?: number;
  erasedBlockIds?: string[];
  incompleteBlockIds?: string[];
  residualDiagnostics?: PatternSourceGlyphResidualDiagnostic[];
  sourceEvidenceReceipt?: PatternSourceGlyphEvidenceReceipt;
};

export type ImageDecodeFallback = (filePath: string) => Promise<Buffer | null>;

export type PatternPageInpaintingOptions = {
  blockId?: string;
  /** Explicit batch selection. Selected excluded blocks become eligible. */
  blockIds?: readonly string[];
  signal?: AbortSignal;
  decodeFallback?: ImageDecodeFallback;
  inpaintingEngine?: InpaintingEngine;
  /** Accept only current zero-padding prepass or allowlisted manual geometry. */
  bubbleLayoutConstraintBlockIds?: readonly string[];
  /** Block ids already committed by an earlier partial page run. */
  excludedBlockIds?: readonly string[];
  sharedInpaintGroupIdsByBlock?: Readonly<Record<string, readonly string[]>>;
  typographySegmentation?: KoharuTypographySegmentation;
  sourceEraseConstraintsByBlock?: Readonly<
    Record<string, InpaintingWindowMask>
  >;
  /** Production stays disabled; sealed QA/offline evidence opts in. */
  sourceEvidenceMode?: "disabled" | "required";
  /** Add this pass to the currently stored cleaned page instead of restarting. */
  preserveExistingInpainting?: boolean;
};
