// @ts-check
const { access } = require("node:fs/promises");
const {
  prepareImageVariants,
  resolveImageSize,
} = require("../simple-page-image-variants.cjs");
const { mimeFromPath } = require("../simple-page-image-utils.cjs");
const { isOpenAICodexProvider } = require("../simple-page-model-config.cjs");

/** @param {Parameters<typeof prepareImageVariants>[0]} options */
async function prepareGroupReviewSource(options) {
  const mime = mimeFromPath(options.imagePath);
  if (
    (mime !== "image/png" && mime !== "image/jpeg") ||
    options.prepareExternalImage ||
    options.includeEnhancedVariant ||
    options.regionContextImagePath ||
    isOpenAICodexProvider(options)
  ) {
    return prepareImageVariants(options);
  }
  await access(options.imagePath);
  const size = resolveImageSize(options);
  return {
    imageVariants: [{ role: "original", path: options.imagePath, ...size }],
    diagnostics: [],
  };
}

/**
 * Reuse the already-hydrated PNG only for WebP. Other formats retain direct
 * path decoding, so the compatibility path cannot perturb normal pages.
 *
 * @param {{path:string;dataUrl?:unknown;convertedFromMime?:unknown}} original
 */
function buildReviewCropImageOptions(original) {
  const hydratedWebp =
    original.convertedFromMime === "image/webp" &&
    typeof original.dataUrl === "string" &&
    original.dataUrl.startsWith("data:image/png;base64,");
  return {
    imagePath: original.path,
    ...(hydratedWebp ? { sourceImageDataUrl: original.dataUrl } : {}),
  };
}

module.exports = { buildReviewCropImageOptions, prepareGroupReviewSource };
