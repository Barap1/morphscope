import { describe, expect, it, vi } from "vitest";
import type { TraceWriter } from "@morphscope/tracing";
import {
  runBaselineAgent,
  runReasoningAgent,
  type BaselineToolbox,
  type AgentReasoningProvider,
} from "./index.js";

function traceStub(): TraceWriter {
  return {
    startSpan: vi.fn(() => ({
      update: vi.fn(),
      event: vi.fn(),
      end: vi.fn(),
    })),
    recordEvent: vi.fn(),
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

  it("stops cleanly when cancellation is requested", () => {
    const result = runBaselineAgent({
      toolbox: {
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
      },
      trace: traceStub(),
      resourceLimits: { maxTurns: 4 },
      isCancelled: () => true,
      plan: { version: 1, actions: [{ type: "list_files" }] },
    });
    expect(result.terminalState).toBe("cancelled");
    expect(result.actionsExecuted).toBe(0);
  });
});

describe("runReasoningAgent", () => {
  it("lets a provider choose constrained tools and records usage", async () => {
    const calls: string[] = [];
    const toolbox: BaselineToolbox = {
      listFiles: () => ["src/greeting.js"],
      search: () => "src/greeting.js:1:1:return greeting",
      readFile: () => "return `Hello ${name}`;",
      replaceFile: ({ path }) => {
        calls.push(`replace:${path}`);
        return { path, replacements: 1 };
      },
      applyPatch: () => ({ files: [] }),
      runCommand: () => ({
        command: "npm test",
        cwd: ".",
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stderr: "",
        durationMs: 1,
        timedOut: false,
        truncated: false,
      }),
      gitDiff: () => "",
    };
    const responses = [
      '{"action":"search","query":"greeting"}',
      '{"action":"read_file","path":"src/greeting.js"}',
      '{"action":"replace","path":"src/greeting.js","search":"return `Hello ${name}`;","replacement":"return `Hello ${name}!`;"}',
      '{"action":"command","command":"npm test"}',
      '{"action":"finish","summary":"implemented and verified"}',
    ];
    const reasoning: AgentReasoningProvider = {
      provider: "groq",
      model: "openai/gpt-oss-120b",
      complete: vi.fn(async () => ({
        content: responses.shift() ?? '{"action":"finish"}',
        metadata: {
          provider: "groq",
          model: "openai/gpt-oss-120b",
          status: 200,
          latencyMs: 4,
          usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
        },
      })),
    };

    const result = await runReasoningAgent({
      toolbox,
      issue: "Add punctuation.",
      reasoning,
      trace: traceStub(),
      resourceLimits: { maxTurns: 8, maxOutputTokens: 64 },
    });

    expect(result.terminalState).toBe("resolved");
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("openai/gpt-oss-120b");
    expect(result.reasoningCalls).toBe(5);
    expect(result.totalInputTokens).toBe(50);
    expect(result.totalOutputTokens).toBe(30);
    expect(calls).toEqual(["replace:src/greeting.js"]);
  });

  it("enforces a nominal cost budget when billed cost is absent", async () => {
    const reasoning: AgentReasoningProvider = {
      provider: "groq",
      model: "openai/gpt-oss-120b",
      complete: vi.fn(async () => ({
        content: '{"action":"finish","summary":"done"}',
        metadata: {
          provider: "groq",
          model: "openai/gpt-oss-120b",
          status: 200,
          latencyMs: 4,
          usage: { inputTokens: 100_000, outputTokens: 0, nominalCostUsd: 0.015 },
        },
      })),
    };
    const result = await runReasoningAgent({
      toolbox: {
        listFiles: () => [],
        search: () => "",
        readFile: () => "",
        replaceFile: () => ({ path: "src/greeting.js", replacements: 1 }),
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
      },
      issue: "No-op.",
      reasoning,
      trace: traceStub(),
      resourceLimits: { maxTurns: 2, maxNominalCostUsd: 0.01 },
    });

    expect(result.terminalState).toBe("budget_exhausted");
    expect(result.failureCategory).toBe("budget_exhaustion");
    expect(result.costBasis).toBe("nominal_estimate");
    expect(result.totalNominalCostUsd).toBe(0.015);
    expect(reasoning.complete).toHaveBeenCalledTimes(1);
  });
});
