import { McpCompositeWorkflowService } from "../application/mcpCompositeWorkflowService";
import { inspectMcpCompositeMetadata } from "../application/mcpCompositeMetadataReview";
import { mcpCompositeWorkflowOutputs } from "../../shared/mcpCompositeWorkflowOutputs";
import { McpEditError } from "../application/mcpEditPolicy";
import { openChapter } from "../library";
import type { McpCompositeRepository } from "./mcpCompositeRepository";
import type { McpParentAdmission } from "./mcpParentAdmission";
import type { McpTool } from "./mcpReadTools";
import { createMcpCompositeNative } from "./mcpCompositeNativeAdapter";
import type { CompositeNativeOptions } from "./mcpCompositeNativeResolve";
import { createMcpCompositeTools } from "./mcpCompositeTools";
import {
  inspectMcpTranslationCompletion,
  type McpTranslationCompletionReader,
} from "../application/mcpTranslationCompletion";

type Options = Omit<CompositeNativeOptions, "tools"> & {
  repository: McpCompositeRepository;
  admission: McpParentAdmission;
  reportError: (error: unknown) => void;
};

/** Composition owns one native adapter and the exact final wrapped public-tool registry. */
export function createMcpCompositeSession(options: Options) {
  const registry = new CompositeToolRegistry();
  const native = createMcpCompositeNative({
    ...options,
    tools: registry.tools,
  });
  const { repository, admission } = options;
  const service = new McpCompositeWorkflowService(
    repository,
    {
      ...native,
      execute: (binding, signal, onReceipt, guard) =>
        admission.executeChild(binding, () =>
          native.execute(binding, signal, onReceipt, guard),
        ),
    },
    {
      acquire: (record) => admission.acquireComposite(record),
      reportError: options.reportError,
    },
  );
  const tools = createMcpCompositeTools({
    service,
    list: async (owner, guard) => {
      guard();
      const records = await repository.list(owner);
      guard();
      return records.map((record) => service.observe(record));
    },
    discard: (owner, id, guard) =>
      repository.discard(owner, id, () => {
        guard();
        admission.assertDiscardable(id);
      }),
    importPreflight: native.importPreflight,
    readEvidence: native.readEvidence,
    inspectMetadata: (record, input, guard) =>
      inspectMcpCompositeMetadata(record, input, guard, {
        openChapter,
        verifySources: native.verifySnapshot,
      }),
  }).map((tool) => ({
    ...tool,
    invoke: async (...args: Parameters<McpTool["invoke"]>) => {
      registry.assertBound();
      return tool.invoke(...args);
    },
  }));
  const stop = () => {
    service.stop();
    native.stop();
    registry.stop();
  };
  return {
    tools,
    readTranslationCompletion: completionReader(
      registry,
      repository,
      native.verifySnapshot,
    ),
    bindNativeTools: registry.bind,
    stop,
    close: () => closeCompositeSession(stop, service, native, registry),
  };
}

async function closeCompositeSession(
  stop: () => void,
  service: McpCompositeWorkflowService,
  native: ReturnType<typeof createMcpCompositeNative>,
  registry: CompositeToolRegistry,
) {
  stop();
  const errors: unknown[] = [];
  try {
    await service.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await native.close();
  } catch (error) {
    errors.push(error);
  }
  registry.clear();
  if (errors.length)
    throw new AggregateError(errors, "Composite session cleanup failed.", {
      cause: errors[0],
    });
}

function completionReader(
  registry: CompositeToolRegistry,
  repository: McpCompositeRepository,
  verifySources: Parameters<
    typeof inspectMcpTranslationCompletion
  >[3]["verifySources"],
): McpTranslationCompletionReader {
  return (owner, selection, guard) => {
    registry.assertBound();
    return inspectMcpTranslationCompletion(owner, selection, guard, {
      list: (owner) => repository.list(owner),
      verifySources,
    });
  };
}

class CompositeToolRegistry {
  readonly tools: McpTool[] = [];
  private bound = false;
  private stopped = false;
  bind = (tools: readonly McpTool[]) => {
    if (this.bound || this.stopped)
      throw new Error(
        "Composite native tools must be bound exactly once before serving.",
      );
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error(
        "Composite native tool registry contains duplicate names.",
      );
    this.tools.push(
      ...tools.filter(
        (tool) => !Object.hasOwn(mcpCompositeWorkflowOutputs, tool.name),
      ),
    );
    this.bound = true;
  };
  assertBound() {
    if (!this.bound || this.stopped)
      throw new McpEditError(
        "access_denied",
        "Composite native composition is not available for this session.",
      );
  }
  stop() {
    this.stopped = true;
  }
  clear() {
    this.tools.length = 0;
  }
}
