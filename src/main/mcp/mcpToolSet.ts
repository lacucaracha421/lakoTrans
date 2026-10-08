import { createTranslationGuideTool } from "./mcpTranslationGuideTool";
import type { McpTool } from "./mcpReadTools";
import type { McpPageEditService } from "../application/mcpPageEditService";
import { createMcpPageEditTools } from "./mcpPageEditTools";
import {
  McpLibraryReadService,
  type McpLibraryReadPort,
} from "../application/mcpLibraryReadService";
import { McpPagePreviewService } from "../application/mcpPagePreviewService";
import { createMcpReadTools } from "./mcpReadTools";
import { createMcpPagePreviewTool } from "./mcpPagePreviewTool";
import type { McpTranslationCompletionReader } from "../application/mcpTranslationCompletion";

type PreviewRenderer = ConstructorParameters<
  typeof McpPagePreviewService
>[0]["renderApprovedPreview"];

/** One composition path for the desktop runtime and behavioral integration tests. */
export function createMcpToolSet(
  library: McpLibraryReadPort,
  renderApprovedPreview?: PreviewRenderer,
  oauth = false,
  editing?: {
    service: McpPageEditService;
    allowEditing: boolean;
    allowProcessing?: boolean;
    lifetime?: AbortSignal;
  },
  extensions: McpTool[] = [],
  readCompletion?: McpTranslationCompletionReader,
) {
  const editTools = editing
    ? createMcpPageEditTools(
        editing.service,
        editing.allowEditing,
        editing.allowProcessing,
        editing.lifetime,
      )
    : [];
  const guide = createTranslationGuideTool(
    library,
    [
      ...[...extensions, ...editTools].map((tool) => tool.name),
      ...(renderApprovedPreview ? ["carrot_get_page_preview"] : []),
    ],
    readCompletion,
  );
  const tools = createMcpReadTools(
    new McpLibraryReadService(library),
    renderApprovedPreview !== undefined,
    oauth,
    {
      readBlocks: !!editing,
      editTranslations: editing?.allowEditing ?? false,
      additionalTools: [guide, ...extensions, ...editTools].map(
        (tool) => tool.name,
      ),
    },
  );
  if (renderApprovedPreview) {
    tools.push(
      createMcpPagePreviewTool(
        new McpPagePreviewService({
          openChapter: library.openChapter,
          renderApprovedPreview,
        }),
      ),
    );
  }
  tools.push(guide, ...editTools);
  tools.push(...extensions);
  return tools.map((tool) => ({ ...tool, oauth }));
}
