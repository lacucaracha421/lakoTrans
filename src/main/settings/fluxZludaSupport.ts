import { parseRocmArch, resolveAmdRocmTargetFromInfo } from "../amdRocmTargets";
import type { DetectedGpuInfo } from "../gpuInfo";
import catalog from "../runtime/native-inference-manifest.json";

const targets = new Set(
  Object.keys(catalog.packages)
    .filter((key) => key.startsWith("rocm-device-"))
    .map((key) => key.slice("rocm-device-".length)),
);

/** Package availability only; the managed ROCm probe validates the selected GPU at launch. */
export function resolveNativeRocmGpuSupport(
  info: DetectedGpuInfo | null,
): boolean | undefined {
  if (!info || info.vendor !== "amd") return undefined;
  const arch = parseRocmArch(String(info.rocmArch ?? ""))?.match(
    /^gfx[0-9a-f]+/,
  )?.[0];
  if (arch) return targets.has(arch);
  const target = resolveAmdRocmTargetFromInfo(info);
  if (!target) return undefined;
  return [...targets].some((entry) =>
    target.endsWith("X")
      ? entry.startsWith(target.slice(0, -1))
      : entry === target,
  );
}
