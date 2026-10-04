import { join } from "node:path";

export const FLUX_RUNTIME_EXECUTABLE =
  process.platform === "win32" ? "mgt-flux-klein.exe" : "mgt-flux-klein";

export const FLUX_MODEL_REPO = "unsloth/FLUX.2-klein-4B-GGUF";

export const FLUX_MODEL_REVISION = "8342a6a97b2d18acae5d62124735c39ba23060e2";

export const FLUX_MODEL_FILE = "flux-2-klein-4b-Q4_K_M.gguf";

export const FLUX_MODEL_SHA256 =
  "0b25d143c8469b342bc5af3bce92b783bf6b0636d285f7b2f75e38af63af9a15";

export const FLUX_VAE_REPO = "black-forest-labs/FLUX.2-small-decoder";

export const FLUX_VAE_REVISION = "a3efc24f613ef42d9428af62fdbd6f5fd8856c4a";

export const FLUX_VAE_FILE = "full_encoder_small_decoder.safetensors";

export const FLUX_VAE_SHA256 =
  "ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62";

export const FLUX_RUNNER_DIR = "mgt-flux-klein";

const FLUX_CPU_RUNNER_CACHE_VERSION = "koharu-0.83.5-r1";
export const FLUX_CPU_RUNNER_DIR = `mgt-flux-klein-cpu-${FLUX_CPU_RUNNER_CACHE_VERSION}`;
export const FLUX_CPU_RUNTIME_EXECUTABLE = "mgt-flux-klein-cpu.exe";

export const FLUX_CPU_RUNNER_RELEASE_TAG = "koharu-native-0.83.5-win-x64-r1";
export const FLUX_CPU_RUNNER_ASSET_FILE =
  "mgt-flux-klein-cpu-0.83.5-win-x64.zip";
export const FLUX_CPU_RUNNER_BASE_URL = `https://github.com/ucx0204/CarrotMangaTranslator/releases/download/${FLUX_CPU_RUNNER_RELEASE_TAG}`;
export const FLUX_CPU_RUNNER_ARCHIVE_SHA256 =
  "1aff35d63b44397b53168225495463315f4981877c157a54b99d6fb35235229e";
export const FLUX_CPU_RUNNER_ARCHIVE_BYTES = 3244240;
export const FLUX_CPU_RUNNER_EXECUTABLE_SHA256 =
  "69cf265709f7093c4cf463dbb6ac15e299631e976254b6ab137f341cd020e773";
export const FLUX_CPU_RUNNER_EXECUTABLE_BYTES = 8440832;
export const FLUX_CPU_RUNNER_MARKER = ".mgt-flux-cpu-runner.json";

const FLUX_NVIDIA_RUNNER_RELEASE_TAG = "koharu-native-0.83.5-win-x64-r1";

export const FLUX_NVIDIA_RUNNER_BASE_URL = `https://github.com/ucx0204/CarrotMangaTranslator/releases/download/${FLUX_NVIDIA_RUNNER_RELEASE_TAG}`;

export const FLUX_NVIDIA_RUNNER_MARKER = ".mgt-flux-runner.json";

// GPU kernels now live in the native runtime; all supported GPUs share one runner.
export const FLUX_NVIDIA_RUNNER_ASSETS = {
  "75": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
  "80": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
  "86": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
  "89": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
  "90": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
  "120": {
    fileName: "mgt-flux-klein-native-0.83.5-win-x64.zip",
    sha256: "7977e384dc8882d88eb687e516f3ad6036f3e4d14e406a2624e6ce0eb35505a3",
  },
} as const;

export const FLUX_CUDA_RUNTIME_DIR = "mgt-flux-cuda12.9";

export const FLUX_ZLUDA_SUPPORT_RUNTIME_DIR = "mgt-flux-zluda-support";

export const FLUX_CUDA_RUNTIME_MARKER = ".mgt-runtime.json";

export const FLUX_PYTHON_WORKER = "flux-klein-python-worker.py";

