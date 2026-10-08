import { createHash } from "node:crypto";

export const MCP_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MCP_LETTERING_REFERENCE = "retained-lettering-sha256:";

/** Separate native inline PNGs from metadata without changing their bytes or the
 * in-memory snapshot. Repeated before/after assets have one persistence identity. */
export function packMcpSnapshot(value: unknown) {
  const images = new Map<string, string>();
  let omittedBytes = 0;
  const json = JSON.stringify(value, (key: string, item: unknown) => {
    if (key !== "generatedLettering" || !item || typeof item !== "object")
      return item;
    const lettering = item as { dataUrl?: unknown };
    const dataUrl = lettering.dataUrl;
    if (
      typeof dataUrl !== "string" ||
      dataUrl.length > 8_000_000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
    )
      return item;
    const sha256 = createHash("sha256").update(dataUrl).digest("hex");
    const reference = MCP_LETTERING_REFERENCE + sha256;
    images.set(sha256, dataUrl);
    omittedBytes += dataUrl.length - reference.length;
    return { ...item, dataUrl: reference };
  });
  const metadataBytes = Buffer.byteLength(json);
  return {
    json,
    images,
    metadataBytes,
    totalBytes: metadataBytes + omittedBytes,
  };
}
