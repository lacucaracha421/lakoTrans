import { expect, it, vi } from "vitest";
import { createMcpFontSamplesTool } from "../src/main/mcp/mcpFontSamplesTool";
import type { McpFontCatalog } from "../src/main/application/mcpTypographyReadService";
import { McpQualityEvidenceSchema } from "../src/shared/mcpQualityEvidence";
import { createHash } from "node:crypto";

function fixture() {
  const inventory: McpFontCatalog = {
    snapshot: "a".repeat(16),
    fonts: [
      {
        fontId: "test-font",
        label: "Test",
        source: "built-in",
        availability: "available",
        matchingRole: "built-in-candidate",
        locales: ["ko"],
        baseWeight: 400,
        baseItalic: false,
        hidden: false,
        favorite: false,
        defaultFont: false,
      },
    ],
  };
  const render = vi.fn(async () => [
    { label: "actual specimen", dataUrl: "data:image/png;base64,aGVsbG8=" },
  ]);
  const catalog = vi.fn(async () => inventory);
  const tool = createMcpFontSamplesTool({ catalog, render });
  const input = {
    fontIds: ["test-font"],
    snapshot: inventory.snapshot,
    text: "안녕하세요",
  };
  return { inventory, render, catalog, tool, input };
}

it("returns image content with stable font IDs and requires image authorization", async () => {
  const f = fixture();
  expect(f.tool.requiredScopes).toEqual(["carrot.read", "carrot.images"]);
  const result = await f.tool.invoke(f.input);
  expect(result[1]).toEqual({
    type: "image",
    mimeType: "image/png",
    data: "aGVsbG8=",
  });
  expect(
    JSON.parse((result[0] as { text: string }).text).samples[0],
  ).toMatchObject({ fontId: "test-font", contentIndex: 1 });
  expect(f.render).toHaveBeenCalledWith(
    ["test-font"],
    "안녕하세요",
    expect.any(Function),
  );
});

it("rejects stale inventories, duplicate IDs, unavailable and unregistered fonts before rendering", async () => {
  const f = fixture();
  for (const changes of [
    { snapshot: "b".repeat(16) },
    { fontIds: ["missing"] },
    { fontIds: ["test-font", "test-font"] },
    { fontIds: ["../font"] },
  ])
    await expect(f.tool.invoke({ ...f.input, ...changes })).rejects.toThrow();
  f.inventory.fonts[0].availability = "unavailable";
  await expect(f.tool.invoke(f.input)).rejects.toThrow();
  expect(f.render).not.toHaveBeenCalled();
});

it("withholds rendered images if authorization or the catalog changes while rendering", async () => {
  const f = fixture();
  let revoked = false;
  f.render.mockImplementationOnce(async () => {
    revoked = true;
    return [{ label: "sample", dataUrl: "data:image/png;base64,eA==" }];
  });
  await expect(
    f.tool.invoke(f.input, {
      assertAuthorized: () => {
        if (revoked) throw new Error("revoked");
      },
    }),
  ).rejects.toThrow("revoked");
  f.render.mockImplementationOnce(async () => {
    f.inventory.snapshot = "b".repeat(16);
    return [{ label: "sample", dataUrl: "data:image/png;base64,eA==" }];
  });
  await expect(f.tool.invoke(f.input)).rejects.toThrow(
    "Font inventory changed",
  );
});

it.each([false, true])(
  "binds font bytes, literal wording and optional context to actual PNG evidence (context=%s)",
  async (contextual) => {
    const f = fixture();
    const saveEvidence = vi.fn(async (_value: unknown) => {});
    const fontFingerprint = vi.fn(async () => "d".repeat(64));
    const tool = createMcpFontSamplesTool({
      catalog: f.catalog,
      render: f.render,
      fontFingerprint,
      saveEvidence,
    });
    const context = contextual
      ? {
          chapterId: "chapter",
          pageId: "page",
          blockId: "a",
          revision: "page-v1:" + "a".repeat(16),
        }
      : undefined;
    const result = await tool.invoke({
      ...f.input,
      ...(context ? { context } : {}),
    });
    expect(result[0].type).toBe("text");
    expect(saveEvidence).toHaveBeenCalledOnce();
    const receipt = McpQualityEvidenceSchema.parse(
      saveEvidence.mock.calls[0]?.[0],
    );
    expect(receipt).toMatchObject({
      kind: "font-specimen",
      text: f.input.text,
      fontFingerprint: "d".repeat(64),
      samples: [
        {
          fontId: "test-font",
          imageSha256: createHash("sha256").update("hello").digest("hex"),
        },
      ],
    });
    if (context) expect(receipt).toHaveProperty("context", context);
    fontFingerprint
      .mockResolvedValueOnce("d".repeat(64))
      .mockResolvedValueOnce("e".repeat(64));
    await expect(tool.invoke(f.input)).rejects.toThrow(/Font bytes changed/);
    expect(saveEvidence).toHaveBeenCalledOnce();
  },
);

it.each(
  [
    [],
    [{ label: "bad", dataUrl: "not-png" }],
    [
      {
        label: "huge",
        dataUrl: "data:image/png;base64," + "a".repeat(3 * 1024 * 1024),
      },
    ],
  ].map((images) => ({ images })),
)(
  "rejects malformed renderer samples without issuing evidence",
  async ({ images }) => {
    const f = fixture();
    f.render.mockResolvedValueOnce(images);
    await expect(f.tool.invoke(f.input)).rejects.toThrow(/Invalid font sample/);
  },
);
