import type { CompactInput, MorphClient } from "./index.js";
import type { ProviderCallMetadata } from "./provider-types.js";

export type ContextRole = "system" | "user" | "assistant" | "tool";

export type ContextMessage = {
  role: ContextRole;
  content: string;
};

export type ContextProfile = {
  strategy: string;
  provider: string;
  model: string;
  beforeBytes: number;
  afterBytes: number;
  beforeMessages: number;
  afterMessages: number;
  beforeLines: number;
  afterLines: number;
  retainedRatio: number;
  toolOutputBytes: number;
  toolOutputShare: number;
  retainedToolOutputBytes: number;
  retainedToolOutputShare: number;
  retainedSourceBytes: number;
  informationLoss: "none" | "estimated" | "unmeasured";
  informationLossBytes: number | null;
  estimatedFutureModelCallsSaved: number;
  estimatedFutureInputBytesSaved: number;
  modelContextLimitBytes: number;
  latencyMs: number;
  costUsd: number | null;
  providerBeforeBytes?: number;
  providerAfterBytes?: number;
  usage: ProviderCallMetadata["usage"];
  metadata: ProviderCallMetadata | null;
};

export type ContextCompactionInput = {
  messages: ContextMessage[];
  modelContextLimitBytes?: number;
  futureModelCalls?: number;
};

export type ContextCompactionResult = {
  provider: string;
  model: string;
  messages: ContextMessage[];
  beforeText: string;
  afterText: string;
  profile: ContextProfile;
};

export interface ContextCompactionProvider {
  readonly id: string;
  compact(input: ContextCompactionInput): Promise<ContextCompactionResult>;
}

/** Records context growth without changing the agent's messages. */
export class NoCompactionProvider implements ContextCompactionProvider {
  readonly id = "no-compaction";

  async compact(input: ContextCompactionInput): Promise<ContextCompactionResult> {
    const startedAt = performance.now();
    return makeResult({
      strategy: this.id,
      provider: "local",
      model: "none",
      beforeMessages: input.messages,
      afterMessages: input.messages,
      startedAt,
      modelContextLimitBytes: input.modelContextLimitBytes,
      futureModelCalls: input.futureModelCalls,
      informationLoss: "none",
      retainedSourceBytes: serializedBytes(input.messages),
      metadata: null,
    });
  }
}

/** Keeps the system message and the newest messages that fit a byte budget. */
export class ThresholdTruncationProvider implements ContextCompactionProvider {
  readonly id = "threshold-truncation";

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) {
      throw new Error("Threshold context maxBytes must be at least 256 bytes");
    }
  }

  async compact(input: ContextCompactionInput): Promise<ContextCompactionResult> {
    const startedAt = performance.now();
    const retained = retainWithinBudget(input.messages, this.maxBytes);
    const retainedSourceBytes = serializedBytes(retained.messages);
    return makeResult({
      strategy: this.id,
      provider: "local",
      model: `byte-threshold-${this.maxBytes}`,
      beforeMessages: input.messages,
      afterMessages: retained.messages,
      startedAt,
      modelContextLimitBytes: input.modelContextLimitBytes,
      futureModelCalls: input.futureModelCalls,
      informationLoss: retained.droppedMessages > 0 ? "estimated" : "none",
      retainedSourceBytes,
      metadata: null,
    });
  }
}

/** Adapts Morph Compact to the same measured context contract as local arms. */
export class MorphCompactProvider implements ContextCompactionProvider {
  readonly id = "morph-compact";

  constructor(
    private readonly client: Pick<MorphClient, "compact">,
    private readonly options: Omit<CompactInput, "input"> = {},
  ) {}

  async compact(input: ContextCompactionInput): Promise<ContextCompactionResult> {
    const startedAt = performance.now();
    const result = await this.client.compact({
      input: input.messages,
      ...this.options,
    });
    const afterMessages: ContextMessage[] = [{ role: "assistant", content: result.output }];
    return makeResult({
      strategy: this.id,
      provider: result.metadata.provider,
      model: result.metadata.model ?? "morph-compactor",
      beforeMessages: input.messages,
      afterMessages,
      startedAt,
      modelContextLimitBytes: input.modelContextLimitBytes,
      futureModelCalls: input.futureModelCalls,
      informationLoss: "unmeasured",
      retainedSourceBytes: 0,
      metadata: result.metadata,
      providerBeforeBytes: result.beforeBytes,
      providerAfterBytes: result.afterBytes,
    });
  }
}

