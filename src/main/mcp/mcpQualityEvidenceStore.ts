import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  McpQualityEvidenceSchema,
  type McpQualityEvidence,
} from "../../shared/mcpQualityEvidence";
import { getAppPaths } from "../appPaths";
import {
  assertPathWithinRootWithoutSymlinks,
  writeDurableJsonFile,
} from "../libraryStore/libraryTransactionStorage";
import { McpEditError } from "../application/mcpEditPolicy";

/** Immutable server-issued metadata survives reconnects. Image bytes stay in native assets. */
export async function saveMcpQualityEvidence(value: McpQualityEvidence) {
  const checked = McpQualityEvidenceSchema.parse(value);
  await writeDurableJsonFile(await evidencePath(checked.id), checked);
  return checked;
}
export async function readMcpQualityEvidence(
  id: string,
): Promise<McpQualityEvidence> {
  try {
    const value = McpQualityEvidenceSchema.parse(
      JSON.parse(await readFile(await evidencePath(id), "utf8")),
    );
    if (value.id !== id) throw new Error("Quality evidence identity mismatch.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new McpEditError(
        "not_found",
        "Server-issued quality evidence is missing; inspect the source, specimen or glyphs again.",
      );
    throw error;
  }
}
async function evidencePath(id: string) {
  z.uuid().parse(id);
  const root = getAppPaths().dataRoot;
  const path = join(root, ".mcp-quality", `${id}.json`);
  await assertPathWithinRootWithoutSymlinks(root, path, {
    allowMissingTarget: true,
  });
  return path;
}
