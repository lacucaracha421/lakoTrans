import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertPathWithinRootWithoutSymlinks } from "../libraryStore/libraryTransactionStorage";
import {
  MCP_LETTERING_REFERENCE,
  MCP_SNAPSHOT_BYTES,
  packMcpSnapshot,
} from "../application/mcpSnapshotPayload";

const envelopeSchema = z
  .object({
    kind: z.literal("carrot-retained-images-v1"),
    payload: z.unknown(),
    images: z
      .array(
        z
          .object({
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().positive().max(8_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(50_000),
  })
  .strict();

/** Uses the caller's existing staged directory or transaction. Image bytes are
 * content-addressed like native recovery image files; metadata stays encrypted. */
export async function retainInlineImages(
  libraryRoot: string,
  value: unknown,
  directory: string,
  write: (path: string, bytes: Buffer) => Promise<void>,
) {
  const packed = packMcpSnapshot(value);
  if (!packed.images.size) return { value, addedBytes: 0 };
  if (packed.totalBytes > MCP_SNAPSHOT_BYTES)
    throw new Error("Retained lettering snapshots exceed 32 MiB.");
  let addedBytes = 0;
  const images = [];
  for (const [sha256, dataUrl] of packed.images) {
    const bytes = Buffer.from(dataUrl);
    const asset = { sha256, bytes: bytes.length };
    const path = await imagePath(libraryRoot, directory, sha256);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info) await readImage(libraryRoot, directory, asset);
    else {
      await write(path, bytes);
      addedBytes += bytes.length;
    }
    images.push(asset);
  }
  return {
    value: {
      kind: "carrot-retained-images-v1",
      payload: JSON.parse(packed.json),
      images,
    },
    addedBytes,
  };
}

export async function restoreInlineImages(
  libraryRoot: string,
  value: unknown,
  directory: string,
) {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "carrot-retained-images-v1"
  )
    return value;
  const envelope = envelopeSchema.parse(value);
  const total = envelope.images.reduce((sum, image) => sum + image.bytes, 0);
  if (total > MCP_SNAPSHOT_BYTES)
    throw new Error("Retained images exceed 32 MiB.");
  const images = new Map<string, string>();
  for (const image of envelope.images) {
    if (images.has(image.sha256)) throw new Error("Duplicate retained image.");
    images.set(image.sha256, await readImage(libraryRoot, directory, image));
  }
  const used = new Set<string>();
  const json = JSON.stringify(envelope.payload);
  let expandedBytes = Buffer.byteLength(json);
  const payload: unknown = JSON.parse(json, (key: string, item: unknown) => {
    if (key !== "generatedLettering" || !item || typeof item !== "object")
      return item;
    const reference = (item as { dataUrl?: unknown }).dataUrl;
    if (
      typeof reference !== "string" ||
      !reference.startsWith(MCP_LETTERING_REFERENCE)
    )
      return item;
    const sha256 = reference.slice(MCP_LETTERING_REFERENCE.length);
    const dataUrl = images.get(sha256);
    if (!dataUrl) throw new Error("Missing retained lettering image.");
    expandedBytes += dataUrl.length - reference.length;
    if (expandedBytes > MCP_SNAPSHOT_BYTES)
      throw new Error("Expanded snapshots exceed 32 MiB.");
    used.add(sha256);
    return { ...item, dataUrl };
  });
  if (used.size !== images.size)
    throw new Error("Unreferenced retained image.");
  return payload;
}

async function imagePath(
  libraryRoot: string,
  directory: string,
  sha256: string,
) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(sha256);
  const path = join(directory, `${sha256}.lettering`);
  await assertPathWithinRootWithoutSymlinks(libraryRoot, path, {
    allowMissingTarget: true,
  });
  return path;
}
async function readImage(
  libraryRoot: string,
  directory: string,
  expected: { sha256: string; bytes: number },
) {
  const path = await imagePath(libraryRoot, directory, expected.sha256);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes)
    throw new Error("Invalid retained lettering image.");
  const bytes = await readFile(path);
  await imagePath(libraryRoot, directory, expected.sha256);
  if (
    bytes.length !== expected.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== expected.sha256
  )
    throw new Error("Retained lettering image bytes changed.");
  return bytes.toString("utf8");
}
