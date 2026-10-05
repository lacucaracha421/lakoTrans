import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  runRuntimeCliProbe,
} = require("../scripts/llama-runtime-cli-probe.cjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function logPath() {
  const root = mkdtempSync(join(tmpdir(), "mgt-cli-probe-"));
  roots.push(root);
  return join(root, "probe.log");
}

describe("native CLI probe diagnostics", () => {
  it("retains stdout and stderr from a completed native command", () => {
    const file = logPath();
    const result = runRuntimeCliProbe(
      process.execPath,
      ["-e", "console.log('--help'); console.error('loader ready')"],
      {
        env: process.env,
        logPath: file,
      },
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain("--help");
    expect(readFileSync(file, "utf8")).toContain("loader ready");
  });

  it("preserves a rejected argument's exit code for the caller to validate", () => {
    const file = logPath();
    const result = runRuntimeCliProbe(
      process.execPath,
      ["-e", "console.error('unsupported argument'); process.exitCode = 9"],
      {
        env: process.env,
        logPath: file,
      },
    );
    expect(result.status).toBe(9);
    expect(readFileSync(file, "utf8")).toContain('"status":9');
  });

  it("fails a hanging child and saves its partial output instead of treating help text as success", () => {
    const file = logPath();
    expect(() =>
      runRuntimeCliProbe(
        process.execPath,
        [
          "-e",
          "console.log('--help printed before hang'); setInterval(() => {}, 1000)",
        ],
        {
          env: process.env,
          logPath: file,
          timeoutMs: 2000,
        },
      ),
    ).toThrow("ETIMEDOUT");
    const output = readFileSync(file, "utf8");
    expect(output).toContain("--help printed before hang");
    expect(output).toContain('"status":null');
  }, 15000);

  it("records loader/spawn errors even when no process output exists", () => {
    const file = logPath();
    expect(() =>
      runRuntimeCliProbe(join(dirname(file), "missing-server"), ["--help"], {
        env: process.env,
        logPath: file,
      }),
    ).toThrow("ENOENT");
    expect(readFileSync(file, "utf8")).toContain("ENOENT");
  });
});
