import { appendFileSync, renameSync, statSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { CharacterProfile } from "../../shared/workContextTypes";

/**
 * Fork-only diagnostics shared with runtime/transport/translation-trace.cjs:
 * both append JSON lines to the same file so page attempts, endpoint starts
 * and individual model requests line up on one timeline. Only sizes, counts
 * and timings are recorded.
 */
const TRACE_PATH_ENV = "LAKOTRANS_TRACE_PATH";
const TRACE_FILE_NAME = "translation-trace.jsonl";
const MAX_TRACE_BYTES = 16 * 1024 * 1024;

export function enableTranslationTrace(logDirectory: string): void {
  process.env[TRACE_PATH_ENV] ||= join(logDirectory, TRACE_FILE_NAME);
}

export function traceTranslation(
  type: string,
  fields: Record<string, unknown> = {},
): void {
  const path = process.env[TRACE_PATH_ENV];
  if (!path) return;
  try {
    if (readSize(path) > MAX_TRACE_BYTES) renameSync(path, `${path}.1`);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      type,
      ...fields,
      rssMb: toMb(process.memoryUsage().rss),
      freeMemMb: toMb(freemem()),
    });
    appendFileSync(path, `${line}\n`, "utf8");
  } catch (error) {
    // Tracing must never break translation.
    void error;
  }
}

export async function traceDuration<T>(
  type: string,
  fields: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  let ok = false;
  try {
    const result = await run();
    ok = true;
    return result;
  } finally {
    traceTranslation(type, {
      ...fields,
      ok,
      ms: Math.round(performance.now() - startedAt),
    });
  }
}

/** Counts that drive prompt growth as a chapter's rolling context accumulates. */
type TraceableWorkContext = {
  styleGuide: {
    glossary: readonly unknown[];
    characters: readonly Pick<
      CharacterProfile,
      "speechStyle" | "customSpeechStyle"
    >[];
  };
  storyMemory: { pages: readonly unknown[] };
};

export function summarizeWorkContextSize(
  workContext: TraceableWorkContext | undefined,
): Record<string, number> | undefined {
  if (!workContext) return undefined;
  const { glossary, characters } = workContext.styleGuide;
  const voicedCharacters = characters.filter((character) =>
    character.speechStyle === "custom"
      ? Boolean(character.customSpeechStyle?.trim())
      : character.speechStyle !== "neutral",
  );
  return {
    glossary: glossary.length,
    characters: characters.length,
    voicedCharacters: voicedCharacters.length,
    voicedStyleChars: voicedCharacters.reduce(
      (total, character) => total + (character.customSpeechStyle?.length ?? 0),
      0,
    ),
    storyPages: workContext.storyMemory.pages.length,
  };
}

function readSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    void error;
    return 0;
  }
}

function toMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
