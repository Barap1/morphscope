import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { TraceWriter } from "@morphscope/tracing";
import { redactSecrets } from "@morphscope/tracing";
import type { ProviderCallMetadata, ProviderUsage } from "./provider-types.js";

export type {
  ProviderCallMetadata,
  ProviderName,
  ProviderUsage,
  RateLimitMetadata,
  ReasoningCompletionInput,
  ReasoningCompletionResult,
  ReasoningMessage,
  ReasoningProvider,
} from "./provider-types.js";
export {
  DEFAULT_GROQ_MODEL,
  GROQ_FREE_MODELS,
  GroqClient,
  GroqProviderError,
  GroqRateLimitError,
  MissingGroqCredentialError,
  type GroqClientOptions,
  type GroqCompletionInput,
  type GroqCompletionResult,
  type GroqMessage,
  type GroqModel,
  type GroqProviderErrorCode,
} from "./groq.js";
export {
  RawSearchProvider,
  WarpGrepProvider,
  type RawSearchExecutor,
  type SearchContext,
  type SearchMatch,
  type SearchMeasurement,
  type SearchProvider,
  type SearchProviderInput,
  type SearchProviderResult,
  type WarpGrepExecutor,
} from "./search.js";
export {
  DeterministicEditProvider,
  FullFileEditProvider,
  MorphFastApplyEditProvider,
  UnifiedDiffEditProvider,
  type DeterministicEditTransform,
  type EditInput,
  type EditProvider,
  type EditResult,
  type SyntaxCheck,
} from "./edit.js";

const DEFAULT_BASE_URL = "https://api.morphllm.com";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type FetchImplementation = typeof fetch;

export class MissingMorphCredentialError extends Error {
  constructor() {
    super("MORPH_API_KEY is required for Morph provider calls");
    this.name = "MissingMorphCredentialError";
  }
}

export class MorphProviderError extends Error {
  readonly status?: number;
  readonly operation: string;
  readonly code: "timeout" | "http_error" | "malformed_response" | "request_error";

  constructor(
    operation: string,
    code: MorphProviderError["code"],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "MorphProviderError";
    this.operation = operation;
    this.code = code;
    this.status = status;
  }
}

export interface MorphClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImplementation;
  trace?: TraceWriter;
}

export type WarpGrepInput = {
  searchTerm: string;
  repoRoot: string;
  maxTurns?: number;
  includes?: string[];
  excludes?: string[];
};

export type WarpGrepContext = { file: string; content: string };

export type WarpGrepResult = {
  success: boolean;
  contexts: WarpGrepContext[];
  contextSource?: "provider_finish" | "local_read_fallback";
  summary?: string;
  toolCalls: number;
  metadata: ProviderCallMetadata;
};

export type FastApplyInput = {
  originalCode: string;
  codeEdit: string;
  instructions: string;
};

export type FastApplyResult = {
  success: boolean;
  mergedCode?: string;
  udiff?: string;
  changes: { linesAdded: number; linesRemoved: number; linesModified: number };
  originalSha256: string;
  finalSha256?: string;
  metadata: ProviderCallMetadata;
  error?: string;
};

export type CompactInput = {
  input: string | Array<{ role: string; content: string }>;
  query?: string;
  compressionRatio?: number;
  preserveRecent?: number;
  model?: string;
};

export type CompactResult = {
  output: string;
  beforeBytes: number;
  afterBytes: number;
  retainedLines: number;
  metadata: ProviderCallMetadata;
};

type JsonRecord = Record<string, unknown>;

