import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingMorphCredentialError, MorphClient, MorphProviderError } from "./index.js";
import type { Span } from "@morphscope/schemas";
import type { TracePersistence, TraceSnapshot } from "@morphscope/tracing";
import { TraceWriter } from "@morphscope/tracing";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class MemoryTrace implements TracePersistence {
  spans = new Map<string, Span>();
  events: Record<string, unknown>[] = [];

  upsertSpan(span: Span): void {
    this.spans.set(span.spanId, span);
  }

  appendEvent(event: Record<string, unknown>): void {
    this.events.push(event);
  }

  readTrace(traceId: string): TraceSnapshot {
    return {
      traceId,
      spans: [...this.spans.values()] as unknown as Record<string, unknown>[],
      events: this.events,
    };
  }
}

describe("MorphClient", () => {
  it("rejects missing credentials before making a request", async () => {
    const previous = process.env.MORPH_API_KEY;
    delete process.env.MORPH_API_KEY;
    const fetchImpl = vi.fn<typeof fetch>();
    try {
      await expect(
        new MorphClient({ fetchImpl }).compact({ input: "secret-free", query: "test" }),
      ).rejects.toBeInstanceOf(MissingMorphCredentialError);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MORPH_API_KEY;
      else process.env.MORPH_API_KEY = previous;
    }
  });

  it("parses Fast Apply output and records content hashes", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        id: "apply-1",
        model: "morph-v3-fast",
        choices: [{ message: { content: "function hello() { return 'new'; }" } }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }),
    );
    const result = await new MorphClient({ apiKey: "test-key", fetchImpl }).fastApply({
      originalCode: "function hello() { return 'old'; }",
      codeEdit: "// ... existing code ... return 'new'; // ... existing code ...",
      instructions: "Change the return value",
    });
    expect(result.success).toBe(true);
    expect(result.originalSha256).toHaveLength(64);
    expect(result.finalSha256).toHaveLength(64);
    expect(result.changes.linesModified).toBe(1);
    expect(result.metadata.usage?.totalTokens).toBe(19);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.morphllm.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("parses Compact output and usage metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        id: "compact-1",
        model: "morph-compactor",
        output: "keep this line",
        usage: { input_tokens: 100, output_tokens: 30, compression_ratio: 0.3 },
      }),
    );
    const result = await new MorphClient({ apiKey: "test-key", fetchImpl }).compact({
      input: "keep this line\ndrop this line",
      query: "keep",
      preserveRecent: 2,
    });
    expect(result.output).toBe("keep this line");
    expect(result.beforeBytes).toBeGreaterThan(result.afterBytes);
    expect(result.metadata.usage?.inputTokens).toBe(100);
  });

  it("executes a WarpGrep tool turn against a local repository", async () => {
    const directory = mkdtempSync(join(tmpdir(), "morphscope-provider-test-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "source.ts"), "const needle = true;\n", "utf8");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "grep-1",
                    type: "function",
                    function: {
                      name: "grep_search",
                      arguments: JSON.stringify({ pattern: "needle" }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "finish-1",
                    type: "function",
                    function: {
                      name: "finish",
                      arguments: JSON.stringify({
                        summary: "found needle",
                        contexts: [{ file: "source.ts", content: "const needle = true;" }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      );
    const result = await new MorphClient({ apiKey: "test-key", fetchImpl }).warpGrep({
      repoRoot: directory,
      searchTerm: "Find needle",
    });
    expect(result.success).toBe(true);
    expect(result.summary).toBe("found needle");
    expect(result.contexts[0]?.file).toBe("source.ts");
    expect(result.toolCalls).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies malformed responses and aborts timed out calls", async () => {
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));
    await expect(
      new MorphClient({ apiKey: "test-key", fetchImpl: malformed }).compact({ input: "x" }),
    ).rejects.toMatchObject<Partial<MorphProviderError>>({
      code: "malformed_response",
    });

    const timeout = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(
      new MorphClient({ apiKey: "test-key", fetchImpl: timeout, timeoutMs: 5 }).compact({
        input: "x",
      }),
    ).rejects.toMatchObject<Partial<MorphProviderError>>({ code: "timeout" });
  });

  it("instruments successful calls as provider trace spans", async () => {
    const persistence = new MemoryTrace();
    const trace = new TraceWriter({ traceId: "provider-trace", persistence });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ output: "kept", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } }),
      );
    await new MorphClient({ apiKey: "test-key", fetchImpl, trace }).compact({
      input: "kept\ndropped",
    });
    const span = [...persistence.spans.values()][0];
    expect(span?.type).toBe("provider.morph.compact");
    expect(span?.status).toBe("ok");
    expect(persistence.events).toHaveLength(1);
  });
});
