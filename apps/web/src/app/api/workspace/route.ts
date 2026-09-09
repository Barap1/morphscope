import { NextResponse } from "next/server";
import {
  createWorkspaceRecord,
  listWorkspaceRecords,
  WorkspaceStorageConfigurationError,
} from "../../../lib/workspace-store";
import {
  isSameOrigin,
  requestHasWorkspaceSession,
  workspaceAuthConfigured,
} from "../../../lib/workspace-auth";
import { parseWorkspaceRecordInput } from "../../../lib/workspace-schema";
import { readJsonBody } from "../../../lib/request-body";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = requireAuth(request);
  if (authError) return authError;
  try {
    return NextResponse.json(
      { records: await listWorkspaceRecords() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(request: Request) {
  const authError = requireMutationAuth(request);
  if (authError) return authError;
  if (tooLarge(request)) return jsonError("Workspace records are limited to 64 KB.", 413);
  const bodyResult = await readJsonBody(request, 64 * 1024);
  if (!bodyResult.ok) return jsonError(bodyResult.message, bodyResult.status);
  const body = bodyResult.value;
  try {
    const input = parseWorkspaceRecordInput(body);
    const record = await createWorkspaceRecord(input);
    return NextResponse.json({ record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isValidationError(error)) return jsonError("The workspace record is invalid.", 400);
    if (isUniqueError(error))
      return jsonError("A record with that type and ID already exists.", 409);
    return storageError(error);
  }
}

function requireAuth(request: Request) {
  if (!workspaceAuthConfigured()) return jsonError("Workspace access is not configured.", 503);
  if (!requestHasWorkspaceSession(request)) return jsonError("Sign in is required.", 401);
  return null;
}

function requireMutationAuth(request: Request) {
  const authError = requireAuth(request);
  if (authError) return authError;
  if (!isSameOrigin(request))
    return jsonError("Mutations must originate from this workspace.", 403);
  return null;
}

function tooLarge(request: Request): boolean {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > 64 * 1024;
}

function storageError(error: unknown) {
  if (error instanceof WorkspaceStorageConfigurationError) {
    return jsonError("Workspace storage is not configured.", 503);
  }
  return jsonError("Workspace storage is temporarily unavailable.", 500);
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isValidationError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "issues" in error);
}

function isUniqueError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
