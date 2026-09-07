import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = process.cwd();
const outputPath = resolve(process.argv[2] ?? "apps/web/src/lib/published-data.json");
const morphScopeRoot = join(repositoryRoot, ".morphscope");
const allowlistPath = resolve(process.argv[3] ?? "scripts/published-run-allowlist.json");

type JsonRecord = Record<string, unknown>;

if (!existsSync(morphScopeRoot)) {
  throw new Error(".morphscope is required; run at least one real local task before publishing");
}

const allowlist = readJson(allowlistPath);
const allowlistedRunIds = new Set(
  isRecord(allowlist) && Array.isArray(allowlist.runIds)
    ? allowlist.runIds.filter((value): value is string => typeof value === "string")
    : [],
);
if (allowlistedRunIds.size === 0) {
  throw new Error(`published run allowlist is empty or invalid: ${allowlistPath}`);
}

const runFiles = findFiles(morphScopeRoot, "run.json");
const runsById = new Map<string, JsonRecord>();
for (const sourceFile of runFiles) {
  const payload = readJson(sourceFile);
  if (!payload) continue;
  const run = isRecord(payload?.run) && typeof payload.run.id === "string" ? payload.run : null;
  if (!run) continue;
  const runId = run.id as string;
  if (!allowlistedRunIds.has(runId)) continue;
  const artifactId = typeof run.finalPatchArtifactId === "string" ? run.finalPatchArtifactId : null;
  const patch = artifactId ? readArtifact(sourceFile, artifactId) : null;
  const publishedRun = sanitize({
    run: projectRun(payload.run),
    evaluation: projectEvaluation(payload.evaluation),
    edit: projectEdit(payload.edit),
    context: projectContext(payload.context),
    routing: projectRouting(payload.routing),
    trace: projectTrace(payload.trace),
    search: projectSearch(payload.search),
    ...(patch !== null ? { patch } : {}),
  });
  runsById.set(runId, publishedRun);
}

const missingRunIds = [...allowlistedRunIds].filter((runId) => !runsById.has(runId));
if (missingRunIds.length > 0) {
  throw new Error(
    `published run allowlist references missing persisted runs: ${missingRunIds.join(", ")}`,
  );
}

if (runsById.size < 2)
  throw new Error("at least two persisted runs are required for hosted comparison");

const publishedTasks = new Map<string, JsonRecord>();
for (const publishedRun of runsById.values()) {
  const run = isRecord(publishedRun.run) ? publishedRun.run : null;
  const taskId = run && typeof run.taskId === "string" ? run.taskId : null;
  if (taskId) publishedTasks.set(taskId, { id: taskId, ...taskDefinition(taskId) });
}
const experiments = findFiles(join(morphScopeRoot, "experiments"), "experiment.json")
  .map(readJson)
  .filter(
    (value): value is JsonRecord =>
      isRecord(value) &&
      isRecord(value.experiment) &&
      allowlistedConfigurations(value.configurations).length > 0,
  )
  .map((value) => {
    const task = projectTask(value.task);
    if (typeof task.id === "string") publishedTasks.set(task.id, sanitize(task));
    return sanitize({
      experiment: projectRecord(value.experiment, [
        "id",
        "name",
        "taskSetVersion",
        "sourceCommit",
        "status",
      ]),
      task,
      ...(isRecord(value.fixedVariables)
        ? { fixedVariables: projectFixedVariables(value.fixedVariables) }
        : {}),
      variedVariable: value.variedVariable,
      configurations: allowlistedConfigurations(value.configurations).map((configuration) => {
        const search = projectSearch(configuration.search);
        return {
          ...projectRecord(configuration, [
            "id",
            "searchProvider",
            "editProvider",
            "contextProvider",
            "routingPolicy",
            "runId",
            "terminalState",
            "downstreamSuccess",
          ]),
          ...(search ? { search } : {}),
        };
      }),
    });
  });

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();

