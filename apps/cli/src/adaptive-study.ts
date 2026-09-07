import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  decideCompaction,
  decideEdit,
  decideSearch,
  runBaselineAgent,
  type BaselinePlan,
  type RoutingDecision,
} from "@morphscope/agent-core";
import { evaluateTask, type EvaluationResult } from "@morphscope/evaluator";
import {
  DeterministicEditProvider,
  FullFileEditProvider,
  MorphClient,
  MorphCompactProvider,
  MorphFastApplyEditProvider,
  NoCompactionProvider,
  RawSearchProvider,
  ThresholdTruncationProvider,
  UnifiedDiffEditProvider,
  WarpGrepProvider,
  serializeMessages,
  type ContextCompactionResult,
  type ContextMessage,
  type EditResult,
  type SearchProviderResult,
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
import { createToolbox, changedFilesFromPlan } from "./toolbox.js";
import { readJsonFile, readTaskFile } from "./task-file.js";

type AdaptiveOptions = {
  taskPath: string;
  outputPath?: string;
  includeMorph: boolean;
};

type AdaptiveRoutingRecord = {
  policyVersion: string;
  decisions: RoutingDecision[];
  contextProfile: {
    provider: string;
    model: string;
    beforeBytes: number;
    afterBytes: number;
    retainedRatio: number;
    toolOutputShare: number;
    latencyMs: number;
    costUsd: number | null;
  } | null;
};

export async function runAdaptiveStudy(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const task = readTaskFile(options.taskPath);
  const experimentId = randomUUID();
  const outputRoot = resolve(
    options.outputPath ??
      join(process.cwd(), ".morphscope", "experiments", "adaptive-study", experimentId),
  );
  mkdirSync(outputRoot, { recursive: true });
  const result = await runConfiguration({
    task,
    experimentId,
    outputRoot,
    includeMorph: options.includeMorph,
  });
  const manifest = {
    schemaVersion: 1,
    experiment: {
      id: experimentId,
      name: "Adaptive routing policy study",
      taskSetVersion: task.commit,
      sourceCommit: morphScopeCommit(),
      status: result.terminalState === "resolved" ? "completed" : "completed_with_failures",
    },
    task: { id: task.id, repository: task.repository, commit: task.commit },
    fixedVariables: {
      reasoningProvider: "local",
      reasoningModel: "deterministic-baseline",
      sandbox: "isolated-local-workspace",
      resourceLimits: task.resourceLimits,
    },
    variedVariable: "adaptiveRoutingPolicy",
    configurations: [
      {
        id: "adaptive-rules-v1",
        routingPolicy: result.routing.policyVersion,
        runId: result.runId,
        terminalState: result.terminalState,
        downstreamSuccess: result.evaluation?.passed ?? null,
        decisions: result.routing.decisions,
      },
    ],
    comparison: {
      policyVersion: result.routing.policyVersion,
      decisionCount: result.routing.decisions.length,
      selectedRoutes: Object.fromEntries(
        result.routing.decisions.map((decision) => [decision.route, decision.selected]),
      ),
    },
  };
  writeFileSync(join(outputRoot, "experiment.json"), JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify({ experimentId, outputRoot, configurations: manifest.configurations }, null, 2),
  );
  if (result.terminalState !== "resolved") process.exitCode = 1;
}

function parseArgs(argv: string[]): AdaptiveOptions {
  if (argv[0] !== "experiment" || argv[1] !== "run" || argv[2] !== "adaptive-study") {
    throw new Error(
      "usage: pnpm morphscope experiment run adaptive-study [--task <task.yaml|task.json>] [--include-morph] [--output <dir>]",
    );
  }
  let taskPath = resolve(process.cwd(), "benchmarks/tasks/example.yaml");
  let outputPath: string | undefined;
  let includeMorph = false;
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--task") taskPath = resolve(argv[++index] ?? "");
    else if (argv[index] === "--output") outputPath = argv[++index];
    else if (argv[index] === "--include-morph") includeMorph = true;
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return { taskPath, outputPath, includeMorph };
}

async function runConfiguration(input: {
  task: Task;
  experimentId: string;
  outputRoot: string;
  includeMorph: boolean;
}) {
  const { task, experimentId, outputRoot, includeMorph } = input;
  const runId = randomUUID();
  const traceId = randomUUID();
  const runRoot = join(outputRoot, "runs", "adaptive-rules-v1");
  mkdirSync(runRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(runRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(runRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("run", {
    attributes: { taskId: task.id, configuration: "adaptive-rules-v1", experimentId },
  });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let workspace: LocalWorkspace | undefined;
  let evaluation: EvaluationResult | undefined;
  let searchResult: SearchProviderResult | undefined;
  let editResult: EditResult | undefined;
  let contextResult: ContextCompactionResult | undefined;
  let terminalState: TerminalState = "environment_error";
  const decisions: RoutingDecision[] = [];
  const routing: AdaptiveRoutingRecord = {
    policyVersion: "adaptive-rules-v1",
    decisions,
    contextProfile: null,
  };

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
        throw new Error("adaptive-study requires task metadata.baselinePlan");
      const plan = readJsonFile<BaselinePlan>(resolve(process.cwd(), planPathValue));
      const searchAction = plan.actions.find((action) => action.type === "search");
      const replaceAction = plan.actions.find((action) => action.type === "replace");
      if (!searchAction || searchAction.type !== "search")
        throw new Error("adaptive-study requires a baseline search action");
      if (!replaceAction || replaceAction.type !== "replace")
        throw new Error("adaptive-study requires a baseline replace action");

      const cheapSearch = activeWorkspace.search(searchAction.query, searchAction.path);
      const searchDecision = decideSearch({
        exactIdentifierExists: isIdentifier(searchAction.query) && cheapSearch.matches.length > 0,
        repositoryFileCount: activeWorkspace.listFiles().length,
        cheapMatchCount: cheapSearch.matches.length,
        querySemantics: querySemantics(searchAction.query),
        crossFileEstimate: new Set(
          plan.actions.flatMap((action) =>
            action.type === "read_file" || action.type === "replace" ? [action.path] : [],
          ),
        ).size,
        previousSearchFailure: false,
        remainingBudget: task.resourceLimits.maxTurns ?? null,
        warpGrepAvailable: includeMorph,
      });
      recordDecision(trace, rootSpan.spanId, searchDecision, decisions);
      const searchSpan = trace.startSpan("adaptive.search", {
        parentSpanId: rootSpan.spanId,
        attributes: {
          selected: searchDecision.selected,
          policyVersion: searchDecision.policyVersion,
        },
      });
      try {
        if (searchDecision.selected === "warpgrep") {
          const morph = new MorphClient({ trace });
          searchResult = await new WarpGrepProvider(
            ({ searchTerm, repoRoot, maxTurns }) =>
              morph.warpGrep({ searchTerm, repoRoot, maxTurns }),
            activeWorkspace.root,
          ).search({
            query: searchAction.query,
            path: searchAction.path,
            maxResults: searchAction.maxResults,
            referenceRelevantFiles: referenceFiles(plan),
          });
        } else {
          searchResult = await new RawSearchProvider(({ query, path }) =>
            activeWorkspace.search(query, path),
          ).search({
            query: searchAction.query,
            path: searchAction.path,
            maxResults: searchAction.maxResults,
            referenceRelevantFiles: referenceFiles(plan),
          });
        }
        searchSpan.update({
          attributes: {
            provider: searchResult.provider,
            bytesContextReturned: searchResult.measurement.bytesContextReturned,
            uniqueFiles: searchResult.measurement.uniqueFilesFound.join(","),
          },
        });
        searchSpan.event("adaptive_search_result", {
          selected: searchDecision.selected,
          measurement: searchResult.measurement,
        });
        searchSpan.end("ok");
      } catch (error) {
        searchSpan.end("error", {
          category: "provider_failure",
          message: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
        throw error;
      }

      const originalCode = activeWorkspace.readFile(replaceAction.path);
      const expectedCode = replaceExact(
        originalCode,
        replaceAction.search,
        replaceAction.replacement,
      );
      const editDecision = decideEdit({
        fileBytes: Buffer.byteLength(originalCode, "utf8"),
        changedLineEstimate: Math.max(
          replaceAction.search.split(/\r?\n/u).length,
          replaceAction.replacement.split(/\r?\n/u).length,
        ),
        nonContiguousRegions: 0,
        exactOldStringAvailable: originalCode.includes(replaceAction.search),
        previousApplyFailure: false,
        remainingBudget: task.resourceLimits.maxTurns ?? null,
        fastApplyAvailable: includeMorph,
      });
      recordDecision(trace, rootSpan.spanId, editDecision, decisions);
      const editSpan = trace.startSpan("adaptive.edit", {
        parentSpanId: rootSpan.spanId,
        attributes: { selected: editDecision.selected, file: replaceAction.path },
      });
      const editProvider = createEditProvider(editDecision.selected, trace, replaceAction.path);
      try {
        editResult = await editProvider.apply({
          originalCode,
          requestedEdit: requestedEdit(
            editDecision.selected,
            replaceAction.path,
            replaceAction.search,
            replaceAction.replacement,
            originalCode,
            expectedCode,
          ),
          instructions: task.issue,
          filePath: replaceAction.path,
          language: "javascript",
        });
        if (!editResult.success || !editResult.mergedCode)
          throw new Error(editResult.error ?? "Adaptive edit was not applicable");
        editSpan.update({
          attributes: {
            provider: editResult.provider,
            syntaxStatus: editResult.syntax.status,
            latencyMs: editResult.latencyMs,
          },
        });
        editSpan.event("adaptive_edit_result", {
          selected: editDecision.selected,
          provider: editResult.provider,
          syntaxStatus: editResult.syntax.status,
          originalSha256: editResult.originalSha256,
          finalSha256: editResult.finalSha256 ?? null,
        });
        editSpan.end("ok");
      } catch (error) {
        editSpan.end("error", {
          category: "provider_failure",
          message: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
        throw error;
      }

      const contextMessages = adaptiveContext(task.issue, searchResult.rendered);
      const contextBytes = Buffer.byteLength(serializeMessages(contextMessages), "utf8");
      const toolBytes = contextMessages
        .filter((message) => message.role === "tool")
        .reduce((sum, message) => sum + Buffer.byteLength(message.content, "utf8"), 0);
      const compactDecision = decideCompaction({
        contextBytes,
        growthRate: contextBytes / 2_000,
        toolOutputShare: contextBytes === 0 ? 0 : toolBytes / contextBytes,
        duplicationRatio: 0.1,
        relevanceScore: 0.9,
        remainingComplexity: task.resourceLimits.maxTurns ?? null,
        morphCompactAvailable: includeMorph,
      });
      recordDecision(trace, rootSpan.spanId, compactDecision, decisions);
      const contextSpan = trace.startSpan("adaptive.compaction", {
        parentSpanId: rootSpan.spanId,
        attributes: { selected: compactDecision.selected, beforeBytes: contextBytes },
      });
      try {
        const contextProvider =
          compactDecision.selected === "morph-compact"
            ? new MorphCompactProvider(new MorphClient({ trace }), { preserveRecent: 3 })
            : compactDecision.selected === "threshold-truncation"
              ? new ThresholdTruncationProvider(1_800)
              : new NoCompactionProvider();
        contextResult = await contextProvider.compact({
          messages: contextMessages,
          modelContextLimitBytes: 2_000,
          futureModelCalls: 3,
        });
        contextSpan.update({
          attributes: {
            provider: contextResult.profile.provider,
            model: contextResult.profile.model,
            beforeBytes: contextResult.profile.beforeBytes,
            afterBytes: contextResult.profile.afterBytes,
            retainedRatio: contextResult.profile.retainedRatio,
            toolOutputShare: contextResult.profile.toolOutputShare,
          },
        });
        contextSpan.event("adaptive_compaction_result", {
          selected: compactDecision.selected,
          beforeBytes: contextResult.profile.beforeBytes,
          afterBytes: contextResult.profile.afterBytes,
        });
        contextSpan.end("ok");
      } catch (error) {
        contextSpan.end("error", {
          category: "provider_failure",
          message: redactSecrets(error instanceof Error ? error.message : String(error)),
        });
        throw error;
      }
      routing.contextProfile = {
        provider: contextResult.profile.provider,
        model: contextResult.profile.model,
        beforeBytes: contextResult.profile.beforeBytes,
        afterBytes: contextResult.profile.afterBytes,
        retainedRatio: contextResult.profile.retainedRatio,
        toolOutputShare: contextResult.profile.toolOutputShare,
        latencyMs: contextResult.profile.latencyMs,
        costUsd: contextResult.profile.costUsd,
      };

      const toolbox = createToolbox(
        activeWorkspace,
        (query, options) =>
          query === searchAction.query && options?.path === searchAction.path
            ? (searchResult?.rendered ?? "")
            : createToolbox(activeWorkspace).search(query, options),
        (input) =>
          input.path === replaceAction.path && input.search === replaceAction.search
            ? activeWorkspace.replaceFile(
                input.path,
                originalCode,
                editResult?.mergedCode ?? expectedCode,
              )
            : activeWorkspace.replaceFile(input.path, input.search, input.replacement),
      );
      const agent = runBaselineAgent({
        toolbox,
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
          allowedChangedFiles: changedFilesFromPlan(plan),
        });
        terminalState = evaluation.terminalState;
      }
      searchResult.measurement.downstreamSuccess = evaluation?.passed ?? false;
    }

    const diff = workspace.collectDiff().diff;
    const diffArtifact = artifacts.put({
      content: redactText(diff).value,
      mimeType: "text/vnd.git-diff",
      redactionStatus: "redacted-by-trace-boundary",
      producerSpanId: rootSpan.spanId,
    });
    rootSpan.update({ outputArtifactIds: [diffArtifact.sha256] });
    const run = RunSchema.parse({
      id: runId,
      experimentId,
      taskId: task.id,
      configurationId: "adaptive-rules-v1",
      traceId,
      repositoryCommit: task.commit,
      MorphScopeCommit: morphScopeCommit(),
      provider: "adaptive-controller",
      model: routing.policyVersion,
      startedAt,
      completedAt: new Date().toISOString(),
      terminalState,
      totalLatency: Date.now() - startedMs,
      totalInputTokens:
        (contextResult?.profile.usage?.inputTokens ?? 0) +
        (editResult?.metadata?.usage?.inputTokens ?? 0),
      totalOutputTokens:
        (contextResult?.profile.usage?.outputTokens ?? 0) +
        (editResult?.metadata?.usage?.outputTokens ?? 0),
      totalCost:
        (contextResult?.profile.costUsd ?? 0) + (editResult?.metadata?.usage?.costUsd ?? 0),
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
    rootSpan.event("run_completed", {
      terminalState,
      score: evaluation?.score ?? null,
      policyVersion: routing.policyVersion,
      decisions: decisions.map((decision) => `${decision.route}:${decision.selected}`),
    });
    rootSpan.end(
      terminalState === "resolved" ? "ok" : "error",
      terminalState === "resolved"
        ? undefined
        : {
            category: failureCategory(evaluation, terminalState) ?? "application_failure",
            message: `Run ended in ${terminalState}`,
          },
    );
    writeFileSync(
      join(runRoot, "run.json"),
      JSON.stringify(
        {
          run,
          evaluation: persistedEvaluation(evaluation),
          search: searchResult ? persistedSearchResult(searchResult) : null,
          edit: editResult ? persistedEdit(editResult) : null,
          routing,
          trace: trace.read(),
        },
        null,
        2,
      ),
    );
    return { runId, outputRoot: runRoot, terminalState, routing, evaluation: evaluation ?? null };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    rootSpan.event("adaptive_study_error", { message, policyVersion: routing.policyVersion });
    rootSpan.end("error", { category: "provider_failure", message });
    writeFileSync(
      join(runRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
    return {
      runId,
      outputRoot: runRoot,
      terminalState: "provider_error" as const,
      routing,
      evaluation: null,
    };
  } finally {
    workspace?.dispose();
    traceStore.close();
  }
}

function recordDecision(
  trace: TraceWriter,
  parentSpanId: string,
  decision: RoutingDecision,
  decisions: RoutingDecision[],
): void {
  decisions.push(decision);
  const span = trace.startSpan(`routing.${decision.route}`, {
    parentSpanId,
    attributes: {
      selected: decision.selected,
      policyVersion: decision.policyVersion,
      reason: decision.reason,
      features: decision.features,
    },
  });
  span.event("routing_decision", decision);
  span.end("ok");
}

function createEditProvider(selected: string, trace: TraceWriter, filePath: string) {
  if (selected === "deterministic-edit") {
    return new DeterministicEditProvider(({ originalCode, requestedEdit }) => {
      const marker = "Replace exactly: ";
      if (!requestedEdit.startsWith(marker))
        throw new Error("Adaptive deterministic edit is malformed");
      const [search, replacement] = requestedEdit.slice(marker.length).split(" → ");
      return replaceExact(originalCode, search, replacement);
    });
  }
  if (selected === "unified-diff") return new UnifiedDiffEditProvider();
  if (selected === "full-file") return new FullFileEditProvider();
  if (selected === "fast-apply") return new MorphFastApplyEditProvider(new MorphClient({ trace }));
  throw new Error(`Unsupported adaptive edit route for ${filePath}: ${selected}`);
}

function requestedEdit(
  selected: string,
  path: string,
  search: string,
  replacement: string,
  originalCode: string,
  expectedCode: string,
): string {
  if (selected === "deterministic-edit") return `Replace exactly: ${search} → ${replacement}`;
  if (selected === "full-file") return expectedCode;
  if (selected === "unified-diff") return makeUnifiedDiff(path, originalCode, expectedCode);
  return "// ... existing code ...\nApply the requested repository edit.\n// ... existing code ...";
}

function adaptiveContext(issue: string, searchOutput: string): ContextMessage[] {
  return [
    {
      role: "system",
      content: "Preserve exact acceptance evidence and do not invent repository facts.",
    },
    { role: "user", content: issue },
    { role: "tool", content: searchOutput },
    {
      role: "assistant",
      content: "Search evidence identifies the target file and the task remains a small edit.",
    },
    { role: "tool", content: "Test evidence: formatGreeting('Ada') should equal 'Hello, Ada.'" },
  ];
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

function persistedEdit(result: EditResult) {
  return {
    provider: result.provider,
    success: result.success,
    originalSha256: result.originalSha256,
    requestedEdit: redactText(result.requestedEdit).value,
    finalSha256: result.finalSha256,
    unifiedDiff: redactText(result.unifiedDiff).value,
    syntax: result.syntax,
    retryCount: result.retryCount,
    latencyMs: result.latencyMs,
    metadata: result.metadata,
    ...(result.error ? { error: redactSecrets(result.error) } : {}),
  };
}

function replaceExact(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index < 0 || source.indexOf(search, index + search.length) >= 0)
    throw new Error("Edit target was missing or ambiguous");
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function makeUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
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

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);
}

function querySemantics(value: string): "identifier" | "phrase" | "path" {
  if (value.includes("/")) return "path";
  return isIdentifier(value) ? "identifier" : "phrase";
}

function failureCategory(
  result: EvaluationResult | undefined,
  terminalState: TerminalState,
): FailureCategory | null {
  if (result?.failureClassification.category) return result.failureClassification.category;
  if (terminalState === "provider_error") return "provider_failure";
  if (terminalState === "environment_error") return "environment_failure";
  if (terminalState === "timeout" || terminalState === "budget_exhausted")
    return "budget_exhaustion";
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
