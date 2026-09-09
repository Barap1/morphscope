import { NextResponse } from "next/server";
import {
  deleteWorkspaceRecord,
  updateWorkspaceRecord,
  WorkspaceStorageConfigurationError,
} from "../../../../lib/workspace-store";
import {
  isSameOrigin,
  requestHasWorkspaceSession,
  workspaceAuthConfigured,
} from "../../../../lib/workspace-auth";
import {
  parseWorkspaceRecordInput,
  type WorkspaceRecordKind,
} from "../../../../lib/workspace-schema";
import { readJsonBody } from "../../../../lib/request-body";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireMutationAuth(request);
  if (authError) return authError;
  if (tooLarge(request)) return jsonError("Workspace records are limited to 64 KB.", 413);
  const { id } = await params;
  const bodyResult = await readJsonBody(request, 64 * 1024);
  if (!bodyResult.ok) return jsonError(bodyResult.message, bodyResult.status);
  const body = bodyResult.value;
  try {
    if (!isRecord(body) || typeof body.kind !== "string") {
      return jsonError("A record kind is required.", 400);
    }
    const input = parseWorkspaceRecordInput(body);
    const record = await updateWorkspaceRecord(body.kind as WorkspaceRecordKind, id, input);
    return record
      ? NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } })
      : jsonError("Workspace record was not found.", 404);
  } catch (error) {
    if (isValidationError(error)) return jsonError("The workspace record is invalid.", 400);
    return storageError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireMutationAuth(request);
  if (authError) return authError;
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "task" && kind !== "experiment" && kind !== "run") {
    return jsonError("A valid record kind is required.", 400);
  }
  try {
    const deleted = await deleteWorkspaceRecord(kind, (await params).id);
    return deleted
      ? NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } })
      : jsonError("Workspace record was not found.", 404);
  } catch (error) {
    return storageError(error);
  }
}

function requireMutationAuth(request: Request) {
  if (!workspaceAuthConfigured()) return jsonError("Workspace access is not configured.", 503);
  if (!requestHasWorkspaceSession(request)) return jsonError("Sign in is required.", 401);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
