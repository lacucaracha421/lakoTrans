import { describe, expect, it, vi } from "vitest";
import { createChapterSummaryCache } from "../src/main/libraryStore/libraryChapterSummaries";
import type { LibraryChapterSummary } from "../src/shared/libraryTypes";

const summary: LibraryChapterSummary = {
  id: "chapter",
  workId: "work",
  title: "title",
  status: "idle",
  pageCount: 10,
  createdAt: "now",
  updatedAt: "now",
};

describe("library summary projection cache", () => {
  it("reuses only unchanged file identities and does not expose mutable cached objects", async () => {
    let stamp: string | null = "first";
    const read = createChapterSummaryCache(async () => stamp);
    const load = vi.fn(async () => ({ ...summary }));
    const first = await read("chapter.json", load);
    if (!first) throw new Error("Expected the cached chapter summary");
    first.title = "renderer changed this";
    expect((await read("chapter.json", load))?.title).toBe("title");
    expect(load).toHaveBeenCalledOnce();
    stamp = "atomic replacement";
    await read("chapter.json", load);
    expect(load).toHaveBeenCalledTimes(2);
    stamp = null;
    expect(await read("chapter.json", async () => null)).toBeNull();
  });
  it("does not cache a racing publication or hide a new corrupt file", async () => {
    let stamp = "before";
    const read = createChapterSummaryCache(async () => stamp);
    const load = vi.fn(async () => {
      stamp = "after";
      return { ...summary };
    });
    await read("chapter.json", load);
    await read("chapter.json", load);
    expect(load).toHaveBeenCalledTimes(2);
    stamp = "corrupt";
    await expect(
      read("chapter.json", async () => {
        throw new Error("invalid chapter");
      }),
    ).rejects.toThrow("invalid chapter");
  });
  it("bounds retained summaries and evicts least recently read entries", async () => {
    const read = createChapterSummaryCache(async () => "same", 2);
    const load = vi.fn(async () => ({ ...summary }));
    await read("a", load);
    await read("b", load);
    await read("a", load);
    await read("c", load);
    await read("b", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
