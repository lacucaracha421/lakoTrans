// Exact non-trace DLLs from the runner's pinned v6 release.
// Do not flatten zluda/trace/ over these libraries.
export type KoharuZludaSource = {
  url: string;
  fileName: string;
  bytes: number;
  sha256: string;
  dlls: Readonly<Record<string, { bytes: number; sha256: string }>>;
};

export const KOHARU_ZLUDA_SOURCE: KoharuZludaSource = {
  url: "https://github.com/vosen/ZLUDA/releases/download/v6/zluda-windows-3fe1206.zip",
  fileName: "zluda-windows-3fe1206.zip",
  bytes: 35_506_692,
  sha256: "fda8891c6fdfaba438f2eb0f9d749ffa2c1fddbdf225be2301f0d7a25e37208a",
  dlls: {
    "nvcuda.dll": {
      bytes: 68483072,
      sha256:
        "682c3e7a1fc4a89168fa8276d2423815f3a00a012f6432d0878ca9c94567079e",
    },
    "nvcudart_hybrid64.dll": {
      bytes: 1066704,
      sha256:
        "bf430d65b863c49bab525001a0712992d17f52f4b5a205536160a337cf8b22b3",
    },
    "cublas64_13.dll": {
      bytes: 251392,
      sha256:
        "caafbbf1944a34fca511743b7c77f842bda290da7adb6d98b81792481288f835",
    },
    "cublasLt64_13.dll": {
      bytes: 223232,
      sha256:
        "2f991ec05fcbb1b505592cac5f96e5220fa822e6b105b6bc4cb85d21ed422902",
    },
    "cufft64_12.dll": {
      bytes: 104960,
      sha256:
        "ccaf424e5953d3031d9c8942808f56ec5ea0938f456f11720b4f55e3051c5e72",
    },
    "cudnn64_9.dll": {
      bytes: 269312,
      sha256:
        "61e202a1c2044c55c1c373291b98d44da61df4702fc77222ea888937596c0503",
    },
  },
};
