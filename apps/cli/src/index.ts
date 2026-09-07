import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runBaselineAgent, type BaselinePlan } from "@morphscope/agent-core";
import { evaluateTask, type EvaluationResult } from "@morphscope/evaluator";
import { createLocalWorkspace, type LocalWorkspace } from "@morphscope/sandbox";
import { RunSchema, type FailureCategory, type TerminalState } from "@morphscope/schemas";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { TraceWriter, redactText } from "@morphscope/tracing";
import { persistedEvaluation } from "./persistence.js";
import { runEditStudy } from "./edit-study.js";
import { runContextStudy } from "./context-study.js";
import { runAdaptiveStudy } from "./adaptive-study.js";
import { runAnalysis } from "./analyze.js";
import { runSearchStudy } from "./search-study.js";
import { readJsonFile, readTaskFile } from "./task-file.js";
import { changedFilesFromPlan, createToolbox } from "./toolbox.js";

type CliOptions = { taskPath: string; config: string; outputPath?: string };

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] !== "run" || !argv[1]) {
    throw new Error(
      "usage: pnpm morphscope run <task.yaml|task.json> --config baseline [--output <dir>]",
    );
  }
  let config = "baseline";
  let outputPath: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--config") config = argv[++index] ?? "";
    else if (argv[index] === "--output") outputPath = argv[++index];
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  if (config !== "baseline")
    throw new Error(`unsupported config: ${config}; the current runner provides baseline`);
  return { taskPath: resolve(argv[1]), config, outputPath };
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

function failureCategory(
  result: EvaluationResult | undefined,
  terminalState: TerminalState,
): FailureCategory | null {
  if (result?.failureClassification.category) return result.failureClassification.category;
  switch (terminalState) {
    case "environment_error":
      return "environment_failure";
    case "budget_exhausted":
      return "budget_exhaustion";
    case "task_failed":
      return result && !result.passed ? "verification_failure" : "application_failure";
    case "timeout":
      return "budget_exhaustion";
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "analysis") {
    await runAnalysis(argv);
    return;
  }
  if (argv[0] === "experiment") {
    if (argv[2] === "edit-study") await runEditStudy(argv);
    else if (argv[2] === "context-study") await runContextStudy(argv);
    else if (argv[2] === "adaptive-study") await runAdaptiveStudy(argv);
    else await runSearchStudy(argv);
    return;
  }
  const options = parseArgs(argv);
  const task = readTaskFile(options.taskPath);
  const runId = randomUUID();
  const traceId = randomUUID();
  const outputRoot = resolve(
    options.outputPath ?? join(process.cwd(), ".morphscope", "runs", runId),
  );
  mkdirSync(outputRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(outputRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(outputRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("run", {
    attributes: { taskId: task.id, configuration: options.config },
  });
  let workspace: LocalWorkspace | undefined;
  let evaluation: EvaluationResult | undefined;
  let terminalState:
    | "resolved"
    | "task_failed"
    | "provider_error"
    | "environment_error"
    | "timeout"
    | "budget_exhausted"
    | "cancelled" = "environment_error";
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    const repository = isAbsolute(task.repository)
      ? task.repository
      : resolve(process.cwd(), task.repository);
    workspace = createLocalWorkspace({
      sourcePath: repository,
      commit: task.commit,
      workspaceRoot: join(outputRoot, "workspace"),
      resourceLimits: {
        maxDurationMs: task.resourceLimits.maxDurationMs,
        maxCommandOutputBytes: 256_000,
      },
    });
    const setup = workspace.runSetup(task.setup, task.resourceLimits.maxDurationMs);
    trace.recordEvent(rootSpan.spanId, "setup_completed", {
      exitCode: setup.exitCode,
      durationMs: setup.durationMs,
      timedOut: setup.timedOut,
    });
    if (setup.exitCode !== 0 || setup.timedOut) {
      terminalState = setup.timedOut ? "timeout" : "environment_error";
    } else {
      const planPathValue = task.metadata.baselinePlan;
      if (typeof planPathValue !== "string")
        throw new Error("task metadata.baselinePlan is required for baseline");
      const planPath = resolve(process.cwd(), planPathValue);
      const plan = readJsonFile<BaselinePlan>(planPath);
      const validationCommands = validationCommandsFromMetadata(task.metadata);
      const agent = runBaselineAgent({
        toolbox: createToolbox(workspace),
        plan,
        trace,
        resourceLimits: task.resourceLimits,
      });
      terminalState = agent.terminalState;
      if (terminalState === "resolved") {
        evaluation = evaluateTask({
          task,
          toolbox: createToolbox(workspace),
          timeoutMs: task.resourceLimits.maxDurationMs,
          allowedChangedFiles: changedFilesFromPlan(plan),
          validations: validationCommands,
        });
        terminalState = evaluation.terminalState;
      }
    }

    const diff = workspace.collectDiff().diff;
    const diffArtifact = artifacts.put({
      content: redactText(diff).value,
      mimeType: "text/vnd.git-diff",
      redactionStatus: "redacted-by-trace-boundary",
      producerSpanId: rootSpan.spanId,
    });
    rootSpan.update({ outputArtifactIds: [diffArtifact.sha256] });
    const completedAt = new Date().toISOString();
    const run = RunSchema.parse({
      id: runId,
      experimentId: "local-baseline",
      taskId: task.id,
      configurationId: options.config,
      traceId,
      repositoryCommit: task.commit,
      MorphScopeCommit: morphScopeCommit(),
      provider: "local",
      model: "deterministic-baseline",
      startedAt,
      completedAt,
      terminalState,
      totalLatency: Date.now() - startedMs,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      score: evaluation?.score ?? null,
      failureCategory: failureCategory(evaluation, terminalState),
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
    rootSpan.event("run_completed", { terminalState, score: evaluation?.score ?? null });
    rootSpan.end(
      terminalState === "resolved" ? "ok" : "error",
      terminalState === "resolved"
        ? undefined
        : {
            category: failureCategory(evaluation, terminalState) ?? "environment_failure",
            message: `Run ended in ${terminalState}`,
          },
    );
    const snapshot = trace.read();
    writeFileSync(
      join(outputRoot, "run.json"),
      JSON.stringify(
        { run, evaluation: persistedEvaluation(evaluation), trace: snapshot },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        { runId, traceId, terminalState, outputRoot, diffArtifact: diffArtifact.sha256 },
        null,
        2,
      ),
    );
    if (terminalState !== "resolved") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (rootSpan) {
      rootSpan.event("run_error", { message });
      rootSpan.end("error", {
        category: "environment_failure",
        message: message.length >= 8 ? message : `CLI error: ${message}`,
      });
    }
    writeFileSync(
      join(outputRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
    console.error(`MorphScope run failed: ${message}`);
    process.exitCode = 1;
  } finally {
    workspace?.dispose();
    traceStore.close();
  }
}

function validationCommandsFromMetadata(metadata: Record<string, unknown>) {
  return [
    optionalValidation(metadata.syntaxCommand, "syntax"),
    optionalValidation(metadata.buildCommand, "build"),
    optionalValidation(metadata.repositoryTestCommand, "repository"),
  ].filter(
    (value): value is { kind: "syntax" | "build" | "repository"; command: string } =>
      value !== null,
  );
}

function optionalValidation(value: unknown, kind: "syntax" | "build" | "repository") {
  return typeof value === "string" && value.trim().length > 0 ? { kind, command: value } : null;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`MorphScope CLI failed: ${message}`);
  process.exitCode = 1;
});
