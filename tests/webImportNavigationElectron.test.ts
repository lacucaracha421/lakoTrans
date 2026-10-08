import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const { ensureElectronExecutable } =
  require("../scripts/electron-executable.cjs") as {
    ensureElectronExecutable: (root: string) => string;
  };

it("collects real browser images despite page and iframe navigation, with normal scripts and redirects", async () => {
  const root = join(__dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "web-import-navigation-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MGT_WEB_IMPORT_TEST_ROOT: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    ensureElectronExecutable(root),
    [join(__dirname, "fixtures/webImportNavigation.mjs")],
    {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const timeout = setTimeout(() => child.kill(), 65000);
  try {
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(exit).toBe(0);
    const report = JSON.parse(
      await readFile(join(directory, "result.json"), "utf8"),
    );
    expect(report.error).toBeUndefined();
    expect(report.results).toHaveLength(8);
    for (const result of report.results) {
      expect(result.status, JSON.stringify(result)).toBe("ready");
      expect(result.widths).toEqual(
        result.name === "iframe" ? [401, 402, 403, 404] : [401, 402, 403],
      );
      expect(result.requests).not.toContain("/ad");
      expect(result.popups).toBe(0);
      expect(result.skipped).toEqual({
        failed: 0,
        unsupported: 0,
        blocked: 0,
        duplicate: result.name === "browser-guard" ? 1 : 0,
      });
      expect(result.sourceHost).toBe(
        result.name === "redirect" ? "93.184.216.35" : "93.184.216.34",
      );
      if (result.name === "browser-guard")
        expect(result.navigations).toBeGreaterThan(0);
    }
    expect(
      report.results.some((result: { rawLoadErrors: string[] }) =>
        result.rawLoadErrors.includes("ERR_ABORTED"),
      ),
    ).toBe(true);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await rm(directory, { recursive: true, force: true });
  }
}, 70000);
