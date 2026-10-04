// @ts-check

// Both model families use audited b1338 assets; gfx103X has no hipBLASLt kernel subtree.
const LEMONADE_CONTRACT = Object.freeze({
  release: "b1338",
  hipblasltKernelExemptTargets: Object.freeze(["gfx103X"]),
  sha256ByTarget: Object.freeze({
    gfx103X: "7963fe1bdf2c70b48a886ea3c3bb416bedc5b1d89db6f9ac5771e1982140aef3",
    gfx1150: "81b8bd5a86bdc09e8ab655e890f4c8f93a673aa258265d976a950296a35da9f5",
    gfx110X: "fb62564b905a7066b7c6c900b0cd20fe4ada5dc0ca007e10288066d8e10b710a",
    gfx1151: "1531edd5d913da4323454244c7ea5820f3951f3f3569e075b348ab5328d814a5",
    gfx908: "ef47c37a456debe29f316aa17b822d710573dbace851eca7bc918810f8c90089",
    gfx90a: "8b8e8e22f04505a118f0b81970e6299b695051ea6eab713d86bd3d8c1e5a9200",
    gfx120X: "574d0096e99d386ac7c9176ac601dc2f8ea78fd82af27cb3699cd50d54d92a23",
  }),
  bytesByTarget: Object.freeze({
    gfx103X: 152829227,
    gfx1150: 97098453,
    gfx110X: 172438846,
    gfx1151: 101889331,
    gfx908: 102506274,
    gfx90a: 216941934,
    gfx120X: 496335963,
  }),
});

/** @param {unknown} target */
function resolveLemonadeLlamaRuntimeRocm(target) {
  return resolvePinnedLemonadeRuntime(target, LEMONADE_CONTRACT);
}

/** @param {unknown} target */
function resolveSpeedLemonadeLlamaRuntimeRocm(target) {
  return resolvePinnedLemonadeRuntime(target, LEMONADE_CONTRACT);
}

/**
 * @param {unknown} target
 * @param {{ release: string; hipblasltKernelExemptTargets: readonly string[]; sha256ByTarget: Readonly<Record<string, string>>; bytesByTarget: Readonly<Record<string, number>> }} contract
 */
function resolvePinnedLemonadeRuntime(target, contract) {
  const normalized = String(target || "").trim();
  if (!normalized) throw new Error("AMD ROCm GPU target is required.");
  const sha256 = contract.sha256ByTarget[normalized];
  const expectedBytes = contract.bytesByTarget[normalized];
  if (!sha256 || !expectedBytes) {
    throw new Error(
      `No pinned llama ROCm runtime exists for target: ${normalized}`,
    );
  }
  const archive = `llama-${contract.release}-windows-rocm-${normalized}-x64.zip`;
  const baseUrl = `https://github.com/lemonade-sdk/llamacpp-rocm/releases/download/${contract.release}`;
  return {
    id: `lemonade-llama-${contract.release}-rocm-${normalized}`,
    kind: "lemonade-rocm",
    backend: "rocm",
    dir: `lemonade-llama-${contract.release}-rocm-${normalized}`,
    archive,
    url: `${baseUrl}/${archive}`,
    archives: [
      { archive, url: `${baseUrl}/${archive}`, sha256, expectedBytes },
    ],
    requiresHipblasltKernels:
      !contract.hipblasltKernelExemptTargets.includes(normalized),
    requiredFiles: [
      "llama-server.exe",
      ["llama-server-impl.dll", "llama.dll"],
      ["amdhip64.dll", "amdhip64_7.dll"],
      ["ggml-hip.dll", "ggml-rocm.dll", "libggml-hip.so", "libggml-rocm.so"],
      "hipblas.dll",
      "rocblas.dll",
    ],
  };
}

module.exports = {
  resolveLemonadeLlamaRuntimeRocm,
  resolveSpeedLemonadeLlamaRuntimeRocm,
};
