import { NextResponse } from "next/server";
import { ensureNbaScheduleGamesForDate } from "@/lib/snapshot/nbaScheduleSync";
import { buildSnapshotParlayCard } from "@/lib/snapshot/parlayModel";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getSnapshotBoardDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidEtDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function readBoundedInt(value: string | null, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readBoundedFloat(value: string | null, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const dateEt = isValidEtDate(searchParams.get("date"))
      ? (searchParams.get("date") as string)
      : getSnapshotBoardDateString();
    const rebuildBoard = searchParams.get("rebuild") === "1" || searchParams.has("refresh");
    const targetLegs = readBoundedInt(searchParams.get("legs"), 2, 12);
    const maxLegs = readBoundedInt(searchParams.get("maxLegs"), 2, 12);
    const minLegProbability = readBoundedFloat(searchParams.get("minProb"), 0.5, 0.9);

    const scheduleSync = await ensureNbaScheduleGamesForDate(dateEt);
    const board = await getSnapshotBoardData(dateEt, rebuildBoard || scheduleSync.upsertedGames > 0);
    const result = buildSnapshotParlayCard(board, {
      ...(targetLegs == null ? {} : { targetLegs, minLegs: targetLegs }),
      ...(maxLegs == null ? {} : { maxLegs }),
      ...(minLegProbability == null ? {} : { minLegProbability }),
    });

    const response = NextResponse.json({ ok: true, result, scheduleSync });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parlay card load failed.";
    const response = NextResponse.json({ ok: false, error: message }, { status: 500 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
