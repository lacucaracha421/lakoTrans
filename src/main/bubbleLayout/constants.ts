/**
 * Production page-layout model. This replaces the legacy comic RT-DETR
 * detector completely; there is no legacy-model fallback path.
 */
export const KOHARU_LAYOUT_ONNX_REPO =
  "ShiniShiho/koharu-layout-rfdetr-seg-2xl-1152-onnx";
export const KOHARU_LAYOUT_ONNX_REVISION =
  "bfbbd4e5ab34a50459865074fa044da496cebb57";
export const KOHARU_LAYOUT_ONNX_FILE = "rfdetr-seg-2xlarge.onnx";
export const KOHARU_LAYOUT_ONNX_SHA256 =
  "7cc10d4316371946b8441da3512261a8e148b129abcdb0ea6235ed1d1d06d351";
export const KOHARU_LAYOUT_ONNX_BYTES = 148_442_003;
export const KOHARU_LAYOUT_INPUT_SIZE = 1152;
export const KOHARU_LAYOUT_QUERY_COUNT = 300;
export const KOHARU_LAYOUT_MASK_SIZE = 288;

export const KOHARU_LAYOUT_LABELS = [
  "text",
  "onomatopoeia",
  "bubble",
  "panel",
] as const;

/** Per-class thresholds published with the pinned KoharuLayout model. */
export const KOHARU_LAYOUT_SCORE_THRESHOLDS = [0.25, 0.2, 0.5, 0.5] as const;

/**
 * The font pixel-inference runtime and the macOS-safe bubble detector consume
 * the same sealed ORT-Web assets. Keep the published hashes shared so both
 * runtime paths reject a partial or substituted package.
 */
export const ONNXRUNTIME_WEB_VERSION = "1.30.0";
export const ONNXRUNTIME_WEB_WASM_MODULE_FILE = "ort-wasm-simd-threaded.mjs";
export const ONNXRUNTIME_WEB_WASM_MODULE_SHA256 =
  "e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b";
export const ONNXRUNTIME_WEB_WASM_MODULE_BYTES = 24_381;
export const ONNXRUNTIME_WEB_WASM_BINARY_FILE = "ort-wasm-simd-threaded.wasm";
export const ONNXRUNTIME_WEB_WASM_BINARY_SHA256 =
  "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2";
export const ONNXRUNTIME_WEB_WASM_BINARY_BYTES = 14_239_897;
