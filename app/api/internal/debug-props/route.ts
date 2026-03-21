import { NextResponse } from "next/server";
import { SportsDataClient } from "@/lib/sportsdata/client";
import { fetchDailyPraLineMap, fetchDailyPtsLineMap, fetchDailyThreesLineMap } from "@/lib/snapshot/pointsContext";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

function summarizeLineMap(map: Map<string, { source: string; sportsbookCount: number }>) {
  return {
    count: map.size,
    sample: Array.from(map.entries()).slice(0, 5),
    maxSportsbookCount: Math.max(...Array.from(map.values()).map((entry) => entry.sportsbookCount), 0),
    sources: Array.from(new Set(Array.from(map.values()).map((entry) => entry.source))),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateEt = searchParams.get("date")?.trim() || getTodayEtDateString();
  let client: SportsDataClient | null = null;

  try {
    client = new SportsDataClient();
  } catch {
    client = null;
  }

  const [legacy, events, metadata, pts, threes, pra] = await Promise.all([
    client?.fetchLegacyPlayerPropsByDate(dateEt).then(
      (rows) => ({ ok: true, count: rows.length, sample: rows.slice(0, 2) }),
      (error) => ({ ok: false, error: String(error) }),
    ) ?? Promise.resolve({ ok: false, error: "SPORTS_DATA_IO_API_KEY is not configured." }),
    client?.fetchBettingEventsByDate(dateEt).then(
      (rows) => ({ ok: true, count: rows.length, sample: rows.slice(0, 2) }),
      (error) => ({ ok: false, error: String(error) }),
    ) ?? Promise.resolve({ ok: false, error: "SPORTS_DATA_IO_API_KEY is not configured." }),
    client?.fetchBettingMetadata().then(
      (payload) => ({
        ok: true,
        keys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).slice(0, 12) : [],
      }),
      (error) => ({ ok: false, error: String(error) }),
    ) ?? Promise.resolve({ ok: false, error: "SPORTS_DATA_IO_API_KEY is not configured." }),
    fetchDailyPtsLineMap(dateEt).then(
      (map) => ({ ok: true, ...summarizeLineMap(map) }),
      (error) => ({ ok: false, error: String(error) }),
    ),
    fetchDailyThreesLineMap(dateEt).then(
      (map) => ({ ok: true, ...summarizeLineMap(map) }),
      (error) => ({ ok: false, error: String(error) }),
    ),
    fetchDailyPraLineMap(dateEt).then(
      (map) => ({ ok: true, ...summarizeLineMap(map) }),
      (error) => ({ ok: false, error: String(error) }),
    ),
  ]);

  return NextResponse.json({
    success: true,
    dateEt,
    sportsData: {
      legacy,
      events,
      metadata,
    },
    scoresAndOdds: {
      pts,
      threes,
      pra,
    },
  });
}
