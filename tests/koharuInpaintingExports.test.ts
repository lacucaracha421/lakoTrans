import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  AOT_MODEL_REVISION,
  AOT_MODEL_SHA256,
  LAMA_MODEL_REVISION,
  LAMA_MODEL_SHA256,
  ensureKoharuWorkerLaunch,
  resolveKoharuModelFiles,
} from "../src/main/inpainting/koharuAssets";
vi.mock("../src/main/runtimeSupport/nativeInferenceLaunch", () => ({
  prepareNativeInferenceLaunch: vi.fn(async (options) => ({
    executable: options.executable,
    manifest: join(options.runtimeDir, "torch-test.json"),
    env: { PATH: "managed-native-runtime" },
  })),
}));

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  delete process.env.MANGA_TRANSLATOR_LOG_PATH;
  delete process.env.MGT_KOHARU_INPAINT_EXE;
});

describe("Koharu inpainting public surface", () => {
  it("maps Koharu model ids to their managed Hugging Face files", () => {
    expect(resolveKoharuModelFiles("lama-manga")).toEqual({
      repo: "mayocream/lama-manga",
      files: ["lama-manga.safetensors"],
    });
    expect(resolveKoharuModelFiles("aot-inpainting")).toEqual({
      repo: "mayocream/aot-inpainting",
      files: ["config.json", "model.safetensors"],
    });
    expect(() => resolveKoharuModelFiles("flux-klein")).toThrow(/Koharu 모델/);
    expect(AOT_MODEL_REVISION).toBe("bde6131f9d3ef841b435507def8534715ac8e87c");
    expect(AOT_MODEL_SHA256).toBe(
      "1b4fea17a84a228c2097a42ab2f403357f07bb56ae022dc243b40817b7aa87d1",
    );
    expect(LAMA_MODEL_REVISION).toBe(
      "bc1fd58e8d92133f437f62f4f18f7ee3aa7503f8",
    );
    expect(LAMA_MODEL_SHA256).toBe(
      "a790515e9da839b8d89af7d565ceb110d908b7d6fbdb991f2acb2ec7d9b08bdb",
    );
  });

  it("re-exports the Koharu engine preparation entry point", async () => {
    vi.doMock("electron", () => ({
      nativeImage: {
        createFromBitmap: vi.fn(),
        createFromBuffer: vi.fn(),
        createFromPath: vi.fn(),
      },
    }));

    const { prepareKoharuInpaintingEngine } =
      await import("../src/main/inpainting");

    expect(typeof prepareKoharuInpaintingEngine).toBe("function");
  });

  it("uses the managed LibTorch runtime contract for Koharu CUDA", async () => {
    const runtimeDir = createTempDir("mgt-koharu-runtime-");
    const fluxRuntimeDir = createTempDir("mgt-koharu-flux-runtime-");
    const runnerDir = createTempDir("mgt-koharu-runner-");
    const runnerPath = join(runnerDir, "mgt-koharu-inpaint-runner.exe");
    writeFileSync(runnerPath, "runner");
    process.env.MGT_KOHARU_INPAINT_EXE = runnerPath;
    process.env.MANGA_TRANSLATOR_LOG_PATH = join(runtimeDir, "app.log");

    const launch = await ensureKoharuWorkerLaunch({
      runtimeDir,
      cudaRuntimeDir: fluxRuntimeDir,
      model: "lama-manga",
      modelFiles: {
        model: "lama-manga",
        weightsPath: join(runtimeDir, "lama-manga.safetensors"),
      },
      backend: "cuda-native",
    });

    expect(launch.env?.PATH?.split(delimiter)[0]).toBe(
      "managed-native-runtime",
    );
    expect(launch.args).toEqual(
      expect.arrayContaining([
        "--native-runtime",
        join(runtimeDir, "torch-test.json"),
      ]),
    );
    expect(launch.env?.KOHARU_DATA_ROOT).toBe(join(runtimeDir, "koharu-data"));
  });
});

function createTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}
