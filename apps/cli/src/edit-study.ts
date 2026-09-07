import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { evaluateTask, type EvaluationResult } from "@morphscope/evaluator";
import {
  DeterministicEditProvider,
  FullFileEditProvider,
  MorphClient,
  MorphFastApplyEditProvider,
  UnifiedDiffEditProvider,
  type EditProvider,
  type EditResult,
} from "@morphscope/providers";
import { createLocalWorkspace, type LocalWorkspace } from "@morphscope/sandbox";
import {
  RunSchema,
  type FailureCategory,
  type Task,
  type TerminalState,
} from "@morphscope/schemas";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { redactSecrets, redactText, TraceWriter } from "@morphscope/tracing";
import { persistedEvaluation } from "./persistence.js";
import { readJsonFile, readTaskFile } from "./task-file.js";
import type { BaselineAction, BaselinePlan } from "@morphscope/agent-core";
import { createToolbox } from "./toolbox.js";

type BaselineReplaceAction = Extract<BaselineAction, { type: "replace" }>;

type EditStudyConfig = "deterministic" | "unified-diff" | "full-file" | "fast-apply";

type EditStudyOptions = {
  taskPath: string;
  outputPath?: string;
  configurations: EditStudyConfig[];
};

type PersistedEdit = Omit<EditResult, "mergedCode">;

export async function runEditStudy(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const task = readTaskFile(options.taskPath);
  const experimentId = randomUUID();
  const outputRoot = resolve(
    options.outputPath ??
      join(process.cwd(), ".morphscope", "experiments", "edit-study", experimentId),
  );
  mkdirSync(outputRoot, { recursive: true });
  const plan = readPlan(task);
  const results = [];

  for (const configurationId of options.configurations) {
    results.push(await runConfiguration({ task, plan, configurationId, outputRoot, experimentId }));
  }

  const manifest = {
    schemaVersion: 1,
    experiment: {
      id: experimentId,
      name: "Editing strategy study",
      taskSetVersion: task.commit,
      sourceCommit: morphScopeCommit(),
      status: results.every((result) => result.terminalState === "resolved")
        ? "completed"
        : "completed_with_failures",
    },
    task: { id: task.id, repository: task.repository, commit: task.commit },
    fixedVariables: {
      reasoningProvider: "local",
      reasoningModel: "deterministic-baseline",
      retrieval: "fixed-source-file",
      context: "fixed-original-file",
      sandbox: "isolated-local-workspace",
      resourceLimits: task.resourceLimits,
    },
    variedVariable: "editProvider",
    configurations: results.map((result) => ({
      id: result.configurationId,
      editProvider: result.provider,
      runId: result.runId,
      outputRoot: result.outputRoot,
      terminalState: result.terminalState,
      edit: result.edit,
      downstreamSuccess: result.evaluation?.passed ?? null,
    })),
    comparison: compareEditResults(results),
  };
  writeFileSync(join(outputRoot, "experiment.json"), JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify({ experimentId, outputRoot, configurations: manifest.configurations }, null, 2),
  );
  if (results.some((result) => result.terminalState !== "resolved")) process.exitCode = 1;
}

function parseArgs(argv: string[]): EditStudyOptions {
  if (argv[0] !== "experiment" || argv[1] !== "run" || argv[2] !== "edit-study") {
    throw new Error(
      "usage: pnpm morphscope experiment run edit-study [--task <task.yaml|task.json>] [--configs deterministic,unified-diff,full-file] [--include-fast-apply] [--output <dir>]",
    );
  }
  let taskPath = resolve(process.cwd(), "benchmarks/tasks/example.yaml");
  let outputPath: string | undefined;
  let configurations: EditStudyConfig[] = ["deterministic", "unified-diff", "full-file"];
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--task") taskPath = resolve(argv[++index] ?? "");
    else if (argv[index] === "--output") outputPath = argv[++index];
    else if (argv[index] === "--configs") configurations = parseConfigurations(argv[++index] ?? "");
    else if (argv[index] === "--include-fast-apply")
      configurations = [...configurations, "fast-apply"];
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return { taskPath, outputPath, configurations: [...new Set(configurations)] };
}

