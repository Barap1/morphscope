import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "./groq.js";

describe("GroqClient", () => {
  it("parses usage and adds an explicit nominal cost estimate", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            model: "openai/gpt-oss-120b",
            choices: [{ message: { content: '{"action":"finish"}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100_000, completion_tokens: 100 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new GroqClient({
      apiKey: "test-key",
      fetchImpl,
      model: "openai/gpt-oss-120b",
    });

    const result = await client.complete({
      messages: [{ role: "user", content: "Return JSON." }],
      temperature: 0,
      maxCompletionTokens: 16,
    });

    expect(result.content).toContain("finish");
    expect(result.metadata.provider).toBe("groq");
    expect(result.metadata.model).toBe("openai/gpt-oss-120b");
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 100_000,
      outputTokens: 100,
      nominalCostUsd: 0.01506,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies authentication failures without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const client = new GroqClient({ apiKey: "test-key", fetchImpl });

    await expect(
      client.complete({ messages: [{ role: "user", content: "Return JSON." }] }),
    ).rejects.toMatchObject({ code: "authentication", status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
