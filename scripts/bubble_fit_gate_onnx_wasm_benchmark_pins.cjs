"use strict";

const BUBBLE_FIT_GATE_BENCHMARK_RUNTIME_PINS = Object.freeze({
  packageName: "onnxruntime-web",
  packageVersion: "1.30.0",
  entry: Object.freeze({
    file: "ort.node.min.js",
    sha256: "f2ffa91920b249103bbfeb58a1a9b68bf92e9e9018bd164dc16da52bd14ee305",
    sizeBytes: 27160,
  }),
  wasmModule: Object.freeze({
    file: "ort-wasm-simd-threaded.mjs",
    sha256: "e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b",
    sizeBytes: 24381,
  }),
  wasmBinary: Object.freeze({
    file: "ort-wasm-simd-threaded.wasm",
    sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2",
    sizeBytes: 14239897,
  }),
});

module.exports = { BUBBLE_FIT_GATE_BENCHMARK_RUNTIME_PINS };
