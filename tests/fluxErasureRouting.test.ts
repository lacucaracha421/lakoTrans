import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowImages } from "../src/main/pageWorkflow/pageWorkflowImages";
import { makePage, makeBlock } from "./unifiedInpaintingUiFixtures";
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { createPageWorkflowPlan } from "../src/shared/pageWorkflowTypes";
import type { PageWorkflowRuntimeContext } from "../src/main/pageWorkflow/pageWorkflowRuntimeTypes";
import type { InpaintingEngine } from "../src/main/inpainting/inpaintingEngine";
import { makeRasterPng } from "./helpers/imageFixtures";

vi.mock("electron", async () => ({
  app: { isPackaged: false },
  nativeImage: (await import("./mcpImageNative.fixture")).imageNativeBoundary,
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FLUX erasure independent of final typesetting", () => {
  it.each(["flux-klein", "aot-inpainting"] as const)(
    "erase-only %s preserves the exact stored blocks and source PNG",
    async (model) => {
      const root = await mkdtemp(join(tmpdir(), "flux-routing-"));
      roots.push(root);
      const page = {
        ...makePage(),
        width: 100,
        height: 100,
        imagePath: join(root, "source.png"),
        blocks: [makeBlock()],
      };
      page.blocks[0].translatedText = "기존 번역";
      const bytes = makeRasterPng(100, 100, [255, 255, 255, 255]);
      await writeFile(page.imagePath, bytes);
      const before = structuredClone(page);
      const runPage = vi.fn(async () => ({
        patches: [],
        typographySegmentation: {
          imageWidth: page.width,
          imageHeight: page.height,
          detections: [],
        },
      }));
      const release = vi.fn(async () => {});
      const engine: InpaintingEngine = {
        model,
        backend: "test",
        runtimePath: "test",
        runRootDir: root,
        inpaint: vi.fn(async (bitmap, _width, _height, mask) => {
          for (let i = 0; i < mask.length; i++) if (mask[i]) bitmap[i * 4] = 0;
        }),
        dispose: vi.fn(),
      };
      const runtime = {
        acquireInpaintingEngine: async () => ({ engine, release }),
        acquireCodexInpaintingEngine: async () => {
          throw Error("Unexpected Codex acquisition");
        },
        createProductionBubbleLayoutRunner: () => ({ runPage }),
      };
      const context = {
        paths: { dataRoot: root },
        settings: resolveDefaultAppSettings(),
        signal: new AbortController().signal,
        plan: {
          ...createPageWorkflowPlan(["erase"]),
          overwrite: ["erase"],
          bubbleLayout: false,
        },
      } as PageWorkflowRuntimeContext;
      const output = await createWorkflowImages(context, runtime).erase(page);
      expect(output.blocks).toEqual(before.blocks);
      expect(page).toEqual(before);
      expect(await readFile(page.imagePath)).toEqual(bytes);
      expect(output.inpaintedImagePath).toBeTruthy();
      expect(engine.inpaint).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      if (model === "flux-klein")
        expect(runPage).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ sourceEraseMask: true, paddingRatio: 0 }),
        );
      else expect(runPage).not.toHaveBeenCalled();
    },
  );
});
