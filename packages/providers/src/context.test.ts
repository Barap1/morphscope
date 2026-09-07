import { describe, expect, it } from "vitest";
import {
  MorphCompactProvider,
  NoCompactionProvider,
  ThresholdTruncationProvider,
  serializeMessages,
  type ContextMessage,
} from "./context.js";

const messages: ContextMessage[] = [
  { role: "system", content: "preserve the task" },
  { role: "user", content: "edit the greeting" },
  { role: "tool", content: "irrelevant repository output ".repeat(16) },
  { role: "assistant", content: "keep the exact acceptance condition" },
  { role: "tool", content: "PUNCTUATION_REQUIRED: preserve this marker" },
];

describe("context compaction providers", () => {
  it("records context growth without changing messages", async () => {
    const result = await new NoCompactionProvider().compact({ messages, futureModelCalls: 3 });
    expect(result.messages).toEqual(messages);
    expect(result.profile.beforeBytes).toBe(result.profile.afterBytes);
    expect(result.profile.retainedRatio).toBe(1);
    expect(result.profile.toolOutputShare).toBeGreaterThan(0);
    expect(result.profile.informationLoss).toBe("none");
  });

  it("truncates older messages while retaining the system and newest evidence", async () => {
    const result = await new ThresholdTruncationProvider(256).compact({
      messages,
      modelContextLimitBytes: 512,
      futureModelCalls: 3,
    });
    const output = serializeMessages(result.messages);
    expect(result.profile.afterBytes).toBeLessThan(result.profile.beforeBytes);
    expect(output).toContain("preserve the task");
    expect(output).toContain("PUNCTUATION_REQUIRED");
    expect(result.profile.informationLoss).toBe("estimated");
    expect(result.profile.estimatedFutureInputBytesSaved).toBeGreaterThan(0);
  });

  it("normalizes Morph Compact output into the measured contract", async () => {
    const provider = new MorphCompactProvider(
      {
        compact: async () => ({
          output: "summary with acceptance condition",
          beforeBytes: 900,
          afterBytes: 250,
          retainedLines: 1,
          metadata: {
            provider: "morph",
            operation: "compact",
            endpoint: "/v1/compact",
            status: 200,
            latencyMs: 42,
            usage: { inputTokens: 90, outputTokens: 30, totalTokens: 120 },
            model: "morph-compactor",
          },
        }),
      },
      { query: "acceptance condition" },
    );
    const result = await provider.compact({ messages });
    expect(result.profile.provider).toBe("morph");
    expect(result.profile.beforeBytes).toBeGreaterThan(result.profile.afterBytes);
    expect(result.profile.providerBeforeBytes).toBe(900);
    expect(result.profile.providerAfterBytes).toBe(250);
    expect(result.profile.informationLoss).toBe("unmeasured");
    expect(result.profile.usage?.totalTokens).toBe(120);
    expect(result.afterText).toContain("summary with acceptance condition");
  });
});
