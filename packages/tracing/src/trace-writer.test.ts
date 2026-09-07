import { describe, expect, it } from "vitest";
import {
  TraceWriter,
  type TraceEvent,
  type TracePersistence,
  type TraceSnapshot,
  type TraceSpan,
} from "./trace-writer.js";
import { redactSecrets } from "./redaction.js";

class MemoryPersistence implements TracePersistence {
  spans = new Map<string, TraceSpan>();
  events: TraceEvent[] = [];

  upsertSpan(span: TraceSpan): void {
    this.spans.set(span.spanId, span);
  }

  appendEvent(event: TraceEvent): void {
    this.events.push(event);
  }

  readTrace(traceId: string): TraceSnapshot {
    return {
      traceId,
      spans: [...this.spans.values()].map((span) => span as unknown as Record<string, unknown>),
      events: this.events.map((event) => event as unknown as Record<string, unknown>),
    };
  }
}

describe("TraceWriter", () => {
  it("persists nested spans incrementally and preserves partial history", () => {
    const persistence = new MemoryPersistence();
    let tick = 0;
    const writer = new TraceWriter({
      traceId: "trace-test",
      persistence,
      now: () => `2026-09-07T12:00:0${tick++}.000Z`,
    });

    const root = writer.startSpan("agent_turn", {
      attributes: { hypothesis: { file: "src/index.ts" } },
    });
    const child = writer.startSpan("search", {
      attributes: { query: "OPENAI_API_KEY=secret" },
    });
    expect(persistence.spans.get(child.spanId)?.status).toBe("running");
    child.event("search_result", { response: "Bearer sk-test-secret-value" });
    child.end("ok");
    root.end("ok");

    const snapshot = writer.read() as TraceSnapshot;
    const finalRoot = snapshot.spans.find((span) => span.spanId === root.spanId) as TraceSpan;
    const finalChild = snapshot.spans.find((span) => span.spanId === child.spanId) as TraceSpan;
    expect(finalChild.parentSpanId).toBe(root.spanId);
    expect(finalRoot.status).toBe("ok");
    expect(finalChild.end).not.toBeNull();
    expect(snapshot.events).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("sk-test-secret-value");
  });

  it("rejects unknown parents and redacts sensitive object keys", () => {
    const persistence = new MemoryPersistence();
    const writer = new TraceWriter({ persistence });
    expect(() => writer.startSpan("search", { parentSpanId: "missing-span" })).toThrow(
      "unknown parent",
    );
    expect(redactSecrets({ OPENAI_API_KEY: "do-not-store", nested: { token: "private" } })).toEqual(
      {
        OPENAI_API_KEY: "[REDACTED]",
        nested: { token: "[REDACTED]" },
      },
    );
    expect(
      redactSecrets({
        tokenUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
        rateLimit: { remainingTokens: 200, resetTokensMs: 1_000 },
      }),
    ).toEqual({
      tokenUsage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      rateLimit: { remainingTokens: 200, resetTokensMs: 1_000 },
    });
    expect(redactSecrets("GROQ_API_KEY=gsk_123456789012345678901234")).toBe(
      "GROQ_API_KEY=[REDACTED]",
    );
  });
});
