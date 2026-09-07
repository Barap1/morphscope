import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RunSchema, type Run } from "@morphscope/schemas";
import { readJsonFile, readTaskFile } from "./task-file.js";
import type { BaselinePlan } from "@morphscope/agent-core";

type RunPayload = {
  run: Run;
  trace?: { spans?: unknown[]; events?: unknown[] };
  [key: string]: unknown;
};

export async function runProductCommand(argv: string[]): Promise<void> {
  if (argv[0] === "task") return runTaskCommand(argv);
  if (argv[0] === "experiment" && argv[1] === "list") return listExperiments(argv);
  if (argv[0] === "experiment" && argv[1] === "resume") return resumeExperiment(argv);
  if (argv[0] === "trace" && argv[1] === "export") return exportTrace(argv);
  if (argv[0] === "results" && argv[1] === "export") return exportResults(argv);
  if (argv[0] === "artifact" && argv[1] === "list") return listArtifacts(argv);
  throw new Error(
    "usage: task validate|list, experiment list|resume, trace export, results export, or artifact list",
  );
}

async function runTaskCommand(argv: string[]): Promise<void> {
  if (argv[1] === "list") {
    const tasks = taskFiles().flatMap((file) => {
      try {
        const task = readTaskFile(file);
        return [{ id: task.id, repository: task.repository, tags: task.tags, file }];
      } catch {
        return [];
      }
    });
    console.log(JSON.stringify({ tasks }, null, 2));
    return;
  }
  if (argv[1] !== "validate" || !argv[2]) {
    throw new Error("usage: pnpm morphscope task validate <task.yaml|task.json> or task list");
  }
  const taskPath = resolve(argv[2]);
  const task = readTaskFile(taskPath);
  const planPathValue = task.metadata.baselinePlan;
  const checks = [
    { name: "task_schema", passed: true },
    { name: "repository_exists", passed: existsSync(resolve(process.cwd(), task.repository)) },
    {
      name: "baseline_plan",
      passed:
        typeof planPathValue === "string" && existsSync(resolve(process.cwd(), planPathValue)),
    },
  ];
  if (typeof planPathValue === "string" && existsSync(resolve(process.cwd(), planPathValue))) {
    const plan = readJsonFile<BaselinePlan>(resolve(process.cwd(), planPathValue));
    checks.push({
      name: "baseline_plan_version",
      passed: plan.version === 1 && Array.isArray(plan.actions),
    });
  }
  const valid = checks.every((check) => check.passed);
  console.log(
    JSON.stringify({ valid, task: { id: task.id, repository: task.repository }, checks }, null, 2),
  );
  if (!valid) process.exitCode = 1;
}

