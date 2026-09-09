import { NextResponse } from "next/server";
import { clearWorkspaceSession } from "../../../../lib/workspace-auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearWorkspaceSession(response);
  return response;
}
