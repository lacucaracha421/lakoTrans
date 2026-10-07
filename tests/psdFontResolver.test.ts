import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionPsdFontResolver } from "../src/main/psdFontResolver";

const paths = vi.hoisted(() => ({
  fontsDir: "",
  logFile: "",
  repoRoot: process.cwd(),
}));
vi.mock("../src/main/appPaths", () => ({ getAppPaths: () => paths }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "unused-read-only-app-data" },
}));

describe("PSD font names", () => {
  beforeEach(() => {
    paths.fontsDir = mkdtempSync(join(tmpdir(), "psd-font-resolver-test-"));
    paths.logFile = join(paths.fontsDir, "app.log");
    vi.stubEnv("MANGA_TRANSLATOR_LOG_PATH", paths.logFile);
  });
  afterEach(() => {
    rmSync(paths.fontsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("resolves bundled font files to PostScript names and reuses the session cache", () => {
    const resolve = createProductionPsdFontResolver();
    expect(resolve("dohyeon")).toBe("BMDoHyeon");
    expect(resolve("dohyeon")).toBe("BMDoHyeon");
    expect(resolve("comic-neue")).toBe("ComicNeue-Regular");
    expect(resolve("missing-font-id")).toBe(resolve(undefined));
  });

  it("reads custom font metadata and caches the name for the export session", () => {
    const id = installCustomFont();
    const resolve = createProductionPsdFontResolver();
    expect(resolve(id)).toBe("BMDoHyeon");
    writeFileSync(join(paths.fontsDir, `${id}.ttf`), "invalid font");
    expect(resolve(id)).toBe("BMDoHyeon");
    expect(createProductionPsdFontResolver()(id)).toBeNull();
    expect(resolve("missing-font-id")).toBe(resolve(undefined));
  });

  it("uses the configured custom default for unspecified and unknown font IDs", () => {
    const id = installCustomFont();
    writeFileSync(
      join(paths.fontsDir, "preferences.json"),
      JSON.stringify({ defaultFontId: id }),
    );
    const resolve = createProductionPsdFontResolver();
    expect(resolve(undefined)).toBe("BMDoHyeon");
    expect(resolve("missing-font-id")).toBe("BMDoHyeon");
    expect(resolve("comic-neue")).toBe("ComicNeue-Regular");
  });
});

function installCustomFont(): string {
  const id = "11111111-1111-4111-8111-111111111111";
  const fileName = `${id}.ttf`;
  copyFileSync(
    join(process.cwd(), "src/renderer/src/assets/fonts/ko/dohyeon.ttf"),
    join(paths.fontsDir, fileName),
  );
  writeFileSync(
    join(paths.fontsDir, "index.json"),
    JSON.stringify([
      { id, label: "Test custom font", family: `MGTUser-${id}`, fileName },
    ]),
  );
  return id;
}
