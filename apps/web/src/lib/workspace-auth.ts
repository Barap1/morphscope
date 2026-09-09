import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  verifyPassword,
  verifySessionToken,
  workspaceSessionTtlSeconds,
} from "./workspace-auth-core";
import { workspaceStorageConfigured } from "./workspace-store";

export const WORKSPACE_SESSION_COOKIE = "morphscope_workspace_session";

export function workspaceAuthConfigured(): boolean {
  return Boolean(
    workspaceStorageConfigured() &&
    process.env.MORPHSCOPE_WORKSPACE_PASSWORD_HASH &&
    (process.env.MORPHSCOPE_SESSION_SECRET?.length ?? 0) >= 32,
  );
}

export function passwordMatches(password: string): boolean {
  const encoded = process.env.MORPHSCOPE_WORKSPACE_PASSWORD_HASH;
  return Boolean(encoded && verifyPassword(password, encoded));
}

export function issueWorkspaceSession(): string {
  const secret = process.env.MORPHSCOPE_SESSION_SECRET;
  if (!secret) throw new Error("MORPHSCOPE_SESSION_SECRET is not configured");
  return createSessionToken(secret);
}

export function requestHasWorkspaceSession(request: Request): boolean {
  const secret = process.env.MORPHSCOPE_SESSION_SECRET;
  if (!secret) return false;
  return verifySessionToken(
    readCookie(request.headers.get("cookie"), WORKSPACE_SESSION_COOKIE),
    secret,
  );
}

export async function hasWorkspaceSession(): Promise<boolean> {
  const secret = process.env.MORPHSCOPE_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(WORKSPACE_SESSION_COOKIE)?.value;
  return verifySessionToken(token, secret);
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function setWorkspaceSession(response: NextResponse, token: string): void {
  response.cookies.set({
    name: WORKSPACE_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: workspaceSessionTtlSeconds,
  });
}

export function clearWorkspaceSession(response: NextResponse): void {
  response.cookies.set({
    name: WORKSPACE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
