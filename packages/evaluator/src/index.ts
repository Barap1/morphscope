import type { BaselineToolbox, CommandExecution } from "@morphscope/agent-core";
import type {
  AnalysisMetadata,
  FailureCategory,
  FailureClassification,
  ManualFailureCorrection,
  Run,
  Task,
} from "@morphscope/schemas";

export type ValidationKind = "syntax" | "build" | "task" | "repository";

export type ValidationSpec = {
  kind: ValidationKind;
  command: string;
};

export type ValidationResult = ValidationSpec & {
  passed: boolean;
  commandResult: CommandExecution;
};

export type PatchStatistics = {
  changedFiles: string[];
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  patchBytes: number;
  outOfScopeFiles: string[];
};

export type FailureEvidence = {
  environmentError?: boolean;
  providerError?: boolean;
  retrievalError?: boolean;
  interpretationError?: boolean;
  planningError?: boolean;
  generationError?: boolean;
  applicationError?: boolean;
  verificationError?: boolean;
  regression?: boolean;
  contextLoss?: boolean;
  stagnation?: boolean;
  budgetExhausted?: boolean;
};

export interface EvaluationResult {
  passed: boolean;
  /** `null` means the run was not scorable, such as an environment failure. */
  score: number | null;
  terminalState: "resolved" | "task_failed" | "timeout" | "environment_error";
  command: CommandExecution;
  diff: string;
  changedFiles: string[];
  patchStatistics: PatchStatistics;
  validations: ValidationResult[];
  failureClassification: FailureClassification;
  analysisMetadata: AnalysisMetadata;
}

export interface EvaluatorOptions {
  task: Task;
  toolbox: BaselineToolbox;
  timeoutMs?: number;
  changedFiles?: string[];
  allowedChangedFiles?: readonly string[];
  validations?: readonly ValidationSpec[];
}

/** Runs task, syntax/build, and repository checks with conservative analysis metadata. */
export function evaluateTask(options: EvaluatorOptions): EvaluationResult {
  const validations = runValidations(options);
  const taskValidation = validations.find((validation) => validation.kind === "task");
  const command = taskValidation?.commandResult ?? failedCommand(options.task.evaluation);
  const diff = options.toolbox.gitDiff();
  const changedFiles = options.changedFiles ?? changedFilesFromDiff(diff);
  const patchStatistics = calculatePatchStatistics(diff, options.allowedChangedFiles);
  const validationTerminalState = terminalStateFromValidations(validations);
  const terminalState =
    validationTerminalState === "resolved" && patchStatistics.outOfScopeFiles.length > 0
      ? "task_failed"
      : validationTerminalState;
  const passed = terminalState === "resolved" && patchStatistics.outOfScopeFiles.length === 0;
  const failureClassification = classifyEvaluation({
    validations,
    patchStatistics,
    terminalState,
  });
  const analysisMetadata = {
    automatic: failureClassification,
    manualCorrection: null,
  } satisfies AnalysisMetadata;

  return {
    passed,
    score: terminalState === "environment_error" ? null : passed ? 1 : 0,
    terminalState,
    command,
    diff,
    changedFiles,
    patchStatistics,
    validations,
    failureClassification,
    analysisMetadata,
  };
}

export function classifyFailure(evidence: FailureEvidence): FailureClassification {
  const ordered: Array<[keyof FailureEvidence, FailureCategory, string]> = [
    ["environmentError", "environment_failure", "The execution environment failed."],
    ["providerError", "provider_failure", "A configured provider failed."],
    ["retrievalError", "retrieval_failure", "Required repository context was not retrieved."],
    [
      "interpretationError",
      "interpretation_failure",
      "The task result could not be interpreted reliably.",
    ],
    ["planningError", "planning_failure", "The execution plan was invalid or incomplete."],
    ["generationError", "generation_failure", "Generated output failed a structural check."],
    ["applicationError", "application_failure", "The proposed change could not be applied."],
    ["verificationError", "verification_failure", "A required verification did not pass."],
    ["regression", "regression", "The change introduced an out-of-scope or regression signal."],
    ["contextLoss", "context_loss_failure", "Required context was lost during execution."],
    ["stagnation", "loop_stagnation", "Execution stopped without making useful progress."],
    ["budgetExhausted", "budget_exhaustion", "A configured execution budget was exhausted."],
  ];
  for (const [key, category, reason] of ordered) {
    if (evidence[key]) return { category, confidence: "high", reason };
  }
  return { category: null, confidence: "high", reason: "No failure evidence was recorded." };
}

export function applyManualFailureCorrection(
  result: EvaluationResult,
  correction: Omit<ManualFailureCorrection, "correctedAt"> & { correctedAt?: string },
): EvaluationResult {
  const manualCorrection: ManualFailureCorrection = {
    category: correction.category,
    reason: correction.reason,
    correctedAt: correction.correctedAt ?? new Date().toISOString(),
  };
  return {
    ...result,
    analysisMetadata: {
      ...result.analysisMetadata,
      manualCorrection,
    },
  };
}

export type AggregatedResults = {
  totalRuns: number;
  resolvedRuns: number;
  resolvedRate: number;
  scoredRuns: number;
  correctnessRate: number | null;
  medianRuntimeMs: number | null;
  totalCost: number;
  medianCost: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  failureCategories: Record<FailureCategory, number>;
  byConfiguration: Record<
    string,
    {
      totalRuns: number;
      resolvedRuns: number;
      resolvedRate: number;
      correctnessRate: number | null;
    }
  >;
};

