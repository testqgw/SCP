import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { runRefresh } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRefresh("DELTA");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
