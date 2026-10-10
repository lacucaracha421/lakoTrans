import { app } from "electron";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { appendFileSync } from "node:original-fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import ts from "typescript";

const directory = process.env.MGT_FONT_TEST_ROOT;
if (!directory) throw new Error("Missing isolated font test root");
app.setPath("userData", join(directory, "profile"));
const load = createRequire(import.meta.url);
load.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(result.outputText, filename);
};
const { readMcpCompositeFontEnvironment } = load(
  resolve(import.meta.dirname, "../../src/main/mcp/mcpCompositeNativeFonts.ts"),
);
const paths = {
  repoRoot: join(directory, "app.asar"),
  isPackaged: true,
  fontsDir: join(directory, "custom"),
};
try {
  const read = () =>
    readMcpCompositeFontEnvironment(
      () => {},
      paths,
      (name) => join(paths.repoRoot, "out/renderer/assets/fonts", name),
    );
  const first = await read();
  const second = await read();
  const native = await readMcpCompositeFontEnvironment(
    () => {},
    { ...paths, repoRoot: join(directory, "source") },
    (name) => join(directory, "source/out/renderer/assets/fonts", name),
  );
  let calls = 0;
  let changed;
  try {
    await readMcpCompositeFontEnvironment(
      () => {
        if (++calls === 3)
          appendFileSync(paths.repoRoot, "changed during read");
      },
      paths,
      (name) => join(paths.repoRoot, "out/renderer/assets/fonts", name),
    );
  } catch (error) {
    changed = error.code;
  }
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify({ first, second, native, changed }),
  );
  app.exit(0);
} catch (error) {
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify({ error: error.stack }),
  );
  app.exit(1);
}