function parseConfigurations(value: string): EditStudyConfig[] {
  const allowed: EditStudyConfig[] = ["deterministic", "unified-diff", "full-file", "fast-apply"];
  const configurations = value.split(",").map((item) => item.trim()) as EditStudyConfig[];
  if (configurations.length === 0 || configurations.some((item) => !allowed.includes(item))) {
    throw new Error(`--configs must contain only: ${allowed.join(", ")}`);
  }
  return configurations;
}

async function runConfiguration(input: {
  task: Task;
  plan: BaselinePlan;
  configurationId: EditStudyConfig;
  outputRoot: string;
  experimentId: string;
}) {
  const { task, plan, configurationId, outputRoot, experimentId } = input;
  const runId = randomUUID();
  const traceId = randomUUID();
  const runRoot = join(outputRoot, "runs", configurationId);
  mkdirSync(runRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(runRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(runRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("run", {
    attributes: { taskId: task.id, configuration: configurationId, experimentId },
  });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let workspace: LocalWorkspace | undefined;
  let edit: EditResult | undefined;
  let evaluation: EvaluationResult | undefined;
  let terminalState: TerminalState = "environment_error";
  let provider: string = configurationId;
  let model: string = configurationId;
  try {
    const repository = isAbsolute(task.repository)
      ? task.repository
      : resolve(process.cwd(), task.repository);
    workspace = createLocalWorkspace({
      sourcePath: repository,
      commit: task.commit,
      workspaceRoot: join(runRoot, "workspace"),
      resourceLimits: {
        maxDurationMs: task.resourceLimits.maxDurationMs,
        maxCommandOutputBytes: 256_000,
      },
    });
    const replaceAction = plan.actions.find(
      (action): action is BaselineReplaceAction => action.type === "replace",
    );
    if (!replaceAction) throw new Error("edit-study requires a baseline replace action");
    const originalCode = workspace.readFile(replaceAction.path);
    const expectedCode = replaceExact(
      originalCode,
      replaceAction.search,
      replaceAction.replacement,
    );
    const editInput = {
      originalCode,
      requestedEdit: requestedEditFor(configurationId, replaceAction, originalCode, expectedCode),
      instructions: task.issue,
      filePath: replaceAction.path,
      language: "javascript" as const,
    };
    const editSpan = trace.startSpan("edit", {
      attributes: {
        provider: configurationId,
        file: replaceAction.path,
        originalSha256: sha256(originalCode),
      },
    });
    const editProvider = createEditProvider(configurationId, trace, replaceAction);
    try {
      edit = await editProvider.apply(editInput);
      provider = edit.metadata?.provider ?? edit.provider;
      model = edit.metadata?.model ?? edit.provider;
      editSpan.update({
        attributes: {
          provider: edit.provider,
          file: replaceAction.path,
          originalSha256: edit.originalSha256,
          finalSha256: edit.finalSha256 ?? null,
          syntaxStatus: edit.syntax.status,
          retryCount: edit.retryCount,
          latencyMs: edit.latencyMs,
        },
        ...(edit.metadata?.usage?.inputTokens !== undefined &&
        edit.metadata.usage.outputTokens !== undefined
          ? {
              tokenUsage: {
                inputTokens: edit.metadata.usage.inputTokens,
                outputTokens: edit.metadata.usage.outputTokens,
                totalTokens: edit.metadata.usage.totalTokens,
              },
            }
          : {}),
        ...(edit.metadata?.usage?.costUsd !== undefined
          ? { cost: edit.metadata.usage.costUsd }
          : {}),
      });
      editSpan.event("edit_result", {
        provider: edit.provider,
        syntaxStatus: edit.syntax.status,
        retryCount: edit.retryCount,
        originalSha256: edit.originalSha256,
        finalSha256: edit.finalSha256 ?? null,
        changes: countLines(edit.unifiedDiff),
      });
      editSpan.end(
        edit.success ? "ok" : "error",
        edit.success
          ? undefined
          : {
              category:
                edit.syntax.status === "failed" ? "generation_failure" : "application_failure",
              message: traceErrorMessage(
                edit.error ?? "Edit provider returned an unsuccessful result",
              ),
            },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      editSpan.end("error", { category: "provider_failure", message: traceErrorMessage(message) });
      throw error;
    }

    if (!edit.success || !edit.mergedCode) {
      terminalState = "task_failed";
    } else {
      workspace.replaceFile(replaceAction.path, originalCode, edit.mergedCode);
      const validation = evaluateTask({
        task,
        toolbox: createToolbox(workspace),
        timeoutMs: task.resourceLimits.maxDurationMs,
        allowedChangedFiles: [replaceAction.path],
      });
      evaluation = validation;
      terminalState = validation.terminalState;
      trace.recordEvent(rootSpan.spanId, "edit_verification", {
        provider: edit.provider,
        syntaxStatus: edit.syntax.status,
        taskPassed: validation.passed,
        validationExitCode: validation.command.exitCode,
      });
    }

    const diff = workspace.collectDiff().diff;
    const diffArtifact = artifacts.put({
      content: redactText(diff).value,
      mimeType: "text/vnd.git-diff",
      redactionStatus: "redacted-by-trace-boundary",
      producerSpanId: rootSpan.spanId,
    });
    rootSpan.update({ outputArtifactIds: [diffArtifact.sha256] });
    const totalTokens =
      edit?.metadata?.usage?.totalTokens ??
      (edit?.metadata?.usage?.inputTokens ?? 0) + (edit?.metadata?.usage?.outputTokens ?? 0);
    const run = RunSchema.parse({
      id: runId,
      experimentId,
      taskId: task.id,
      configurationId,
      traceId,
      repositoryCommit: task.commit,
      MorphScopeCommit: morphScopeCommit(),
      provider,
      model,
      startedAt,
      completedAt: new Date().toISOString(),
      terminalState,
      totalLatency: Date.now() - startedMs,
      totalInputTokens: edit?.metadata?.usage?.inputTokens ?? 0,
      totalOutputTokens: edit?.metadata?.usage?.outputTokens ?? 0,
      totalCost: edit?.metadata?.usage?.costUsd ?? 0,
      score: evaluation?.score ?? (terminalState === "resolved" ? 1 : 0),
      failureCategory: failureCategory(evaluation, terminalState, edit),
      analysisMetadata: evaluation?.analysisMetadata,
      finalPatchArtifactId: diffArtifact.sha256,
      artifactIds: [diffArtifact.sha256],
      environmentManifest: {
        runtime: process.version,
        platform: process.platform,
        toolVersions: { node: process.version },
      },
    });
    traceStore.upsertRun({ runId, ...run });
    rootSpan.event("run_completed", { terminalState, score: run.score, totalTokens });
    rootSpan.end(
      terminalState === "resolved" ? "ok" : "error",
      terminalState === "resolved"
        ? undefined
        : {
            category: failureCategory(evaluation, terminalState, edit) ?? "application_failure",
            message: `Run ended in ${terminalState}`,
          },
    );
    writeFileSync(
      join(runRoot, "run.json"),
      JSON.stringify(
        {
          run,
          evaluation: persistedEvaluation(evaluation),
          edit: edit ? persistedEdit(edit) : null,
          trace: trace.read(),
        },
        null,
        2,
      ),
    );
    return {
      runId,
      configurationId,
      outputRoot: runRoot,
      provider: edit?.provider ?? provider,
      terminalState,
      edit: edit ? persistedEdit(edit) : null,
      evaluation: evaluation ?? null,
    };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    terminalState = "provider_error";
    rootSpan.event("edit_study_error", { message });
    rootSpan.end("error", {
      category: "provider_failure",
      message: message.length >= 8 ? message : "Provider error",
    });
    writeFileSync(
      join(runRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
    return {
      runId,
      configurationId,
      outputRoot: runRoot,
      provider,
      terminalState,
      edit: edit ? persistedEdit(edit) : null,
      evaluation: evaluation ?? null,
    };
  } finally {
    workspace?.dispose();
    traceStore.close();
  }
}

function createEditProvider(
  configurationId: EditStudyConfig,
  trace: TraceWriter,
  action: BaselineReplaceAction,
): EditProvider {
  switch (configurationId) {
    case "deterministic":
      return new DeterministicEditProvider(({ originalCode }) =>
        replaceExact(originalCode, action.search, action.replacement),
      );
    case "unified-diff":
      return new UnifiedDiffEditProvider();
    case "full-file":
      return new FullFileEditProvider();
    case "fast-apply":
      return new MorphFastApplyEditProvider(new MorphClient({ trace }));
    default:
      return assertNever(configurationId);
  }
}

function requestedEditFor(
  configurationId: EditStudyConfig,
  action: BaselineReplaceAction,
  originalCode: string,
  expectedCode: string,
): string {
  if (configurationId === "unified-diff")
    return makeUnifiedDiff(action.path, originalCode, expectedCode);
  if (configurationId === "full-file") return expectedCode;
  return configurationId === "fast-apply"
    ? `// ... existing code ...\n${action.replacement}\n// ... existing code ...`
    : `Replace exactly: ${action.search} → ${action.replacement}`;
}

function readPlan(task: Task): BaselinePlan {
  const planPath = task.metadata.baselinePlan;
  if (typeof planPath !== "string")
    throw new Error("edit-study requires task metadata.baselinePlan");
  return readJsonFile<BaselinePlan>(resolve(process.cwd(), planPath));
}

function replaceExact(source: string, search: string, replacement: string): string {
  const firstIndex = source.indexOf(search);
  if (firstIndex < 0 || source.indexOf(search, firstIndex + search.length) >= 0) {
    throw new Error("Edit target was missing or ambiguous");
  }
  return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + search.length)}`;
}

function makeUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function persistedEdit(edit: EditResult): PersistedEdit {
  return {
    provider: edit.provider,
    success: edit.success,
    originalSha256: edit.originalSha256,
    requestedEdit: redactText(edit.requestedEdit).value,
    finalSha256: edit.finalSha256,
    unifiedDiff: redactText(edit.unifiedDiff).value,
    syntax: edit.syntax,
    retryCount: edit.retryCount,
    latencyMs: edit.latencyMs,
    metadata: edit.metadata,
    error: edit.error ? redactText(edit.error).value : undefined,
  };
}

function countLines(diff: string) {
  const lines = diff.split(/\r?\n/);
  return {
    added: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    removed: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
  };
}

function compareEditResults(
  results: Array<{
    configurationId: EditStudyConfig;
    edit: PersistedEdit | null;
    terminalState: TerminalState;
    evaluation: EvaluationResult | null;
  }>,
) {
  return {
    fixedVariables: [
      "reasoningProvider",
      "reasoningModel",
      "retrieval",
      "context",
      "sandbox",
      "resourceLimits",
    ],
    variedVariables: ["editProvider"],
    configurations: results.map((result) => ({
      id: result.configurationId,
      terminalState: result.terminalState,
      syntaxStatus: result.edit?.syntax.status ?? null,
      retryCount: result.edit?.retryCount ?? null,
      applyLatencyMs: result.edit?.latencyMs ?? null,
      originalSha256: result.edit?.originalSha256 ?? null,
      finalSha256: result.edit?.finalSha256 ?? null,
      downstreamSuccess: result.evaluation?.passed ?? null,
      changedFiles: result.evaluation?.patchStatistics.changedFiles ?? [],
    })),
  };
}

function failureCategory(
  evaluation: EvaluationResult | undefined,
  terminalState: TerminalState,
  edit: EditResult | undefined,
): FailureCategory | null {
  if (evaluation?.failureClassification.category) return evaluation.failureClassification.category;
  if (terminalState === "provider_error") return "provider_failure";
  if (edit && !edit.success)
    return edit.syntax.status === "failed" ? "generation_failure" : "application_failure";
  if (terminalState === "task_failed") return "verification_failure";
  return null;
}

function morphScopeCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  } catch {
    return "uncommitted-development";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported edit provider: ${String(value)}`);
}

function traceErrorMessage(message: string): string {
  const redacted = redactSecrets(message).slice(0, 512);
  return redacted.length >= 8 ? redacted : "Edit provider failed";
}
