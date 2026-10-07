/** Every browser dependency is serialized explicitly; no main-process closures cross the boundary. */
export function buildImageThumbnailScript(
  originalUrl: string,
  maxEdge: number,
): string {
  const functions = [
    thumbnailRasterAllowed,
    thumbnailPngAllowed,
    readThumbnailJpegMarker,
    readThumbnailJpegSegment,
    thumbnailJpegFrameAllowed,
    thumbnailJpegAllowed,
    readThumbnailBlob,
    drawThumbnailBlob,
    renderThumbnailInPage,
  ];
  return `(() => { ${functions.map((fn) => fn.toString()).join("\n")}
return renderThumbnailInPage(${JSON.stringify(originalUrl)}, ${maxEdge}); })()`;
}

function thumbnailRasterAllowed(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= 32_000_000;
}

function thumbnailPngAllowed(prefix: Uint8Array): boolean {
  if (
    prefix.length < 33 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some(
      (byte, index) => prefix[index] !== byte,
    )
  )
    return false;
  const view = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  );
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...prefix.subarray(12, 16)) !== "IHDR"
  )
    return false;
  if (!thumbnailRasterAllowed(view.getUint32(16), view.getUint32(20)))
    return false;
  let offset = 8;
  while (offset + 8 <= prefix.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      ...prefix.subarray(offset + 4, offset + 8),
    );
    if (["acTL", "iCCP", "cICP", "cHRM"].includes(type)) return false;
    if (type === "IDAT") return true;
    if (offset + 12 + size > prefix.length) return false;
    offset += 12 + size;
  }
  return false;
}

type ThumbnailJpegSegment = {
  marker: number;
  offset: number;
  size: number;
  nextOffset: number;
};
function readThumbnailJpegMarker(
  prefix: Uint8Array,
  start: number,
): { marker: number; offset: number } | null {
  let offset = start;
  if (prefix[offset++] !== 0xff) return null;
  while (offset < prefix.length && prefix[offset] === 0xff) offset++;
  if (offset >= prefix.length) return null;
  return { marker: prefix[offset], offset: offset + 1 };
}

function readThumbnailJpegSegment(
  prefix: Uint8Array,
  start: number,
): ThumbnailJpegSegment | null {
  const position = readThumbnailJpegMarker(prefix, start);
  if (!position) return null;
  const { marker, offset } = position;
  if (marker === 0xda) return { marker, offset, size: 0, nextOffset: offset };
  if (marker === 0xd9 || marker === 0x00 || offset + 2 > prefix.length)
    return null;
  if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
    return { marker, offset, size: 0, nextOffset: offset };
  const size = (prefix[offset] << 8) | prefix[offset + 1];
  if (size < 2 || offset + size > prefix.length) return null;
  return { marker, offset, size, nextOffset: offset + size };
}

function thumbnailJpegFrameAllowed(
  prefix: Uint8Array,
  segment: ThumbnailJpegSegment,
): boolean {
  if (segment.size < 8) return false;
  const height = (prefix[segment.offset + 3] << 8) | prefix[segment.offset + 4];
  const width = (prefix[segment.offset + 5] << 8) | prefix[segment.offset + 6];
  return thumbnailRasterAllowed(width, height);
}

function thumbnailJpegAllowed(prefix: Uint8Array): boolean {
  if (prefix[0] !== 0xff || prefix[1] !== 0xd8) return false;
  let offset = 2,
    foundFrameSize = false;
  while (offset < prefix.length) {
    const segment = readThumbnailJpegSegment(prefix, offset);
    if (!segment) return false;
    const { marker, size } = segment;
    if (marker === 0xda) return foundFrameSize;
    if (
      marker === 0xe2 &&
      size >= 14 &&
      String.fromCharCode(
        ...prefix.subarray(segment.offset + 2, segment.offset + 14),
      ) === "ICC_PROFILE\0"
    )
      return false;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (!thumbnailJpegFrameAllowed(prefix, segment)) return false;
      foundFrameSize = true;
    }
    offset = segment.nextOffset;
  }
  return false;
}

async function readThumbnailBlob(originalUrl: string): Promise<Blob | null> {
  const response = await fetch(originalUrl, {
    redirect: "error",
    credentials: "omit",
  });
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const declared = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !["image/png", "image/jpeg"].includes(mime) ||
    declared > 64 * 1024 * 1024
  ) {
    await response.body?.cancel();
    return null;
  }
  const blob = await response.blob();
  if (blob.size > 64 * 1024 * 1024) return null;
  const prefix = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  const allowed =
    mime === "image/png"
      ? thumbnailPngAllowed(prefix)
      : thumbnailJpegAllowed(prefix);
  return allowed ? blob : null;
}

async function drawThumbnailBlob(
  blob: Blob,
  maxEdge: number,
): Promise<string | null> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = objectUrl;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (width < 1 || height < 1 || Math.max(width, height) <= maxEdge)
      return null;
    const scale = maxEdge / Math.max(width, height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    image.src = "";
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderThumbnailInPage(
  originalUrl: string,
  maxEdge: number,
): Promise<string | null> {
  const blob = await readThumbnailBlob(originalUrl);
  return blob ? drawThumbnailBlob(blob, maxEdge) : null;
}
