import { app, session } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const loadModule = createRequire(import.meta.url);
const testRoot = process.env.MGT_WEB_IMPORT_TEST_ROOT;
if (!testRoot) throw new Error("Missing isolated test root");
app.setPath("userData", join(testRoot, "profile"));
app.on("window-all-closed", () => {});
loadModule.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(result.outputText, filename);
};
const { WebImportSessionManager, createSecureWebImportWindow } = loadModule(
  join(root, "src/main/webImportSessionManager.ts"),
);
const origin = "https://93.184.216.34";
const cdn = "https://93.184.216.35";
const cases = [
  "early",
  "dom-ready",
  "scroll",
  "iframe",
  "popup",
  "spa",
  "redirect",
  "browser-guard",
];
const results = [];
let activeCase;
let requests;
let navigations;
let popups;
let rawLoadErrors;

function imageBytes(index) {
  const png = new PNG({ width: 400 + index, height: 600 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = index * 40;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}
const images = [1, 2, 3, 4].map(imageBytes);
const preloadPath = join(testRoot, "navigation-preload.cjs");
const emptyPreload = join(testRoot, "empty-preload.cjs");
writeFileSync(emptyPreload, "");
writeFileSync(
  preloadPath,
  ts.transpileModule(
    readFileSync(join(root, "src/main/webImportNavigationPreload.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
);

function pageHtml(name) {
  const move = `location.replace('${origin}/ad')`;
  const trigger =
    name === "early"
      ? move
      : name === "dom-ready"
        ? `addEventListener('DOMContentLoaded',()=>{${move}})`
        : name === "browser-guard"
          ? `addEventListener('DOMContentLoaded',()=>setTimeout(()=>{${move}},20))`
          : "";
  const scroll = name === "scroll" ? move : "";
  const extra =
    name === "popup"
      ? `window.open('${origin}/ad','_blank')`
      : name === "spa"
        ? `history.replaceState(null,'','/virtual#page-2')`
        : "";
  return `<!doctype html><html><head><title>Fixture ${name}</title><script>${trigger}</script></head>
    <body><img src="${cdn}/1.png"><div style="height:1200px"></div>
    <script src="${cdn}/images.js"></script>
    <script>addEventListener('scroll',()=>{
      const img=document.createElement('img');img.src='${cdn}/3.png';document.body.append(img);${scroll}
    },{once:true});${extra}</script>
    ${name === "iframe" ? `<iframe src="${origin}/frame"></iframe>` : ""}
    ${name === "browser-guard" ? `<img src="${cdn}/slow.png">` : ""}</body></html>`;
}

function response(request) {
  const url = new URL(request.url);
  requests.push(url.pathname);
  if (url.pathname === "/slow.png")
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve(
            new Response(images[0], {
              headers: { "content-type": "image/png" },
            }),
          ),
        500,
      ),
    );
  if (url.pathname === "/redirect")
    return new Response(null, {
      status: 302,
      headers: { Location: `${cdn}/redirected` },
    });
  if (url.pathname === "/frame")
    return new Response(
      `<script>top.location='${origin}/ad'</script><img src="${cdn}/4.png">`,
      { headers: { "content-type": "text/html" } },
    );
  if (url.pathname === "/images.js")
    return new Response(
      `const image=document.createElement('img');image.src='${cdn}/2.png';document.body.append(image);`,
      { headers: { "content-type": "text/javascript" } },
    );
  const index = /^\/([1-4])\.png$/.exec(url.pathname);
  if (index)
    return new Response(images[Number(index[1]) - 1], {
      headers: { "content-type": "image/png" },
    });
  if (url.pathname === "/ad")
    return new Response("<title>Wrong document</title><img src='/4.png'>", {
      headers: { "content-type": "text/html" },
    });
  return new Response(pageHtml(activeCase), {
    headers: { "content-type": "text/html" },
  });
}

app
  .whenReady()
  .then(async () => {
    const manager = new WebImportSessionManager({
      dataRoot: join(testRoot, "data"),
      createSession: (partition) => {
        const isolated = session.fromPartition(partition, { cache: false });
        isolated.protocol.handle("https", response);
        return isolated;
      },
      createWindow: (isolated) => {
        const window = createSecureWebImportWindow(
          isolated,
          activeCase === "browser-guard" ? emptyPreload : preloadPath,
        );
        window.webContents.on("will-frame-navigate", (event) => {
          if (event.isMainFrame) navigations += 1;
        });
        window.webContents.on("did-create-window", () => {
          popups += 1;
        });
        const load = window.loadURL.bind(window);
        window.loadURL = (...args) =>
          load(...args).catch((error) => {
            rawLoadErrors.push(error.code);
            throw error;
          });
        return window;
      },
    });
    try {
      for (const name of cases) {
        activeCase = name;
        requests = [];
        navigations = 0;
        popups = 0;
        rawLoadErrors = [];
        const result = await manager.scan(
          { requestId: name, url: `${origin}/${name}` },
          new AbortController().signal,
          () => {},
        );
        results.push({
          name,
          status: result.status,
          reason: result.reason,
          widths: result.result?.candidates
            .map((candidate) => candidate.width)
            .sort(),
          sourceHost: result.result?.sourceHost,
          title: result.result?.pageTitle,
          skipped: result.result?.skipped,
          requests,
          navigations,
          popups,
          rawLoadErrors,
        });
        if (result.status === "ready")
          await manager.discardSession(result.result.sessionId);
      }
      writeFileSync(join(testRoot, "result.json"), JSON.stringify({ results }));
    } finally {
      await manager.dispose();
      app.quit();
    }
  })
  .catch((error) => {
    writeFileSync(
      join(testRoot, "result.json"),
      JSON.stringify({ error: String(error), results }),
    );
    app.exit(1);
  });
setTimeout(() => {
  app.exit(2);
}, 60000).unref();
