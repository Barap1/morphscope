import type { TraceWriter } from "@morphscope/tracing";
import { redactSecrets } from "@morphscope/tracing";
import type {
  ProviderCallMetadata,
  ProviderUsage,
  RateLimitMetadata,
  ReasoningCompletionInput,
  ReasoningCompletionResult,
  ReasoningMessage,
  ReasoningProvider,
} from "./provider-types.js";

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b" as const;
export const GROQ_FREE_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] as const;
export type GroqModel = (typeof GROQ_FREE_MODELS)[number];

type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type GroqMessage = ReasoningMessage;
export type GroqCompletionInput = ReasoningCompletionInput;
export type GroqCompletionResult = ReasoningCompletionResult;

export class MissingGroqCredentialError extends Error {
  readonly code = "missing_credential" as const;

  constructor() {
    super("GROQ_API_KEY is required for Groq reasoning-provider calls");
    this.name = "MissingGroqCredentialError";
  }
}

export type GroqProviderErrorCode =
  | "rate_limited"
  | "authentication"
  | "model_unavailable"
  | "timeout"
  | "http_error"
  | "malformed_response"
  | "request_error";

export class GroqProviderError extends Error {
  readonly status?: number;
  readonly operation: string;
  readonly code: GroqProviderErrorCode;
  readonly metadata?: ProviderCallMetadata;

  constructor(
    operation: string,
    code: GroqProviderErrorCode,
    message: string,
    status?: number,
    metadata?: ProviderCallMetadata,
  ) {
    super(message);
    this.name = "GroqProviderError";
    this.operation = operation;
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

export class GroqRateLimitError extends GroqProviderError {
  readonly retryAfterMs?: number;

  constructor(message: string, metadata: ProviderCallMetadata) {
    super("chat.completions", "rate_limited", message, metadata.status, metadata);
    this.name = "GroqRateLimitError";
    this.retryAfterMs = metadata.rateLimit?.retryAfterMs;
  }
}

export type GroqClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  model?: GroqModel;
  fetchImpl?: FetchImplementation;
  trace?: TraceWriter;
};

export class GroqClient implements ReasoningProvider {
  readonly provider = "groq" as const;
  readonly model: GroqModel;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchImplementation;
  private readonly trace: TraceWriter | undefined;

  constructor(options: GroqClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.trace = options.trace;
    this.model = options.model ?? resolveConfiguredModel(process.env.GROQ_MODEL);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Groq timeoutMs must be a positive safe integer");
    }
  }

  async complete(input: GroqCompletionInput): Promise<GroqCompletionResult> {
    if (!this.apiKey) throw new MissingGroqCredentialError();
    if (input.messages.length === 0) {
      throw new GroqProviderError(
        "chat.completions",
        "malformed_response",
        "Groq messages must contain at least one message",
      );
    }
    const model = this.model;
    assertAllowedModel(model);
    const span = this.trace?.startSpan("provider.groq.reasoning", {
      attributes: {
        provider: "groq",
        model,
        operation: "chat.completions",
      },
    });
    try {
      const response = await this.callCompletion(input, model);
      const choice = firstChoice(response.payload);
      const message = asRecord(choice.message, "Groq completion message");
      const content = stringValue(message.content);
      if (content === undefined) {
        throw new GroqProviderError(
          "chat.completions",
          "malformed_response",
          "Groq completion returned no text content",
          response.metadata.status,
          response.metadata,
        );
      }
      const result = {
        content,
        finishReason: stringValue(choice.finish_reason),
        metadata: response.metadata,
      };
      endGroqSpan(span, undefined, response.metadata);
      return result;
    } catch (error) {
      endGroqSpan(span, error, error instanceof GroqProviderError ? error.metadata : undefined);
      throw error;
    }
  }

