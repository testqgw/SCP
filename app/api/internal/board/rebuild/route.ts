import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getSnapshotBoardDateString } from "@/lib/snapshot/time";

// Rebuilds and persists the slate board after scheduled refreshes. Page loads serve the persisted board
// without a freshness check, so without this the board stays frozen at its first build of the day.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const dateParam = request.nextUrl.searchParams.get("date");
    const dateEt = isValidEtDate(dateParam) ? dateParam : getSnapshotBoardDateString();
    const board = await getSnapshotBoardData(dateEt, true);
    const response = NextResponse.json({
      ok: true,
      dateEt: board.dateEt,
      lastUpdatedAt: board.lastUpdatedAt,
      matchups: board.matchups.length,
      rows: board.rows.length,
      feedEvents: board.boardFeed?.events.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Board rebuild failed";
    const response = NextResponse.json({ ok: false, error: message, durationMs: Date.now() - startedAt }, { status: 500 });
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