writeFileSync(
  outputPath,
  JSON.stringify(
    {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      provenance: {
        kind: "sanitized-local-artifacts",
        sourceCommit,
        runCount: runsById.size,
        experimentCount: experiments.length,
        note: "Generated from persisted MorphScope traces; hosted mode is read-only.",
      },
      runs: [...runsById.values()].sort((left, right) => timestamp(right) - timestamp(left)),
      tasks: [...publishedTasks.values()].sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
      experiments,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
execFileSync(resolve(repositoryRoot, "node_modules/.bin/prettier"), ["--write", outputPath], {
  cwd: repositoryRoot,
  stdio: "ignore",
});

console.log(
  JSON.stringify({ outputPath, runs: runsById.size, experiments: experiments.length }, null, 2),
);

function readArtifact(sourceFile: string, artifactId: string): string | null {
  if (!/^[a-f0-9]{64}$/u.test(artifactId)) return null;
  const artifactPath = join(
    dirname(sourceFile),
    "artifacts",
    "sha256",
    artifactId.slice(0, 2),
    artifactId,
  );
  try {
    const stat = lstatSync(artifactPath);
    return stat.isFile() && !stat.isSymbolicLink() ? readFileSync(artifactPath, "utf8") : null;
  } catch {
    return null;
  }
}

function findFiles(root: string, filename: string): string[] {
  const files: string[] = [];
  walk(root, files, filename);
  return files;
}

function walk(directory: string, files: string[], filename: string): void {
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
    if (entry.isDirectory()) walk(path, files, filename);
    else if (entry.isFile() && entry.name === filename) files.push(path);
  }
}

function readJson(sourceFile: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(sourceFile, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sanitize(value: unknown): JsonRecord {
  return sanitizeValue(value) as JsonRecord;
}

function projectRun(value: unknown): JsonRecord {
  return projectRecord(value, [
    "id",
    "experimentId",
    "taskId",
    "configurationId",
    "traceId",
    "repositoryCommit",
    "MorphScopeCommit",
    "provider",
    "model",
    "startedAt",
    "completedAt",
    "terminalState",
    "totalLatency",
    "totalInputTokens",
    "totalOutputTokens",
    "totalCost",
    "costBasis",
    "costCoverage",
    "score",
    "failureCategory",
    "finalPatchArtifactId",
    "artifactIds",
  ]);
}

function projectEvaluation(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...projectRecord(value, ["passed", "score", "terminalState", "changedFiles"]),
    ...(isRecord(value.patchStatistics)
      ? {
          patchStatistics: projectRecord(value.patchStatistics, [
            "changedFiles",
            "linesAdded",
            "linesRemoved",
            "linesModified",
            "patchBytes",
            "outOfScopeFiles",
          ]),
        }
      : {}),
    ...(isRecord(value.command) ? { command: projectCommand(value.command) } : {}),
    ...(Array.isArray(value.validations)
      ? {
          validations: value.validations.filter(isRecord).map((validation) => ({
            ...projectRecord(validation, ["kind", "command", "passed"]),
            ...(isRecord(validation.commandResult)
              ? { commandResult: projectCommand(validation.commandResult) }
              : {}),
          })),
        }
      : {}),
    ...(isRecord(value.failureClassification)
      ? {
          failureClassification: projectRecord(value.failureClassification, [
            "category",
            "confidence",
            "reason",
          ]),
        }
      : {}),
  };
}

function projectCommand(value: JsonRecord): JsonRecord {
  return projectRecord(value, [
    "command",
    "args",
    "exitCode",
    "signal",
    "durationMs",
    "timedOut",
    "truncated",
  ]);
}

function projectEdit(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...projectRecord(value, [
      "provider",
      "success",
      "originalSha256",
      "finalSha256",
      "retryCount",
      "latencyMs",
    ]),
    ...(isRecord(value.syntax) ? { syntax: projectRecord(value.syntax, ["status"]) } : {}),
  };
}

function projectContext(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...projectRecord(value, [
      "provider",
      "model",
      "configuration",
      "contextLimitBytes",
      "downstreamSuccess",
    ]),
    ...(Array.isArray(value.profiles)
      ? {
          profiles: value.profiles.filter(isRecord).map((profile) => ({
            ...projectRecord(profile, ["step", "label", "status", "beforeSha256", "afterSha256"]),
            ...(isRecord(profile.profile)
              ? {
                  profile: projectRecord(profile.profile, [
                    "strategy",
                    "provider",
                    "model",
                    "beforeBytes",
                    "afterBytes",
                    "beforeMessages",
                    "afterMessages",
                    "beforeLines",
                    "afterLines",
                    "retainedRatio",
                    "toolOutputBytes",
                    "toolOutputShare",
                    "retainedToolOutputBytes",
                    "retainedToolOutputShare",
                    "retainedSourceBytes",
                    "informationLoss",
                    "informationLossBytes",
                    "estimatedFutureModelCallsSaved",
                    "estimatedFutureInputBytesSaved",
                    "modelContextLimitBytes",
                    "latencyMs",
                    "costUsd",
                  ]),
                }
              : {}),
          })),
        }
      : {}),
  };
}

function projectRouting(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...projectRecord(value, ["policyVersion"]),
    ...(Array.isArray(value.decisions)
      ? {
          decisions: value.decisions.filter(isRecord).map((decision) => ({
            ...projectRecord(decision, ["route", "selected", "policyVersion", "reason"]),
            ...(isRecord(decision.features)
              ? { features: projectScalarRecord(decision.features) }
              : {}),
          })),
        }
      : {}),
  };
}

function projectSearch(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...projectRecord(value, ["provider", "model", "contextSource"]),
    ...(Array.isArray(value.contexts) ? { contextCount: value.contexts.length } : {}),
    ...(Array.isArray(value.matches) ? { matchCount: value.matches.length } : {}),
  };
}

function projectTask(value: unknown): JsonRecord {
  const task = projectRecord(value, [
    "id",
    "repository",
    "commit",
    "issue",
    "setup",
    "evaluation",
    "tags",
  ]);
  if (typeof task.id !== "string") return task;
  return { ...taskDefinition(task.id), ...task };
}

function taskDefinition(taskId: string): JsonRecord {
  const taskRoot = join(repositoryRoot, "benchmarks", "tasks");
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = readdirSync(taskRoot, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return { id: taskId };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:yaml|yml|json)$/u.test(entry.name)) continue;
    const definition = readTaskDefinition(join(taskRoot, entry.name));
    if (definition?.id === taskId) return definition;
  }
  return { id: taskId };
}

