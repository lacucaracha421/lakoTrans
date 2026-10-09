import { describe, expect, it, vi } from "vitest";
import { mcpEndpointTools } from "../src/main/mcp/mcpEndpointTools";
import type { McpTool } from "../src/main/mcp/mcpReadTools";

describe("shared native MCP endpoint binding", () => {
  it("keeps schemas, ownership and native execution identical while round-tripping artifact URLs", async () => {
    const invoke = vi.fn<McpTool["invoke"]>(async (args) => [
      {
        type: "text",
        text: JSON.stringify({
          receipt: "stable-receipt",
          upload: args.upload,
          file: "http://127.0.0.1:49100/files/test",
          unrelated: "http://127.0.0.1:49100.evil/files/test",
        }),
      },
      {
        type: "resource_link",
        name: "preview",
        size: 42,
        mimeType: "image/png",
        uri: "http://127.0.0.1:49100/files/image",
      },
      { type: "image", data: "cGl4ZWxz", mimeType: "image/png" },
    ]);
    const tool: McpTool = {
      name: "carrot_test",
      description: "fixture",
      readOnly: false,
      inputSchema: { type: "object" },
      requiredScopes: ["carrot.edit"],
      invoke,
    };
    const external = mcpEndpointTools(
      [tool],
      "http://127.0.0.1:49100",
      "https://carrot.example",
    )[0];
    if (!external) throw new Error("Missing endpoint tool");
    const context = {
      principalId: "external-owner",
      assertAuthorized: () => undefined,
    };
    const result = await external.invoke(
      { upload: { url: "https://carrot.example/uploads/id" } },
      context,
    );
    expect(external.inputSchema).toBe(tool.inputSchema);
    expect(external.requiredScopes).toEqual(["carrot.edit"]);
    expect(invoke).toHaveBeenCalledWith(
      { upload: { url: "http://127.0.0.1:49100/uploads/id" } },
      context,
    );
    expect(result[0]).toEqual({
      type: "text",
      text: JSON.stringify({
        receipt: "stable-receipt",
        upload: { url: "https://carrot.example/uploads/id" },
        file: "https://carrot.example/files/test",
        unrelated: "http://127.0.0.1:49100.evil/files/test",
      }),
    });
    expect(result[1]).toMatchObject({
      uri: "https://carrot.example/files/image",
    });
    expect(result[2]).toMatchObject({ data: "cGl4ZWxz" });
  });
});
