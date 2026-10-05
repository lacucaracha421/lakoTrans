import { describe, expect, it } from "vitest";
import {
  isFluxRtx20Sm75Hardware,
  isFluxSm75ComputeCapability,
  shouldEnableExperimentalSm75Flux,
} from "../src/shared/fluxSm75";
import { FluxBackendSchema } from "../src/shared/ipcEnumSchemas";
import {
  FLUX_NVIDIA_RUNNER_ASSETS,
  FLUX_NVIDIA_RUNNER_BASE_URL,
} from "../src/main/inpainting/fluxAssets/constants";

describe("experimental Flux SM75 routing", () => {
  it("uses the same immutable native runner for Turing and newer CUDA devices", () => {
    expect(FLUX_NVIDIA_RUNNER_BASE_URL).toMatch(
      /\/diffusion-master-929-cpu-win-x64-r1$/u,
    );
    expect(FLUX_NVIDIA_RUNNER_ASSETS["75"]).toEqual(
      FLUX_NVIDIA_RUNNER_ASSETS["86"],
    );
    expect(FLUX_NVIDIA_RUNNER_ASSETS["75"].sha256).toBe(
      "cab50e3825737c5f8550538efa66d686c2facc6b75752933390b2c3b537bf60b",
    );
  });

  it("recognizes compute capability 7.5 and only enables the explicit backend", () => {
    expect(isFluxSm75ComputeCapability(7.5)).toBe(true);
    expect(isFluxSm75ComputeCapability(8.6)).toBe(false);
    expect(
      isFluxRtx20Sm75Hardware({
        computeCapability: 7.5,
        rtxGeneration: 20,
      }),
    ).toBe(true);
    expect(
      isFluxRtx20Sm75Hardware({
        computeCapability: 7.5,
        rtxGeneration: null,
      }),
    ).toBe(false);
    expect(
      shouldEnableExperimentalSm75Flux({
        backend: "cuda-sm75-experimental",
        computeCapability: 7.5,
      }),
    ).toBe(true);
    expect(
      shouldEnableExperimentalSm75Flux({
        backend: "cuda-sm75-experimental",
        computeCapability: 8.9,
      }),
    ).toBe(false);
    expect(
      shouldEnableExperimentalSm75Flux({
        backend: "cuda-native",
        computeCapability: 7.5,
      }),
    ).toBe(false);
  });

  it("normalizes temporary SM75 backend aliases", () => {
    expect(FluxBackendSchema.parse("sm75")).toBe("cuda-sm75-experimental");
    expect(FluxBackendSchema.parse("cuda-sm75")).toBe("cuda-sm75-experimental");
  });
});
