import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { aggregateRuns } from "@morphscope/evaluator";
import { RunSchema, type Run } from "@morphscope/schemas";

const MAX_JSON_BYTES = 8 * 1024 * 1024;

export type TraceSpanRecord = {
  spanId: string;
  parentSpanId: string | null;
  type: string;
  start: string;
  end: string | null;
  status: string;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens?: number } | null;
  cost?: number | null;
  attributes?: Record<string, unknown>;
  error?: { category: string; message: string } | null;
};

export type TraceEventRecord = {
  eventId: string;
  spanId: string | null;
  type: string;
  occurredAt: string;
  attributes: Record<string, unknown>;
};

export type EvaluationRecord = {
  passed: boolean;
  score: number | null;
  terminalState: string;
  command?: {
    command?: string;
    args?: string[];
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  };
  diff?: string;
  changedFiles?: string[];
  patchStatistics?: {
    changedFiles: string[];
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
    patchBytes: number;
    outOfScopeFiles: string[];
  };
  validations?: Array<{
    kind: string;
    command: string;
    passed: boolean;
    commandResult?: { stdout?: string; stderr?: string; exitCode?: number | null };
  }>;
  failureClassification?: { category: string | null; confidence: string; reason: string };
  analysisMetadata?: Run["analysisMetadata"];
};

export type EditRecord = {
  provider: string;
  success: boolean;
  originalSha256: string;
  requestedEdit: string;
  finalSha256?: string;
  unifiedDiff: string;
  syntax: { status: string; message?: string };
  retryCount: number;
  latencyMs: number;
  metadata: Record<string, unknown> | null;
  error?: string;
};

export type ContextProfileRecord = {
  step: number;
  label: string;
  status: string;
  beforeText: string;
  afterText: string;
  beforeSha256: string;
  afterSha256: string;
  profile: {
    strategy: string;
    provider: string;
    model: string;
    beforeBytes: number;
    afterBytes: number;
    beforeMessages: number;
    afterMessages: number;
    beforeLines: number;
    afterLines: number;
    retainedRatio: number;
    toolOutputBytes: number;
    toolOutputShare: number;
    retainedToolOutputBytes: number;
    retainedToolOutputShare: number;
    retainedSourceBytes: number;
    informationLoss: string;
    informationLossBytes: number | null;
    estimatedFutureModelCallsSaved: number;
    estimatedFutureInputBytesSaved: number;
    modelContextLimitBytes: number;
    latencyMs: number;
    costUsd: number | null;
    providerBeforeBytes?: number;
    providerAfterBytes?: number;
    usage: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  } | null;
  downstreamSuccess: boolean | null;
};

export type ContextRecord = {
  provider: string;
  model: string;
  configuration: string;
  contextLimitBytes: number;
  expectedMarker: string;
  downstreamSuccess: boolean | null;
  profiles: ContextProfileRecord[];
};

export type StoredRun = {
  run: Run;
  evaluation: EvaluationRecord | null;
  edit: EditRecord | null;
  context: ContextRecord | null;
  trace: { spans: TraceSpanRecord[]; events: TraceEventRecord[] };
  search: Record<string, unknown> | null;
  patch: string | null;
  sourceFile: string;
};

export type TaskSummary = {
  id: string;
  repository: string;
  commit: string;
  issue: string;
  setup: string;
  evaluation: string;
  tags: string[];
  sourceFile: string | null;
};

export type ExperimentManifest = {
  schemaVersion?: number;
  experiment: {
    id: string;
    name: string;
    taskSetVersion?: string;
    sourceCommit?: string;
    status?: string;
  };
  task?: { id?: string; repository?: string; commit?: string };
  fixedVariables?: Record<string, unknown>;
  variedVariable?: string;
  configurations?: Array<{
    id: string;
    searchProvider?: string;
    editProvider?: string;
    contextProvider?: string;
    runId?: string;
    terminalState?: string;
    search?: Record<string, unknown> | null;
    downstreamSuccess?: boolean | null;
  }>;
  comparison?: Record<string, unknown>;
  sourceFile: string;
};

export type ExperimentRecord = Omit<ExperimentManifest, "task"> & {
  runs: StoredRun[];
  summary: ReturnType<typeof aggregateRuns>;
  task: TaskSummary | null;
};

export function loadRuns(): StoredRun[] {
  const files = findFiles(morphScopeRoot(), "run.json");
  const storedRuns = files
    .map((file) => readStoredRun(file))
    .filter((run): run is StoredRun => run !== null)
    .sort((left: StoredRun, right: StoredRun) => timestamp(right) - timestamp(left));
  return storedRuns;
}

export function loadRun(id: string): StoredRun | null {
  return loadRuns().find((storedRun) => storedRun.run.id === id) ?? null;
}

