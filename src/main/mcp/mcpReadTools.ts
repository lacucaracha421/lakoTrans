import type { McpArtifactMime } from "../../shared/mcpOutputFormats";
import { mcpToolOutputSchema } from "./mcpOutputSchemas";
import type { McpLibraryReadService } from "../application/mcpLibraryReadService";
import {
  allowArguments,
  argumentObject,
  identifierSchema,
  readIdentifier,
  readQuery,
  readWindow,
  windowProperties,
} from "./mcpArguments";

type McpToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType: McpArtifactMime;
      size: number;
    };
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  oauth?: boolean;
  requiredScopes?: readonly string[];
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  invoke: (
    args: Record<string, unknown>,
    context?: {
      assertAuthorized: () => void;
      principalId?: string;
      assertScopes?: (scopes: readonly string[]) => void;
      assertJobAuthorized?: (scopes?: readonly string[]) => void;
      visibleToolNames?: readonly string[];
      clientName?: string;
    },
  ) => Promise<McpToolContent[]>;
};

type CapabilityProfile = {
  readBlocks: boolean;
  editTranslations: boolean;
  additionalTools?: string[];
};

export function createMcpReadTools(
  service: McpLibraryReadService,
  imageTransfer = false,
  oauth = false,
  profile?: CapabilityProfile,
): McpTool[] {
  return [
    {
      name: "carrot_get_capabilities",
      description:
        "Report what this Carrot connection actually exposes. For a complete translation start with carrot_get_translation_guide: all text/SFX, plan/usage-aware image selection, typography planned from the original, batched edits and one final visual review. Correct observed defects only; do not schedule repetitive review cycles. Chat-host image tool availability is not observable here. No models are started.",
      inputSchema: objectSchema({}),
      invoke: async (args, context) => {
        allowArguments(args, []);
        return textContent(
          capabilityProfile(
            imageTransfer,
            oauth,
            profile,
            context?.visibleToolNames,
          ),
        );
      },
    },
    {
      name: "carrot_list_works",
      description:
        "Search and page through the existing app library. Does not return local paths or images.",
      inputSchema: objectSchema({
        ...windowProperties,
        query: { type: "string", maxLength: 200 },
      }),
      invoke: async (args) => {
        allowArguments(args, ["offset", "limit", "query"]);
        return textContent(
          await service.listWorks(readWindow(args), readQuery(args.query)),
        );
      },
    },
    {
      name: "carrot_list_chapters",
      description:
        "List chapters of a work by its opaque workId, not by a filesystem path.",
      inputSchema: objectSchema(
        { ...windowProperties, workId: identifierSchema },
        ["workId"],
      ),
      invoke: async (args) => {
        allowArguments(args, ["offset", "limit", "workId"]);
        return textContent(
          await service.listChapters(
            readIdentifier(args.workId, "workId"),
            readWindow(args),
          ),
        );
      },
    },
    {
      name: "carrot_get_chapter",
      description:
        "Get chapter and paginated page metadata. Text, source images, errors and internal artifacts are excluded.",
      inputSchema: objectSchema(
        { ...windowProperties, chapterId: identifierSchema },
        ["chapterId"],
      ),
      invoke: async (args) => {
        allowArguments(args, ["offset", "limit", "chapterId"]);
        return textContent(
          await service.getChapter(
            readIdentifier(args.chapterId, "chapterId"),
            readWindow(args),
          ),
        );
      },
    },
  ];
}

export function describeMcpTool(
  tool: McpTool,
  options: { includeOutputSchema?: boolean } = {},
) {
  const securitySchemes = [
    { type: "oauth2", scopes: tool.requiredScopes ?? ["carrot.read"] },
  ];
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(options.includeOutputSchema === false
      ? {}
      : { outputSchema: mcpToolOutputSchema(tool.name) }),
    ...(tool.oauth ? { securitySchemes, _meta: { securitySchemes } } : {}),
    annotations: {
      readOnlyHint: tool.readOnly !== false,
      destructiveHint: tool.destructive ?? tool.readOnly === false,
      idempotentHint: tool.idempotent ?? tool.readOnly !== false,
      openWorldHint: tool.openWorld ?? false,
    },
  };
}

export function textContent(value: unknown): McpToolContent[] {
  return [{ type: "text", text: JSON.stringify(value) }];
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return { type: "object", properties, required, additionalProperties: false };
}

export async function invokeMcpTool(tool: McpTool, value: unknown) {
  return tool.invoke(argumentObject(value));
}

function capabilityProfile(
  imageTransfer: boolean,
  oauth: boolean,
  profile?: CapabilityProfile,
  visibleToolNames?: readonly string[],
) {
  const current = scopeCapabilityProfile(
    imageTransfer,
    profile,
    visibleToolNames,
  );
  imageTransfer = current.imageTransfer;
  const additionalTools = current.additionalTools ?? [];
  const features = new Set(additionalTools);
  return {
    mode: features.has("carrot_run_page_ocr")
      ? "page-processing"
      : current.editTranslations
        ? "translation-edit"
        : "read-only",
    features: [
      "library.read",
      ...(imageTransfer ? ["page.preview"] : []),
      ...(current.readBlocks ? ["page.blocks"] : []),
      ...(current.editTranslations ? ["translation.edit"] : []),
      ...additionalTools,
    ],
    editing: current.editTranslations,
    translation: features.has("carrot_run_block_translation"),
    ocr: features.has("carrot_run_page_ocr"),
    erasure: features.has("carrot_run_page_erasure"),
    pngExport: features.has("carrot_export_page_png"),
    imageTransfer,
    imageRedaction: "preview-blocked-when-local-review-is-required",
    sampling: false,
    oauth,
  };
}

function scopeCapabilityProfile(
  imageTransfer: boolean,
  profile?: CapabilityProfile,
  visibleToolNames?: readonly string[],
) {
  const exposed = visibleToolNames ? new Set(visibleToolNames) : undefined;
  const current = exposed
    ? {
        readBlocks: exposed.has("carrot_get_page_blocks"),
        editTranslations: exposed.has("carrot_update_translations"),
        additionalTools: profile?.additionalTools?.filter((name) =>
          exposed.has(name),
        ),
      }
    : (profile ?? { readBlocks: false, editTranslations: false });
  imageTransfer =
    imageTransfer && (!exposed || exposed.has("carrot_get_page_preview"));
  return { ...current, imageTransfer };
}
