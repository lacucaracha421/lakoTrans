export type LetteringMaskStroke = {
  space: "asset" | "page";
  mode: "hide" | "restore";
  shape: "circle" | "square";
  points: { x: number; y: number }[];
  radiusX: number;
  radiusY: number;
  softness: number;
};
export type LetteringTool = {
  blockId: string | null;
  space: LetteringMaskStroke["space"];
  mode: LetteringMaskStroke["mode"] | "paint" | "move";
  selectionShape?: "lasso" | "rectangle";
  color?: string;
  shape: LetteringMaskStroke["shape"];
  size: number;
  softness: number;
  showMask: boolean;
};

export type LetteringPaintStroke = Omit<
  LetteringMaskStroke,
  "mode" | "space"
> & {
  color: string;
};

/** Cut and translate the selected composed pixels, before the final outline/warp. */
export type LetteringPartMove = {
  polygon: { x: number; y: number }[];
  offset: { x: number; y: number };
  /** Brush prefixes already present when this move was made. Page masks are excluded. */
  paintCount: number;
  maskCount: number;
};
