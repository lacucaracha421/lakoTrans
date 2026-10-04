import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { resolveHardwareLlamaRuntimeProfile } from "../src/main/settings/llamaRuntimeProfile";
import {
  GEMMA_12B_QAT_MODEL_FILE_Q4_K_M,
  GEMMA_12B_QAT_MODEL_REPO,
  GEMMA_26B_MODEL_FILE_IQ3_S,
  GEMMA_26B_MODEL_REPO,
  GEMMA_26B_QAT_MODEL_FILE_Q4_K_M,
  GEMMA_26B_QAT_MODEL_REPO,
  GEMMA_31B_QAT_MODEL_FILE_Q4_K_M,
  GEMMA_31B_QAT_MODEL_REPO,
} from "../src/shared/modelPresets";

const require = createRequire(import.meta.url);
const { resolvePreferredLlamaRuntime } =
  require("../src/main/runtime/simple-page-runtime-paths.cjs") as {
    resolvePreferredLlamaRuntime: (options?: Record<string, unknown>) => {
      id: string;
      kind: string;
      archives: Array<{ sha256?: string; expectedBytes?: number }>;
    };
  };
const {
  resolveWindowsLlamaRuntimeMaxRelativePathLength,
  shouldExtractLlamaRuntimeFile,
} = require("../src/main/runtime/simple-page-llama-runtimes.cjs") as {
  resolveWindowsLlamaRuntimeMaxRelativePathLength: (
    runtime?: {
      id?: string;
      requiredFiles?: Array<string | string[]>;
    } | null,
  ) => number;
  shouldExtractLlamaRuntimeFile: (
    fileName: string,
    relativePath?: string,
  ) => boolean;
};

