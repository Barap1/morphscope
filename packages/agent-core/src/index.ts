import { createHash } from "node:crypto";
import type { FailureCategory, ResourceLimits, TerminalState } from "@morphscope/schemas";
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

export type ReasoningMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
};

export type ReasoningUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  nominalCostUsd?: number;
};

export type ReasoningMetadata = {
  provider: string;
  model?: string;
  status: number;
  latencyMs: number;
  usage: ReasoningUsage | null;
};

export interface AgentReasoningProvider {
  readonly provider: string;
  readonly model: string;
  complete(input: {
    messages: ReasoningMessage[];
    temperature?: number;
    maxCompletionTokens?: number;
    responseFormat?:
      | { type: "json_object" }
      | {
          type: "json_schema";
          json_schema: {
            name: string;
            strict: boolean;
            schema: Record<string, unknown>;
          };
        };
    includeReasoning?: boolean;
    reasoningEffort?: "low" | "medium" | "high";
  }): Promise<{
    content: string;
    finishReason?: string;
    metadata: ReasoningMetadata;
  }>;
}

export interface ReasoningAgentOptions {
  toolbox: BaselineToolbox;
  issue: string;
  reasoning: AgentReasoningProvider;
  trace: TraceWriter;
  resourceLimits: ResourceLimits;
  isCancelled?: () => boolean;
}

