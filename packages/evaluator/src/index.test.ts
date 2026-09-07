import { describe, expect, it } from "vitest";
import type { Task } from "@morphscope/schemas";
import type { BaselineToolbox } from "@morphscope/agent-core";
import {
  aggregateRuns,
  applyManualFailureCorrection,
  calculatePatchStatistics,
  classifyFailure,
  evaluateTask,
} from "./index.js";

const task = {
  id: "task",
  repository: "fixture",
  commit: "fixture-v1",
  issue: "fix it",
  setup: "true",
  evaluation: "pnpm test",
  resourceLimits: { maxDurationMs: 1_000 },
  tags: ["fixture"],
  metadata: {},
} satisfies Task;

function toolbox(exitCode: number, diff = "diff --git a/x b/x"): BaselineToolbox {
  return {
    listFiles: () => [],
    search: () => "",
    readFile: () => "",
    replaceFile: () => ({ path: "x", replacements: 1 }),
    applyPatch: () => ({ files: [] }),
    runCommand: () => ({
      command: "pnpm test",
      cwd: ".",
      exitCode,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 2,
      timedOut: false,
      truncated: false,
    }),
    gitDiff: () => diff,
  };
}

describe("evaluateTask", () => {
  it("requires the real evaluation command to pass", () => {
    expect(evaluateTask({ task, toolbox: toolbox(0) }).terminalState).toBe("resolved");
    expect(evaluateTask({ task, toolbox: toolbox(1) }).terminalState).toBe("task_failed");
  });

  it("keeps environment failures unscored and classifies them separately", () => {
    const result = evaluateTask({ task, toolbox: toolbox(null as unknown as number) });
    expect(result.terminalState).toBe("environment_error");
    expect(result.score).toBeNull();
    expect(result.failureClassification.category).toBe("environment_failure");
  });

  it("records patch statistics and flags out-of-scope files as regression evidence", () => {
    const diff = [
      "diff --git a/src/a.js b/src/a.js",
      "--- a/src/a.js",
      "+++ b/src/a.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/notes.txt b/notes.txt",
      "--- a/notes.txt",
      "+++ b/notes.txt",
      "@@ -1 +1 @@",
      "-old note",
      "+new note",
      "",
    ].join("\n");
    const stats = calculatePatchStatistics(diff, ["src/a.js"]);
    expect(stats).toMatchObject({
      changedFiles: ["src/a.js", "notes.txt"],
      linesAdded: 2,
      linesRemoved: 2,
      linesModified: 2,
      outOfScopeFiles: ["notes.txt"],
    });
    const result = evaluateTask({
      task,
      toolbox: toolbox(0, diff),
      allowedChangedFiles: ["src/a.js"],
    });
    expect(result.passed).toBe(false);
    expect(result.terminalState).toBe("task_failed");
    expect(result.failureClassification.category).toBe("regression");
  });

  it("runs structural and repository validations before aggregation", () => {
    const result = evaluateTask({
      task,
      toolbox: {
        ...toolbox(0),
        runCommand: (command) => ({
          command,
          cwd: ".",
          exitCode: command === "npm run build" ? 1 : 0,
          signal: null,
          stdout: "",
          stderr: command === "npm run build" ? "build failed" : "",
          durationMs: 2,
          timedOut: false,
          truncated: false,
        }),
      },
      validations: [
        { kind: "syntax", command: "node --check src/index.js" },
        { kind: "build", command: "npm run build" },
        { kind: "repository", command: "npm test" },
      ],
    });
    expect(result.validations.map((validation) => validation.kind)).toEqual([
      "syntax",
      "build",
      "repository",
      "task",
    ]);
    expect(result.terminalState).toBe("task_failed");
    expect(result.failureClassification.category).toBe("verification_failure");
  });

  it("supports manual correction without erasing the automatic category", () => {
    const result = evaluateTask({ task, toolbox: toolbox(1) });
    const corrected = applyManualFailureCorrection(result, {
      category: "planning_failure",
      reason: "Reviewer found the plan omitted the required file.",
      correctedAt: "2026-09-07T12:00:00.000Z",
    });
    expect(corrected.analysisMetadata.automatic.category).toBe("verification_failure");
    expect(corrected.analysisMetadata.manualCorrection?.category).toBe("planning_failure");
  });

  it("uses the failure taxonomy priority consistently", () => {
    expect(classifyFailure({ providerError: true, verificationError: true }).category).toBe(
      "provider_failure",
    );
    expect(classifyFailure({ budgetExhausted: true }).category).toBe("budget_exhaustion");
  });

  it("aggregates scores without counting unscorable environment runs as incorrect", () => {
    const base = {
      id: "run",
      experimentId: "experiment",
      taskId: "task",
      configurationId: "baseline",
      traceId: "trace",
      repositoryCommit: "fixture-v1",
      MorphScopeCommit: "morphscope",
      provider: "local",
      model: "fixture",
      startedAt: "2026-09-07T12:00:00.000Z",
      completedAt: "2026-09-07T12:00:01.000Z",
      totalLatency: 100,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      environmentManifest: { runtime: "node" },
    } as const;
    const summary = aggregateRuns([
      { ...base, id: "resolved", terminalState: "resolved", score: 1 },
      {
        ...base,
        id: "failed",
        terminalState: "task_failed",
        score: 0,
        failureCategory: "verification_failure",
      },
      {
        ...base,
        id: "environment",
        terminalState: "environment_error",
        score: null,
        failureCategory: "environment_failure",
      },
    ]);
    expect(summary.resolvedRate).toBeCloseTo(1 / 3);
    expect(summary.scoredRuns).toBe(2);
    expect(summary.correctnessRate).toBe(0.5);
    expect(summary.failureCategories.environment_failure).toBe(1);
  });
});
