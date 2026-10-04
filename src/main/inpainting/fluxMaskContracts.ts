import type { InpaintingWindowMask } from "./inpaintingEngine";

type FluxMaskOptions = {
  compositeConstraints?: Array<InpaintingWindowMask | null>;
  compositeFeatherPx?: number[];
  compositeMasks?: InpaintingWindowMask[];
  windowMasks?: InpaintingWindowMask[];
  speechBubbleWindows?: boolean[];
};

export function assertFluxMaskContracts(options: {
  isolateWindowMasks: boolean;
  runOptions: FluxMaskOptions;
  windowCount: number;
}): void {
  const { isolateWindowMasks, runOptions, windowCount } = options;
  const alignedMetadata = [
    [
      isolateWindowMasks ? runOptions.windowMasks : undefined,
      "Block-owned mask",
    ],
    [runOptions.compositeMasks, "Composite mask"],
    [runOptions.speechBubbleWindows, "Speech bubble hint"],
  ] as const;
  for (const [values, label] of alignedMetadata) {
    if (values && values.length !== windowCount) {
      throw new Error(`${label} count does not match Flux window count.`);
    }
  }
  if (!runOptions.compositeConstraints) return;
  if (
    runOptions.compositeConstraints.length !== windowCount ||
    runOptions.windowMasks?.length !== windowCount ||
    (runOptions.compositeFeatherPx !== undefined &&
      runOptions.compositeFeatherPx.length !== windowCount)
  ) {
    throw new Error(
      "Composite constraint count does not match Flux window count.",
    );
  }
}
