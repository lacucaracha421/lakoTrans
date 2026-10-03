import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { WorkInstructionSnapshotSchema } from "../shared/ipcWorkContextSchemas";
import type { WorkInstructionSnapshot } from "../shared/workContextInstructions";
import { PageWorkflowRequestSchema } from "../shared/ipcPageWorkflowContracts";
import { ConditionalBatchSchemeDraftV2Schema } from "../shared/conditionalBatchRules";
import { freezeWorkflowRules } from "../shared/pageWorkflowRules";
import { assertPageWorkflowResumeSelection } from "../shared/pageWorkflowPolicy";
import type { PageWorkflowRequest } from "../shared/pageWorkflowTypes";
import { ConditionalBatchSchemeStore } from "./conditionalBatchSchemeStore";
import { writeJsonFile } from "./libraryStore/storage";

const RunSchema = z
  .object({
    id: z.string().uuid(),
    request: PageWorkflowRequestSchema,
    instructions: z
      .record(z.string(), WorkInstructionSnapshotSchema)
      .optional(),
    rules: z
      .object({
        "source-rules": z.array(ConditionalBatchSchemeDraftV2Schema).optional(),
        "translation-rules": z
          .array(ConditionalBatchSchemeDraftV2Schema)
          .optional(),
        "format-rules": z.array(ConditionalBatchSchemeDraftV2Schema).optional(),
      })
      .strict(),
  })
  .strict();

export async function readPageWorkflowRun(dataRoot: string, id: string) {
  const safeId = z.string().uuid().parse(id);
  return RunSchema.parse(
    JSON.parse(
      await readFile(
        join(dataRoot, "page-workflows", `${safeId}.json`),
        "utf8",
      ),
    ),
  );
}

export async function preparePageWorkflowRun(
  dataRoot: string,
  request: PageWorkflowRequest,
  readInstructions?: (chapterId: string) => Promise<WorkInstructionSnapshot>,
) {
  if (request.resumeRunId) {
    const run = await readPageWorkflowRun(dataRoot, request.resumeRunId);
    assertPageWorkflowResumeSelection(request.selection, run.request.selection);
    if (!run.instructions && readInstructions) {
      run.instructions = await captureSelectionInstructions(
        run.request,
        readInstructions,
      );
      await writeJsonFile(
        join(dataRoot, "page-workflows", `${run.id}.json`),
        run,
      );
    }
    return run;
  }
  const snapshot = await new ConditionalBatchSchemeStore(dataRoot).list();
  const run = {
    id: randomUUID(),
    request,
    ...(readInstructions
      ? {
          instructions: await captureSelectionInstructions(
            request,
            readInstructions,
          ),
        }
      : {}),
    rules: freezeWorkflowRules(request.plan, snapshot),
  };
  await writeJsonFile(join(dataRoot, "page-workflows", `${run.id}.json`), run);
  return run;
}

async function captureSelectionInstructions(
  request: PageWorkflowRequest,
  read: (id: string) => Promise<WorkInstructionSnapshot>,
) {
  if (!request.plan.stages.includes("translate")) return {};
  const instructions: Record<string, WorkInstructionSnapshot> = {};
  for (const item of request.selection)
    instructions[item.chapterId] = WorkInstructionSnapshotSchema.parse(
      await read(item.chapterId),
    );
  return instructions;
}
