import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MorphClient,
  MorphCompactProvider,
  NoCompactionProvider,
  serializeMessages,
  ThresholdTruncationProvider,
  type ContextCompactionProvider,
  type ContextCompactionResult,
  type ContextMessage,
  type ContextProfile,
} from "@morphscope/providers";
import { RunSchema, type Task, type TerminalState } from "@morphscope/schemas";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { redactSecrets, redactText, TraceWriter, type SpanHandle } from "@morphscope/tracing";
import { readTaskFile } from "./task-file.js";

type ContextStudyConfig = "no-compaction" | "threshold-truncation" | "morph-compact";

type ContextStudyOptions = {
  taskPath: string;
  outputPath?: string;
  configurations: ContextStudyConfig[];
};

type ContextProfileRecord = {
  step: number;
  label: string;
  status: "ok" | "provider_error";
  beforeText: string;
  afterText: string;
  beforeSha256: string;
  afterSha256: string;
  profile: ContextProfile | null;
  downstreamSuccess: boolean | null;
};

export type ContextStudyRecord = {
  provider: string;
  model: string;
  configuration: ContextStudyConfig;
  contextLimitBytes: number;
  expectedMarker: string;
  downstreamSuccess: boolean | null;
  profiles: ContextProfileRecord[];
};

const CONTEXT_LIMIT_BYTES = 2_000;
const THRESHOLD_BYTES = 1_800;
const EXPECTED_MARKER = "PUNCTUATION_REQUIRED: formatGreeting must return a period.";

export async function runContextStudy(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const task = readTaskFile(options.taskPath);
  const experimentId = randomUUID();
  const outputRoot = resolve(
    options.outputPath ??
      join(process.cwd(), ".morphscope", "experiments", "context-study", experimentId),
  );
  mkdirSync(outputRoot, { recursive: true });
  const results = [];
  for (const configuration of options.configurations) {
    results.push(await runConfiguration({ task, configuration, outputRoot, experimentId }));
  }

  const manifest = {
    schemaVersion: 1,
    experiment: {
      id: experimentId,
      name: "Context accounting and Compact study",
      taskSetVersion: task.commit,
      sourceCommit: morphScopeCommit(),
      status: results.every((result) => result.terminalState === "resolved")
        ? "completed"
        : "completed_with_failures",
    },
    task: { id: task.id, repository: task.repository, commit: task.commit },
    fixedVariables: {
      reasoningProvider: "local",
      reasoningModel: "deterministic-context-observer",
      contextFixture: "synthetic-greeting-agent-v1",
      contextLimitBytes: CONTEXT_LIMIT_BYTES,
      futureModelCalls: 3,
      sandbox: "not applicable; downstream marker check only",
    },
    variedVariable: "contextProvider",
    configurations: results.map((result) => ({
      id: result.configuration,
      contextProvider: result.provider,
      runId: result.runId,
      terminalState: result.terminalState,
      downstreamSuccess: result.context?.downstreamSuccess ?? null,
      finalProfile: result.context?.profiles.at(-1)?.profile ?? null,
    })),
    comparison: compareResults(results),
  };
  writeFileSync(join(outputRoot, "experiment.json"), JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify(
      {
        experimentId,
        outputRoot,
        configurations: manifest.configurations,
      },
      null,
      2,
    ),
  );
  if (results.some((result) => result.terminalState !== "resolved")) process.exitCode = 1;
}

function parseArgs(argv: string[]): ContextStudyOptions {
  if (argv[0] !== "experiment" || argv[1] !== "run" || argv[2] !== "context-study") {
    throw new Error(
      "usage: pnpm morphscope experiment run context-study [--task <task.yaml|task.json>] [--configs no-compaction,threshold-truncation] [--include-compact] [--output <dir>]",
    );
  }
  let taskPath = resolve(process.cwd(), "benchmarks/tasks/example.yaml");
  let outputPath: string | undefined;
  let configurations: ContextStudyConfig[] = ["no-compaction", "threshold-truncation"];
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--task") taskPath = resolve(argv[++index] ?? "");
    else if (argv[index] === "--output") outputPath = argv[++index];
    else if (argv[index] === "--configs") configurations = parseConfigurations(argv[++index] ?? "");
    else if (argv[index] === "--include-compact")
      configurations = [...configurations, "morph-compact"];
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return { taskPath, outputPath, configurations: [...new Set(configurations)] };
}