export interface ReasoningAgentResult {
  actionsExecuted: number;
  turns: number;
  terminalState: TerminalState;
  outputs: Array<{ action: BaselineAction["type"] | "finish"; summary: string }>;
  failureCategory?: FailureCategory;
  provider: string;
  model: string;
  reasoningCalls: number;
  totalLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalNominalCostUsd: number;
  costBasis: "provider_reported" | "nominal_estimate" | "unavailable";
  costCoverage: "free_tier";
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

const REASONING_SYSTEM_PROMPT = [
  "You are the coding agent inside MorphScope.",
  "Solve the task by requesting only the explicit repository operations below.",
  "Return exactly one JSON object and no markdown or prose.",
  'Return one operation object at a time: {"action":"list_files","path":"."}, {"action":"search","query":"...","path":".","maxResults":20},',
  '{"action":"read_file","path":"..."}, {"action":"replace","path":"...","search":"...","replacement":"..."},',
  '{"action":"apply_patch","patch":"unified diff"}, {"action":"command","command":"npm test"},',
  '{"action":"finish","summary":"brief result"}.',
  "Use relative repository paths only. Inspect before editing. Make the smallest correct change.",
  "Return plain JSON text only. Do not emit function calls, Harmony tool calls, or tool names.",
  "Do not invent operation results. Do not request credentials or access outside the workspace.",
].join("\n");

const REASONING_RESPONSE_FORMAT = { type: "json_object" } as const;

/**
 * A provider-backed coding loop. The model chooses one explicit repository action per turn;
 * the host executes it through the same constrained toolbox as the deterministic baseline.
 * The protocol is intentionally JSON-in-content so provider tool implementations remain
 * pluggable and controlled comparisons do not inherit provider-specific agentic tools.
 */
export async function runReasoningAgent(
  options: ReasoningAgentOptions,
): Promise<ReasoningAgentResult> {
  const startedAt = Date.now();
  const outputs: ReasoningAgentResult["outputs"] = [];
  const messages: ReasoningMessage[] = [
    {
      role: "user",
      content: `${REASONING_SYSTEM_PROMPT}\n\nTask issue:\n<issue>\n${options.issue}\n</issue>`,
    },
  ];
  let turns = 0;
  let actionsExecuted = 0;
  let reasoningCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalNominalCostUsd = 0;
  let costReported = false;
  let nominalCostReported = false;

  const result = (
    terminalState: TerminalState,
    failureCategory?: FailureCategory,
  ): ReasoningAgentResult => ({
    actionsExecuted,
    turns,
    terminalState,
    outputs,
    ...(failureCategory ? { failureCategory } : {}),
    provider: options.reasoning.provider,
    model: options.reasoning.model,
    reasoningCalls,
    totalLatencyMs: Date.now() - startedAt,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalNominalCostUsd,
    costBasis: costReported
      ? "provider_reported"
      : nominalCostReported
        ? "nominal_estimate"
        : "unavailable",
    costCoverage: "free_tier",
  });

  try {
    while (true) {
      checkBudget(startedAt, turns, options.resourceLimits, options.isCancelled);
      turns += 1;
      const remainingOutputTokens =
        options.resourceLimits.maxOutputTokens === undefined
          ? undefined
          : options.resourceLimits.maxOutputTokens - totalOutputTokens;
      if (remainingOutputTokens !== undefined && remainingOutputTokens < 1) {
        return result("budget_exhausted", "budget_exhaustion");
      }
      const modelSpan = options.trace.startSpan("agent.reasoning", {
        attributes: {
          provider: options.reasoning.provider,
          model: options.reasoning.model,
          turn: turns,
        },
      });
      let completion: Awaited<ReturnType<AgentReasoningProvider["complete"]>>;
      try {
        completion = await options.reasoning.complete({
          messages,
          temperature: 0,
          maxCompletionTokens: remainingOutputTokens,
          responseFormat: REASONING_RESPONSE_FORMAT,
          includeReasoning: false,
          reasoningEffort: "low",
        });
        reasoningCalls += 1;
        totalInputTokens += completion.metadata.usage?.inputTokens ?? 0;
        totalOutputTokens += completion.metadata.usage?.outputTokens ?? 0;
        totalCostUsd += completion.metadata.usage?.costUsd ?? 0;
        totalNominalCostUsd += completion.metadata.usage?.nominalCostUsd ?? 0;
        costReported ||= completion.metadata.usage?.costUsd !== undefined;
        nominalCostReported ||= completion.metadata.usage?.nominalCostUsd !== undefined;
        modelSpan.update({
          tokenUsage:
            completion.metadata.usage?.inputTokens !== undefined &&
            completion.metadata.usage?.outputTokens !== undefined
              ? {
                  inputTokens: completion.metadata.usage.inputTokens,
                  outputTokens: completion.metadata.usage.outputTokens,
                  totalTokens: completion.metadata.usage.totalTokens,
                }
              : null,
          cost: completion.metadata.usage?.costUsd ?? null,
          attributes: {
            providerStatus: completion.metadata.status,
            providerLatencyMs: completion.metadata.latencyMs,
          },
        });
        modelSpan.event("reasoning_response", {
          status: completion.metadata.status,
          latencyMs: completion.metadata.latencyMs,
          responseLength: completion.content.length,
          responseSha256: createHash("sha256").update(completion.content).digest("hex"),
          finishReason: completion.finishReason,
          nominalCostUsd: completion.metadata.usage?.nominalCostUsd,
        });
        modelSpan.end("ok");
        if (
          (options.resourceLimits.maxInputTokens !== undefined &&
            totalInputTokens > options.resourceLimits.maxInputTokens) ||
          (options.resourceLimits.maxOutputTokens !== undefined &&
            totalOutputTokens > options.resourceLimits.maxOutputTokens) ||
          (options.resourceLimits.maxTotalTokens !== undefined &&
            totalInputTokens + totalOutputTokens > options.resourceLimits.maxTotalTokens) ||
          (options.resourceLimits.maxCostUsd !== undefined &&
            costReported &&
            totalCostUsd > options.resourceLimits.maxCostUsd) ||
          (options.resourceLimits.maxNominalCostUsd !== undefined &&
            totalNominalCostUsd > options.resourceLimits.maxNominalCostUsd)
        ) {
          return result("budget_exhausted", "budget_exhaustion");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        modelSpan.end("error", {
          category: "provider_failure",
          code: errorCode(error) ?? "provider_error",
          message: message.length >= 8 ? message : "Reasoning provider error",
        });
        return result("provider_error", "provider_failure");
      }

      messages.push({ role: "assistant", content: completion.content });
      let action: ReasoningAction;
      try {
        action = parseReasoningAction(completion.content);
      } catch (error) {
        options.trace.recordEvent(null, "reasoning_action_invalid", {
          turn: turns,
          message: error instanceof Error ? error.message : String(error),
        });
        return result("task_failed", "interpretation_failure");
      }

      if (action.type === "finish") {
        outputs.push({ action: "finish", summary: summarize(action.summary) });
        return result("resolved");
      }

      checkBudget(startedAt, turns, options.resourceLimits, options.isCancelled);
      actionsExecuted += 1;
      options.trace.recordEvent(null, "reasoning_action_requested", {
        turn: turns,
        action: action.type,
        ...("path" in action && action.path ? { path: action.path } : {}),
      });
      const span = options.trace.startSpan(`tool.${action.type}`, {
        attributes: { action: action.type, source: "reasoning-agent", turn: turns },
      });
      try {
        const toolResult = executeReasoningAction(options.toolbox, action);
        const summary = summarize(toolResult);
        span.event("tool_result", { action: action.type, summary });
        span.end("ok");
        outputs.push({ action: action.type, summary });
        messages.push({
          role: "user",
          content: `<operation_result action="${action.type}">\n${summary}\n</operation_result>`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.event("tool_error", { action: action.type, message });
        span.end("error", {
          category: "application_failure",
          message: message.length >= 8 ? message : "Tool application failed",
        });
        return result("task_failed", "application_failure");
      }

      if (
        options.resourceLimits.maxTotalTokens !== undefined &&
        totalInputTokens + totalOutputTokens > options.resourceLimits.maxTotalTokens
      ) {
        return result("budget_exhausted", "budget_exhaustion");
      }
    }
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return result(error.reason, "budget_exhaustion");
    }
    throw error;
  }
}

type ReasoningAction =
  | Exclude<BaselineAction, { type: "list_files" }>
  | Extract<BaselineAction, { type: "list_files" }>
  | { type: "finish"; summary: string };

function executeReasoningAction(
  toolbox: BaselineToolbox,
  action: Exclude<ReasoningAction, { type: "finish" }>,
): unknown {
  switch (action.type) {
    case "list_files":
      return toolbox.listFiles(action.path);
    case "search":
      return toolbox.search(action.query, { path: action.path, maxResults: action.maxResults });
    case "read_file":
      return toolbox.readFile(action.path, {
        startLine: action.startLine,
        endLine: action.endLine,
      });
    case "replace":
      return toolbox.replaceFile(action);
    case "apply_patch":
      return toolbox.applyPatch(action.patch);
    case "command":
      return toolbox.runCommand(action.command, { timeoutMs: action.timeoutMs });
  }
}

function parseReasoningAction(content: string): ReasoningAction {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("reasoning response did not contain a JSON action");
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
  if (!isRecord(parsed) || typeof parsed.action !== "string") {
    throw new Error("reasoning action must contain an action field");
  }
  if (parsed.action === "finish") {
    return { type: "finish", summary: stringField(parsed, "summary") ?? "Task finished" };
  }
  if (parsed.action === "list_files")
    return { type: "list_files", path: optionalString(parsed.path) };
  if (parsed.action === "search") {
    return {
      type: "search",
      query: requiredString(parsed, "query"),
      path: optionalString(parsed.path),
      maxResults: positiveInteger(parsed.maxResults, "maxResults"),
    };
  }
  if (parsed.action === "read_file") {
    return {
      type: "read_file",
      path: requiredString(parsed, "path"),
      startLine: positiveInteger(parsed.startLine, "startLine"),
      endLine: positiveInteger(parsed.endLine, "endLine"),
    };
  }
  if (parsed.action === "replace") {
    return {
      type: "replace",
      path: requiredString(parsed, "path"),
      search: requiredString(parsed, "search"),
      replacement: stringField(parsed, "replacement") ?? "",
      expectedOccurrences: positiveInteger(parsed.expectedOccurrences, "expectedOccurrences"),
    };
  }
  if (parsed.action === "apply_patch") {
    return { type: "apply_patch", patch: requiredString(parsed, "patch") };
  }
  if (parsed.action === "command") {
    return {
      type: "command",
      command: requiredString(parsed, "command"),
      timeoutMs: positiveInteger(parsed.timeoutMs, "timeoutMs"),
    };
  }
  throw new Error(`unsupported reasoning action: ${parsed.action}`);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function positiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error(`${key} must be a positive integer`);
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  return error.code;
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
