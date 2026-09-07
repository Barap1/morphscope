import { describe, expect, it, vi } from "vitest";
import type { TraceWriter } from "@morphscope/tracing";
import { runBaselineAgent, type BaselineToolbox } from "./index.js";

function traceStub(): TraceWriter {
  return {
    startSpan: vi.fn(() => ({
      event: vi.fn(),
      end: vi.fn(),
    })),
  } as unknown as TraceWriter;
}

describe("runBaselineAgent", () => {
  it("executes a real ordered tool plan", () => {
    const calls: string[] = [];
    const toolbox: BaselineToolbox = {
      listFiles: () => {
        calls.push("list");
        return ["src/index.ts"];
      },
      search: () => {
        calls.push("search");
        return "src/index.ts:1";
      },
      readFile: () => {
        calls.push("read");
        return "old";
      },
      replaceFile: () => {
        calls.push("replace");
        return { path: "src/index.ts", replacements: 1 };
      },
      applyPatch: () => ({ files: [] }),
      runCommand: () => {
        calls.push("command");
        return {
          command: "pnpm test",
          cwd: ".",
          exitCode: 0,
          signal: null,
          stdout: "ok",
          stderr: "",
          durationMs: 1,
          timedOut: false,
          truncated: false,
        };
      },
      gitDiff: () => "",
    };
    const result = runBaselineAgent({
      toolbox,
      trace: traceStub(),
      resourceLimits: { maxTurns: 4 },
      plan: {
        version: 1,
        actions: [
          { type: "list_files" },
          { type: "search", query: "old" },
          { type: "read_file", path: "src/index.ts" },
          { type: "replace", path: "src/index.ts", search: "old", replacement: "new" },
        ],
      },
    });
    expect(result.terminalState).toBe("resolved");
    expect(calls).toEqual(["list", "search", "read", "replace"]);
  });

  it("stops before exceeding turn budget", () => {
    const toolbox = {
      listFiles: () => [],
      search: () => "",
      readFile: () => "",
      replaceFile: () => ({ path: "x", replacements: 0 }),
      applyPatch: () => ({ files: [] }),
      runCommand: () => ({
        command: "true",
        cwd: ".",
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        timedOut: false,
        truncated: false,
      }),
      gitDiff: () => "",
    } satisfies BaselineToolbox;
    const result = runBaselineAgent({
      toolbox,
      trace: traceStub(),
      resourceLimits: { maxTurns: 1 },
      plan: { version: 1, actions: [{ type: "list_files" }, { type: "list_files" }] },
    });
    expect(result.terminalState).toBe("budget_exhausted");
    expect(result.actionsExecuted).toBe(1);
  });
});