function readTaskDefinition(sourceFile: string): JsonRecord | null {
  const payload = readJson(sourceFile);
  if (payload && typeof payload.id === "string") {
    return projectRecord(payload, [
      "id",
      "repository",
      "commit",
      "issue",
      "setup",
      "evaluation",
      "tags",
    ]);
  }
  let source: string;
  try {
    source = readFileSync(sourceFile, "utf8");
  } catch {
    return null;
  }
  const value = (key: string) => {
    const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"));
    return match ? unquote(match[1].trim()) : undefined;
  };
  const id = value("id");
  if (!id) return null;
  const tags = [...source.matchAll(/^\s+-\s+(.+)$/gmu)].map((match) => unquote(match[1].trim()));
  return {
    id,
    ...(value("repository") ? { repository: value("repository") } : {}),
    ...(value("commit") ? { commit: value("commit") } : {}),
    ...(value("issue") ? { issue: value("issue") } : {}),
    ...(value("setup") ? { setup: value("setup") } : {}),
    ...(value("evaluation") ? { evaluation: value("evaluation") } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function projectTrace(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(Array.isArray(value.spans)
      ? { spans: value.spans.filter(isRecord).map(projectSpan) }
      : { spans: [] }),
    ...(Array.isArray(value.events)
      ? { events: value.events.filter(isRecord).map(projectEvent) }
      : { events: [] }),
  };
}

function projectSpan(value: JsonRecord): JsonRecord {
  return {
    ...projectRecord(value, [
      "spanId",
      "traceId",
      "parentSpanId",
      "type",
      "start",
      "end",
      "status",
      "inputArtifactIds",
      "outputArtifactIds",
      "tokenUsage",
      "cost",
    ]),
    ...(isRecord(value.attributes) ? { attributes: projectScalarRecord(value.attributes) } : {}),
    ...(isRecord(value.error) && typeof value.error.category === "string"
      ? { error: { category: value.error.category, message: "[redacted]" } }
      : {}),
  };
}

function projectEvent(value: JsonRecord): JsonRecord {
  return {
    ...projectRecord(value, ["eventId", "traceId", "spanId", "type", "occurredAt"]),
    ...(isRecord(value.attributes) ? { attributes: projectScalarRecord(value.attributes) } : {}),
  };
}

function projectRecord(value: unknown, keys: readonly string[]): JsonRecord {
  if (!isRecord(value)) return {};
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function projectScalarRecord(value: JsonRecord): JsonRecord {
  const allowedKeys = new Set([
    "provider",
    "model",
    "operation",
    "status",
    "providerStatus",
    "providerLatencyMs",
    "turn",
    "action",
    "source",
    "path",
    "route",
    "selected",
    "policyVersion",
    "reason",
    "contextBytes",
    "uniqueFiles",
    "responseLength",
    "responseSha256",
    "finishReason",
    "latencyMs",
    "durationMs",
    "nominalCostUsd",
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => allowedKeys.has(key) && isSafeScalar(entry)),
  );
}

function projectFixedVariables(value: JsonRecord): JsonRecord {
  return {
    ...projectRecord(value, ["reasoningProvider", "reasoningModel", "sandbox"]),
    ...(isRecord(value.resourceLimits)
      ? {
          resourceLimits: projectRecord(value.resourceLimits, [
            "maxDurationMs",
            "maxInputTokens",
            "maxOutputTokens",
            "maxTotalTokens",
            "maxCostUsd",
            "maxNominalCostUsd",
            "maxTurns",
            "maxMemoryMb",
          ]),
        }
      : {}),
  };
}

function allowlistedConfigurations(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (configuration): configuration is JsonRecord =>
      isRecord(configuration) &&
      typeof configuration.runId === "string" &&
      allowlistedRunIds.has(configuration.runId),
  );
}

function isSafeScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (
    key &&
    /api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|private[_-]?key|credential/iu.test(
      key,
    )
  ) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return value
      .replaceAll(repositoryRoot, "workspace")
      .replaceAll("/private/tmp/", "workspace/")
      .replaceAll("/private/var/", "workspace/")
      .replace(
        /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu,
        "[PRIVATE KEY REDACTED]",
      )
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, "sk-[REDACTED]")
      .replace(/\bgsk_[A-Za-z0-9_-]{8,}/gu, "gsk_[REDACTED]")
      .replace(/\b(?:ghp|github_pat|xoxb|npm|AIza)[A-Za-z0-9_-]+/gu, "[CREDENTIAL REDACTED]")
      .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, sanitizeValue(entry, entryKey)]),
    );
  }
  return value;
}

function timestamp(value: JsonRecord): number {
  const run = isRecord(value.run) ? value.run : {};
  const date = typeof run.completedAt === "string" ? run.completedAt : run.startedAt;
  return typeof date === "string" ? Date.parse(date) || 0 : 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value.startsWith("'") && value.endsWith("'")
      ? value.slice(1, -1)
      : value;
}