async function listExperiments(argv: string[]): Promise<void> {
  const filter = optionValue(argv, "--filter")?.toLowerCase();
  const records = findFiles(join(morphScopeRoot(), "experiments"), "experiment.json")
    .flatMap((file) => {
      const payload = readJson(file);
      if (!payload || !isRecord(payload.experiment)) return [];
      const experiment = payload.experiment;
      const id = stringValue(experiment.id);
      const name = stringValue(experiment.name);
      if (!id || !name) return [];
      const record = { id, name, status: stringValue(experiment.status), file };
      if (filter && !JSON.stringify(record).toLowerCase().includes(filter)) return [];
      return [record];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  console.log(JSON.stringify({ filter: filter ?? null, experiments: records }, null, 2));
}

async function resumeExperiment(argv: string[]): Promise<void> {
  const id = argv[2];
  if (!id) throw new Error("usage: pnpm morphscope experiment resume <experiment-id>");
  const file = findFiles(join(morphScopeRoot(), "experiments"), "experiment.json").find(
    (candidate) => {
      const payload = readJson(candidate);
      return isRecord(payload?.experiment) && payload.experiment.id === id;
    },
  );
  if (!file) throw new Error(`experiment not found: ${id}`);
  const payload = readJson(file);
  const configurations = Array.isArray(payload?.configurations) ? payload.configurations : [];
  const runIds = configurations
    .filter(isRecord)
    .map((configuration) => stringValue(configuration.runId))
    .filter((value): value is string => value !== undefined);
  const persistedRuns = new Set(loadRunPayloads().map((payload) => payload.run.id));
  const missingRunIds = runIds.filter((runId) => !persistedRuns.has(runId));
  const experiment = isRecord(payload?.experiment) ? payload.experiment : null;
  const status = stringValue(experiment?.status);
  const complete =
    missingRunIds.length === 0 && (status === "completed" || status === "completed_with_failures");
  console.log(
    JSON.stringify(
      {
        id,
        status: complete ? "already_complete" : "resume_required",
        missingRunIds,
        message: complete
          ? "All manifest-linked runs are present; no duplicate run was started."
          : "The manifest is incomplete. Re-run the original study command with a new output directory after reviewing the missing run IDs.",
      },
      null,
      2,
    ),
  );
  if (!complete) process.exitCode = 2;
}

async function exportTrace(argv: string[]): Promise<void> {
  const runId = argv[2];
  if (!runId)
    throw new Error("usage: pnpm morphscope trace export <run-id> [--output <file.json>]");
  const payload = findRunPayload(runId);
  if (!payload) throw new Error(`run not found: ${runId}`);
  const output = optionValue(argv, "--output");
  const exported = { run: payload.run, trace: payload.trace ?? { spans: [], events: [] } };
  writeOrPrint(exported, output ? resolve(output) : undefined);
}

async function exportResults(argv: string[]): Promise<void> {
  const format = optionValue(argv, "--format") ?? "json";
  if (format !== "json" && format !== "csv") throw new Error("--format must be json or csv");
  const filter = optionValue(argv, "--experiment");
  const runs = loadRunPayloads()
    .map((payload) => payload.run)
    .filter((run) => !filter || run.experimentId === filter);
  const output = optionValue(argv, "--output");
  if (format === "json") writeOrPrint({ runs }, output ? resolve(output) : undefined);
  else {
    const header = [
      "id",
      "experimentId",
      "taskId",
      "configurationId",
      "terminalState",
      "score",
      "totalLatency",
      "totalCost",
      "provider",
      "model",
    ];
    const rows = runs.map((run) =>
      [
        run.id,
        run.experimentId,
        run.taskId,
        run.configurationId,
        run.terminalState,
        run.score ?? "",
        run.totalLatency,
        run.totalCost,
        run.provider,
        run.model,
      ]
        .map(csvCell)
        .join(","),
    );
    writeOrPrint(
      [header.join(","), ...rows].join("\n") + "\n",
      output ? resolve(output) : undefined,
    );
  }
}

async function listArtifacts(argv: string[]): Promise<void> {
  const runId = argv[2];
  if (!runId) throw new Error("usage: pnpm morphscope artifact list <run-id>");
  const payload = findRunPayload(runId);
  if (!payload) throw new Error(`run not found: ${runId}`);
  const runFile = findFiles(morphScopeRoot(), "run.json").find(
    (file) => readPayload(file)?.run.id === runId,
  );
  const directory = runFile ? dirname(runFile) : "";
  const artifacts = (payload.run.artifactIds ?? []).map((id) => ({
    id,
    path: directory ? join(directory, "artifacts", "sha256", id.slice(0, 2), id) : null,
  }));
  console.log(JSON.stringify({ runId, artifacts }, null, 2));
}

function taskFiles(): string[] {
  return readdirSync(join(process.cwd(), "benchmarks", "tasks"), { encoding: "utf8" })
    .filter((file) => /\.ya?ml$/u.test(file) && !file.includes(".baseline"))
    .map((file) => join(process.cwd(), "benchmarks", "tasks", file))
    .sort();
}

function loadRunPayloads(): RunPayload[] {
  return findFiles(morphScopeRoot(), "run.json")
    .map((file) => readPayload(file))
    .filter((payload): payload is RunPayload => payload !== null);
}

function findRunPayload(runId: string): RunPayload | null {
  return loadRunPayloads().find((payload) => payload.run.id === runId) ?? null;
}

function readPayload(file: string): RunPayload | null {
  try {
    const payload: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(payload)) return null;
    const run = RunSchema.safeParse(payload.run);
    return run.success ? ({ ...payload, run: run.data } as RunPayload) : null;
  } catch {
    return null;
  }
}

function findFiles(root: string, filename: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, 0, files, filename);
  return files;
}

function walk(directory: string, depth: number, files: string[], filename: string): void {
  if (depth > 8) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "workspace" || entry.name === "node_modules" || entry.name === ".git")
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, depth + 1, files, filename);
    else if (entry.isFile() && entry.name === filename) files.push(path);
  }
}

function writeOrPrint(value: unknown, output: string | undefined): void {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!output) {
    console.log(text);
    return;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  console.log(JSON.stringify({ output }, null, 2));
}

function optionValue(argv: string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  return index >= 0 ? argv[index + 1] : undefined;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function morphScopeRoot(): string {
  return join(process.cwd(), ".morphscope");
}