export class MorphClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchImplementation;
  private readonly trace: TraceWriter | undefined;

  constructor(options: MorphClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.MORPH_API_KEY;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.trace = options.trace;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Morph timeoutMs must be a positive safe integer");
    }
  }

  async warpGrep(input: WarpGrepInput): Promise<WarpGrepResult> {
    const span = this.trace?.startSpan("provider.morph.warpgrep", {
      attributes: { model: "morph-warp-grep-v2.1", searchTerm: input.searchTerm },
    });
    try {
      const repoRoot = assertRepositoryRoot(input.repoRoot);
      const structure = repositoryStructure(repoRoot);
      const messages: JsonRecord[] = [
        {
          role: "user",
          content: `<repo_structure>\n${structure}\n</repo_structure>\n\n<search_string>\n${input.searchTerm}\n</search_string>`,
        },
      ];
      const maxTurns = Math.max(1, Math.min(input.maxTurns ?? 6, 6));
      let metadata: ProviderCallMetadata | undefined;
      let toolCalls = 0;
      const observedContexts: WarpGrepContext[] = [];
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const response = await this.callJson("warpgrep", "/v1/chat/completions", {
          model: "morph-warp-grep-v2.1",
          messages,
          temperature: 0,
          max_tokens: 2048,
        });
        metadata = response.metadata;
        const choice = firstChoice(response.payload, "warpgrep");
        const message = asRecord(choice.message, "warpgrep message");
        const content = contentText(message.content);
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        messages.push({ role: "assistant", content, tool_calls: calls });
        if (calls.length === 0) {
          const parsed = parseStructuredContent(content);
          const resolvedContexts = contextsFrom(parsed);
          if (resolvedContexts.length === 0) {
            if (parsed) resolvedContexts.push(...contextsFromFinish(repoRoot, parsed));
          }
          if (resolvedContexts.length === 0) {
            const finish = finishFromContent(content);
            if (finish) resolvedContexts.push(...contextsFromFinish(repoRoot, finish));
          }
          const contexts = resolvedContexts.length > 0 ? resolvedContexts : observedContexts;
          const result = {
            success: true,
            contexts,
            ...(resolvedContexts.length > 0
              ? { contextSource: "provider_finish" as const }
              : observedContexts.length > 0
                ? { contextSource: "local_read_fallback" as const }
                : {}),
            summary: stringValue(parsed?.summary) ?? (content || undefined),
            toolCalls,
            metadata,
          };
          endProviderSpan(span, undefined, metadata);
          return result;
        }
        for (const callValue of calls) {
          const call = asRecord(callValue, "warpgrep tool call");
          const functionValue = asRecord(call.function, "warpgrep tool function");
          const name = stringValue(functionValue.name);
          const callId = stringValue(call.id) ?? `tool-${toolCalls}`;
          const argsText = stringValue(functionValue.arguments) ?? "{}";
          const args = parseArguments(argsText, "warpgrep tool arguments");
          toolCalls += 1;
          if (name === "finish") {
            const parsed = parseStructuredContent(args.answer ?? args.result ?? args ?? content);
            const resolvedContexts = contextsFrom(parsed);
            if (resolvedContexts.length === 0) {
              resolvedContexts.push(...contextsFromFinish(repoRoot, args));
            }
            if (resolvedContexts.length === 0) {
              const nestedFinish = stringValue(args.answer) ?? stringValue(args.result);
              const finish = nestedFinish ? finishFromContent(nestedFinish) : undefined;
              if (finish) resolvedContexts.push(...contextsFromFinish(repoRoot, finish));
            }
            const contexts = resolvedContexts.length > 0 ? resolvedContexts : observedContexts;
            const result = {
              success: true,
              contexts,
              ...(resolvedContexts.length > 0
                ? { contextSource: "provider_finish" as const }
                : observedContexts.length > 0
                  ? { contextSource: "local_read_fallback" as const }
                  : {}),
              summary: stringValue(parsed?.summary) ?? stringValue(args.summary),
              toolCalls,
              metadata,
            };
            endProviderSpan(span, undefined, metadata);
            return result;
          }
          const toolOutput = executeWarpTool(repoRoot, name, args);
          if (name === "read") {
            const inputPath = stringValue(args.path) ?? stringValue(args.file);
            if (inputPath && !toolOutput.startsWith("Tool error:")) {
              try {
                observedContexts.push({
                  file: relative(repoRoot, safeRepoPath(repoRoot, inputPath)),
                  content: toolOutput,
                });
              } catch {
                // The tool output remains in the provider conversation but is not a safe context.
              }
            }
          }
          messages.push({ role: "tool", tool_call_id: callId, content: toolOutput });
        }
      }
      throw new MorphProviderError(
        "warpgrep",
        "malformed_response",
        "WarpGrep reached its maximum turns without a final result",
      );
    } catch (error) {
      endProviderSpan(span, error);
      throw error;
    }
  }

  async fastApply(input: FastApplyInput): Promise<FastApplyResult> {
    const originalSha256 = sha256(input.originalCode);
    const span = this.trace?.startSpan("provider.morph.fast_apply", {
      attributes: { model: "morph-v3-fast", originalSha256 },
    });
    try {
      const content = [
        `<instruction>${input.instructions}</instruction>`,
        `<code>${input.originalCode}</code>`,
        `<update>${input.codeEdit}</update>`,
      ].join("\n");
      const response = await this.callJson("fast_apply", "/v1/chat/completions", {
        model: "morph-v3-fast",
        messages: [{ role: "user", content }],
      });
      const choice = firstChoice(response.payload, "fast_apply");
      const message = asRecord(choice.message, "fast_apply message");
      const mergedCode = stringValue(message.content);
      if (!mergedCode) {
        throw new MorphProviderError(
          "fast_apply",
          "malformed_response",
          "Fast Apply returned no merged code",
        );
      }
      const changes = countLineChanges(input.originalCode, mergedCode);
      const result: FastApplyResult = {
        success: true,
        mergedCode,
        udiff: unifiedDiff(input.originalCode, mergedCode),
        changes,
        originalSha256,
        finalSha256: sha256(mergedCode),
        metadata: response.metadata,
      };
      endProviderSpan(span, undefined, response.metadata);
      return result;
    } catch (error) {
      endProviderSpan(span, error);
      throw error;
    }
  }

  async compact(input: CompactInput): Promise<CompactResult> {
    const inputText =
      typeof input.input === "string"
        ? input.input
        : input.input.map((item) => item.content).join("\n");
    const span = this.trace?.startSpan("provider.morph.compact", {
      attributes: {
        model: input.model ?? "morph-compactor",
        beforeBytes: Buffer.byteLength(inputText),
      },
    });
    try {
      const response = await this.callJson("compact", "/v1/compact", {
        input: input.input,
        ...(input.query ? { query: input.query } : {}),
        ...(input.compressionRatio !== undefined
          ? { compression_ratio: input.compressionRatio }
          : {}),
        ...(input.preserveRecent !== undefined ? { preserve_recent: input.preserveRecent } : {}),
        model: input.model ?? "morph-compactor",
      });
      const output =
        stringValue(response.payload.output) ?? compactOutputFromMessages(response.payload);
      if (output === undefined) {
        throw new MorphProviderError("compact", "malformed_response", "Compact returned no output");
      }
      const result: CompactResult = {
        output,
        beforeBytes: Buffer.byteLength(inputText),
        afterBytes: Buffer.byteLength(output),
        retainedLines: output.length === 0 ? 0 : output.split(/\r?\n/).length,
        metadata: response.metadata,
      };
      endProviderSpan(span, undefined, response.metadata);
      return result;
    } catch (error) {
      endProviderSpan(span, error);
      throw error;
    }
  }

  private async callJson(
    operation: string,
    path: string,
    body: JsonRecord,
  ): Promise<{ payload: JsonRecord; metadata: ProviderCallMetadata }> {
    if (!this.apiKey) throw new MissingMorphCredentialError();
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw new MorphProviderError(operation, "timeout", `Morph ${operation} request timed out`);
      }
      throw new MorphProviderError(
        operation,
        "request_error",
        `Morph ${operation} request failed: ${safeErrorMessage(error)}`,
      );
    }
    clearTimeout(timeout);
    const latencyMs = performance.now() - startedAt;
    const text = await readResponseText(response, operation);
    if (!response.ok) {
      throw new MorphProviderError(
        operation,
        "http_error",
        `Morph ${operation} returned HTTP ${response.status}`,
        response.status,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MorphProviderError(
        operation,
        "malformed_response",
        `Morph ${operation} returned invalid JSON`,
      );
    }
    const payload = asRecord(parsed, `${operation} response`);
    const usage = usageFrom(payload.usage);
    const metadata: ProviderCallMetadata = {
      provider: "morph",
      operation,
      endpoint: path,
      status: response.status,
      latencyMs,
      usage,
      responseId: stringValue(payload.id),
      model: stringValue(payload.model),
    };
    return { payload, metadata };
  }
}

