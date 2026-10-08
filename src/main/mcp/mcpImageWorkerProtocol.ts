import type { McpImageUploadBegin } from "../../shared/mcpImageUploads";

export type McpExternalRasterInput = {
  image: Uint8Array;
  mask?: Uint8Array;
  protectedMask?: Uint8Array;
  width: number;
  height: number;
  letteringPatch?: {
    base: Uint8Array;
    rect: { x: number; y: number; w: number; h: number };
  };
};
type McpExternalRasterStats = {
  mask: Uint8Array;
  width: number;
  height: number;
  selectedPixels: number;
  protectedPixels: number;
  changedPixels: number;
};
export type McpImageOperations = {
  validate: {
    input: {
      path: string;
      declared: Pick<
        McpImageUploadBegin,
        "bytes" | "sha256" | "width" | "height" | "purpose"
      >;
    };
    output: { hasTransparency: boolean; selectedPixels: number | null };
  };
  lettering: {
    input: McpExternalRasterInput;
    output: McpExternalRasterStats & { bytes: Uint8Array };
  };
  background: {
    input: McpExternalRasterInput & {
      pageWidth: number;
      pageHeight: number;
      rect: { x: number; y: number; w: number; h: number };
      before: Uint8Array;
      pixels: Uint8Array;
    };
    output: McpExternalRasterStats & { bitmap: Uint8Array };
  };
};
export type McpImageOperation = keyof McpImageOperations;
export type McpImageWorkerRequest = {
  [K in McpImageOperation]: {
    id: number;
    kind: K;
    input: McpImageOperations[K]["input"];
  };
}[McpImageOperation];
export type McpImageWorkerResponse =
  | {
      [K in McpImageOperation]: {
        id: number;
        kind: K;
        result: McpImageOperations[K]["output"];
      };
    }[McpImageOperation]
  | {
      id: number;
      error: {
        name: string;
        message: string;
        code?: "revision_conflict" | "invalid_edit";
      };
    };
export interface McpImageProcessingPort {
  run<K extends McpImageOperation>(
    kind: K,
    input: McpImageOperations[K]["input"],
    guard: () => void,
  ): Promise<McpImageOperations[K]["output"]>;
}
