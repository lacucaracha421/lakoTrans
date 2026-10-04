import { describe, expect, it } from "vitest";
import {
  GEMMA_12B_QAT_MTP_MODEL_FILE,
  GEMMA_12B_QAT_MTP_MODEL_REPO,
} from "../src/shared/modelPresets";
import {
  DEFAULT_26B_FILE,
  DEFAULT_26B_MMPROJ_FILE,
  DEFAULT_26B_MMPROJ_REPO,
  DEFAULT_26B_REPO,
  DEFAULT_31B_FILE,
  DEFAULT_31B_REPO,
  buildLaunchArgs,
  createTempDir,
} from "./helpers/runtimeModelContracts";

describe("runtime launch memory policy", () => {
  it.each(["cuda12", "rtx50", "rocm", "vulkan", "metal"])(
    "disables mmap using the current CLI on %s",
    (llamaRuntimeProfile) => {
      const args = buildLaunchArgs({
        port: 18180,
        fitTargetMb: 9216,
        ctx: 16384,
        batch: 2048,
        ubatch: 1536,
        gpuLayers: "fit",
        mmprojOffload: true,
        modelRepo: DEFAULT_26B_REPO,
        modelFile: DEFAULT_26B_FILE,
        mmprojRepo: DEFAULT_26B_MMPROJ_REPO,
        mmprojFile: DEFAULT_26B_MMPROJ_FILE,
        disableMmap: true,
        llamaRuntimeProfile,
        useDraft: true,
        draftSpecType: "draft-mtp",
        draftModelRepo: GEMMA_12B_QAT_MTP_MODEL_REPO,
        draftModelFile: GEMMA_12B_QAT_MTP_MODEL_FILE,
        hfHubCacheDir: createTempDir("high-fit-mtp-cache-"),
      });

      expect(
        args.slice(
          args.indexOf("--load-mode"),
          args.indexOf("--load-mode") + 2,
        ),
      ).toEqual(["--load-mode", "none"]);
      expect(args).not.toContain("--no-mmap");
    },
  );

  it("keeps mmap enabled for non-MTP high-fit launches", () => {
    const args = buildLaunchArgs({
      port: 18180,
      fitTargetMb: 9216,
      ctx: 16384,
      batch: 2048,
      ubatch: 1536,
      gpuLayers: "fit",
      mmprojOffload: true,
      modelRepo: DEFAULT_26B_REPO,
      modelFile: DEFAULT_26B_FILE,
      mmprojRepo: DEFAULT_26B_MMPROJ_REPO,
      mmprojFile: DEFAULT_26B_MMPROJ_FILE,
      disableMmap: false,
    });

    expect(args).not.toContain("--load-mode");
    expect(args).not.toContain("--no-mmap");
  });

  it.each(["cuda12", "rtx50", "rocm", "metal"])(
    "preserves BeeLlama RAM locking without deprecated flags on %s",
    (llamaRuntimeProfile) => {
      const args = buildLaunchArgs({
        port: 18180,
        ctx: 32768,
        batch: 1024,
        ubatch: 1024,
        llamaRuntimeProfile,
        serverPath: "/tools/beellama-v0.4.7/llama-server",
        modelRepo: DEFAULT_31B_REPO,
        modelFile: DEFAULT_31B_FILE,
        disableMmap: true,
      });
      expect(
        args.slice(
          args.indexOf("--load-mode"),
          args.indexOf("--load-mode") + 2,
        ),
      ).toEqual(["--load-mode", "mlock"]);
      expect(args.filter((arg) => arg === "--load-mode")).toHaveLength(1);
      expect(args).not.toContain("--no-mmap");
      expect(args).not.toContain("--mlock");
    },
  );
});
