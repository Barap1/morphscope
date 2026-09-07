import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runBaselineAgent, type BaselinePlan } from "@morphscope/agent-core";
import { evaluateTask, type EvaluationResult } from "@morphscope/evaluator";
import { createLocalWorkspace, type LocalWorkspace } from "@morphscope/sandbox";
import { RunSchema, type FailureCategory, type TerminalState } from "@morphscope/schemas";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { TraceWriter } from "@morphscope/tracing";
import { readJsonFile, readTaskFile } from "./task-file.js";

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
    throw new Error(`unsupported config: ${config}; CP3 provides baseline`);
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
  if (result && !result.passed) return "verification_failure";
  switch (terminalState) {
    case "environment_error":
      return "environment_failure";
    case "budget_exhausted":
      return "budget_exhaustion";
    case "task_failed":
      return "application_failure";
    case "timeout":
      return "budget_exhaustion";
    default:
      return null;
  }
}

function createToolbox(workspace: LocalWorkspace) {
  return {
    listFiles: (path?: string) => workspace.listFiles(path),
    search: (query: string, options?: { path?: string; maxResults?: number }) => {
      const result = workspace.search(query, options?.path);
      const matches = options?.maxResults
        ? result.matches.slice(0, options.maxResults)
        : result.matches;
      return matches
        .map((match) => `${match.path}:${match.line}:${match.column}:${match.text}`)
        .join("\n");
    },
    readFile: (path: string, options?: { startLine?: number; endLine?: number }) => {
      const lines = workspace.readFile(path).split(/\r?\n/);
      const start = Math.max(1, options?.startLine ?? 1);
      const end = Math.min(lines.length, options?.endLine ?? lines.length);
      return lines.slice(start - 1, end).join("\n");
    },
    replaceFile: (input: { path: string; search: string; replacement: string }) =>
      workspace.replaceFile(input.path, input.search, input.replacement),
    applyPatch: (patch: string) => workspace.applyPatch(patch),
    runCommand: (command: string) => workspace.runSetup(command),
    gitDiff: () => workspace.collectDiff().diff,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
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
        });
        terminalState = evaluation.terminalState;
      }
    }

    const diff = workspace.collectDiff().diff;
    const diffArtifact = artifacts.put({
      content: diff,
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
      JSON.stringify({ run, evaluation, trace: snapshot }, null, 2),
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

main();