export function loadExperiments(runs = loadRuns()): ExperimentRecord[] {
  const byRunId = new Map(runs.map((storedRun) => [storedRun.run.id, storedRun]));
  const records = findFiles(join(morphScopeRoot(), "experiments"), "experiment.json")
    .map((sourceFile) => readExperiment(sourceFile, byRunId))
    .filter((record): record is ExperimentRecord => record !== null);

  const baselineRuns = runs.filter((storedRun) => storedRun.run.experimentId === "local-baseline");
  if (
    baselineRuns.length > 0 &&
    !records.some((record) => record.experiment.id === "local-baseline")
  ) {
    records.push({
      experiment: {
        id: "local-baseline",
        name: "Local baseline runs",
        status: "completed",
      },
      configurations: [{ id: "baseline", runId: baselineRuns[0].run.id }],
      runs: baselineRuns,
      summary: aggregateRuns(baselineRuns.map((storedRun) => storedRun.run)),
      task: loadTaskSummary(baselineRuns[0].run.taskId),
      sourceFile: join(morphScopeRoot(), "runs"),
    });
  }

  return records.sort(
    (left, right) => fileTimestamp(right.sourceFile) - fileTimestamp(left.sourceFile),
  );
}

export function loadExperiment(id: string): ExperimentRecord | null {
  return loadExperiments().find((record) => record.experiment.id === id) ?? null;
}

export function loadTaskSummary(id: string): TaskSummary | null {
  const taskFiles = findFiles(join(repoRoot(), "benchmarks", "tasks"), undefined).filter((file) =>
    /\.(?:yaml|yml|json)$/u.test(file),
  );
  for (const sourceFile of taskFiles) {
    const task = parseTaskSummary(sourceFile);
    if (task?.id === id) return task;
  }
  return null;
}

export function loadTaskRuns(id: string): StoredRun[] {
  return loadRuns().filter((storedRun) => storedRun.run.taskId === id);
}

export function loadDashboardData() {
  const runs = loadRuns();
  const experiments = loadExperiments(runs);
  return { runs, experiments, summary: aggregateRuns(runs.map((storedRun) => storedRun.run)) };
}

function readStoredRun(sourceFile: string): StoredRun | null {
  const payload = readJson(sourceFile);
  if (!isRecord(payload)) return null;
  const parsedRun = RunSchema.safeParse(payload.run);
  if (!parsedRun.success) return null;
  const trace = isRecord(payload.trace) ? payload.trace : {};
  return {
    run: parsedRun.data,
    evaluation: isRecord(payload.evaluation) ? (payload.evaluation as EvaluationRecord) : null,
    edit: isRecord(payload.edit) ? (payload.edit as EditRecord) : null,
    context: isRecord(payload.context) ? (payload.context as ContextRecord) : null,
    trace: {
      spans: Array.isArray(trace.spans) ? (trace.spans as TraceSpanRecord[]) : [],
      events: Array.isArray(trace.events) ? (trace.events as TraceEventRecord[]) : [],
    },
    search: isRecord(payload.search) ? payload.search : null,
    patch: readArtifact(sourceFile, parsedRun.data.finalPatchArtifactId),
    sourceFile,
  };
}

function readExperiment(
  sourceFile: string,
  byRunId: Map<string, StoredRun>,
): ExperimentRecord | null {
  const payload = readJson(sourceFile);
  if (!isRecord(payload) || !isRecord(payload.experiment)) return null;
  const experiment = payload.experiment;
  if (typeof experiment.id !== "string" || typeof experiment.name !== "string") return null;
  const configurations = Array.isArray(payload.configurations)
    ? payload.configurations.filter(isRecord).flatMap((configuration) => {
        if (typeof configuration.id !== "string") return [];
        return [
          {
            id: configuration.id,
            ...(typeof configuration.searchProvider === "string"
              ? { searchProvider: configuration.searchProvider }
              : {}),
            ...(typeof configuration.editProvider === "string"
              ? { editProvider: configuration.editProvider }
              : {}),
            ...(typeof configuration.contextProvider === "string"
              ? { contextProvider: configuration.contextProvider }
              : {}),
            ...(typeof configuration.runId === "string" ? { runId: configuration.runId } : {}),
            ...(typeof configuration.terminalState === "string"
              ? { terminalState: configuration.terminalState }
              : {}),
            ...(isRecord(configuration.search) ? { search: configuration.search } : {}),
            ...(typeof configuration.downstreamSuccess === "boolean" ||
            configuration.downstreamSuccess === null
              ? { downstreamSuccess: configuration.downstreamSuccess }
              : {}),
          },
        ];
      })
    : [];
  const runs = configurations
    .flatMap((configuration) => (configuration.runId ? [byRunId.get(configuration.runId)] : []))
    .filter((run): run is StoredRun => run !== undefined);
  const taskId =
    isRecord(payload.task) && typeof payload.task.id === "string"
      ? payload.task.id
      : runs[0]?.run.taskId;
  return {
    experiment: {
      id: experiment.id,
      name: experiment.name,
      ...(typeof experiment.taskSetVersion === "string"
        ? { taskSetVersion: experiment.taskSetVersion }
        : {}),
      ...(typeof experiment.sourceCommit === "string"
        ? { sourceCommit: experiment.sourceCommit }
        : {}),
      ...(typeof experiment.status === "string" ? { status: experiment.status } : {}),
    },
    ...(isRecord(payload.fixedVariables) ? { fixedVariables: payload.fixedVariables } : {}),
    ...(typeof payload.variedVariable === "string"
      ? { variedVariable: payload.variedVariable }
      : {}),
    ...(isRecord(payload.task) ? { task: payload.task as ExperimentManifest["task"] } : {}),
    ...(Array.isArray(payload.comparison)
      ? {}
      : isRecord(payload.comparison)
        ? { comparison: payload.comparison }
        : {}),
    configurations,
    runs,
    summary: aggregateRuns(runs.map((storedRun) => storedRun.run)),
    task: typeof taskId === "string" ? loadTaskSummary(taskId) : null,
    sourceFile,
  };
}

