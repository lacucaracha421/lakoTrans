import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { afterEach, expect, it, vi } from "vitest";
import {
  ensureKoharuModelAssets,
  ensureKoharuWorkerLaunch,
} from "../src/main/inpainting/koharuAssets";
import { ensureFluxWorkerLaunch } from "../src/main/inpainting/fluxAssets/workerLaunch";
import {
  ensureRemoteFile,
  hfResolveUrl,
} from "../src/main/runtimeSupport/modelDownloads";
import * as models from "../src/main/inpainting/fluxAssets/constants";

afterEach(() => vi.unstubAllEnvs());

// Opt-in network/hardware check. The normal suite never downloads models.
it.runIf(process.env.MGT_NATIVE_HARDWARE_SMOKE === "1")(
  "installs the pinned runtimes and performs real LaMa and FLUX CPU inference",
  async () => {
    await mkdir(resolve(".tmp/native-hardware"), { recursive: true });
    const root = await mkdtemp(resolve(".tmp/native-hardware/한글-"));
    vi.stubEnv("MANGA_TRANSLATOR_LOG_PATH", join(root, "app.log"));
    const input = join(root, "input.png"),
      mask = join(root, "mask.png");
    for (const [path, isMask] of [
      [input, false],
      [mask, true],
    ] as const) {
      const png = new PNG({ width: 256, height: 256 });
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const offset = (y * 256 + x) * 4;
          const selected = x > 100 && x < 155 && y > 100 && y < 155;
          const value = isMask ? (selected ? 255 : 0) : selected ? 40 : 220;
          png.data.fill(value, offset, offset + 3);
          png.data[offset + 3] = 255;
        }
      await writeFile(path, PNG.sync.write(png));
    }
    const runtimeDir = join(root, "runtime"),
      modelDir = process.env.MGT_NATIVE_SMOKE_MODEL_DIR || join(root, "models");
    const modelFiles = await ensureKoharuModelAssets({
      model: "lama-manga",
      modelDir,
    });
    const lama = await ensureKoharuWorkerLaunch({
      runtimeDir,
      model: "lama-manga",
      modelFiles,
      backend: "cpu",
    });
    const flux = await ensureFluxWorkerLaunch({
      runtimeDir,
      modelDir,
      backend: "cpu-native",
    });
    for (const [flag, repo, revision, fileName, expectedSha256] of [
      [
        "--transformer-path",
        models.FLUX_MODEL_REPO,
        models.FLUX_MODEL_REVISION,
        models.FLUX_MODEL_FILE,
        models.FLUX_MODEL_SHA256,
      ],
      [
        "--vae-path",
        models.FLUX_VAE_REPO,
        models.FLUX_VAE_REVISION,
        models.FLUX_VAE_FILE,
        models.FLUX_VAE_SHA256,
      ],
      [
        "--text-encoder-path",
        models.FLUX_SDCPP_LLM_REPO,
        models.FLUX_SDCPP_LLM_REVISION,
        models.FLUX_SDCPP_LLM_FILE,
        models.FLUX_SDCPP_LLM_SHA256,
      ],
    ]) {
      const path = await ensureRemoteFile({
        modelDir,
        fileName,
        expectedSha256,
        label: fileName,
        url: hfResolveUrl(repo, fileName, revision),
        maximumBytes: 4 * 1024 ** 3,
      });
      flux.args.push(flag, path);
    }
    const receipts = [];
    for (const [name, launch] of [
      ["lama", lama],
      ["flux", flux],
    ] as const) {
      const output = join(root, name + ".png");
      const request = {
        type: "inpaint",
        id: name,
        input,
        mask,
        bubble_mask: mask,
        windows: [[80, 80, 180, 180]],
        output,
        max_pixels: 65536,
        steps: 4,
        strength: 1,
      };
      const result = spawnSync(launch.executable, launch.args, {
        env: { ...process.env, ...launch.env, OMP_NUM_THREADS: "4" },
        input: JSON.stringify(request) + '\n{"type":"shutdown"}\n',
        encoding: "utf8",
        windowsHide: true,
        timeout: 15 * 60_000,
        maxBuffer: 8 * 1024 ** 2,
      });
      await writeFile(join(root, name + "-stderr.log"), result.stderr ?? "");
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const response = JSON.parse(result.stdout.trim());
      expect(response).toMatchObject({ id: name, ok: true });
      const png = PNG.sync.read(await readFile(output));
      expect([png.width, png.height]).toEqual([256, 256]);
      receipts.push({
        name,
        response,
        executable: launch.executable,
        args: launch.args,
      });
    }
    await writeFile(
      join(root, "receipt.json"),
      JSON.stringify(
        { platform: process.platform, arch: process.arch, receipts },
        null,
        2,
      ),
    );
  },
  30 * 60_000,
);
