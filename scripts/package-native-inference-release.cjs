#!/usr/bin/env node
// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const AdmZip = require("adm-zip");
const yazl = require("yazl");

/** @param {Buffer} bytes */
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} directory @param {any} manifest */
function verify(directory, manifest) {
  for (const asset of manifest.assets) {
    const archive = fs.readFileSync(path.join(directory, asset.name));
    if (archive.length !== asset.bytes || digest(archive) !== asset.sha256)
      throw new Error("Archive mismatch: " + asset.name);
    const entries = new AdmZip(archive).getEntries();
    if (entries.length !== asset.files.length)
      throw new Error("Unexpected archive inventory");
    for (const entry of entries) {
      if (entry.isDirectory || !/^[a-zA-Z0-9_.-]+$/.test(entry.entryName))
        throw new Error("Unsafe archive path: " + entry.entryName);
      const expected = asset.files.find(
        (/** @type {any} */ file) => file.name === entry.entryName,
      );
      const bytes = entry.getData();
      if (
        !expected ||
        bytes.length !== expected.bytes ||
        digest(bytes) !== expected.sha256
      )
        throw new Error("Archive member mismatch: " + entry.entryName);
    }
  }
}

async function main() {
  if (process.argv[2] === "--verify") {
    const directory = path.resolve(process.argv[3]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
    verify(directory, manifest);
    console.log("Verified native assets: " + manifest.assets.length);
    return;
  }
  const config = JSON.parse(
    fs.readFileSync(path.resolve(process.argv[2]), "utf8"),
  );
  const output = path.resolve(process.argv[3]);
  if (fs.existsSync(output)) throw new Error("Staging must be new and empty");
  fs.mkdirSync(output, { recursive: true });
  const manifest = {
    schema: 1,
    tag: config.tag,
    sourceCommit: config.sourceCommit,
    provenance: config.provenance,
    assets: /** @type {any[]} */ ([]),
  };
  for (const asset of config.assets) {
    if (!/^[a-zA-Z0-9_.-]+\.zip$/.test(asset.name))
      throw new Error("Invalid asset name");
    const zip = new yazl.ZipFile();
    const files = [];
    const names = new Set();
    for (const file of [...asset.files].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || names.has(file.name))
        throw new Error("Invalid or duplicate member name");
      names.add(file.name);
      const metadata = fs.lstatSync(file.source);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error("Only regular files are allowed");
      const bytes = fs.readFileSync(file.source);
      files.push({
        name: file.name,
        bytes: bytes.length,
        sha256: digest(bytes),
      });
      zip.addBuffer(bytes, file.name, {
        mtime: new Date("1980-01-01T00:00:00Z"),
        mode: 0o100644,
      });
    }
    const archivePath = path.join(output, asset.name);
    const writing = pipeline(
      zip.outputStream,
      fs.createWriteStream(archivePath, { flags: "wx" }),
    );
    zip.end();
    await writing;
    const bytes = fs.readFileSync(archivePath);
    manifest.assets.push({
      name: asset.name,
      bytes: bytes.length,
      sha256: digest(bytes),
      files,
    });
  }
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  verify(output, manifest);
  console.log(JSON.stringify(manifest, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