function readArtifact(sourceFile: string, artifactId: string | null | undefined): string | null {
  if (!artifactId || !/^[a-f0-9]{64}$/u.test(artifactId)) return null;
  const runDirectory = dirname(sourceFile);
  const artifactFile = join(
    runDirectory,
    "artifacts",
    "sha256",
    artifactId.slice(0, 2),
    artifactId,
  );
  return readText(artifactFile);
}

function parseTaskSummary(sourceFile: string): TaskSummary | null {
  if (sourceFile.endsWith(".json")) {
    const payload = readJson(sourceFile);
    if (!isRecord(payload) || typeof payload.id !== "string") return null;
    return {
      id: payload.id,
      repository: stringValue(payload.repository) ?? "Unknown repository",
      commit: stringValue(payload.commit) ?? "Unknown commit",
      issue: stringValue(payload.issue) ?? "No issue text recorded.",
      setup: stringValue(payload.setup) ?? "Not recorded",
      evaluation: stringValue(payload.evaluation) ?? "Not recorded",
      tags: arrayOfStrings(payload.tags),
      sourceFile,
    };
  }
  const source = readText(sourceFile);
  if (!source) return null;
  const value = (key: string) => {
    const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"));
    return match ? unquote(match[1].trim()) : undefined;
  };
  const id = value("id");
  if (!id) return null;
  return {
    id,
    repository: value("repository") ?? "Unknown repository",
    commit: value("commit") ?? "Unknown commit",
    issue: value("issue") ?? "No issue text recorded.",
    setup: value("setup") ?? "Not recorded",
    evaluation: value("evaluation") ?? "Not recorded",
    tags: [...source.matchAll(/^\s+-\s+(.+)$/gmu)].map((match) => unquote(match[1].trim())),
    sourceFile,
  };
}

function findFiles(root: string, filename: string | undefined): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, 0, files, filename);
  return files;
}

function walk(
  directory: string,
  depth: number,
  files: string[],
  filename: string | undefined,
): void {
  if (depth > 7) return;
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
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
    else if (entry.isFile() && (!filename || entry.name === filename)) files.push(path);
  }
}

function readJson(sourceFile: string): Record<string, unknown> | null {
  const source = readText(sourceFile);
  if (!source || Buffer.byteLength(source, "utf8") > MAX_JSON_BYTES) return null;
  try {
    const payload: unknown = JSON.parse(source);
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readText(sourceFile: string): string | null {
  try {
    if (!statSync(sourceFile).isFile() || statSync(sourceFile).size > MAX_JSON_BYTES) return null;
    return readFileSync(sourceFile, "utf8");
  } catch {
    return null;
  }
}

function repoRoot(): string {
  return existsSync(join(process.cwd(), "MorphScope_spec.md"))
    ? process.cwd()
    : resolve(process.cwd(), "../..");
}

function morphScopeRoot(): string {
  return join(repoRoot(), ".morphscope");
}

function timestamp(storedRun: StoredRun): number {
  return Date.parse(storedRun.run.completedAt ?? storedRun.run.startedAt) || 0;
}

function fileTimestamp(sourceFile: string): number {
  try {
    return statSync(sourceFile).mtimeMs;
  } catch {
    return 0;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? unquote(value) : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value.startsWith("'") && value.endsWith("'")
      ? value.slice(1, -1)
      : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
