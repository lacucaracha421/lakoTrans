import type {
  WorkTypographyProfileV2,
  FontMatchingPaletteRole,
} from "../../shared/fontMatchingProfileTypes";
import type { McpWorkTypographyChange } from "../../shared/mcpWorkTypography";
import { normalizeWorkTypographyProfileV2 } from "../../shared/fontMatchingProfileCodec";
import type { McpQualityEvidence } from "../../shared/mcpQualityEvidence";
import { compositeFingerprint } from "./mcpCompositeWorkflowPolicy";
import { McpEditError } from "./mcpEditPolicy";

export async function previewWorkTypography(
  input: McpWorkTypographyChange,
  current: WorkTypographyProfileV2 | null,
  fontFingerprint: string,
  readEvidence: (id: string) => Promise<McpQualityEvidence>,
  timestamp: string,
  environment: Pick<
    WorkTypographyProfileV2,
    "catalogVersion" | "modelVersion" | "rendererHash"
  >,
) {
  if ((current ? compositeFingerprint(current) : null) !== input.revision)
    throw new McpEditError(
      "revision_conflict",
      "Work typography profile changed.",
    );
  const next = current
    ? structuredClone(current)
    : emptyProfile(input.workId, environment, timestamp);
  for (const item of input.selections) {
    const evidence = await readEvidence(item.specimenId);
    if (
      !item.candidateFontIds.includes(item.fontId) ||
      evidence.kind !== "font-specimen" ||
      evidence.fontFingerprint !== fontFingerprint ||
      item.candidateFontIds.some(
        (id) => !evidence.samples.some((sample) => sample.fontId === id),
      )
    )
      throw new McpEditError(
        "invalid_edit",
        "Compare 2–4 actual candidate specimens from the current fonts before selecting a work palette.",
      );
    assertRoleLock(next, item);
    updatePalette(next, item, timestamp, fontFingerprint);
  }
  next.updatedAt = timestamp;
  return normalizeWorkTypographyProfileV2(next);
}

function updatePalette(
  next: WorkTypographyProfileV2,
  item: McpWorkTypographyChange["selections"][number],
  timestamp: string,
  fontFingerprint: string,
) {
  if (["dialogue", "narration", "thought"].includes(item.role)) {
    const key = `${item.role}Anchor` as
      "dialogueAnchor" | "narrationAnchor" | "thoughtAnchor";
    next[key] = {
      primaryFontId: item.fontId,
      allowedFontIds: item.candidateFontIds,
      origin: "connected-ai",
      evidenceCount: 1,
      confidence: 0,
      replacementPolicy: next[key]?.replacementPolicy ?? {
        minimumEvidenceCount: 20,
        minimumScoreMargin: 0.1,
      },
      updatedAt: timestamp,
    };
  } else {
    const role = item.role as FontMatchingPaletteRole;
    next.rolePalettes = [
      ...next.rolePalettes.filter((entry) => entry.role !== role),
      {
        role,
        allowedFontIds: item.candidateFontIds,
        maxDistinctFonts: item.candidateFontIds.length,
        reuseVisualClusterFont: true,
        evidenceCount: 1,
        confidence: 0,
      },
    ];
  }
  next.visualSelections = [
    ...(next.visualSelections ?? []).filter(
      (entry) => entry.role !== item.role,
    ),
    {
      role: item.role,
      selection: {
        ...next.userLocks.find(
          (lock) => lock.scope.type === "role" && lock.scope.role === item.role,
        )?.selection,
        fontId: item.fontId,
        ...(item.fontWeight !== undefined
          ? { fontWeight: item.fontWeight }
          : {}),
        ...(item.italic !== undefined ? { italic: item.italic } : {}),
      },
      specimenId: item.specimenId,
      fontFingerprint,
      reason: item.reason,
      origin: "connected-ai",
      createdAt: timestamp,
    },
  ];
}

function assertRoleLock(
  next: WorkTypographyProfileV2,
  item: McpWorkTypographyChange["selections"][number],
) {
  const lock = next.userLocks.find(
    (entry) => entry.scope.type === "role" && entry.scope.role === item.role,
  );
  if (
    lock &&
    (lock.selection.fontId !== item.fontId ||
      (item.fontWeight !== undefined &&
        lock.selection.fontWeight !== item.fontWeight) ||
      (item.italic !== undefined && lock.selection.italic !== item.italic))
  )
    throw new McpEditError(
      "invalid_edit",
      "A user role lock cannot be changed by the connected AI palette.",
    );
}

function emptyProfile(
  workId: string,
  environment: Pick<
    WorkTypographyProfileV2,
    "catalogVersion" | "modelVersion" | "rendererHash"
  >,
  timestamp: string,
): WorkTypographyProfileV2 {
  return {
    schemaVersion: 2,
    workId: workId,
    dialogueAnchor: null,
    narrationAnchor: null,
    thoughtAnchor: null,
    rolePalettes: [],
    intentionalOverrides: [],
    userLocks: [],
    orientationPolicy: {
      horizontalAllowedFontIds: null,
      verticalAllowedFontIds: null,
      verticalOnlyFontIds: ["seoul-namsan-vertical"],
    },
    consistencyPolicy: {
      reuseBodyAnchors: true,
      requireIntentionalOverrideForBodySwitch: true,
      reuseVisualClusterFont: true,
      maxAccentFontsPerRole: 4,
    },
    genrePrior: null,
    evidenceCount: 0,
    confidence: 0,
    ...environment,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
