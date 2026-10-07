import { describe, expect, it, vi } from "vitest";
import { createProductionPsdFontResolver } from "../src/main/psdFontResolver";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "unused-read-only-app-data" },
}));

describe("PSD font names", () => {
  it("resolves bundled font files to PostScript names and reuses the session cache", () => {
    const resolve = createProductionPsdFontResolver();
    expect(resolve("dohyeon")).toBe("BMDoHyeon");
    expect(resolve("dohyeon")).toBe("BMDoHyeon");
    expect(resolve("comic-neue")).toBe("ComicNeue-Regular");
    expect(resolve("missing-font-id")).toBe(resolve(undefined));
  });
});
