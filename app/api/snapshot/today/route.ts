import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionAuthenticated } from "@/lib/auth/guard";
import { getTodaySnapshot, parseTodayFilter } from "@/lib/snapshot/query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authenticated = await isSessionAuthenticated(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = parseTodayFilter(request.nextUrl.searchParams);
  const payload = await getTodaySnapshot(filter);
  if (payload.qualityStatus === "BLOCKED") {
    return NextResponse.json(payload, { status: 503 });
  }
  return NextResponse.json(payload);
}
