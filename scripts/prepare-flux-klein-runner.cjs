// @ts-check
const { copyFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { nativeBindgenEnv } = require("./native-bindgen-env.cjs");

const root = join(__dirname, "..");
const target =
  process.env.MGT_FLUX_KLEIN_TARGET_DIR ||
  join(root, ".tmp", "flux-native-target");
const executable =
  process.platform === "win32" ? "mgt-flux-klein.exe" : "mgt-flux-klein";
const environment = nativeBindgenEnv();
const remaps = [`--remap-path-prefix=${root}=/src`];
if (environment.USERPROFILE)
  remaps.push(`--remap-path-prefix=${environment.USERPROFILE}=/user`);
const build = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    join(root, "tools", "mgt-flux-klein-runner", "Cargo.toml"),
  ],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...environment,
      CARGO_TARGET_DIR: target,
      CARGO_ENCODED_RUSTFLAGS: [environment.CARGO_ENCODED_RUSTFLAGS, ...remaps]
        .filter(Boolean)
        .join("\x1f"),
    },
  },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const output = join(root, "tools", "mgt-flux-klein");
mkdirSync(output, { recursive: true });
copyFileSync(join(target, "release", executable), join(output, executable));
console.log("Prepared Koharu 0.83.5 dynamic FLUX runner: " + output);
