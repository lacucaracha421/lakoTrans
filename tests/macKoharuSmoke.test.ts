import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ensureKoharuWorkerLaunch } from "../src/main/inpainting/koharuAssets";

const require = createRequire(import.meta.url);
const { ensureElectronExecutable } =
  require("../scripts/electron-executable.cjs") as {
    ensureElectronExecutable(root: string): string;
  };
type LaunchOptions = Parameters<typeof ensureKoharuWorkerLaunch>[0];
type Launch = Awaited<ReturnType<typeof ensureKoharuWorkerLaunch>>;
type RunOptions = { env?: NodeJS.ProcessEnv; input?: string; timeout?: number };
const { verifyKoharuImageSmokes } =
  require("../scripts/verify-mac-runtime-smokes.cjs") as {
    verifyKoharuImageSmokes(
      launch: (options: LaunchOptions) => Promise<Launch>,
      python: string,
      root: string,
      images: { ocr: string; input: string; mask: string; bubble: string },
      dependencies: {
        ensureAsset: (
          asset: { file: string },
          directory: string,
        ) => Promise<string>;
        execute: (
          command: string,
          args: string[],
          options: RunOptions,
        ) => {
          status: number;
          stdout: string;
          stderr: string;
        };
      },
    ): Promise<void>;
  };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.skipIf(!["win32", "darwin"].includes(process.platform))(
  "enters the smoke CLI under real Electron and reports a missing packaged module instead of hanging",
  { timeout: 45_000 },
  () => {
    const root = mkdtempSync(join(tmpdir(), "mac-koharu-entry-"));
    roots.push(root);
    const result = spawnSync(
      ensureElectronExecutable(join(__dirname, "..")),
      [
        join(__dirname, "..", "scripts", "verify-mac-runtime-smokes.cjs"),
        "--koharu-smoke",
        join(root, "missing.app"),
        root,
        "{}",
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Cannot find module");
    expect(result.stderr).toContain("koharuAssets.js");
  },
);

function fixture(reply: "ok" | "error" | "missing" = "ok") {
  const root = mkdtempSync(join(tmpdir(), "mac-koharu-smoke-"));
  roots.push(root);
  const executable = join(root, "native-runtime", "relocated-runner");
  const manifest = join(root, "native-runtime", "torch-runtime.json");
  const prepareLaunch = vi.fn(
    async (options: LaunchOptions): Promise<Launch> => ({
      backend: options.backend,
      executable,
      runtimePath: executable,
      label: "Koharu",
      args: ["--model", options.model, "--native-runtime", manifest],
      env: {
        PATH: "native-dylib-directory",
        KOHARU_DATA_ROOT: join(root, "managed-data"),
      },
    }),
  );
  const execute = vi.fn(
    (command: string, _args: string[], options: RunOptions) => {
      if (command === "python") return { status: 0, stdout: "", stderr: "" };
      if (!options.input) throw new Error("Worker request was not provided");
      const [request, shutdown] = options.input
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(shutdown).toEqual({ type: "shutdown" });
      if (reply !== "missing")
        writeFileSync(request.output, "worker image output");
      return {
        status: 0,
        stdout:
          JSON.stringify({ id: request.id, ok: reply !== "error" }) + "\n",
        stderr: "",
      };
    },
  );
  const run = () =>
    verifyKoharuImageSmokes(
      prepareLaunch,
      "python",
      root,
      {
        ocr: "ocr.png",
        input: "input.png",
        mask: "mask.png",
        bubble: "bubble.png",
      },
      {
        ensureAsset: async (asset, directory) => join(directory, asset.file),
        execute,
      },
    );
  return { root, executable, manifest, prepareLaunch, execute, run };
}

it("uses the production Metal launch including relocated executable, manifest and library environment for both models", async () => {
  const f = fixture();
  await f.run();
  expect(f.prepareLaunch.mock.calls.map(([options]) => options.model)).toEqual([
    "aot-inpainting",
    "lama-manga",
  ]);
  for (const [options] of f.prepareLaunch.mock.calls) {
    expect(options).toMatchObject({
      backend: "metal-native",
      runtimeDir: join(f.root, "koharu-runtime"),
      modelFiles: { model: options.model },
    });
  }
  expect(f.prepareLaunch.mock.calls[0][0].modelFiles.configPath).toMatch(
    /config\.json$/,
  );
  expect(
    f.prepareLaunch.mock.calls[1][0].modelFiles.configPath,
  ).toBeUndefined();
  const workers = f.execute.mock.calls.filter(
    ([command]) => command !== "python",
  );
  expect(workers).toHaveLength(2);
  for (const [command, args, options] of workers) {
    expect(command).toBe(f.executable);
    expect(args.slice(-2)).toEqual(["--native-runtime", f.manifest]);
    expect(options.env).toMatchObject({
      PATH: "native-dylib-directory",
      KOHARU_DATA_ROOT: join(f.root, "managed-data"),
    });
  }
  expect(
    f.execute.mock.calls.filter(([command]) => command === "python"),
  ).toHaveLength(2);
});

it.each(["error", "missing"] as const)(
  "rejects a %s image response even when the process exits successfully",
  async (reply) => {
    const f = fixture(reply);
    await expect(f.run()).rejects.toThrow("Metal 128x128 smoke failed");
    expect(f.prepareLaunch).toHaveBeenCalledTimes(1);
  },
);

it("propagates native runtime installation failure instead of bypassing the smoke", async () => {
  const f = fixture();
  f.prepareLaunch.mockRejectedValueOnce(new Error("runtime hash mismatch"));
  await expect(f.run()).rejects.toThrow("runtime hash mismatch");
  expect(f.execute).not.toHaveBeenCalled();
});
