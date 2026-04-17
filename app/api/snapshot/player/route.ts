import { NextResponse } from "next/server";
import { getSnapshotPlayerLookupData } from "@/lib/snapshot/query";
import { getSnapshotBoardDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const dateEt = isValidEtDate(searchParams.get("date")) ? (searchParams.get("date") as string) : getSnapshotBoardDateString();
    const playerId = searchParams.get("playerId");
    const playerSearch = searchParams.get("player");

    if (!playerId && !playerSearch?.trim()) {
      return NextResponse.json({ ok: false, error: "Player search is required." }, { status: 400 });
    }

    const result = await getSnapshotPlayerLookupData({
      dateEt,
      playerId,
      playerSearch,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Player lookup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