  private async callCompletion(
    input: GroqCompletionInput,
    model: GroqModel,
  ): Promise<{
    payload: JsonRecord;
    metadata: ProviderCallMetadata;
  }> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: input.messages,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxCompletionTokens !== undefined
            ? { max_completion_tokens: input.maxCompletionTokens }
            : {}),
          ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
          ...(input.includeReasoning !== undefined
            ? { include_reasoning: input.includeReasoning }
            : {}),
          ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw new GroqProviderError(
          "chat.completions",
          "timeout",
          "Groq chat completion request timed out",
        );
      }
      throw new GroqProviderError(
        "chat.completions",
        "request_error",
        "Groq chat completion request failed: " + safeErrorMessage(error),
      );
    }
    clearTimeout(timeout);
    const latencyMs = performance.now() - startedAt;
    const text = await readResponseText(response);
    const rateLimit = rateLimitFromHeaders(response.headers);
    if (!response.ok) {
      const metadata = createMetadata({
        status: response.status,
        latencyMs,
        rateLimit,
        model,
      });
      if (response.status === 429) {
        throw new GroqRateLimitError(
          "Groq rate limit reached; no automatic retry was attempted",
          metadata,
        );
      }
      const code: GroqProviderErrorCode =
        response.status === 401
          ? "authentication"
          : response.status === 403 || response.status === 404
            ? "model_unavailable"
            : "http_error";
      const detail = groqErrorDetail(text);
      throw new GroqProviderError(
        "chat.completions",
        code,
        `Groq chat completion returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
        metadata,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GroqProviderError(
        "chat.completions",
        "malformed_response",
        "Groq chat completion returned invalid JSON",
        response.status,
      );
    }
    const payload = asRecord(parsed, "Groq chat completion response");
    const metadata = createMetadata({
      status: response.status,
      latencyMs,
      rateLimit,
      model: stringValue(payload.model) ?? model,
      responseId: stringValue(payload.id),
      usage: usageFrom(payload.usage),
    });
    return { payload, metadata };
  }
}

function resolveConfiguredModel(value: string | undefined): GroqModel {
  const model = value ?? DEFAULT_GROQ_MODEL;
  assertAllowedModel(model);
  return model;
}

function assertAllowedModel(model: string): asserts model is GroqModel {
  if (!(GROQ_FREE_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      "Unsupported Groq model " + model + "; configure one of " + GROQ_FREE_MODELS.join(", "),
    );
  }
}

function createMetadata(input: {
  status: number;
  latencyMs: number;
  rateLimit?: RateLimitMetadata;
  model?: string;
  responseId?: string;
  usage?: ProviderUsage | null;
}): ProviderCallMetadata {
  const usage = withNominalCost(input.model, input.usage);
  return {
    provider: "groq",
    operation: "chat.completions",
    endpoint: "/chat/completions",
    status: input.status,
    latencyMs: input.latencyMs,
    usage,
    ...(input.model ? { model: input.model } : {}),
    ...(input.responseId ? { responseId: input.responseId } : {}),
    ...(input.rateLimit ? { rateLimit: input.rateLimit } : {}),
  };
}

function endGroqSpan(
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
    span.update(spanUpdate);
    span.event("provider_response", {
      status: metadata.status,
      latencyMs: metadata.latencyMs,
      usage: metadata.usage,
      rateLimit: metadata.rateLimit,
    });
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    span.end("error", {
      category: "provider_failure",
      message: message.length >= 8 ? message : "Provider error: " + message,
      ...(error instanceof GroqProviderError ? { code: error.code } : {}),
    });
  } else {
    span.end("ok");
  }
}

function firstChoice(payload: JsonRecord): JsonRecord {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new GroqProviderError(
      "chat.completions",
      "malformed_response",
      "Groq chat completion returned no choices",
    );
  }
  return asRecord(payload.choices[0], "Groq chat completion choice");
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GroqProviderError(
      "chat.completions",
      "malformed_response",
      label + " is not an object",
    );
  }
  return value as JsonRecord;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function usageFrom(value: unknown): ProviderUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const usage = value as JsonRecord;
  const details =
    typeof usage.completion_tokens_details === "object" &&
    usage.completion_tokens_details !== null &&
    !Array.isArray(usage.completion_tokens_details)
      ? (usage.completion_tokens_details as JsonRecord)
      : undefined;
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  const reasoningTokens = numberValue(details?.reasoning_tokens);
  const costUsd = numberValue(usage.cost_usd ?? usage.cost);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined &&
    costUsd === undefined
  )
    return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function withNominalCost(model: string | undefined, usage: ProviderUsage | null | undefined) {
  if (!usage || usage.nominalCostUsd !== undefined || !model) return usage ?? null;
  const rates =
    model === "openai/gpt-oss-120b"
      ? { input: 0.15, output: 0.6 }
      : model === "openai/gpt-oss-20b"
        ? { input: 0.075, output: 0.3 }
        : null;
  if (!rates) return usage;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return usage;
  return {
    ...usage,
    nominalCostUsd: (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function rateLimitFromHeaders(headers: Headers): RateLimitMetadata | undefined {
  const rateLimit: RateLimitMetadata = {};
  const retryAfter = headers.get("retry-after");
  const retryAfterMs = retryAfter ? parseRetryAfterMs(retryAfter) : undefined;
  const values: Array<[keyof RateLimitMetadata, string | null]> = [
    ["limitRequests", headers.get("x-ratelimit-limit-requests")],
    ["remainingRequests", headers.get("x-ratelimit-remaining-requests")],
    ["limitTokens", headers.get("x-ratelimit-limit-tokens")],
    ["remainingTokens", headers.get("x-ratelimit-remaining-tokens")],
  ];
  for (const [key, value] of values) {
    const parsed = value ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) rateLimit[key] = parsed;
  }
  const resetRequestsMs = parseDurationMs(headers.get("x-ratelimit-reset-requests"));
  const resetTokensMs = parseDurationMs(headers.get("x-ratelimit-reset-tokens"));
  if (retryAfterMs !== undefined) rateLimit.retryAfterMs = retryAfterMs;
  if (resetRequestsMs !== undefined) rateLimit.resetRequestsMs = resetRequestsMs;
  if (resetTokensMs !== undefined) rateLimit.resetTokensMs = resetTokensMs;
  return Object.keys(rateLimit).length > 0 ? rateLimit : undefined;
}

function parseRetryAfterMs(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return undefined;
}

function parseDurationMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.round(numeric * 1_000);
  const match = value.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/u);
  if (!match || match.slice(1).every((part) => part === undefined)) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return Math.round((hours * 3_600 + minutes * 60 + seconds) * 1_000);
}

async function readResponseText(response: Response): Promise<string> {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new GroqProviderError(
      "chat.completions",
      "malformed_response",
      "Groq chat completion response is too large",
    );
  }
  return text;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactSecrets(message)).slice(0, 512);
}

function groqErrorDetail(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const error = (parsed as JsonRecord).error;
    if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
    const record = error as JsonRecord;
    const parts: string[] = [];
    if (typeof record.code === "string" && record.code.trim().length > 0) parts.push(record.code);
    if (typeof record.message === "string" && record.message.trim().length > 0)
      parts.push(record.message);
    if (
      typeof record.failed_generation === "object" &&
      record.failed_generation !== null &&
      !Array.isArray(record.failed_generation) &&
      typeof (record.failed_generation as JsonRecord).reason === "string"
    ) {
      const reason = (record.failed_generation as JsonRecord).reason as string;
      if (reason.trim().length > 0) parts.push(reason);
    }
    return parts.length > 0
      ? String(redactSecrets([...new Set(parts)].join("; "))).slice(0, 512)
      : undefined;
  } catch {
    return undefined;
  }
}
