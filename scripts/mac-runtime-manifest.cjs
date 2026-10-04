// @ts-check

const MAC_RUNTIME_MANIFEST = Object.freeze({
  platform: "darwin",
  arch: "arm64",
  minimumSystemVersion: "14.0",
  python: Object.freeze({
    version: "3.12.13",
    build: "20260510",
    archive:
      "cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz",
    url: "https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13%2B20260510-aarch64-apple-darwin-install_only.tar.gz",
    sha256: "5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17",
  }),
  ocrPackages: Object.freeze([
    "paddlepaddle==3.3.1",
    "paddleocr[doc-parser]==3.7.0",
  ]),
  ocrRequirements: Object.freeze({
    file: "requirements-mac-arm64.lock",
    sha256: "125dfc5b881bab917b926d2f72a66a01fdf8e8f87870deff14e1dfe407bb2f85",
    packageCount: 95,
    pythonVersion: "3.12",
    platform: "macosx_14_0_arm64",
  }),
  llamaRuntimes: Object.freeze([
    Object.freeze({
      id: "llama-b11146-metal-arm64",
      archive: "llama-b11146-bin-macos-arm64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-macos-arm64.tar.gz",
      sha256:
        "1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711",
    }),
    Object.freeze({
      id: "beellama-v0.4.7-metal-arm64",
      archive: "beellama-v0.4.7-bin-macos-arm64.tar.gz",
      url: "https://github.com/Anbeeld/beellama.cpp/releases/download/v0.4.7/beellama-v0.4.7-bin-macos-arm64.tar.gz",
      sha256:
        "20085c6da04585c36e06233b78b8172f95b5bd9e4797856761e9502dc1a46b4d",
    }),
  ]),
});

module.exports = { MAC_RUNTIME_MANIFEST };
