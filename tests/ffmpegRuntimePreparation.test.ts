import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import AdmZip from "adm-zip";

const { readVerifiedFfmpeg } = require("../scripts/prepare-ffmpeg-runtime.cjs");
const roots: string[] = [];
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(includeBinary = true) {
  const root = mkdtempSync(join(tmpdir(), "mgt-ffmpeg-prepare-"));
  roots.push(root);
  const binary = Buffer.from("verified app binary");
  const zip = new AdmZip();
  if (includeBinary) zip.addFile("release/bin/ffmpeg.exe", binary);
  zip.addFile("other/bin/ffmpeg.exe", Buffer.from("wrong binary"));
  const archive = zip.toBuffer();
  const file = join(root, "release.zip");
  writeFileSync(file, archive);
  return {
    file,
    binary,
    asset: {
      entry: "release/bin/ffmpeg.exe",
      bytes: archive.length,
      sha256: hash(archive),
      binaryBytes: binary.length,
      binarySha256: hash(binary),
    },
  };
}

describe("pinned FFmpeg preparation", () => {
  it("selects only the exact release entry and verifies its bytes", () => {
    const f = fixture();
    expect(readVerifiedFfmpeg(f.file, f.asset)).toEqual(f.binary);
  });
  it("rejects a modified archive before extracting executable code", () => {
    const f = fixture();
    expect(() =>
      readVerifiedFfmpeg(f.file, { ...f.asset, sha256: "0".repeat(64) }),
    ).toThrow("archive integrity");
  });
  it("rejects a same-name binary in the wrong archive directory", () => {
    const f = fixture(false);
    expect(() => readVerifiedFfmpeg(f.file, f.asset)).toThrow("exactly one");
  });
  it("requires the binary hash as well as the archive hash", () => {
    const f = fixture();
    expect(() =>
      readVerifiedFfmpeg(f.file, { ...f.asset, binarySha256: "0".repeat(64) }),
    ).toThrow("binary integrity");
  });
});
