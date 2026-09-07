import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runBaselineAgent, type BaselinePlan } from "@morphscope/agent-core";
import { evaluateTask, type EvaluationResult } from "@morphscope/evaluator";
import {
  MorphClient,
  RawSearchProvider,
  WarpGrepProvider,
  type SearchMeasurement,
  type SearchProviderResult,
} from "@morphscope/providers";
import { createLocalWorkspace, type LocalWorkspace } from "@morphscope/sandbox";
import {
  RunSchema,
  type FailureCategory,
  type TerminalState,
  type Task,
} from "@morphscope/schemas";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { TraceWriter, redactText } from "@morphscope/tracing";
import { createToolbox } from "./toolbox.js";
import { readJsonFile, readTaskFile } from "./task-file.js";

type SearchStudyOptions = {
  taskPath: string;
  outputPath?: string;
};

type StudyConfig = "raw-search" | "warpgrep";

type SearchStudyRun = {
  runId: string;
  configurationId: StudyConfig;
  outputRoot: string;
  terminalState: TerminalState;
  search: SearchMeasurement | null;
  providerMetadata: SearchProviderResult["metadata"];
  evaluation: EvaluationResult | null;
};

export async function runSearchStudy(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const task = readTaskFile(options.taskPath);
  const experimentId = randomUUID();
  const outputRoot = resolve(
    options.outputPath ??
      join(process.cwd(), ".morphscope", "experiments", "search-study", experimentId),
  );
  mkdirSync(outputRoot, { recursive: true });

  const results: SearchStudyRun[] = [];
  for (const configurationId of ["raw-search", "warpgrep"] as const) {
    results.push(await runConfiguration({ task, configurationId, outputRoot }));
  }

  const manifest = {
    schemaVersion: 1,
    experiment: {
      id: experimentId,
      name: "Search provider study",
      taskSetVersion: task.commit,
      sourceCommit: morphScopeCommit(),
      status: results.every((result) => result.terminalState === "resolved")
        ? "completed"
        : "completed_with_failures",
    },
    task: {
      id: task.id,
      repository: task.repository,
      commit: task.commit,
    },
    fixedVariables: {
      reasoningProvider: "local",
      reasoningModel: "deterministic-baseline",
      editingStrategy: "baseline-plan",
      sandbox: "isolated-local-workspace",
      resourceLimits: task.resourceLimits,
    },
    variedVariable: "searchProvider",
    configurations: results.map((result) => ({
      id: result.configurationId,
      searchProvider: result.configurationId,
      runId: result.runId,
      outputRoot: result.outputRoot,
      terminalState: result.terminalState,
      search: result.search,
      providerMetadata: result.providerMetadata ?? null,
      downstreamSuccess: result.evaluation?.passed ?? null,
    })),
    comparison: compareSearchResults(results),
  };
  writeFileSync(join(outputRoot, "experiment.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify({ experimentId, outputRoot, configurations: manifest.configurations }, null, 2),
  );
  if (results.some((result) => result.terminalState !== "resolved")) process.exitCode = 1;
}

function parseArgs(argv: string[]): SearchStudyOptions {
  if (argv[0] !== "experiment" || argv[1] !== "run" || argv[2] !== "search-study") {
    throw new Error(
      "usage: pnpm morphscope experiment run search-study [--task <task.yaml|task.json>] [--output <dir>]",
    );
  }
  let taskPath = resolve(process.cwd(), "benchmarks/tasks/example.yaml");
  let outputPath: string | undefined;
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--task") taskPath = resolve(argv[++index] ?? "");
    else if (argv[index] === "--output") outputPath = argv[++index];
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return { taskPath, outputPath };
}

async function runConfiguration(input: {
  task: Task;
  configurationId: StudyConfig;
  outputRoot: string;
}): Promise<SearchStudyRun> {
  const { task, configurationId, outputRoot } = input;
  const runId = randomUUID();
  const traceId = randomUUID();
  const runRoot = join(outputRoot, "runs", configurationId);
  mkdirSync(runRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(runRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(runRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("run", {
    attributes: {
      taskId: task.id,
      configuration: configurationId,
      searchProvider: configurationId,
    },
  });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let workspace: LocalWorkspace | undefined;
  let evaluation: EvaluationResult | undefined;
  let searchResult: SearchProviderResult | undefined;
  let terminalState: TerminalState = "environment_error";

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
    const activeWorkspace = workspace;
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
        throw new Error("task metadata.baselinePlan is required for search-study");
      const plan = readJsonFile<BaselinePlan>(resolve(process.cwd(), planPathValue));
      const searchAction = plan.actions.find((action) => action.type === "search");
      if (!searchAction || searchAction.type !== "search") {
        throw new Error("search-study requires a baseline plan with a search action");
      }
      const referenceRelevantFiles = referenceFiles(plan);
      const searchSpan = trace.startSpan("search", {
        attributes: {
          provider: configurationId,
          query: searchAction.query,
          referenceRelevantFiles: referenceRelevantFiles.join(","),
        },
      });
      try {
        const provider = createSearchProvider(configurationId, activeWorkspace, trace);
        searchResult = await provider.search({
          query: searchAction.query,
          path: searchAction.path,
          maxResults: searchAction.maxResults,
          referenceRelevantFiles,
        });
        searchSpan.update({
          attributes: {
            provider: configurationId,
            query: searchAction.query,
            searches: searchResult.measurement.numberSearches,
            latencyMs: searchResult.measurement.totalSearchLatencyMs,
            contextBytes: searchResult.measurement.bytesContextReturned,
            uniqueFiles: searchResult.measurement.uniqueFilesFound.join(","),
          },
        });
        searchSpan.event("search_result", {
          provider: configurationId,
          measurement: searchResult.measurement,
          metadata: searchResult.metadata ?? null,
        });
        const searchArtifact = artifacts.put({
          content: redactText(searchResult.rendered).value,
          mimeType: "text/plain",
          redactionStatus: "provider-context-sanitized",
          producerSpanId: searchSpan.spanId,
        });
        searchSpan.update({ outputArtifactIds: [searchArtifact.sha256] });
        searchSpan.end("ok");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        searchSpan.event("search_error", { provider: configurationId, message });
        searchSpan.end("error", {
          category: "provider_failure",
          message: message.length >= 8 ? message : `Search provider error: ${message}`,
        });
        terminalState = "provider_error";
      }

      if (searchResult) {
        const searchOutput = searchResult.rendered;
        const agent = runBaselineAgent({
          toolbox: createToolbox(activeWorkspace, (query, options) =>
            query === searchAction.query && options?.path === searchAction.path
              ? searchOutput
              : createToolbox(activeWorkspace).search(query, options),
          ),
          plan,
          trace,
          resourceLimits: task.resourceLimits,
        });
        terminalState = agent.terminalState;
        if (terminalState === "resolved") {
          evaluation = evaluateTask({
            task,
            toolbox: createToolbox(activeWorkspace),
            timeoutMs: task.resourceLimits.maxDurationMs,
          });
          terminalState = evaluation.terminalState;
        }
        searchResult.measurement.downstreamSuccess = evaluation?.passed ?? false;
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
    const run = RunSchema.parse({
      id: runId,
      experimentId: "search-study",
      taskId: task.id,
      configurationId,
      traceId,
      repositoryCommit: task.commit,
      MorphScopeCommit: morphScopeCommit(),
      provider: "local",
      model: "deterministic-baseline",
      startedAt,
      completedAt: new Date().toISOString(),
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
    rootSpan.event("run_completed", {
      terminalState,
      score: evaluation?.score ?? null,
      searchProvider: configurationId,
    });
    rootSpan.end(
      terminalState === "resolved" ? "ok" : "error",
      terminalState === "resolved"
        ? undefined
        : {
            category: failureCategory(evaluation, terminalState) ?? "environment_failure",
            message: `Run ended in ${terminalState}`,
          },
    );
    writeFileSync(
      join(runRoot, "run.json"),
      JSON.stringify(
        {
          run,
          evaluation: evaluation ?? null,
          search: searchResult ? persistedSearchResult(searchResult) : null,
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
      terminalState,
      search: searchResult?.measurement ?? null,
      providerMetadata: searchResult?.metadata,
      evaluation: evaluation ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    terminalState = "environment_error";
    rootSpan.event("run_error", { message });
    rootSpan.end("error", {
      category: "environment_failure",
      message: message.length >= 8 ? message : `Search study error: ${message}`,
    });
    writeFileSync(
      join(runRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
    return {
      runId,
      configurationId,
      outputRoot: runRoot,
      terminalState,
      search: searchResult?.measurement ?? null,
      providerMetadata: searchResult?.metadata,
      evaluation: evaluation ?? null,
    };
  } finally {
    workspace?.dispose();
    traceStore.close();
  }
}

function createSearchProvider(
  configurationId: StudyConfig,
  workspace: LocalWorkspace,
  trace: TraceWriter,
) {
  if (configurationId === "raw-search") {
    return new RawSearchProvider(({ query, path }) => workspace.search(query, path));
  }
  const morph = new MorphClient({ trace });
  return new WarpGrepProvider(
    ({ searchTerm, repoRoot, maxTurns }) => morph.warpGrep({ searchTerm, repoRoot, maxTurns }),
    workspace.root,
  );
}

function persistedSearchResult(result: SearchProviderResult): SearchProviderResult {
  return {
    ...result,
    rendered: redactText(result.rendered).value,
    contexts: result.contexts.map((context) => ({
      file: redactText(context.file).value,
      content: redactText(context.content).value,
    })),
    matches: result.matches.map((match) => ({
      ...match,
      path: redactText(match.path).value,
      text: redactText(match.text).value,
    })),
  };
}

function referenceFiles(plan: BaselinePlan): string[] {
  return [
    ...new Set(
      plan.actions.flatMap((action) =>
        action.type === "read_file" || action.type === "replace" ? [action.path] : [],
      ),
    ),
  ];
}

function failureCategory(
  result: EvaluationResult | undefined,
  terminalState: TerminalState,
): FailureCategory | null {
  if (result && !result.passed) return "verification_failure";
  switch (terminalState) {
    case "environment_error":
      return "environment_failure";
    case "provider_error":
      return "provider_failure";
    case "budget_exhausted":
    case "timeout":
      return "budget_exhaustion";
    case "task_failed":
      return "application_failure";
    default:
      return null;
  }
}

function compareSearchResults(results: SearchStudyRun[]) {
  const raw = results.find((result) => result.configurationId === "raw-search")?.search;
  const warp = results.find((result) => result.configurationId === "warpgrep")?.search;
  return {
    fixedVariables: [
      "reasoningProvider",
      "reasoningModel",
      "editingStrategy",
      "sandbox",
      "resourceLimits",
    ],
    variedVariables: ["searchProvider"],
    metrics: {
      numberSearches: delta(raw?.numberSearches, warp?.numberSearches),
      totalSearchLatencyMs: delta(raw?.totalSearchLatencyMs, warp?.totalSearchLatencyMs),
      bytesContextReturned: delta(raw?.bytesContextReturned, warp?.bytesContextReturned),
      fileRecallProxy: delta(raw?.fileRecallProxy, warp?.fileRecallProxy),
      timeToFirstReferenceRelevantFileMs: delta(
        raw?.timeToFirstReferenceRelevantFileMs,
        warp?.timeToFirstReferenceRelevantFileMs,
      ),
      uniqueFilesFound: {
        rawSearch: raw?.uniqueFilesFound ?? null,
        warpGrep: warp?.uniqueFilesFound ?? null,
      },
      downstreamSuccess: {
        rawSearch: raw?.downstreamSuccess ?? null,
        warpGrep: warp?.downstreamSuccess ?? null,
      },
    },
  };
}

function delta(raw: number | null | undefined, warp: number | null | undefined) {
  return {
    rawSearch: raw ?? null,
    warpGrep: warp ?? null,
    deltaWarpMinusRaw:
      raw !== null && raw !== undefined && warp !== null && warp !== undefined ? warp - raw : null,
  };
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
