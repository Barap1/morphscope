import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type JsonRecord = Record<string, unknown>;

export type TraceSnapshot = {
  traceId: string;
  run?: JsonRecord;
  spans: JsonRecord[];
  events: JsonRecord[];
};

export type SqliteTraceStoreOptions = {
  filename: string;
};

type JsonRow = { payload_json: string };

export class SqliteTraceStore {
  readonly filename: string;
  private readonly database: DatabaseSync;

  constructor(options: SqliteTraceStoreOptions) {
    this.filename = resolve(options.filename);
    mkdirSync(dirname(this.filename), { recursive: true });
    this.database = new DatabaseSync(this.filename);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  upsertRun(run: JsonRecord): void {
    const runId = requireString(run, "runId");
    const traceId = requireString(run, "traceId");
    this.database
      .prepare(
        `INSERT INTO runs (run_id, trace_id, payload_json)
         VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           trace_id = excluded.trace_id,
           payload_json = excluded.payload_json`,
      )
      .run(runId, traceId, serialize(run));
  }

  upsertSpan(span: JsonRecord): void {
    const spanId = requireString(span, "spanId");
    const traceId = requireString(span, "traceId");
    this.database
      .prepare(
        `INSERT INTO spans (span_id, trace_id, parent_span_id, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(span_id) DO UPDATE SET
           trace_id = excluded.trace_id,
           parent_span_id = excluded.parent_span_id,
           payload_json = excluded.payload_json`,
      )
      .run(spanId, traceId, optionalString(span.parentSpanId), serialize(span));
  }

  appendEvent(event: JsonRecord): void {
    const eventId = requireString(event, "eventId");
    const traceId = requireString(event, "traceId");
    this.database
      .prepare(
        `INSERT INTO events (event_id, trace_id, span_id, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(eventId, traceId, optionalString(event.spanId), serialize(event));
  }

  readTrace(traceId: string): TraceSnapshot {
    const run = this.database
      .prepare("SELECT payload_json FROM runs WHERE trace_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(traceId) as JsonRow | undefined;
    const spans = this.database
      .prepare("SELECT payload_json FROM spans WHERE trace_id = ? ORDER BY rowid ASC")
      .all(traceId) as unknown as JsonRow[];
    const events = this.database
      .prepare("SELECT payload_json FROM events WHERE trace_id = ? ORDER BY rowid ASC")
      .all(traceId) as unknown as JsonRow[];

    return {
      traceId,
      ...(run ? { run: parseRecord(run.payload_json) } : {}),
      spans: spans.map((row) => parseRecord(row.payload_json)),
      events: events.map((row) => parseRecord(row.payload_json)),
    };
  }

  listTraceIds(): string[] {
    const rows = this.database
      .prepare("SELECT DISTINCT trace_id FROM spans ORDER BY trace_id ASC")
      .all() as unknown as Array<{ trace_id: string }>;
    return rows.map((row) => row.trace_id);
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spans (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        span_id TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_trace_id ON runs(trace_id);
      CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
    `);
    this.database
      .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(1, new Date().toISOString());
  }
}

function requireString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function serialize(record: JsonRecord): string {
  const serialized = JSON.stringify(record);
  if (!serialized) throw new Error("record could not be serialized as JSON");
  return serialized;
}

function parseRecord(serialized: string): JsonRecord {
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("stored record is not a JSON object");
  }
  return parsed as JsonRecord;
}
