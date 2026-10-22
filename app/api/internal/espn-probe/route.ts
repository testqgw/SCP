import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/auth/guard";
import { EspnNbaDataClient } from "@/lib/espn/client";
import { etDateShift, getTodayEtDateString } from "@/lib/snapshot/time";

// Read-only reachability probe for the ESPN NBA feed from Vercel. Touches no database tables.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NBA_CDN_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";

async function timed<T>(task: () => Promise<T>): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number; error: string }> {
  const startedAt = Date.now();
  try {
    const value = await task();
    return { ok: true, ms: Date.now() - startedAt, value };
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeNbaCdn(): Promise<{ status: number | null; error?: string }> {
  try {
    const response = await fetch(NBA_CDN_SCHEDULE_URL, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Origin: "https://www.nba.com",
        Referer: "https://www.nba.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return { status: response.status };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = request.nextUrl.searchParams.get("date")?.trim();
  const dateEt = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : getTodayEtDateString();
  const from = etDateShift(dateEt, -2);
  const client = new EspnNbaDataClient();

  const [schedule, nbaCdn] = await Promise.all([timed(() => client.fetchScheduleRange(from, dateEt)), probeNbaCdn()]);
  const games = schedule.ok ? schedule.value : [];
  const finalGame = games
    .filter((game) => game.statusNumber >= 3)
    .sort((a, b) => (b.commenceTimeUtc?.getTime() ?? 0) - (a.commenceTimeUtc?.getTime() ?? 0))[0];
  const boxScore = finalGame ? await timed(() => client.fetchGameBoxScore(finalGame)) : null;

  const response = NextResponse.json({
    ok: schedule.ok && (boxScore?.ok ?? true),
    region: process.env.VERCEL_REGION ?? null,
    window: { from, to: dateEt },
    espnSchedule: schedule.ok
      ? {
          ok: true,
          ms: schedule.ms,
          games: games.length,
          finals: games.filter((game) => game.statusNumber >= 3).length,
          today: games
            .filter((game) => game.gameDateEt === dateEt)
            .map((game) => `${game.awayTeamAbbr}@${game.homeTeamAbbr} ${game.status ?? ""}`.trim()),
        }
      : schedule,
    espnBoxScore: !boxScore
      ? null
      : boxScore.ok
        ? {
            ok: true,
            ms: boxScore.ms,
            game: `${finalGame?.awayTeamAbbr}@${finalGame?.homeTeamAbbr} ${finalGame?.gameDateEt}`,
            logs: boxScore.value.logs.length,
            playedLogs: boxScore.value.logs.filter((log) => (log.minutes ?? 0) > 0).length,
            sample: boxScore.value.logs.slice(0, 2),
          }
        : boxScore,
    nbaCdnSchedule: nbaCdn,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
