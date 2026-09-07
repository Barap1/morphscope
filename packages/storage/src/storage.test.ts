import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedArtifactStore } from "./artifacts.js";
import { SqliteTraceStore } from "./sqlite-trace-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ContentAddressedArtifactStore", () => {
  it("deduplicates identical content and returns the stored bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "morphscope-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new ContentAddressedArtifactStore(directory);
    const input = {
      content: "safe trace output",
      mimeType: "text/plain",
      redactionStatus: "not_redacted",
      producerSpanId: "span-001",
    };

    const first = store.put(input);
    const second = store.put(input);
    expect(second).toEqual(first);
    expect(store.has(first.sha256)).toBe(true);
    expect(store.read(first.sha256).toString("utf8")).toBe("safe trace output");
  });
});

describe("SqliteTraceStore", () => {
  it("persists a partial trace across reopening", () => {
    const directory = mkdtempSync(join(tmpdir(), "morphscope-sqlite-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "traces.sqlite");
    const first = new SqliteTraceStore({ filename });
    first.upsertRun({ runId: "run-001", traceId: "trace-001", terminalState: "running" });
    first.upsertSpan({
      spanId: "span-001",
      traceId: "trace-001",
      parentSpanId: null,
      status: "running",
    });
    first.appendEvent({
      eventId: "event-001",
      traceId: "trace-001",
      spanId: "span-001",
      type: "agent_turn_started",
    });
    first.close();

    const reopened = new SqliteTraceStore({ filename });
    const snapshot = reopened.readTrace("trace-001");
    expect(snapshot.run?.terminalState).toBe("running");
    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    reopened.close();
  });

  it("rejects records without stable identifiers", () => {
    const directory = mkdtempSync(join(tmpdir(), "morphscope-sqlite-"));
    temporaryDirectories.push(directory);
    const store = new SqliteTraceStore({ filename: join(directory, "traces.sqlite") });
    expect(() => store.upsertSpan({ traceId: "trace-001" })).toThrow("spanId");
    store.close();
  });
});