function endProviderSpan(
  span: ReturnType<TraceWriter["startSpan"]> | undefined,
  error: unknown,
  metadata?: ProviderCallMetadata,
): void {
  if (!span) return;
  if (metadata) {
    const spanUpdate: Parameters<typeof span.update>[0] = {};
    if (metadata.usage?.inputTokens !== undefined && metadata.usage.outputTokens !== undefined) {
      spanUpdate.tokenUsage = {
        inputTokens: metadata.usage.inputTokens,
        outputTokens: metadata.usage.outputTokens,
        totalTokens: metadata.usage.totalTokens,
      };
    }
    if (metadata.usage?.costUsd !== undefined) spanUpdate.cost = metadata.usage.costUsd;
    if (Object.keys(spanUpdate).length > 0) span.update(spanUpdate);
    span.event("provider_response", {
      status: metadata.status,
      latencyMs: metadata.latencyMs,
      usage: metadata.usage,
    });
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    span.end("error", {
      category: "provider_failure",
      message: message.length >= 8 ? message : `Provider error: ${message}`,
    });
  } else {
    span.end("ok");
  }
}

async function readResponseText(response: Response, operation: string): Promise<string> {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new MorphProviderError(
      operation,
      "malformed_response",
      `Morph ${operation} response is too large`,
    );
  }
  return text;
}