export const FLUX_SDCPP_WORKER = "flux-klein-sdcpp-worker.py";

export const FLUX_PYTHON_RUNTIME_MARKER = ".mgt-flux-python-runtime.json";

export const FLUX_ROCM_PREBUILT_RUNTIME_SCHEMA = 1;

export const WINDOWS_MSVC_COMPILER_TARGET = "x86_64-pc-windows-msvc";

export const WINDOWS_DYNAMIC_RUNTIME_LIB_NAMES = [
  "msvcrt.lib",
  "msvcprt.lib",
  "vcruntime.lib",
  "ucrt.lib",
  "oldnames.lib",
];

export const DEFAULT_AMD_GPU_TARGETS = [
  // Keep this in sync with scripts/build-flux-rocm-runtime.cjs. ROCm/HIP wants
  // concrete LLVM targets here, not grouped labels such as "gfx110X".
  "gfx908",
  "gfx90a",
  "gfx1030",
  "gfx1031",
  "gfx1032",
  "gfx1033",
  "gfx1034",
  "gfx1035",
  "gfx1036",
  "gfx1100",
  "gfx1101",
  "gfx1102",
  "gfx1103",
  "gfx1150",
  "gfx1151",
  "gfx1152",
  "gfx1153",
  "gfx1200",
  "gfx1201",
];

export const WINDOWS_SYSTEM_IMPORT_LIB_NAMES = [
  "kernel32.lib",
  "user32.lib",
  "gdi32.lib",
  "winspool.lib",
  "shell32.lib",
  "ole32.lib",
  "oleaut32.lib",
  "uuid.lib",
  "comdlg32.lib",
  "advapi32.lib",
];

export const FLUX_ROCM_PREBUILT_RUNTIME_MANIFEST = "mgt-flux-rocm-runtime.json";

export const FLUX_DIFFUSERS_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B";

export const FLUX_SDCPP_VAE_FILE = "full_encoder_small_decoder.safetensors";

export const FLUX_SDCPP_LLM_REPO = "unsloth/Qwen3-4B-GGUF";

export const FLUX_SDCPP_LLM_FILE = "Qwen3-4B-Q4_K_M.gguf";

export const FLUX_SDCPP_LLM_REVISION =
  "22c9fc8a8c7700b76a1789366280a6a5a1ad1120";
export const FLUX_SDCPP_LLM_SHA256 =
  "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a";

export const FLUX_ROCM_WINDOWS_VERSION = "7.2.1";

export const FLUX_CPU_TORCH_INDEX_URL = "https://download.pytorch.org/whl/cpu";

export const FLUX_PYTHON_DEFAULT_MODE = "klein-edit-composite";

export const FLUX_EMBED_PYTHON_VERSION = "3.12.7";

export const FLUX_ROCM_PREBUILT_RUNTIME_FILE = `mgt-flux-rocm-win-x64-rocm${FLUX_ROCM_WINDOWS_VERSION}-py${FLUX_EMBED_PYTHON_VERSION}-sdcpp.zip`;

const FLUX_ROCM_PREBUILT_RUNTIME_RELEASE_TAG = "flux-runtime-rocm7.2.1-r1";

export const FLUX_ROCM_PREBUILT_RUNTIME_URL = `https://github.com/ucx0204/CarrotMangaTranslator/releases/download/${FLUX_ROCM_PREBUILT_RUNTIME_RELEASE_TAG}/${FLUX_ROCM_PREBUILT_RUNTIME_FILE}`;

// This is the original 2026-06-11 stable-diffusion.cpp ROCm runtime. Keep the
// complete archive digest as the trust anchor even though GitHub must host it
// in sub-2-GiB release parts.
export const FLUX_ROCM_PREBUILT_RUNTIME_SHA256 =
  "dc789faf12c2983c8aec3a14bb0b2735d8b79748472c1215e1e06bb1d5b94cb2";

export const FLUX_ROCM_PREBUILT_RUNTIME_BYTES = 3_054_206_837;

