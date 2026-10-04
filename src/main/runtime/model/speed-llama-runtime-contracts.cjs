// @ts-check

// llama.cpp v0.5.0 and its official binary tag b11146 resolve to the same
// commit. Keep CUDA 12.4 for older NVIDIA GPUs/drivers; CUDA 13.4 is a
// separate profile. New immutable directories never replace cached binaries.
const SPEED_LLAMA_RUNTIME_CUDA12 = {
  id: "llama-b11146-cuda12.4",
  kind: "mainline",
  backend: "cuda",
  dir: "llama-b11146-cuda12.4",
  archive: "llama-b11146-bin-win-cuda-12.4-x64.zip",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-cuda-12.4-x64.zip",
  archives: [
    {
      archive: "llama-b11146-bin-win-cuda-12.4-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-cuda-12.4-x64.zip",
      sha256:
        "3c806a6ceccc3dae1c743ceb1a1fb2cce5b76f40bfbd4c6b7b8afb6ef45a5807",
      expectedBytes: 253869799,
    },
    {
      archive: "cudart-llama-bin-win-cuda-12.4-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/cudart-llama-bin-win-cuda-12.4-x64.zip",
      sha256:
        "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
      expectedBytes: 391443627,
    },
  ],
  requiredFiles: [
    "llama-server.exe",
    "llama-server-impl.dll",
    ["ggml-cuda.dll", "ggml-cuda-cu12.dll"],
    ["cublas64_12.dll"],
    ["cublasLt64_12.dll"],
    ["cudart64_12.dll"],
  ],
};

const SPEED_LLAMA_RUNTIME_CUDA13 = {
  id: "llama-b11146-cuda13.4",
  kind: "mainline",
  backend: "cuda",
  dir: "llama-b11146-cuda13.4",
  archive: "llama-b11146-bin-win-cuda-13.4-x64.zip",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-cuda-13.4-x64.zip",
  archives: [
    {
      archive: "llama-b11146-bin-win-cuda-13.4-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-cuda-13.4-x64.zip",
      sha256:
        "b1866c0ce76bc7bfb0c24b33e9a37e9669f1be18539b12c74ce361f81c41f047",
      expectedBytes: 149758833,
    },
    {
      archive: "cudart-llama-bin-win-cuda-13.4-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/cudart-llama-bin-win-cuda-13.4-x64.zip",
      sha256:
        "738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668",
      expectedBytes: 423535356,
    },
  ],
  requiredFiles: [
    "llama-server.exe",
    "llama-server-impl.dll",
    ["ggml-cuda.dll", "ggml-cuda-cu13.dll"],
    ["cublas64_13.dll", "cublas64_12.dll"],
    ["cublasLt64_13.dll", "cublasLt64_12.dll"],
    ["cudart64_13.dll", "cudart64_12.dll"],
  ],
};

const SPEED_LLAMA_RUNTIME_VULKAN = {
  id: "llama-b11146-vulkan",
  kind: "mainline",
  backend: "vulkan",
  dir: "llama-b11146-vulkan",
  archive: "llama-b11146-bin-win-vulkan-x64.zip",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-vulkan-x64.zip",
  archives: [
    {
      archive: "llama-b11146-bin-win-vulkan-x64.zip",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-vulkan-x64.zip",
      sha256:
        "55a378aa095b466979d85075234f66d7655c7a7483222af0c006c0e55b4d7bd6",
      expectedBytes: 32127004,
    },
  ],
  requiredFiles: [
    "llama-server.exe",
    "llama-server-impl.dll",
    ["ggml-vulkan.dll", "libggml-vulkan.so"],
  ],
};

const SPEED_LLAMA_RUNTIME_METAL_ARM64 = {
  id: "llama-b11146-metal-arm64",
  kind: "mainline-metal",
  backend: "metal",
  platform: "darwin",
  arch: "arm64",
  dir: "llama-b11146-metal-arm64",
  archive: "llama-b11146-bin-macos-arm64.tar.gz",
  url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-macos-arm64.tar.gz",
  archives: [
    {
      archive: "llama-b11146-bin-macos-arm64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-macos-arm64.tar.gz",
      sha256:
        "1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711",
      expectedBytes: 11189714,
      type: "tar.gz",
      stripComponents: 1,
    },
  ],
  requiredFiles: [
    "llama-server",
    ["libggml.dylib", "libggml-base.dylib"],
    ["libggml-metal.dylib", "libggml-metal.0.dylib"],
    ["libllama.dylib", "libllama.0.dylib"],
  ],
};

module.exports = {
  SPEED_LLAMA_RUNTIME_CUDA12,
  SPEED_LLAMA_RUNTIME_CUDA13,
  SPEED_LLAMA_RUNTIME_METAL_ARM64,
  SPEED_LLAMA_RUNTIME_VULKAN,
};