function makeResult(input: {
  strategy: string;
  provider: string;
  model: string;
  beforeMessages: ContextMessage[];
  afterMessages: ContextMessage[];
  startedAt: number;
  modelContextLimitBytes?: number;
  futureModelCalls?: number;
  informationLoss: ContextProfile["informationLoss"];
  retainedSourceBytes: number;
  metadata: ProviderCallMetadata | null;
  providerBeforeBytes?: number;
  providerAfterBytes?: number;
}): ContextCompactionResult {
  const beforeText = serializeMessages(input.beforeMessages);
  const afterText = serializeMessages(input.afterMessages);
  const beforeBytes = byteLength(beforeText);
  const afterBytes = byteLength(afterText);
  const modelContextLimitBytes = input.modelContextLimitBytes ?? 6_000;
  const futureModelCalls = Math.max(0, input.futureModelCalls ?? 1);
  const droppedBytes = Math.max(
    0,
    input.retainedSourceBytes > 0 ? beforeBytes - input.retainedSourceBytes : 0,
  );
  const estimatedFutureModelCallsSaved =
    beforeBytes > modelContextLimitBytes && afterBytes <= modelContextLimitBytes ? 1 : 0;
  const retainedToolOutputBytes = toolOutputBytes(input.afterMessages);
  const toolBytes = toolOutputBytes(input.beforeMessages);
  const elapsed = Math.max(0, performance.now() - input.startedAt);
  const profile: ContextProfile = {
    strategy: input.strategy,
    provider: input.provider,
    model: input.model,
    beforeBytes,
    afterBytes,
    beforeMessages: input.beforeMessages.length,
    afterMessages: input.afterMessages.length,
    beforeLines: lineCount(beforeText),
    afterLines: lineCount(afterText),
    retainedRatio: beforeBytes === 0 ? 1 : round(afterBytes / beforeBytes),
    toolOutputBytes: toolBytes,
    toolOutputShare: beforeBytes === 0 ? 0 : round(toolBytes / beforeBytes),
    retainedToolOutputBytes,
    retainedToolOutputShare: toolBytes === 0 ? 0 : round(retainedToolOutputBytes / toolBytes),
    retainedSourceBytes: input.retainedSourceBytes,
    informationLoss: input.informationLoss,
    informationLossBytes: input.informationLoss === "unmeasured" ? null : droppedBytes,
    estimatedFutureModelCallsSaved,
    estimatedFutureInputBytesSaved: Math.max(0, beforeBytes - afterBytes) * futureModelCalls,
    modelContextLimitBytes,
    latencyMs: input.metadata?.latencyMs ?? elapsed,
    costUsd: input.metadata?.usage?.costUsd ?? null,
    ...(input.providerBeforeBytes !== undefined
      ? { providerBeforeBytes: input.providerBeforeBytes }
      : {}),
    ...(input.providerAfterBytes !== undefined
      ? { providerAfterBytes: input.providerAfterBytes }
      : {}),
    usage: input.metadata?.usage ?? null,
    metadata: input.metadata,
  };
  return {
    provider: input.provider,
    model: input.model,
    messages: input.afterMessages,
    beforeText,
    afterText,
    profile,
  };
}

function retainWithinBudget(
  messages: ContextMessage[],
  maxBytes: number,
): {
  messages: ContextMessage[];
  droppedMessages: number;
} {
  if (byteLength(serializeMessages(messages)) <= maxBytes) {
    return { messages, droppedMessages: 0 };
  }
  const system = messages.find((message) => message.role === "system");
  const candidates = messages.filter((message) => message !== system).reverse();
  const retained: ContextMessage[] = [];
  let size = system ? byteLength(serializeMessages([system])) : 0;
  for (const message of candidates) {
    const nextSize = byteLength(
      serializeMessages(system ? [system, ...retained, message] : [...retained, message]),
    );
    if (nextSize > maxBytes && retained.length > 0) continue;
    if (nextSize > maxBytes) {
      const truncated = truncateMessage(message, Math.max(64, maxBytes - size));
      retained.push(truncated);
      break;
    }
    retained.push(message);
    size = nextSize;
  }
  retained.reverse();
  const omitted = messages.length - retained.length - (system ? 1 : 0);
  const marker: ContextMessage = {
    role: "assistant",
    content: `[context truncated: ${Math.max(0, omitted)} earlier message(s) omitted]`,
  };
  const output = system ? [system, marker, ...retained] : [marker, ...retained];
  return { messages: output, droppedMessages: Math.max(0, omitted) };
}

function truncateMessage(message: ContextMessage, maxBytes: number): ContextMessage {
  const marker = "…";
  const budget = Math.max(0, maxBytes - byteLength(`[${message.role}]\n` + marker));
  let content = message.content;
  while (byteLength(content) > budget && content.length > 0) content = content.slice(0, -1);
  return { ...message, content: `${content}${marker}` };
}

export function serializeMessages(messages: ContextMessage[]): string {
  return messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
}

function serializedBytes(messages: ContextMessage[]): number {
  return byteLength(serializeMessages(messages));
}

function toolOutputBytes(messages: ContextMessage[]): number {
  return messages
    .filter((message) => message.role === "tool")
    .reduce((total, message) => total + byteLength(message.content), 0);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/u).length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
