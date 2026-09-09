import { NextResponse } from "next/server";
import { hasWorkspaceSession, workspaceAuthConfigured } from "../../../../lib/workspace-auth";

export const runtime = "nodejs";

export async function GET() {
  const configured = workspaceAuthConfigured();
  const authenticated = configured && (await hasWorkspaceSession());
  return NextResponse.json(
    { configured, authenticated },
    { headers: { "Cache-Control": "no-store" } },
  );
}
