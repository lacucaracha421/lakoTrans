// @ts-check
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync, statSync } = require("node:fs");
const { chmod, mkdir, rename, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const AdmZip = require("adm-zip");
const manifest = require("./ffmpeg-runtime-manifest.json");
const { assertRealGeneratedPath } = require("./compile-electron.cjs");
const {
  downloadHfFileWithProgress,
} = require("../src/main/runtime/transport/hf-download.cjs");

/** @typedef {typeof manifest.platforms["win32-x64"]} FfmpegAsset */
/** @param {Buffer} bytes */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} file @param {number} bytes @param {string} hash */
function matches(file, bytes, hash) {
  return (
    existsSync(file) &&
    statSync(file).isFile() &&
    statSync(file).size === bytes &&
    sha256(readFileSync(file)) === hash
  );
}

/** @param {string} archive @param {FfmpegAsset} asset */
function readVerifiedFfmpeg(archive, asset) {
  if (!matches(archive, asset.bytes, asset.sha256)) {
    throw new Error("FFmpeg archive integrity validation failed");
  }
  const entries = new AdmZip(archive)
    .getEntries()
    .filter((entry) => entry.entryName === asset.entry);
  if (entries.length !== 1 || entries[0].isDirectory) {
    throw new Error("FFmpeg archive must contain exactly one expected binary");
  }
  // Extract the exact entry to our own fixed filename, never an archive path.
  const bytes = entries[0].getData();
  if (
    bytes.length !== asset.binaryBytes ||
    sha256(bytes) !== asset.binarySha256
  ) {
    throw new Error("FFmpeg binary integrity validation failed");
  }
  return bytes;
}

/** @param {{root?: string; platform?: string; arch?: string}} [options] */
async function prepareFfmpegRuntime(options = {}) {
  const root = options.root ?? join(__dirname, "..");
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const key = `${platform}-${arch}`;
  const asset = /** @type {Record<string, FfmpegAsset>} */ (manifest.platforms)[
    key
  ];
  if (!asset) throw new Error(`Unsupported FFmpeg app platform: ${key}`);
  const target = join(root, "tools", "ffmpeg", asset.binary);
  assertRealGeneratedPath(root, target);
  if (!matches(target, asset.binaryBytes, asset.binarySha256)) {
    const archive = join(root, ".tmp", "ffmpeg-downloads", asset.archive);
    assertRealGeneratedPath(root, archive);
    if (!matches(archive, asset.bytes, asset.sha256)) {
      await downloadHfFileWithProgress({
        url: asset.url,
        file: asset.archive,
        destination: archive,
        label: `FFmpeg ${manifest.version}`,
        maximumBytes: asset.bytes,
        // Static release hosts need not support parallel HTTP range requests.
        // Equal min/max bounds still enforce the exact archive size.
        minimumBytes: asset.bytes,
        expectedSha256: asset.sha256,
      });
    }
    const bytes = readVerifiedFfmpeg(archive, asset);
    await mkdir(join(root, "tools", "ffmpeg"), { recursive: true });
    const staging = `${target}.${process.pid}.tmp`;
    assertRealGeneratedPath(root, staging);
    try {
      await writeFile(staging, bytes, { flag: "wx", mode: 0o755 });
      await rename(staging, target);
    } finally {
      await rm(staging, { force: true });
    }
  }
  if (platform !== "win32") await chmod(target, 0o755);
  await writeFile(
    join(root, "tools", "ffmpeg", "ffmpeg-runtime.json"),
    JSON.stringify(
      { version: manifest.version, platform, arch, ...asset },
      null,
      2,
    ) + "\n",
  );
  if (platform === process.platform && arch === process.arch) {
    const result = spawnSync(target, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    if (
      result.status !== 0 ||
      !result.stdout.startsWith(`ffmpeg version ${manifest.version}`)
    ) {
      throw new Error(`FFmpeg runtime smoke failed: ${result.stderr}`);
    }
  }
  console.log(`[ffmpeg] verified ${manifest.version} ${key}`);
  return target;
}

if (require.main === module) {
  prepareFfmpegRuntime().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { prepareFfmpegRuntime, readVerifiedFfmpeg };