/** Aggregates persisted runs without treating unscorable environment failures as wrong answers. */
export function aggregateRuns(runs: readonly Run[]): AggregatedResults {
  const resolvedRuns = runs.filter((run) => run.terminalState === "resolved").length;
  const scoredRuns = runs.filter((run) => run.score !== null && run.score !== undefined);
  const byConfiguration = new Map<
    string,
    { totalRuns: number; resolvedRuns: number; scores: number[] }
  >();
  for (const run of runs) {
    const current = byConfiguration.get(run.configurationId) ?? {
      totalRuns: 0,
      resolvedRuns: 0,
      scores: [],
    };
    current.totalRuns += 1;
    if (run.terminalState === "resolved") current.resolvedRuns += 1;
    if (run.score !== null && run.score !== undefined) current.scores.push(run.score);
    byConfiguration.set(run.configurationId, current);
  }
  return {
    totalRuns: runs.length,
    resolvedRuns,
    resolvedRate: rate(resolvedRuns, runs.length),
    scoredRuns: scoredRuns.length,
    correctnessRate: meanOrNull(
      scoredRuns.flatMap((run) =>
        run.score !== null && run.score !== undefined ? [run.score] : [],
      ),
    ),
    medianRuntimeMs: median(runs.map((run) => run.totalLatency)),
    totalCost: sum(runs.map((run) => run.totalCost)),
    medianCost: median(runs.map((run) => run.totalCost)),
    totalInputTokens: sum(runs.map((run) => run.totalInputTokens)),
    totalOutputTokens: sum(runs.map((run) => run.totalOutputTokens)),
    failureCategories: failureCategoryCounts(runs),
    byConfiguration: Object.fromEntries(
      [...byConfiguration.entries()].map(([configurationId, value]) => [
        configurationId,
        {
          totalRuns: value.totalRuns,
          resolvedRuns: value.resolvedRuns,
          resolvedRate: rate(value.resolvedRuns, value.totalRuns),
          correctnessRate: meanOrNull(value.scores),
        },
      ]),
    ),
  };
}

export const aggregateResults = aggregateRuns;

function runValidations(options: EvaluatorOptions): ValidationResult[] {
  const specs: ValidationSpec[] = [
    ...(options.validations ?? []),
    { kind: "task", command: options.task.evaluation },
  ];
  const uniqueSpecs = specs.filter(
    (spec, index) =>
      specs.findIndex(
        (candidate) => candidate.kind === spec.kind && candidate.command === spec.command,
      ) === index,
  );
  return uniqueSpecs.map((spec) => {
    let commandResult: CommandExecution;
    try {
      commandResult = options.toolbox.runCommand(spec.command, { timeoutMs: options.timeoutMs });
    } catch (error) {
      commandResult = failedCommand(
        spec.command,
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      ...spec,
      passed: commandResult.exitCode === 0 && !commandResult.timedOut,
      commandResult,
    };
  });
}

function classifyEvaluation(input: {
  validations: ValidationResult[];
  patchStatistics: PatchStatistics;
  terminalState: EvaluationResult["terminalState"];
}): FailureClassification {
  if (input.patchStatistics.outOfScopeFiles.length > 0)
    return classifyFailure({ regression: true });
  if (input.terminalState === "timeout") return classifyFailure({ budgetExhausted: true });
  if (input.terminalState === "environment_error")
    return classifyFailure({ environmentError: true });
  const failedValidation = input.validations.find((validation) => !validation.passed);
  if (failedValidation?.kind === "repository") return classifyFailure({ regression: true });
  if (failedValidation) return classifyFailure({ verificationError: true });
  return classifyFailure({});
}

function terminalStateFromValidations(
  validations: ValidationResult[],
): EvaluationResult["terminalState"] {
  if (validations.some((validation) => validation.commandResult.timedOut)) return "timeout";
  if (validations.some((validation) => validation.commandResult.exitCode === null))
    return "environment_error";
  return validations.every((validation) => validation.passed) ? "resolved" : "task_failed";
}

export function calculatePatchStatistics(
  diff: string,
  allowedChangedFiles?: readonly string[],
): PatchStatistics {
  const changedFiles = changedFilesFromDiff(diff);
  const lines = diff.split(/\r?\n/);
  const linesAdded = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const linesRemoved = lines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  const allowed = allowedChangedFiles ? new Set(allowedChangedFiles) : undefined;
  const outOfScopeFiles = allowed ? changedFiles.filter((file) => !allowed.has(file)) : [];
  return {
    changedFiles,
    linesAdded,
    linesRemoved,
    linesModified: Math.min(linesAdded, linesRemoved),
    patchBytes: Buffer.byteLength(diff, "utf8"),
    outOfScopeFiles,
  };
}

function changedFilesFromDiff(diff: string): string[] {
  return [
    ...new Set(
      [
        ...diff.matchAll(/^\+\+\+ b\/(.+)$/gm),
        ...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm),
      ].flatMap((match) => (match[2] ? [match[2]] : [match[1]])),
    ),
  ];
}

function failedCommand(
  command: string,
  stderr = "Evaluation command could not be executed",
): CommandExecution {
  return {
    command,
    cwd: ".",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr,
    durationMs: 0,
    timedOut: false,
    truncated: false,
  };
}

function failureCategoryCounts(runs: readonly Run[]): Record<FailureCategory, number> {
  const categories: FailureCategory[] = [
    "environment_failure",
    "provider_failure",
    "retrieval_failure",
    "interpretation_failure",
    "planning_failure",
    "generation_failure",
    "application_failure",
    "verification_failure",
    "regression",
    "context_loss_failure",
    "loop_stagnation",
    "budget_exhaustion",
  ];
  const counts = Object.fromEntries(categories.map((category) => [category, 0])) as Record<
    FailureCategory,
    number
  >;
  for (const run of runs) {
    const category = run.analysisMetadata?.manualCorrection?.category ?? run.failureCategory;
    if (category) counts[category] += 1;
  }
  return counts;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function meanOrNull(values: number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
