import { resolveDemotedBlockFontId } from "../shared/demotedBlockFonts";
import { readFileSync, statSync } from "node:fs";
import { getAppPaths } from "./appPaths";
import { createCustomFontLibrary } from "./customFonts";
import { resolveBundledFontFilePath } from "./bundledFontResolver";
import { resolveBuiltInFontAssetRelativePath } from "./builtInFontMatchingCatalog";
import { readFontPostScriptName } from "./fontPostScriptName";
import { validateCustomFontLoad } from "./customFontLoadValidation";
import { logError } from "./logger";

export function createProductionPsdFontResolver(): (
  fontId: string | undefined,
) => string | null {
  const library = createCustomFontLibrary({
    getFontsDirectory: () => getAppPaths().fontsDir,
    validateFontLoad: validateCustomFontLoad,
    readOnlyQueries: true,
    reportError: logError,
  });
  const snapshot = library.getFontLibrarySnapshot();
  const names = new Map<string, string | null>();
  return (fontId) => {
    const id = effectiveFontId(fontId, snapshot);
    if (id === "default")
      return process.platform === "win32"
        ? "MalgunGothic"
        : "AppleSDGothicNeo-Regular";
    if (names.has(id)) return names.get(id) ?? null;
    const bundled = resolveBuiltInFontAssetRelativePath(id);
    const file = bundled
      ? resolveBundledFontFilePath(bundled)
      : library.resolveCustomFontFilePath(id);
    let name: string | null = null;
    try {
      if (file && statSync(file).size <= 32 * 1024 * 1024)
        name = readFontPostScriptName(readFileSync(file));
    } catch (error) {
      logError("Could not resolve PSD font; preserving raster text", {
        fontId: id,
        error,
      });
    }
    names.set(id, name);
    return name;
  };
}

function effectiveFontId(
  fontId: string | undefined,
  snapshot: ReturnType<
    ReturnType<typeof createCustomFontLibrary>["getFontLibrarySnapshot"]
  >,
): string {
  const requested = resolveDemotedBlockFontId(fontId?.trim() || "default");
  const known =
    resolveBuiltInFontAssetRelativePath(requested) ||
    snapshot.customFonts.some((font) => font.id === requested);
  return requested !== "default" && known
    ? requested
    : snapshot.preferences.defaultFontId;
}