function firstChoice(payload: JsonRecord, operation: string): JsonRecord {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new MorphProviderError(
      operation,
      "malformed_response",
      `Morph ${operation} returned no choices`,
    );
  }
  return asRecord(payload.choices[0], `${operation} choice`);
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MorphProviderError("morph", "malformed_response", `${label} is not an object`);
  }
  return value as JsonRecord;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseArguments(value: string, label: string): JsonRecord {
  try {
    return asRecord(JSON.parse(value), label);
  } catch (error) {
    if (error instanceof MorphProviderError) throw error;
    throw new MorphProviderError("warpgrep", "malformed_response", `${label} is invalid JSON`);
  }
}

function parseStructuredContent(content: unknown): JsonRecord | undefined {
  if (typeof content === "object" && content !== null && !Array.isArray(content)) {
    return content as JsonRecord;
  }
  if (typeof content !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

function contextsFrom(value: JsonRecord | undefined): WarpGrepContext[] {
  if (!value || !Array.isArray(value.contexts)) return [];
  return value.contexts.flatMap((context) => {
    if (typeof context !== "object" || context === null || Array.isArray(context)) return [];
    const record = context as JsonRecord;
    const file = stringValue(record.file);
    const content = stringValue(record.content);
    return file && content ? [{ file, content }] : [];
  });
}

function contextsFromFinish(root: string, value: unknown): WarpGrepContext[] {
  return fileSpecifications(value).flatMap((file) => {
    const inputPath =
      stringValue(file.path) ?? stringValue(file.file) ?? stringValue(file.file_path);
    if (!inputPath) return [];
    try {
      const path = safeRepoPath(root, inputPath);
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      const range = stringValue(file.lines);
      const [start, end] = lineRange(range, lines.length);
      return [{ file: relative(root, path), content: lines.slice(start - 1, end).join("\n") }];
    } catch {
      return [];
    }
  });
}

function fileSpecifications(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap((item) => fileSpecifications(item));
  if (typeof value === "string") {
    try {
      return fileSpecifications(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as JsonRecord;
  const inputPath =
    stringValue(record.path) ?? stringValue(record.file) ?? stringValue(record.file_path);
  if (inputPath) return [record];
  return Object.values(record).flatMap((item) => fileSpecifications(item));
}

function finishFromContent(content: string): JsonRecord | undefined {
  const finishMatch = content.match(/<finish\b[^>]*>([\s\S]*?)<\/finish>/iu);
  if (!finishMatch) return undefined;
  const files = [...finishMatch[1].matchAll(/<file\b[^>]*>([\s\S]*?)<\/file>/giu)].flatMap(
    (fileMatch) => {
      const path = xmlValue(fileMatch[1], "path") ?? xmlValue(fileMatch[1], "file_path");
      const lines = xmlValue(fileMatch[1], "lines");
      return path ? [{ path, ...(lines ? { lines } : {}) }] : [];
    },
  );
  return { files };
}

function xmlValue(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "iu"));
  return match?.[1]?.trim();
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (typeof part !== "object" || part === null || Array.isArray(part)) return [];
      const text = stringValue((part as JsonRecord).text);
      return text ? [text] : [];
    })
    .join("\n");
}

function lineRange(value: string | undefined, lineCount: number): [number, number] {
  if (!value || value.trim() === "*") return [1, lineCount];
  const firstRange = value.split(",")[0]?.trim() ?? "";
  const match = firstRange.match(/^(\d+)(?:-(\d+))?$/u);
  if (!match) return [1, lineCount];
  const start = Math.max(1, Number(match[1]));
  const end = Math.min(lineCount, Math.max(start, Number(match[2] ?? match[1])));
  return [start, end];
}

function compactOutputFromMessages(payload: JsonRecord): string | undefined {
  if (!Array.isArray(payload.messages)) return undefined;
  const messages = payload.messages.flatMap((message) => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return [];
    const content = stringValue((message as JsonRecord).content);
    return content === undefined ? [] : [content];
  });
  return messages.length > 0 ? messages.join("\n") : undefined;
}

