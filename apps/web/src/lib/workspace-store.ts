import { neon } from "@neondatabase/serverless";
import {
  parseWorkspaceRecordInput,
  type WorkspaceRecord,
  type WorkspaceRecordInput,
  type WorkspaceRecordKind,
} from "./workspace-schema";

let schemaPromise: Promise<void> | null = null;

export class WorkspaceStorageConfigurationError extends Error {
  constructor() {
    super("Workspace storage is not configured");
    this.name = "WorkspaceStorageConfigurationError";
  }
}

export function workspaceStorageConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function listWorkspaceRecords(): Promise<WorkspaceRecord[]> {
  const sql = await preparedSql();
  const rows = await sql`SELECT kind, id, payload, created_at, updated_at
    FROM morphscope_workspace_records
    ORDER BY updated_at DESC, id ASC`;
  return rows.flatMap(readRow);
}

export async function createWorkspaceRecord(input: WorkspaceRecordInput): Promise<WorkspaceRecord> {
  const parsed = parseWorkspaceRecordInput(input);
  const sql = await preparedSql();
  const payload = JSON.stringify(parsed.payload);
  const rows = await sql`INSERT INTO morphscope_workspace_records (kind, id, payload)
    VALUES (${parsed.kind}, ${parsed.payload.id}, ${payload}::jsonb)
    RETURNING kind, id, payload, created_at, updated_at`;
  const record = rows.flatMap(readRow)[0];
  if (!record) throw new Error("Workspace record was not returned after insert");
  return record;
}

export async function updateWorkspaceRecord(
  kind: WorkspaceRecordKind,
  id: string,
  input: WorkspaceRecordInput,
): Promise<WorkspaceRecord | null> {
  const parsed = parseWorkspaceRecordInput(input);
  if (parsed.kind !== kind || parsed.payload.id !== id) {
    throw new Error("Workspace record identity cannot change");
  }
  const sql = await preparedSql();
  const payload = JSON.stringify(parsed.payload);
  const rows = await sql`UPDATE morphscope_workspace_records
    SET payload = ${payload}::jsonb, updated_at = now()
    WHERE kind = ${kind} AND id = ${id}
    RETURNING kind, id, payload, created_at, updated_at`;
  return rows.flatMap(readRow)[0] ?? null;
}

export async function deleteWorkspaceRecord(
  kind: WorkspaceRecordKind,
  id: string,
): Promise<boolean> {
  const sql = await preparedSql();
  const rows = await sql`DELETE FROM morphscope_workspace_records
    WHERE kind = ${kind} AND id = ${id}
    RETURNING id`;
  return rows.length > 0;
}

async function preparedSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new WorkspaceStorageConfigurationError();
  const sql = neon(connectionString);
  if (!schemaPromise) {
    schemaPromise = sql`
      CREATE TABLE IF NOT EXISTS morphscope_workspace_records (
        kind text NOT NULL CHECK (kind IN ('task', 'experiment', 'run')),
        id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, id)
      )
    `
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
  return sql;
}

function readRow(row: Record<string, unknown>): WorkspaceRecord[] {
  const createdAt = timestampValue(row.created_at);
  const updatedAt = timestampValue(row.updated_at);
  if (
    (row.kind !== "task" && row.kind !== "experiment" && row.kind !== "run") ||
    typeof row.id !== "string" ||
    !createdAt ||
    !updatedAt
  ) {
    return [];
  }
  try {
    const parsed = parseWorkspaceRecordInput({ kind: row.kind, payload: row.payload });
    if (parsed.payload.id !== row.id) return [];
    return [{ ...parsed, createdAt, updatedAt }];
  } catch {
    return [];
  }
}

function timestampValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  return value instanceof Date ? value.toISOString() : null;
}
