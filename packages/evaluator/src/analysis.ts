import type { Run } from "@morphscope/schemas";

export type NumericSummary = {
  count: number;
  min: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
};

export type BootstrapInterval = {
  lower: number;
  upper: number;
  confidence: 0.95;
  resamples: number;
  seed: number;
};

export type AnalysisReport = {
  schemaVersion: 1;
  generatedAt: string;
  source: { runCount: number; taskCount: number; configurationCount: number };
  rawCounts: Record<string, number>;
  overall: {
    score: NumericSummary;
    latencyMs: NumericSummary;
    costUsd: NumericSummary;
    inputTokens: NumericSummary;
    outputTokens: NumericSummary;
  };
  byConfiguration: Record<
    string,
    {
      rawCount: number;
      resolvedCount: number;
      resolvedRate: number | null;
      scoredCount: number;
      correctnessRate: number | null;
      latencyMs: NumericSummary;
      costUsd: NumericSummary;
    }
  >;
  pairedComparisons: Array<{
    leftConfiguration: string;
    rightConfiguration: string;
    pairedTasks: number;
    latencyDeltaRightMinusLeft: NumericSummary;
    scoreDeltaRightMinusLeft: NumericSummary;
    costDeltaRightMinusLeft: NumericSummary;
    bootstrapLatencyDelta95: BootstrapInterval | null;
    bootstrapStatus: "computed" | "not_computed_sample_below_10";
  }>;
  notes: string[];
};

export function analyzeRuns(
  runs: readonly Run[],
  options: { generatedAt?: string; bootstrapSeed?: number; bootstrapResamples?: number } = {},
): AnalysisReport {
  const configurations = [...new Set(runs.map((run) => run.configurationId))].sort();
  const taskIds = new Set(runs.map((run) => run.taskId));
  const rawCounts = runs.reduce<Record<string, number>>((counts, run) => {
    counts[run.terminalState] = (counts[run.terminalState] ?? 0) + 1;
    return counts;
  }, {});
  rawCounts.total = runs.length;
  rawCounts.scored = runs.filter((run) => run.score !== null && run.score !== undefined).length;
  rawCounts.unscored = runs.length - rawCounts.scored;
  const byConfiguration = Object.fromEntries(
    configurations.map((configuration) => {
      const selected = runs.filter((run) => run.configurationId === configuration);
      const scored = selected.filter((run) => run.score !== null && run.score !== undefined);
      return [
        configuration,
        {
          rawCount: selected.length,
          resolvedCount: selected.filter((run) => run.terminalState === "resolved").length,
          resolvedRate:
            selected.length > 0
              ? selected.filter((run) => run.terminalState === "resolved").length / selected.length
              : null,
          scoredCount: scored.length,
          correctnessRate:
            scored.length > 0
              ? scored.filter((run) => run.score === 1).length / scored.length
              : null,
          latencyMs: summarize(selected.map((run) => run.totalLatency)),
          costUsd: summarize(selected.map((run) => run.totalCost)),
        },
      ];
    }),
  );
  const pairedComparisons = [];
  const seed = options.bootstrapSeed ?? 17_091;
  const resamples = options.bootstrapResamples ?? 2_000;
  for (let leftIndex = 0; leftIndex < configurations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < configurations.length; rightIndex += 1) {
      const leftConfiguration = configurations[leftIndex];
      const rightConfiguration = configurations[rightIndex];
      const leftRuns = runs.filter((run) => run.configurationId === leftConfiguration);
      const rightRuns = runs.filter((run) => run.configurationId === rightConfiguration);
      const leftByTask = groupByTask(leftRuns);
      const rightByTask = groupByTask(rightRuns);
      const latencyDelta: number[] = [];
      const scoreDelta: number[] = [];
      const costDelta: number[] = [];
      let pairedTasks = 0;
      for (const taskId of [...leftByTask.keys()].sort()) {
        const left = leftByTask.get(taskId) ?? [];
        const right = rightByTask.get(taskId) ?? [];
        const pairCount = Math.min(left.length, right.length);
        if (pairCount > 0) pairedTasks += 1;
        for (let index = 0; index < pairCount; index += 1) {
          latencyDelta.push(right[index].totalLatency - left[index].totalLatency);
          costDelta.push(right[index].totalCost - left[index].totalCost);
          if (
            left[index].score !== null &&
            left[index].score !== undefined &&
            right[index].score !== null &&
            right[index].score !== undefined
          ) {
            const leftScore = left[index].score;
            const rightScore = right[index].score;
            if (
              leftScore !== null &&
              leftScore !== undefined &&
              rightScore !== null &&
              rightScore !== undefined
            ) {
              scoreDelta.push(rightScore - leftScore);
            }
          }
        }
      }
      pairedComparisons.push({
        leftConfiguration,
        rightConfiguration,
        pairedTasks,
        latencyDeltaRightMinusLeft: summarize(latencyDelta),
        scoreDeltaRightMinusLeft: summarize(scoreDelta),
        costDeltaRightMinusLeft: summarize(costDelta),
        bootstrapLatencyDelta95:
          latencyDelta.length >= 10
            ? bootstrapMeanInterval(latencyDelta, seed + leftIndex * 101 + rightIndex, resamples)
            : null,
        bootstrapStatus:
          latencyDelta.length >= 10
            ? ("computed" as const)
            : ("not_computed_sample_below_10" as const),
      });
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      runCount: runs.length,
      taskCount: taskIds.size,
      configurationCount: configurations.length,
    },
    rawCounts,
    overall: {
      score: summarize(
        runs.flatMap((run) => (run.score === null || run.score === undefined ? [] : [run.score])),
      ),
      latencyMs: summarize(runs.map((run) => run.totalLatency)),
      costUsd: summarize(runs.map((run) => run.totalCost)),
      inputTokens: summarize(runs.map((run) => run.totalInputTokens)),
      outputTokens: summarize(runs.map((run) => run.totalOutputTokens)),
    },
    byConfiguration,
    pairedComparisons,
    notes: [
      "All summaries are descriptive; no significance claim is made.",
      "Paired comparisons align runs by task and occurrence order within each configuration.",
      "Bootstrap latency intervals are omitted when fewer than 10 paired observations exist.",
    ],
  };
}

export function summarize(values: readonly number[]): NumericSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted.at(-1) ?? null,
  };
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function groupByTask(runs: readonly Run[]): Map<string, Run[]> {
  const grouped = new Map<string, Run[]>();
  for (const run of runs) grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]);
  for (const group of grouped.values())
    group.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  return grouped;
}

function bootstrapMeanInterval(
  values: readonly number[],
  seed: number,
  resamples: number,
): BootstrapInterval {
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1)
      total += values[Math.floor(random() * values.length)];
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  return {
    lower: percentile(means, 0.025) ?? 0,
    upper: percentile(means, 0.975) ?? 0,
    confidence: 0.95,
    resamples,
    seed,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}
