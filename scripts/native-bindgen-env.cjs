// @ts-check
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { execFileSync } = require("node:child_process");

/** Use an existing or explicitly isolated libclang; never install a system tool.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {NodeJS.ProcessEnv} */
function nativeBindgenEnv(environment = process.env) {
  if (environment.LIBCLANG_PATH) return { ...environment };
  let directory;
  if (process.platform === "win32") {
    const candidate = join(
      environment.ProgramFiles || "C:/Program Files",
      "LLVM",
      "bin",
    );
    if (existsSync(join(candidate, "libclang.dll"))) directory = candidate;
  } else if (process.platform === "darwin") {
    const clang = execFileSync("xcrun", ["--find", "clang"], {
      encoding: "utf8",
      env: environment,
    }).trim();
    const candidate = join(dirname(dirname(clang)), "lib");
    if (existsSync(join(candidate, "libclang.dylib"))) directory = candidate;
  }
  return { ...environment, ...(directory ? { LIBCLANG_PATH: directory } : {}) };
}
module.exports = { nativeBindgenEnv };
