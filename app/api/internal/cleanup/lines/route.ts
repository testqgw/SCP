import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { pruneOldLineSnapshots } from "@/lib/snapshot/refresh";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await pruneOldLineSnapshots(60);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
