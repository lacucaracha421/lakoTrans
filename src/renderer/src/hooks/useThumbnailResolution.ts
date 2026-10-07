import * as React from "react";

/** Request enough source pixels for the current CSS size and display scale. */
export function useThumbnailResolution(
  frameRef?: React.RefObject<HTMLElement | null>,
  original = false,
  fallbackEdge = 128,
): number | undefined {
  const [edge, setEdge] = React.useState(() => physicalEdge(fallbackEdge));
  React.useEffect(() => {
    if (original) return;
    const measure = () => {
      const bounds = frameRef?.current?.getBoundingClientRect();
      setEdge(
        physicalEdge(
          Math.max(bounds?.width ?? 0, bounds?.height ?? 0) || fallbackEdge,
        ),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    if (frameRef?.current) observer?.observe(frameRef.current);
    window.addEventListener("resize", measure);
    const stopResolutionWatch = watchDevicePixelRatio(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      stopResolutionWatch();
    };
  }, [frameRef, original, fallbackEdge]);
  return original ? undefined : edge;
}

function watchDevicePixelRatio(measure: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  let query: MediaQueryList;
  const watch = () => {
    query?.removeEventListener("change", watch);
    measure();
    query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    query.addEventListener("change", watch);
  };
  watch();
  return () => query.removeEventListener("change", watch);
}

function physicalEdge(cssEdge: number): number | undefined {
  const pixels = Math.max(
    64,
    Math.ceil((cssEdge * (window.devicePixelRatio || 1)) / 64) * 64,
  );
  // Oversized/zoomed previews retain original detail instead of hitting a cap.
  return pixels <= 2048 ? pixels : undefined;
}
