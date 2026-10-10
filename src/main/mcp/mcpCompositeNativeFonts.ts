import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { getAppPaths, type AppPaths } from "../appPaths";
import { createCustomFontLibrary, isPathInside } from "../customFonts";
import { ALLOWED_FONT_EXTENSIONS } from "../customFontFileValidation";
import { validateCustomFontLoad } from "../customFontLoadValidation";
import { resolveBundledFontFilePath } from "../bundledFontResolver";
import { McpEditError } from "../application/mcpEditPolicy";
import { compositeFingerprint } from "../application/mcpCompositeWorkflowPolicy";
import { failAfterCompositeNativeCleanup } from "./mcpCompositeNativeCleanup";

const MAX_FONT_BYTES = 32 * 1024 * 1024;
const MAX_ENVIRONMENT_BYTES = 512 * 1024 * 1024;
const MAX_FONT_FILES = 512;
type Paths = Pick<AppPaths, "repoRoot" | "isPackaged" | "fontsDir">;
type ArchiveStat = (path: string) => ReturnType<typeof lstat>;
type FontSource = {
  id: string;
  path: string | null;
  root: string;
  archive?: string;
};

/** Bind all app-managed renderer faces, including weight variants and rich-text fallback faces.
 * System fallback remains evidenced only by the actual native rendered pixels. */
export async function readMcpCompositeFontEnvironment(
  guard: () => void,
  paths: Paths = getAppPaths(),
  resolveBundled = resolveBundledFontFilePath,
  archiveStat: ArchiveStat = nativeArchiveStat,
) {
  guard();
  const library = createCustomFontLibrary({
    validateFontLoad: validateCustomFontLoad,
    getFontsDirectory: () => paths.fontsDir,
    readOnlyQueries: true,
    reportError: (_message, error) => {
      throw error;
    },
  });
  const registry = library.getFontLibrarySnapshot();
  const bundled = await bundledFonts(paths, resolveBundled);
  const custom = registry.customFonts.map((font) => ({
    id: `custom:${font.id}`,
    root: paths.fontsDir,
    path: library.resolveCustomFontFilePath(font.id),
  }));
  const sources = [...bundled, ...custom];
  if (sources.length > MAX_FONT_FILES) throw capacity();
  let remaining = MAX_ENVIRONMENT_BYTES;
  const files: Array<
    | { id: string; bytes: number; sha256: string }
    | { id: string; unavailable: true }
  > = [];
  for (const source of sources) {
    guard();
    if (!source.path) {
      files.push({ id: source.id, unavailable: true });
      continue;
    }
    const value = await hashFont(source, remaining, guard, archiveStat);
    remaining -= value.bytes;
    files.push({ id: source.id, ...value });
  }
  if (
    compositeFingerprint(registry) !==
      compositeFingerprint(library.getFontLibrarySnapshot()) ||
    compositeFingerprint(bundled) !==
      compositeFingerprint(await bundledFonts(paths, resolveBundled))
  )
    throw changed();
  guard();
  return compositeFingerprint({
    registry,
    files,
    systemFallback: "native-render-pixels-only",
  });
}
async function bundledFonts(
  paths: Paths,
  resolveBundled: typeof resolveBundledFontFilePath,
) {
  const location = bundledFontLocation(paths);
  const { root } = location;
  const result: FontSource[] = [];
  const directories = [root];
  let entries = 0;
  while (directories.length) {
    const directory = directories.shift();
    if (!directory) break;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (missing(error) && directory === root) return [];
      throw error;
    }
    for (const child of children) {
      if (++entries > MAX_FONT_FILES * 2 || child.isSymbolicLink())
        throw capacity();
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        directories.push(path);
        continue;
      }
      if (!ALLOWED_FONT_EXTENSIONS.has(extname(child.name).toLowerCase()))
        continue;
      const name = relative(root, path).split("\\").join("/");
      result.push({
        id: `bundled:${name}`,
        path: resolveBundled(name),
        ...location,
      });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
function bundledFontLocation(paths: Paths) {
  return {
    root: join(
      paths.repoRoot,
      paths.isPackaged
        ? "out/renderer/assets/fonts"
        : "src/renderer/src/assets/fonts",
    ),
    ...(paths.isPackaged && extname(paths.repoRoot) === ".asar"
      ? { archive: paths.repoRoot }
      : {}),
  };
}
async function hashFont(
  source: FontSource & { path?: string | null },
  remaining: number,
  guard: () => void,
  archiveStat: ArchiveStat,
) {
  const path = source.path;
  if (!path) throw changed();
  const initial = await lstat(path);
  if (
    // lstat's regular-file check also rejects symbolic links.
    !initial.isFile() ||
    !isPathInside(await realpath(source.root), await realpath(path))
  )
    throw new McpEditError(
      "invalid_edit",
      "Composite font evidence requires a native managed regular file.",
    );
  if (initial.size < 1 || initial.size > Math.min(MAX_FONT_BYTES, remaining))
    throw capacity();
  if (source.archive)
    return hashArchivedFont(path, source.archive, initial, guard, archiveStat);
  const handle = await open(path, "r");
  let result: { bytes: number; sha256: string };
  try {
    if (stamp(initial) !== stamp(await handle.stat())) throw changed();
    result = await hashOpenedFont(handle, initial.size, guard);
    if (
      stamp(initial) !== stamp(await handle.stat()) ||
      stamp(initial) !== stamp(await lstat(path)) ||
      !isPathInside(await realpath(source.root), await realpath(path))
    )
      throw changed();
  } catch (error) {
    return failAfterCompositeNativeCleanup(error, () => handle.close());
  }
  await handle.close();
  return result;
}
/** Electron's open() extracts an ASAR member to a different native file, and
 * each virtual lstat() generates an inode. Neither is a stable member identity.
 * Bind the bounded member bytes to the archive identity instead; custom/native
 * files retain the descriptor and path checks above. */
async function hashArchivedFont(
  path: string,
  archive: string,
  initial: Awaited<ReturnType<typeof lstat>>,
  guard: () => void,
  archiveStat: ArchiveStat,
) {
  const before = await archiveStat(archive);
  if (!before.isFile() || before.isSymbolicLink()) throw changed();
  const bytes = await readFile(path);
  guard();
  const after = await lstat(path);
  if (
    bytes.length !== initial.size ||
    stamp(before) !== stamp(await archiveStat(archive)) ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== initial.size
  )
    throw changed();
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
function nativeArchiveStat(path: string): ReturnType<typeof lstat> {
  // Even the archive root is virtualized as a directory by Electron's fs.
  const nativeFs: typeof import("node:fs/promises") =
    require("node:original-fs").promises;
  return nativeFs.lstat(path);
}
async function hashOpenedFont(
  handle: FileHandle,
  size: number,
  guard: () => void,
) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of handle.createReadStream({
    autoClose: false,
    highWaterMark: 64 * 1024,
  })) {
    guard();
    bytes += chunk.length;
    if (bytes > size) throw changed();
    hash.update(chunk);
  }
  if (bytes !== size) throw changed();
  return { bytes, sha256: hash.digest("hex") };
}
function stamp(value: Awaited<ReturnType<typeof lstat>>) {
  return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(
    ":",
  );
}
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function changed() {
  return new McpEditError(
    "revision_conflict",
    "Managed font bytes or registration changed during composite review.",
  );
}
function capacity() {
  return new McpEditError(
    "invalid_edit",
    "Composite font evidence supports at most 512 managed files, 32 MiB per face and 512 MiB total; this environment needs a narrower supported font configuration.",
  );
}