describe("llama speed runtime path selection", () => {
  it.each(["cuda12", "rtx50", "vulkan", "metal", "rocm"])(
    "keeps the complete legacy/speed archive and loader contracts equal on %s",
    (llamaRuntimeProfile) => {
      for (const llamaRocmTarget of [
        "gfx103X",
        "gfx110X",
        "gfx1150",
        "gfx1151",
        "gfx120X",
        "gfx908",
        "gfx90a",
      ]) {
        const hardware = { llamaRuntimeProfile, llamaRocmTarget };
        expect(
          resolvePreferredLlamaRuntime({
            ...hardware,
            modelRepo: GEMMA_26B_MODEL_REPO,
            modelFile: GEMMA_26B_MODEL_FILE_IQ3_S,
          }),
        ).toEqual(
          resolvePreferredLlamaRuntime({
            ...hardware,
            modelRepo: GEMMA_12B_QAT_MODEL_REPO,
            modelFile: GEMMA_12B_QAT_MODEL_FILE_Q4_K_M,
          }),
        );
      }
    },
  );
  it.each([
    ["GeForce GTX 1080", 6.1, null],
    ["GeForce GTX 1660", 7.5, null],
    ["GeForce RTX 2060", 7.5, 20],
    ["GeForce RTX 2080 Ti", 7.5, 20],
    ["GeForce RTX 2080", null, 20],
  ])(
    "keeps %s on CUDA 12.4 for both model families",
    (name, computeCapability, rtxGeneration) => {
      const llamaRuntimeProfile = resolveHardwareLlamaRuntimeProfile({
        name,
        computeCapability,
        rtxGeneration,
        vendor: "nvidia",
        memoryMb: 8192,
      });
      expect(llamaRuntimeProfile).toBe("cuda12");
      for (const [modelRepo, modelFile] of [
        [GEMMA_26B_MODEL_REPO, GEMMA_26B_MODEL_FILE_IQ3_S],
        [GEMMA_12B_QAT_MODEL_REPO, GEMMA_12B_QAT_MODEL_FILE_Q4_K_M],
      ]) {
        expect(
          resolvePreferredLlamaRuntime({
            modelRepo,
            modelFile,
            llamaRuntimeProfile,
          }).id,
        ).toBe("llama-b11146-cuda12.4");
      }
      expect(
        resolvePreferredLlamaRuntime({
          modelRepo: "custom/gemma-4-31b",
          modelFile: "model.gguf",
          llamaRuntimeProfile,
        }).id,
      ).toBe("beellama-v0.4.7-cuda12.4");
    },
  );

  it("routes the QAT 31B MTP preset through current speed runtimes", () => {
    const cuda = resolvePreferredLlamaRuntime({
      llamaRuntimeProfile: "cuda12",
      modelRepo: GEMMA_31B_QAT_MODEL_REPO,
      modelFile: GEMMA_31B_QAT_MODEL_FILE_Q4_K_M,
    });
    expect(cuda.id).toBe("llama-b11146-cuda12.4");
    expect(cuda.kind).toBe("mainline");

    const rocm = resolvePreferredLlamaRuntime({
      llamaRuntimeProfile: "rocm",
      llamaRocmTarget: "gfx110X",
      modelRepo: GEMMA_31B_QAT_MODEL_REPO,
      modelFile: GEMMA_31B_QAT_MODEL_FILE_Q4_K_M,
    });
    expect(rocm.id).toBe("lemonade-llama-b1338-rocm-gfx110X");
    expect(rocm.archives[0]).toMatchObject({
      sha256:
        "fb62564b905a7066b7c6c900b0cd20fe4ada5dc0ca007e10288066d8e10b710a",
      expectedBytes: 172_438_846,
    });
  });

  it("routes all built-in model families to the stable b11146 build", () => {
    for (const [modelRepo, modelFile] of [
      [GEMMA_12B_QAT_MODEL_REPO, GEMMA_12B_QAT_MODEL_FILE_Q4_K_M],
      [GEMMA_26B_QAT_MODEL_REPO, GEMMA_26B_QAT_MODEL_FILE_Q4_K_M],
      [GEMMA_31B_QAT_MODEL_REPO, GEMMA_31B_QAT_MODEL_FILE_Q4_K_M],
    ]) {
      expect(
        resolvePreferredLlamaRuntime({
          llamaRuntimeProfile: "cuda13",
          modelRepo,
          modelFile,
        }).id,
      ).toBe("llama-b11146-cuda13.4");
      expect(
        resolvePreferredLlamaRuntime({
          llamaRuntimeProfile: "vulkan",
          modelRepo,
          modelFile,
        }).id,
      ).toBe("llama-b11146-vulkan");
    }

    expect(
      resolvePreferredLlamaRuntime({
        llamaRuntimeProfile: "cuda12",
        modelRepo: GEMMA_26B_MODEL_REPO,
        modelFile: GEMMA_26B_MODEL_FILE_IQ3_S,
      }).id,
    ).toBe("llama-b11146-cuda12.4");
  });

  it("keeps extraction and fallback path policies explicit", () => {
    expect(
      shouldExtractLlamaRuntimeFile(
        "TensileLibrary.dat",
        "rocblas/library/TensileLibrary.dat",
      ),
    ).toBe(true);
    expect(
      shouldExtractLlamaRuntimeFile("kernel.co", "hipblaslt/library/kernel.co"),
    ).toBe(true);
    expect(
      shouldExtractLlamaRuntimeFile("README.txt", "rocblas/README.txt"),
    ).toBe(false);
    expect(shouldExtractLlamaRuntimeFile("ggml-cuda.dll")).toBe(true);
    expect(shouldExtractLlamaRuntimeFile("llama-server.exe")).toBe(true);
    expect(shouldExtractLlamaRuntimeFile("notes.txt")).toBe(false);

    expect(
      resolveWindowsLlamaRuntimeMaxRelativePathLength({
        id: "unlisted-runtime",
        requiredFiles: ["llama-server.exe", ["nested-runtime-library.dll"]],
      }),
    ).toBe(255);
    expect(resolveWindowsLlamaRuntimeMaxRelativePathLength(null)).toBe(255);
  });

  it.each([
    ["gfx103X", 102],
    ["gfx110X", 122],
    ["gfx1150", 122],
    ["gfx1151", 122],
    ["gfx120X", 134],
    ["gfx908", 121],
    ["gfx90a", 137],
  ])("pins the audited b1338 path budget for %s", (target, maximum) => {
    expect(
      resolveWindowsLlamaRuntimeMaxRelativePathLength({
        id: `lemonade-llama-b1338-rocm-${target}`,
      }),
    ).toBe(maximum);
  });
});