export const FLUX_ROCM_PREBUILT_RUNTIME_PARTS = [
  {
    fileName: `${FLUX_ROCM_PREBUILT_RUNTIME_FILE}.part-001`,
    bytes: 1_900_000_000,
    sha256: "a5e73ab2cf38ffdeb865fd45c221fc799e10fb136a71f0d541b0fb52a082e954",
  },
  {
    fileName: `${FLUX_ROCM_PREBUILT_RUNTIME_FILE}.part-002`,
    bytes: 1_154_206_837,
    sha256: "8116ae4899ecf59f66b359446703447b96bae4e0e5f8c028faeb3217c7918606",
  },
] as const;

// The pinned legacy runtime is larger than the generic archive policy because
// it contains the ROCm SDK layout used by the known-working build. These exact
// limits are only selected after the complete archive SHA-256 matches above.
export const FLUX_ROCM_PREBUILT_EXTRACTION_LIMITS = {
  maximumEntries: 20_336,
  maximumEntryBytes: 997_573_120,
  maximumExpandedBytes: 10_679_266_773,
  maximumCompressionRatio: 60,
} as const;

export const FLUX_ROCM_PREBUILT_EXTRACTION_DEADLINE_MS = 30 * 60 * 1000;

export const FLUX_GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

export const FLUX_BOOTSTRAP_PYTHON_MARKER = ".mgt-flux-bootstrap-python.json";

export const WINDOWS_LEGACY_MAX_PATH = 260;

export const WINDOWS_PATH_SAFETY_MARGIN = 8;

export const WINDOWS_RUNTIME_WORK_DIR_BASENAME = ".s-0000000000000000";

const ROCM_LONGEST_LIBRARY_ENTRY = join(
  "_rocm_sdk_libraries_custom",
  "bin",
  "hipblaslt",
  "library",
  "TensileLibrary_B8B8_B8B8_HA_Bias_SAB_SCD_SAV_UA_Type_B8B8_HPA_Contraction_l_Ailk_Bjlk_Cijk_Dijk_gfx1200.co",
);

export const ROCM_LONGEST_FINAL_ENTRY = join("p", ROCM_LONGEST_LIBRARY_ENTRY);

export const ROCM_LONGEST_PIP_TEMP_ENTRY = join(
  "t",
  "pip-target-xxxxxxxx",
  "lib",
  "python",
  ROCM_LONGEST_LIBRARY_ENTRY,
);

export const CUDA_REDIST_BASE_URL =
  "https://developer.download.nvidia.com/compute/cuda/redist";

export const CUDNN_REDIST_BASE_URL =
  "https://developer.download.nvidia.com/compute/cudnn/redist";

export const CUDA_REDIST_MANIFEST_URL = `${CUDA_REDIST_BASE_URL}/redistrib_12.9.0.json`;

export const CUDNN_REDIST_MANIFEST_URL = `${CUDNN_REDIST_BASE_URL}/redistrib_9.21.0.json`;

export const FLUX_CUDA_DLLS = new Set([
  "cublas64_12.dll",
  "cublasLt64_12.dll",
  "cudart64_12.dll",
  // Koharu LaMa shares this runtime and loads cuFFT on its first inference.
  // Requiring it here also invalidates pre-cuFFT runtime caches.
  "cufft64_11.dll",
  "curand64_10.dll",
]);

export const FLUX_CUDNN_DLLS = new Set([
  "cudnn64_9.dll",
  "cudnn_adv64_9.dll",
  "cudnn_cnn64_9.dll",
  "cudnn_engines_precompiled64_9.dll",
  "cudnn_engines_runtime_compiled64_9.dll",
  "cudnn_engines_tensor_ir64_9.dll",
  "cudnn_graph64_9.dll",
  "cudnn_heuristic64_9.dll",
  "cudnn_ops64_9.dll",
]);

export function resolveFluxRuntimeTempDir(runtimeDir: string): string {
  return join(runtimeDir, "t");
}
