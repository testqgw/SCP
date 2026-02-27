import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionAuthenticated } from "@/lib/auth/guard";
import { getSnapshotFilters } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authenticated = await isSessionAuthenticated(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateEt = request.nextUrl.searchParams.get("date") ?? getTodayEtDateString();
  const payload = await getSnapshotFilters(dateEt);
  return NextResponse.json(payload);
}
