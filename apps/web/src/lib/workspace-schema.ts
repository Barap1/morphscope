import { z } from "zod";

const Identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u,
    "Use letters, numbers, dots, slashes, colons, or hyphens",
  );

const Text = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const WorkspaceTaskInputSchema = z
  .object({
    id: Identifier,
    repository: Text(2_048),
    commit: Text(128),
    issue: Text(50_000),
    setup: Text(16_384),
    evaluation: Text(16_384),
    tags: z.array(Text(64)).max(64),
  })
  .strict();

export const WorkspaceExperimentInputSchema = z
  .object({
    id: Identifier,
    name: Text(256),
    description: Text(16_384),
    taskId: OptionalText(128),
    sourceCommit: OptionalText(128),
    variedVariable: OptionalText(128),
    status: z.enum(["draft", "active", "completed", "archived"]),
  })
  .strict();

export const WorkspaceRunInputSchema = z
  .object({
    id: Identifier,
    experimentId: Identifier,
    taskId: Identifier,
    configurationId: Identifier,
    provider: Text(128),
    model: Text(256),
    status: z.enum(["planned", "running", "resolved", "failed", "cancelled"]),
    notes: z.string().trim().max(16_384),
  })
  .strict();

export const WorkspaceRecordInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), payload: WorkspaceTaskInputSchema }).strict(),
  z.object({ kind: z.literal("experiment"), payload: WorkspaceExperimentInputSchema }).strict(),
  z.object({ kind: z.literal("run"), payload: WorkspaceRunInputSchema }).strict(),
]);

export type WorkspaceTaskInput = z.infer<typeof WorkspaceTaskInputSchema>;
export type WorkspaceExperimentInput = z.infer<typeof WorkspaceExperimentInputSchema>;
export type WorkspaceRunInput = z.infer<typeof WorkspaceRunInputSchema>;
export type WorkspaceRecordInput = z.infer<typeof WorkspaceRecordInputSchema>;
export type WorkspaceRecordKind = WorkspaceRecordInput["kind"];

export type WorkspaceRecord = WorkspaceRecordInput & {
  createdAt: string;
  updatedAt: string;
};

export function parseWorkspaceRecordInput(value: unknown): WorkspaceRecordInput {
  return WorkspaceRecordInputSchema.parse(value);
}