function parseConfigurations(value: string): ContextStudyConfig[] {
  const allowed: ContextStudyConfig[] = ["no-compaction", "threshold-truncation", "morph-compact"];
  const configurations = value.split(",").map((item) => item.trim()) as ContextStudyConfig[];
  if (configurations.length === 0 || configurations.some((item) => !allowed.includes(item))) {
    throw new Error(`--configs must contain only: ${allowed.join(", ")}`);
  }
  return configurations;
}

async function runConfiguration(input: {
  task: Task;
  configuration: ContextStudyConfig;
  outputRoot: string;
  experimentId: string;
}) {
  const { task, configuration, outputRoot, experimentId } = input;
  const runId = randomUUID();
  const traceId = randomUUID();
  const runRoot = join(outputRoot, "runs", configuration);
  mkdirSync(runRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(runRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(runRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("run", {
    attributes: { taskId: task.id, configuration, experimentId },
  });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const contextMessages = syntheticContext(task);
  const profiles: ContextProfileRecord[] = [];
  let context: ContextStudyRecord | null = null;
  let provider = configuration === "morph-compact" ? "morph" : "local";
  let model = configuration === "morph-compact" ? "morph-compactor" : configuration;
  let terminalState: TerminalState = "environment_error";
  let artifactIds: string[] = [];

  try {
    const compactionProvider = createProvider(configuration, trace);
    if (configuration === "morph-compact") {
      const result = await compactStep({
        provider: compactionProvider,
        messages: contextMessages,
        label: "final accumulated context",
        step: 1,
        profiles,
        rootSpan,
        trace,
      });
      provider = result.profile.provider;
      model = result.profile.model;
    } else {
      const batches = contextBatches(contextMessages);
      for (let index = 0; index < batches.length; index += 1) {
        const currentMessages = batches.slice(0, index + 1).flat();
        const result = await compactStep({
          provider: compactionProvider,
          messages: currentMessages,
          label:
            index === batches.length - 1
              ? "final accumulated context"
              : `context growth ${index + 1}`,
          step: index + 1,
          profiles,
          rootSpan,
          trace,
        });
        provider = result.profile.provider;
        model = result.profile.model;
      }
    }
    const finalProfile = profiles.at(-1);
    const downstreamSuccess = finalProfile?.afterText.includes(EXPECTED_MARKER) ?? false;
    if (finalProfile) finalProfile.downstreamSuccess = downstreamSuccess;
    context = {
      provider,
      model,
      configuration,
      contextLimitBytes: CONTEXT_LIMIT_BYTES,
      expectedMarker: EXPECTED_MARKER,
      downstreamSuccess,
      profiles,
    };
    terminalState = downstreamSuccess ? "resolved" : "task_failed";
    const contextArtifact = artifacts.put({
      content: redactText(JSON.stringify(context, null, 2)).value,
      mimeType: "application/json",
      redactionStatus: "redacted-before-persist",
      producerSpanId: rootSpan.spanId,
    });
    artifactIds = [contextArtifact.sha256];
    rootSpan.update({ outputArtifactIds: artifactIds });
    rootSpan.event("context_study_completed", {
      configuration,
      downstreamSuccess,
      profileCount: profiles.length,
      finalBeforeBytes: finalProfile?.profile?.beforeBytes ?? null,
      finalAfterBytes: finalProfile?.profile?.afterBytes ?? null,
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    terminalState = "provider_error";
    rootSpan.event("context_study_error", { configuration, message });
    rootSpan.end("error", { category: "provider_failure", message });
    writeFileSync(
      join(runRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
  }

  const totalInputTokens = profiles.reduce(
    (sum, record) => sum + (record.profile?.usage?.inputTokens ?? 0),
    0,
  );
  const totalOutputTokens = profiles.reduce(
    (sum, record) => sum + (record.profile?.usage?.outputTokens ?? 0),
    0,
  );
  const totalCost = profiles.reduce((sum, record) => sum + (record.profile?.costUsd ?? 0), 0);
  const finalProfile = profiles.at(-1)?.profile;
  const run = RunSchema.parse({
    id: runId,
    experimentId,
    taskId: task.id,
    configurationId: configuration,
    traceId,
    repositoryCommit: task.commit,
    MorphScopeCommit: morphScopeCommit(),
    provider,
    model,
    startedAt,
    completedAt: new Date().toISOString(),
    terminalState,
    totalLatency: Date.now() - startedMs,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    score: terminalState === "resolved" ? 1 : terminalState === "provider_error" ? null : 0,
    failureCategory:
      terminalState === "resolved"
        ? null
        : terminalState === "provider_error"
          ? "provider_failure"
          : "context_loss_failure",
    finalPatchArtifactId: null,
    artifactIds,
    environmentManifest: {
      runtime: process.version,
      platform: process.platform,
      toolVersions: { node: process.version },
    },
  });
  traceStore.upsertRun({ runId, ...run });
  if (terminalState !== "provider_error") {
    rootSpan.event("run_completed", {
      terminalState,
      score: run.score,
      finalBeforeBytes: finalProfile?.beforeBytes ?? null,
      finalAfterBytes: finalProfile?.afterBytes ?? null,
    });
    if (terminalState === "resolved") {
      rootSpan.end("ok");
    } else {
      rootSpan.end("error", {
        category: "context_loss_failure",
        message: "Expected downstream marker was not retained",
      });
    }
  }
  writeFileSync(
    join(runRoot, "run.json"),
    JSON.stringify(
      {
        run,
        evaluation: context
          ? {
              passed: context.downstreamSuccess,
              score: run.score,
              terminalState,
              validations: [],
              failureClassification: {
                category: run.failureCategory,
                confidence: "high",
                reason: context.downstreamSuccess
                  ? "The expected downstream context marker was retained."
                  : "The expected downstream context marker was lost.",
              },
            }
          : null,
        context,
        trace: trace.read(),
      },
      null,
      2,
    ),
  );
  traceStore.close();
  return { runId, configuration, outputRoot: runRoot, provider, terminalState, context };
}

async function compactStep(input: {
  provider: ContextCompactionProvider;
  messages: ContextMessage[];
  label: string;
  step: number;
  profiles: ContextProfileRecord[];
  rootSpan: SpanHandle;
  trace: TraceWriter;
}): Promise<ContextCompactionResult> {
  const beforeText = serializeMessages(input.messages);
  const persistedBeforeText = redactText(beforeText).value;
  const span = input.trace.startSpan("context.compact", {
    parentSpanId: input.rootSpan.spanId,
    attributes: {
      strategy: input.provider.id,
      step: input.step,
      beforeBytes: Buffer.byteLength(beforeText, "utf8"),
    },
  });
  let result: ContextCompactionResult;
  try {
    result = await input.provider.compact({
      messages: input.messages,
      modelContextLimitBytes: CONTEXT_LIMIT_BYTES,
      futureModelCalls: 3,
    });
    span.update({
      attributes: {
        strategy: result.profile.strategy,
        provider: result.profile.provider,
        model: result.profile.model,
        beforeBytes: result.profile.beforeBytes,
        afterBytes: result.profile.afterBytes,
        retainedRatio: result.profile.retainedRatio,
        toolOutputShare: result.profile.toolOutputShare,
        informationLoss: result.profile.informationLoss,
        latencyMs: result.profile.latencyMs,
      },
      ...(result.profile.usage?.inputTokens !== undefined &&
      result.profile.usage?.outputTokens !== undefined
        ? {
            tokenUsage: {
              inputTokens: result.profile.usage.inputTokens,
              outputTokens: result.profile.usage.outputTokens,
              totalTokens: result.profile.usage.totalTokens,
            },
          }
        : {}),
      ...(result.profile.costUsd !== null ? { cost: result.profile.costUsd } : {}),
    });
    span.event("context_compacted", {
      beforeBytes: result.profile.beforeBytes,
      afterBytes: result.profile.afterBytes,
      retainedRatio: result.profile.retainedRatio,
      estimatedFutureModelCallsSaved: result.profile.estimatedFutureModelCallsSaved,
    });
    span.end("ok");
  } catch (error) {
    span.end("error", {
      category: "provider_failure",
      message: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
  const persistedAfterText = redactText(result.afterText).value;
  input.rootSpan.event("context_profile", {
    step: input.step,
    label: input.label,
    strategy: result.profile.strategy,
    provider: result.profile.provider,
    beforeBytes: result.profile.beforeBytes,
    afterBytes: result.profile.afterBytes,
    retainedRatio: result.profile.retainedRatio,
    toolOutputShare: result.profile.toolOutputShare,
    retainedToolOutputShare: result.profile.retainedToolOutputShare,
    estimatedFutureModelCallsSaved: result.profile.estimatedFutureModelCallsSaved,
    estimatedFutureInputBytesSaved: result.profile.estimatedFutureInputBytesSaved,
    informationLoss: result.profile.informationLoss,
    beforeText: persistedBeforeText,
    afterText: persistedAfterText,
  });
  input.profiles.push({
    step: input.step,
    label: input.label,
    status: "ok",
    beforeText: persistedBeforeText,
    afterText: persistedAfterText,
    beforeSha256: sha256(persistedBeforeText),
    afterSha256: sha256(persistedAfterText),
    profile: result.profile,
    downstreamSuccess: null,
  });
  return result;
}

function createProvider(
  configuration: ContextStudyConfig,
  trace: TraceWriter,
): ContextCompactionProvider {
  switch (configuration) {
    case "no-compaction":
      return new NoCompactionProvider();
    case "threshold-truncation":
      return new ThresholdTruncationProvider(THRESHOLD_BYTES);
    case "morph-compact":
      return new MorphCompactProvider(new MorphClient({ trace }), {
        query: "Retain the exact acceptance condition and the relevant file/test evidence.",
        preserveRecent: 3,
      });
    default:
      return assertNever(configuration);
  }
}

function syntheticContext(task: Task): ContextMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a repository editing agent. Preserve exact evidence, distinguish tool output from conclusions, and do not invent files or tests.",
    },
    {
      role: "user",
      content: task.issue,
    },
    {
      role: "tool",
      content:
        "grep_search(pattern=formatGreeting) -> benchmarks/fixtures/buggy-greeting/src/greeting.js:3:function formatGreeting(name) {",
    },
    {
      role: "assistant",
      content:
        "The target function is in src/greeting.js. I need to preserve the caller's name and change only the returned greeting punctuation.",
    },
    {
      role: "tool",
      content: Array.from(
        { length: 18 },
        (_, index) =>
          `file_observation_${index + 1}: src/module-${index + 1}.js exports a stable helper; no edit is required for the greeting task.`,
      ).join("\n"),
    },
    {
      role: "assistant",
      content:
        "Repository scan is complete. The unrelated helper observations are low-priority context and should be safe to discard if the context budget is reached.",
    },
    {
      role: "user",
      content:
        "Before applying the edit, retain the exact acceptance condition and the relevant test evidence.",
    },
    {
      role: "tool",
      content: `${EXPECTED_MARKER}\nTest evidence: formatGreeting('Ada') should equal 'Hello, Ada.'`,
    },
  ];
}

function contextBatches(messages: ContextMessage[]): ContextMessage[][] {
  return [messages.slice(0, 2), messages.slice(2, 4), messages.slice(4, 6), messages.slice(6)];
}

function compareResults(
  results: Array<{ configuration: string; context: ContextStudyRecord | null }>,
) {
  return results.map((result) => {
    const finalProfile = result.context?.profiles.at(-1)?.profile;
    return {
      configuration: result.configuration,
      downstreamSuccess: result.context?.downstreamSuccess ?? null,
      beforeBytes: finalProfile?.beforeBytes ?? null,
      afterBytes: finalProfile?.afterBytes ?? null,
      retainedRatio: finalProfile?.retainedRatio ?? null,
      toolOutputShare: finalProfile?.toolOutputShare ?? null,
      estimatedFutureModelCallsSaved: finalProfile?.estimatedFutureModelCallsSaved ?? null,
      estimatedFutureInputBytesSaved: finalProfile?.estimatedFutureInputBytesSaved ?? null,
      informationLoss: finalProfile?.informationLoss ?? null,
      compactionLatencyMs: finalProfile?.latencyMs ?? null,
      compactionCostUsd: finalProfile?.costUsd ?? null,
    };
  });
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
  return createHash("sha256").update(value).digest("hex");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported context study configuration: ${String(value)}`);
}
