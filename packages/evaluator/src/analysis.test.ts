import { describe, expect, it } from "vitest";
import { analyzeRuns, summarize } from "./analysis.js";
import type { Run } from "@morphscope/schemas";

function run(input: Partial<Run> & Pick<Run, "id" | "configurationId" | "taskId">): Run {
  return {
    id: input.id,
    experimentId: input.experimentId ?? "analysis-test",
    taskId: input.taskId,
    configurationId: input.configurationId,
    traceId: input.traceId ?? `trace-${input.id}`,
    repositoryCommit: input.repositoryCommit ?? "fixture-v1",
    MorphScopeCommit: input.MorphScopeCommit ?? "test-commit",
    provider: input.provider ?? "local",
    model: input.model ?? "test-model",
    startedAt: input.startedAt ?? "2026-09-07T12:00:00.000Z",
    completedAt: input.completedAt ?? "2026-09-07T12:00:01.000Z",
    terminalState: input.terminalState ?? "resolved",
    totalLatency: input.totalLatency ?? 100,
    totalInputTokens: input.totalInputTokens ?? 10,
    totalOutputTokens: input.totalOutputTokens ?? 5,
    totalCost: input.totalCost ?? 0,
    score: input.score ?? 1,
  } as Run;
}

describe("result analysis", () => {
  it("summarizes descriptive percentiles without inventing an empty value", () => {
    expect(summarize([1, 2, 3, 4, 5])).toMatchObject({ count: 5, median: 3, p10: 1.4, p90: 4.6 });
    expect(summarize([]).median).toBeNull();
  });

  it("reports raw counts and paired deltas", () => {
    const report = analyzeRuns(
      [
        run({ id: "a1", configurationId: "baseline", taskId: "task-1", totalLatency: 100 }),
        run({ id: "b1", configurationId: "adaptive", taskId: "task-1", totalLatency: 80 }),
        run({
          id: "a2",
          configurationId: "baseline",
          taskId: "task-2",
          terminalState: "task_failed",
          score: 0,
        }),
        run({
          id: "b2",
          configurationId: "adaptive",
          taskId: "task-2",
          terminalState: "resolved",
          score: 1,
        }),
      ],
      { generatedAt: "2026-09-07T12:00:00.000Z" },
    );
    expect(report.rawCounts.total).toBe(4);
    expect(report.rawCounts.task_failed).toBe(1);
    expect(report.byConfiguration.adaptive.resolvedRate).toBe(1);
    expect(report.pairedComparisons[0].pairedTasks).toBe(2);
    expect(report.pairedComparisons[0].latencyDeltaRightMinusLeft.median).toBe(10);
    expect(report.pairedComparisons[0].bootstrapLatencyDelta95).toBeNull();
    expect(report.pairedComparisons[0].bootstrapStatus).toBe("not_computed_sample_below_10");
  });
});
