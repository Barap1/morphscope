import { describe, expect, it } from "vitest";
import type { Task } from "@morphscope/schemas";
import type { BaselineToolbox } from "@morphscope/agent-core";
import { evaluateTask } from "./index.js";

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

function toolbox(exitCode: number): BaselineToolbox {
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
    gitDiff: () => "diff --git a/x b/x",
  };
}

describe("evaluateTask", () => {
  it("requires the real evaluation command to pass", () => {
    expect(evaluateTask({ task, toolbox: toolbox(0) }).terminalState).toBe("resolved");
    expect(evaluateTask({ task, toolbox: toolbox(1) }).terminalState).toBe("task_failed");
  });
});
