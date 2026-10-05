// @ts-check
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

/**
 * Keep native loader failures visible even when the child never exits normally.
 * macOS gets a bounded startup allowance; this never retries or accepts a timeout.
 * @param {string} serverPath
 * @param {string[]} args
 * @param {{env: NodeJS.ProcessEnv; logPath: string; timeoutMs?: number}} options
 */
function runRuntimeCliProbe(serverPath, args, options) {
  const timeoutMs =
    options.timeoutMs ?? (process.platform === "darwin" ? 120000 : 30000);
  const startedAt = Date.now();
  const result = spawnSync(serverPath, args, {
    cwd: dirname(serverPath),
    env: options.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const diagnostics = {
    serverPath,
    args,
    timeoutMs,
    elapsedMs: Date.now() - startedAt,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  };
  writeFileSync(options.logPath, `${JSON.stringify(diagnostics)}\n${output}`);
  if (result.error || result.signal || result.status === null) {
    throw new Error(
      `Native CLI probe failed: ${JSON.stringify(diagnostics)}\n${output}`,
      { cause: result.error },
    );
  }
  return { status: result.status, output };
}

module.exports = { runRuntimeCliProbe };
