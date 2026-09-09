import { NextResponse } from "next/server";
import {
  issueWorkspaceSession,
  passwordMatches,
  setWorkspaceSession,
  workspaceAuthConfigured,
} from "../../../../lib/workspace-auth";
import { readJsonBody } from "../../../../lib/request-body";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 10;

export async function POST(request: Request) {
  if (!workspaceAuthConfigured()) {
    return jsonError("Workspace access is not configured.", 503);
  }
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowAttempt(address)) return jsonError("Too many sign-in attempts. Try again later.", 429);

  const bodyResult = await readJsonBody(request, 8 * 1024);
  if (!bodyResult.ok) return jsonError(bodyResult.message, bodyResult.status);
  const body = bodyResult.value;
  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof body.password === "string"
      ? body.password
      : "";
  if (!passwordMatches(password)) return jsonError("The workspace password is incorrect.", 401);

  const response = NextResponse.json(
    { authenticated: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  setWorkspaceSession(response, issueWorkspaceSession());
  return response;
}

function allowAttempt(address: string): boolean {
  const now = Date.now();
  const current = attempts.get(address);
  if (!current || current.resetAt <= now) {
    if (attempts.size >= 2_048) {
      const oldest = attempts.keys().next().value;
      if (oldest) attempts.delete(oldest);
    }
    attempts.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_ATTEMPTS) return false;
  current.count += 1;
  return true;
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
