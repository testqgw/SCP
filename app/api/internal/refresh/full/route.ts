import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRefresh("FULL");
    const response = NextResponse.json({ ok: true, result });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    const response = NextResponse.json({ error: message }, { status: 500 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
