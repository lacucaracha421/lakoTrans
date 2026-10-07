type ThumbnailRenderer = (
  originalUrl: string,
  maxEdge: number,
) => Promise<Buffer | null>;

/** Encoded derivatives only: decoded source rasters never enter this cache. */
export function createImageThumbnailResponse(
  render: ThumbnailRenderer,
  { maxBytes = 24 * 1024 * 1024, maxEntries = 128 } = {},
) {
  const cache = new Map<string, Buffer>();
  const pending = new Map<string, Promise<Buffer | null>>();
  let bytes = 0;
  const generate = async (key: string, url: string, edge: number) => {
    const png = await render(url, edge);
    if (png && png.length <= maxBytes && maxEntries > 0) {
      cache.set(key, png);
      bytes += png.length;
      while (bytes > maxBytes || cache.size > maxEntries) {
        const first = cache.entries().next().value;
        if (!first) break;
        cache.delete(first[0]);
        bytes -= first[1].length;
      }
    }
    return png;
  };
  return async (
    originalUrl: string,
    maxEdge: number,
  ): Promise<Response | null> => {
    const key = `${originalUrl}\0${maxEdge}`;
    let png = cache.get(key);
    if (png) {
      cache.delete(key);
      cache.set(key, png);
    } else {
      let request = pending.get(key);
      if (!request) {
        request = generate(key, originalUrl, maxEdge).finally(() =>
          pending.delete(key),
        );
        pending.set(key, request);
      }
      png = (await request) ?? undefined;
    }
    return png
      ? new Response(Uint8Array.from(png), {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(png.length),
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        })
      : null;
  };
}
