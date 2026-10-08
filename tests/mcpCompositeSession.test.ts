import { expect, it, vi } from "vitest";
import { retentionFixture } from "./mcpRetention.fixture";
import { McpTranslationGuideOutputSchema } from "../src/shared/mcpTranslationGuide";

it("requires a bound live native registry for chapter completion and preserves the read guard", async () => {
  const f = await retentionFixture();
  try {
    const session = f.operations();
    const read = session.readTranslationCompletion;
    if (!read || !session.bindNativeTools)
      throw new Error("Missing native completion composition");
    const guide = McpTranslationGuideOutputSchema.parse(
      (await f.invoke("carrot_get_translation_guide", { chapterId: "chapter" }))
        .structuredContent,
    );
    const guard = vi.fn();
    expect(() => read(f.owner, guide, guard)).toThrow(
      "not available for this session",
    );
    session.bindNativeTools(f.tools());
    const before = await f.snapshot();
    expect(await read(f.owner, guide, guard)).toMatchObject({
      scope: "whole-chapter",
      status: "incomplete",
      checkedPages: guide.chapterPageCount,
      acceptedPages: 0,
      pages: guide.pages.map(({ pageId, revision }) => ({
        pageId,
        revision,
        status: "pending",
      })),
    });
    expect(guard).toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
    expect(f.acquireEngine).not.toHaveBeenCalled();
    await expect(
      read(f.owner, guide, () => {
        throw new Error("connection revoked");
      }),
    ).rejects.toThrow("connection revoked");
    session.stop();
    expect(() => read(f.owner, guide, guard)).toThrow(
      "not available for this session",
    );
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
