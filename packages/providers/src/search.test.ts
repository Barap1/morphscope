import { describe, expect, it, vi } from "vitest";
import { RawSearchProvider, WarpGrepProvider } from "./search.js";

describe("search providers", () => {
  it("measures the raw search baseline with a stable rendered result", async () => {
    const provider = new RawSearchProvider(() => ({
      matches: [
        { path: "src/a.ts", line: 2, column: 3, text: "needle" },
        { path: "src/b.ts", line: 4, column: 1, text: "needle" },
      ],
    }));
    const result = await provider.search({
      query: "needle",
      referenceRelevantFiles: ["src/a.ts"],
    });
    expect(result.rendered).toContain("src/a.ts:2:3:needle");
    expect(result.measurement.numberSearches).toBe(1);
    expect(result.measurement.uniqueFilesFound).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.measurement.fileRecallProxy).toBe(1);
    expect(result.measurement.downstreamSuccess).toBeNull();
  });

  it("adapts WarpGrep contexts without changing the measurement contract", async () => {
    const execute = vi.fn().mockResolvedValue({
      contexts: [{ file: "src/a.ts", content: "needle" }],
      toolCalls: 2,
      metadata: {
        provider: "morph",
        operation: "warpgrep",
        endpoint: "/v1/chat/completions",
        status: 200,
        latencyMs: 12,
      },
    });
    const result = await new WarpGrepProvider(execute, "/tmp/repo").search({
      query: "needle",
      referenceRelevantFiles: ["src/a.ts"],
    });
    expect(execute).toHaveBeenCalledWith({ searchTerm: "needle", repoRoot: "/tmp/repo" });
    expect(result.rendered).toContain("src/a.ts");
    expect(result.metadata?.status).toBe(200);
    expect(result.measurement.totalSearchLatencyMs).toBe(12);
    expect(result.measurement.fileRecallProxy).toBe(1);
  });
});
