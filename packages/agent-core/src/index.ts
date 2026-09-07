import type { ResourceLimits, TerminalState } from "@morphscope/schemas";
import type { TraceWriter } from "@morphscope/tracing";

export {
  ADAPTIVE_POLICY_VERSION,
  decideCompaction,
  decideEdit,
  decideSearch,
  type CompactionRoutingFeatures,
  type EditRoutingFeatures,
  type RoutingDecision,
  type SearchRoutingFeatures,
} from "./controller.js";

export type BaselineAction =
  | { type: "list_files"; path?: string }
  | { type: "search"; query: string; path?: string; maxResults?: number }
  | { type: "read_file"; path: string; startLine?: number; endLine?: number }
  | {
      type: "replace";
      path: string;
      search: string;
      replacement: string;
      expectedOccurrences?: number;
    }
  | { type: "apply_patch"; patch: string }
  | { type: "command"; command: string; timeoutMs?: number };

export interface BaselinePlan {
  version: 1;
  actions: BaselineAction[];
}

export interface CommandExecution {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface BaselineToolbox {
  listFiles(path?: string): string[];
  search(query: string, options?: { path?: string; maxResults?: number }): string;
  readFile(path: string, options?: { startLine?: number; endLine?: number }): string;
  replaceFile(input: {
    path: string;
    search: string;
    replacement: string;
    expectedOccurrences?: number;
  }): { path: string; replacements: number };
  applyPatch(patch: string): { files: string[] };
  runCommand(command: string, options?: { timeoutMs?: number }): CommandExecution;
  gitDiff(): string;
}

export interface BaselineAgentOptions {
  toolbox: BaselineToolbox;
  plan: BaselinePlan;
  trace: TraceWriter;
  resourceLimits: ResourceLimits;
  isCancelled?: () => boolean;
}

export interface BaselineAgentResult {
  actionsExecuted: number;
  turns: number;
  terminalState: TerminalState;
  outputs: Array<{ action: BaselineAction["type"]; summary: string }>;
}

class BudgetExceeded extends Error {
  constructor(readonly reason: "timeout" | "budget_exhausted" | "cancelled") {
    super(reason);
  }
}

function summarize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
}

function checkBudget(
  startedAt: number,
  turns: number,
  limits: ResourceLimits,
  isCancelled?: () => boolean,
): void {
  if (isCancelled?.()) throw new BudgetExceeded("cancelled");
  if (limits.maxDurationMs !== undefined && Date.now() - startedAt > limits.maxDurationMs) {
    throw new BudgetExceeded("timeout");
  }
  if (limits.maxTurns !== undefined && turns >= limits.maxTurns) {
    throw new BudgetExceeded("budget_exhausted");
  }
}

/**
 * A deterministic conventional tool loop used for local fixtures and offline development.
 * It intentionally has no hidden answer key: every edit comes from the supplied plan and is
 * still applied through the same repository tools a provider-backed agent will use later.
 */
export function runBaselineAgent(options: BaselineAgentOptions): BaselineAgentResult {
  const startedAt = Date.now();
  const outputs: BaselineAgentResult["outputs"] = [];
  let turns = 0;

  try {
    for (const action of options.plan.actions) {
      checkBudget(startedAt, turns, options.resourceLimits, options.isCancelled);
      turns += 1;
      const span = options.trace.startSpan(`tool.${action.type}`, {
        attributes: { action: action.type },
      });

      try {
        let result: unknown;
        switch (action.type) {
          case "list_files":
            result = options.toolbox.listFiles(action.path);
            break;
          case "search":
            result = options.toolbox.search(action.query, {
              path: action.path,
              maxResults: action.maxResults,
            });
            break;
          case "read_file":
            result = options.toolbox.readFile(action.path, {
              startLine: action.startLine,
              endLine: action.endLine,
            });
            break;
          case "replace":
            result = options.toolbox.replaceFile(action);
            break;
          case "apply_patch":
            result = options.toolbox.applyPatch(action.patch);
            break;
          case "command":
            result = options.toolbox.runCommand(action.command, { timeoutMs: action.timeoutMs });
            break;
        }
        const summary = summarize(result);
        span.event("tool_result", { action: action.type, summary });
        span.end("ok");
        outputs.push({ action: action.type, summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.event("tool_error", { action: action.type, message });
        span.end("error", {
          category: "application_failure",
          message: message.length >= 8 ? message : `Tool error: ${message}`,
        });
        return {
          actionsExecuted: turns,
          turns,
          terminalState: "task_failed",
          outputs,
        };
      }
    }

    return {
      actionsExecuted: turns,
      turns,
      terminalState: "resolved",
      outputs,
    };
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return {
        actionsExecuted: turns,
        turns,
        terminalState: error.reason,
        outputs,
      };
    }
    throw error;
  }
}
