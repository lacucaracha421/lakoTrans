#!/usr/bin/env node
// @ts-check

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { nativeBindgenEnv } = require("./native-bindgen-env.cjs");

const root = join(__dirname, "..");
const runnerManifest = join(
  root,
  "tools",
  "mgt-flux-klein-runner",
  "Cargo.toml",
);
const imageProcessingManifest = join(
  root,
  "tools",
  "runner-image-processing",
  "Cargo.toml",
);
const runtimePolicyManifest = join(
  root,
  "tools",
  "runner-runtime-policy",
  "Cargo.toml",
);

/** @param {string[]} args */
function cargo(args) {
  const result = spawnSync("cargo", args, {
    cwd: root,
    env: {
      ...nativeBindgenEnv(),
      CANDLE_METAL_XCODE: "1",
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`cargo failed with exit code ${result.status ?? "null"}`);
  }
}

function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Flux Metal tests require an Apple Silicon Mac.");
  }

  cargo(["test", "--manifest-path", runtimePolicyManifest, "--locked"]);
  cargo([
    "test",
    "--manifest-path",
    runnerManifest,
    "--locked",
    "--no-default-features",
    "--features",
    "metal",
    "--",
    "--test-threads=1",
  ]);
  cargo([
    "test",
    "--manifest-path",
    imageProcessingManifest,
    "--locked",
    "--",
    "--test-threads=1",
  ]);
}

main();
