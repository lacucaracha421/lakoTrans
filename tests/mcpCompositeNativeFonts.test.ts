import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPackage } from "@electron/asar";
import { readMcpCompositeFontEnvironment } from "../src/main/mcp/mcpCompositeNativeFonts";
import { failAfterCompositeNativeCleanup } from "../src/main/mcp/mcpCompositeNativeCleanup";

it("binds archived member bytes to a stable native archive and rejects changed archives or revoked reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-archive-binding-"));
  const repoRoot = join(root, "app.asar");
  const fonts = join(repoRoot, "out/renderer/assets/fonts");
  const archiveFile = join(root, "archive-backing-file");
  await mkdir(fonts, { recursive: true });
  await writeFile(archiveFile, "archive");
  await writeFile(join(fonts, "regular.ttf"), "font-bytes");
  const paths = { repoRoot, isPackaged: true, fontsDir: join(root, "custom") };
  // A virtual archive directory and a real backing file model Electron's two
  // filesystem views; the process test above verifies the actual ASAR adapter.
  const read = (guard = () => {}, archiveStat = () => lstat(archiveFile)) =>
    readMcpCompositeFontEnvironment(
      guard,
      paths,
      (name) => join(fonts, name),
      archiveStat,
    );
  try {
    const before = await read();
    expect(await read()).toBe(before);
    await writeFile(join(fonts, "regular.ttf"), "new-bytes!");
    expect(await read()).not.toBe(before);
    let calls = 0;
    await expect(
      read(
        () => {},
        async () => {
          if (++calls === 2) await writeFile(archiveFile, "changed archive");
          return lstat(archiveFile);
        },
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(
      read(
        () => {},
        () => lstat(repoRoot),
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    let guards = 0;
    await expect(
      read(() => {
        if (++guards === 3) throw new Error("authorization revoked");
      }),
    ).rejects.toThrow("authorization revoked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("hashes bundled ASAR font bytes in Electron without comparing virtual and extracted file identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-packaged-fonts-"));
  const source = join(root, "source");
  const fonts = join(source, "out/renderer/assets/fonts");
  await mkdir(fonts, { recursive: true });
  await writeFile(join(fonts, "regular.ttf"), "packaged-regular-face");
  await writeFile(join(fonts, "bold.ttf"), "packaged-bold-face");
  await createPackage(source, join(root, "app.asar"));
  const env: NodeJS.ProcessEnv = { ...process.env, MGT_FONT_TEST_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron") as string,
    [join(__dirname, "fixtures/mcpPackagedFonts.mjs")],
    {
      env,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const timeout = setTimeout(() => child.kill(), 20000);
  try {
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const result = JSON.parse(
      await readFile(join(root, "result.json"), "utf8"),
    );
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(exit).toBe(0);
    expect(result.first).toBeTruthy();
    expect(result.second).toBe(result.first);
    expect(result.native).toBe(result.first);
    expect(result.changed).toBe("revision_conflict");
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
}, 25000);

it("hashes actual native bundled weight faces and detects same-size same-mtime replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-composite-fonts-"));
  const fontRoot = join(root, "src/renderer/src/assets/fonts");
  await mkdir(fontRoot, { recursive: true });
  try {
    const regular = join(fontRoot, "regular.ttf");
    const bold = join(fontRoot, "bold.ttf");
    await writeFile(regular, Buffer.from("regular-face"));
    await writeFile(bold, Buffer.from("bold-face-01"));
    const paths = {
      repoRoot: root,
      isPackaged: false,
      fontsDir: join(root, "custom"),
    };
    const read = () =>
      readMcpCompositeFontEnvironment(
        () => {},
        paths,
        (name) => join(fontRoot, name),
      );
    const before = await read();
    const license = join(fontRoot, "LICENSE.txt");
    await writeFile(license, "Bundled font license, not a font face.");
    expect(await read()).toBe(before);
    const stamp = await stat(bold);
    await writeFile(bold, Buffer.from("bold-face-02"));
    await utimes(bold, stamp.atime, stamp.mtime);
    expect(await read()).not.toBe(before);
    await mkdir(paths.fontsDir);
    const id = randomUUID();
    const custom = join(paths.fontsDir, `${id}.ttf`);
    await writeFile(custom, Buffer.from("custom-face-1"));
    await writeFile(
      join(paths.fontsDir, "index.json"),
      JSON.stringify([
        {
          id,
          family: `MGTUser-${id}`,
          fileName: `${id}.ttf`,
          label: "Owned custom fixture",
        },
      ]),
    );
    const registered = await read();
    const customStamp = await stat(custom);
    await writeFile(custom, Buffer.from("custom-face-2"));
    await utimes(custom, customStamp.atime, customStamp.mtime);
    expect(await read()).not.toBe(registered);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a native face above the unchanged 32 MiB bound before hashing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-composite-font-cap-"));
  const fonts = join(root, "src/renderer/src/assets/fonts");
  await mkdir(fonts, { recursive: true });
  try {
    const path = join(fonts, "large.ttf");
    await writeFile(path, "");
    await truncate(path, 32 * 1024 * 1024 + 1);
    await expect(
      readMcpCompositeFontEnvironment(
        () => {},
        { repoRoot: root, isPackaged: false, fontsDir: join(root, "custom") },
        () => path,
      ),
    ).rejects.toMatchObject({ code: "invalid_edit" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves the original authority error together with physical cleanup failure", async () => {
  const original = new Error("authority revoked");
  const cleanup = new Error("font handle close failed");
  let caught: unknown;
  try {
    await failAfterCompositeNativeCleanup(original, async () => {
      throw cleanup;
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught).toMatchObject({ cause: cleanup, errors: [original, cleanup] });
  await expect(
    failAfterCompositeNativeCleanup(original, async () => {}),
  ).rejects.toBe(original);
});
