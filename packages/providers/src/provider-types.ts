export type ProviderName = "morph" | "groq";

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  nominalCostUsd?: number;
};

export type RateLimitMetadata = {
  retryAfterMs?: number;
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
  resetTokensMs?: number;
};

export type ProviderCallMetadata = {
  provider: ProviderName;
  operation: string;
  endpoint: string;
  status: number;
  latencyMs: number;
  usage: ProviderUsage | null;
  responseId?: string;
  model?: string;
  rateLimit?: RateLimitMetadata;
};

export type ReasoningMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
};

export type ReasoningCompletionInput = {
  messages: ReasoningMessage[];
  temperature?: number;
  maxCompletionTokens?: number;
};

export type ReasoningCompletionResult = {
  content: string;
  finishReason?: string;
  metadata: ProviderCallMetadata;
};

export interface ReasoningProvider {
  readonly provider: ProviderName;
  readonly model: string;
  complete(input: ReasoningCompletionInput): Promise<ReasoningCompletionResult>;
}