function usageFrom(value: unknown): ProviderUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const usage = value as JsonRecord;
  const inputTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  const costUsd = numberValue(usage.cost_usd ?? usage.cost);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costUsd === undefined
  )
    return null;
  return { inputTokens, outputTokens, totalTokens, costUsd };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactSecrets(message)).slice(0, 512);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function countLineChanges(
  before: string,
  after: string,
): { linesAdded: number; linesRemoved: number; linesModified: number } {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const common = Math.min(beforeLines.length, afterLines.length);
  let modified = 0;
  for (let index = 0; index < common; index += 1)
    if (beforeLines[index] !== afterLines[index]) modified += 1;
  return {
    linesAdded: Math.max(0, afterLines.length - beforeLines.length),
    linesRemoved: Math.max(0, beforeLines.length - afterLines.length),
    linesModified: modified,
  };
}

function unifiedDiff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  return [
    "--- original",
    "+++ merged",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function assertRepositoryRoot(input: string): string {
  const root = realpathSync.native(resolve(input));
  if (!statSync(root).isDirectory()) throw new Error("WarpGrep repoRoot must be a directory");
  return root;
}

function repositoryStructure(root: string): string {
  const entries: string[] = [root];
  walkStructure(root, root, 0, entries);
  return entries.join("\n");
}

function walkStructure(root: string, directory: string, depth: number, entries: string[]): void {
  if (depth >= 2) return;
  for (const entry of readdirSync(directory).sort()) {
    if (entry === ".git" || entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    const stat = lstatSync(path);
    entries.push(path);
    if (stat.isDirectory()) walkStructure(root, path, depth + 1, entries);
  }
}

function executeWarpTool(root: string, name: string | undefined, args: JsonRecord): string {
  try {
    if (name === "read") {
      const path = safeRepoPath(root, stringValue(args.path) ?? stringValue(args.file));
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      const [rangeStart, rangeEnd] = lineRange(stringValue(args.lines), lines.length);
      const start = Math.max(1, numberValue(args.start_line ?? args.start) ?? rangeStart);
      const end = Math.min(lines.length, numberValue(args.end_line ?? args.end) ?? rangeEnd);
      return lines
        .slice(start - 1, end)
        .join("\n")
        .slice(0, 100_000);
    }
    if (name === "list_directory") {
      const path = safeRepoPath(root, stringValue(args.path) ?? stringValue(args.command) ?? ".");
      return readdirSync(path).sort().join("\n");
    }
    if (name === "glob") {
      const pattern = stringValue(args.pattern) ?? "*";
      const result = spawnSync(
        "rg",
        ["--files", "--hidden", "--glob", "!.git/**", "--glob", pattern],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 100_000,
        },
      );
      return (result.stdout ?? "").slice(0, 100_000);
    }
    if (name === "grep_search") {
      const pattern = stringValue(args.pattern) ?? stringValue(args.query) ?? "";
      const subDir = stringValue(args.sub_dir) ?? stringValue(args.path) ?? ".";
      const path = safeRepoPath(root, subDir);
      const result = spawnSync(
        "rg",
        ["--no-heading", "--line-number", "--color", "never", "--", pattern, path],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 200_000,
        },
      );
      return `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 200_000);
    }
    return `Unsupported WarpGrep tool: ${name ?? "<missing>"}`;
  } catch (error) {
    return `Tool error: ${safeErrorMessage(error)}`;
  }
}

function safeRepoPath(root: string, input: string | undefined): string {
  if (!input || input.includes("\0")) throw new Error("repository path is required");
  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    (candidate !== root && !candidate.startsWith(`${root}${sep}`))
  ) {
    throw new Error("repository path escapes repoRoot");
  }
  if (!existsSync(candidate)) throw new Error("repository path does not exist");
  const realPath = realpathSync.native(candidate);
  const realRelativePath = relative(root, realPath);
  if (realRelativePath === ".." || realRelativePath.startsWith(`..${sep}`)) {
    throw new Error("repository symlink escapes repoRoot");
  }
  return realPath;
}
