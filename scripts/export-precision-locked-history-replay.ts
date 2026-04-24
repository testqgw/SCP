import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import {
  buildPrecisionUpstreamLockedHistoryReplay,
  type PrecisionUpstreamLockedHistoryReplay,
} from "../lib/snapshot/precisionUpstreamReranker";
import { round } from "../lib/utils";

type FirstGameLockMeta = {
  firstGameTimeUtc: string | null;
  syntheticLockedAt: string | null;
  lockLeadMinutes: number;
};

type LockedReplayWithFirstGameLocks = Omit<PrecisionUpstreamLockedHistoryReplay, "daily" | "picks" | "summary"> & {
  firstGameLockPolicy: {
    source: "nba_cdn_schedule" | "database_game_commence_time";
    sourceUrl: string | null;
    lockLeadMinutes: number;
    caveat: string;
  };
  summary: PrecisionUpstreamLockedHistoryReplay["summary"] & {
    firstGameLockCoveragePct: number;
  };
  daily: Array<PrecisionUpstreamLockedHistoryReplay["daily"][number] & FirstGameLockMeta>;
  picks: Array<PrecisionUpstreamLockedHistoryReplay["picks"][number] & FirstGameLockMeta>;
};

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), "exports", "precision-upstream-locked-pregame-history-replay.json");
const DEFAULT_LOCK_LEAD_MINUTES = 15;
const NBA_CDN_SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";

function parseArgs(): {
  out: string;
  lockLeadMinutes: number;
  timeSource: "nba-cdn" | "db";
} {
  const args = process.argv.slice(2);
  let out = DEFAULT_OUTPUT_PATH;
  let lockLeadMinutes = DEFAULT_LOCK_LEAD_MINUTES;
  let timeSource: "nba-cdn" | "db" = "nba-cdn";
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if ((token === "--out" || token === "-o") && next) {
      out = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      const value = token.slice("--out=".length);
      out = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
      continue;
    }
    if (token === "--lock-lead-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) lockLeadMinutes = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--lock-lead-minutes=")) {
      const parsed = Number(token.slice("--lock-lead-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) lockLeadMinutes = Math.floor(parsed);
      continue;
    }
    if (token === "--time-source" && next) {
      if (next === "nba-cdn" || next === "db") timeSource = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--time-source=")) {
      const value = token.slice("--time-source=".length);
      if (value === "nba-cdn" || value === "db") timeSource = value;
    }
  }
  return { out, lockLeadMinutes, timeSource };
}

function buildLockMeta(firstGameTimeUtc: Date | null, lockLeadMinutes: number): FirstGameLockMeta {
  if (!firstGameTimeUtc) {
    return {
      firstGameTimeUtc: null,
      syntheticLockedAt: null,
      lockLeadMinutes,
    };
  }
  return {
    firstGameTimeUtc: firstGameTimeUtc.toISOString(),
    syntheticLockedAt: new Date(firstGameTimeUtc.getTime() - lockLeadMinutes * 60_000).toISOString(),
    lockLeadMinutes,
  };
}

async function loadFirstGameTimeByDate(dates: string[]): Promise<Map<string, Date | null>> {
  const games = await prisma.game.findMany({
    where: { gameDateEt: { in: dates } },
    select: { gameDateEt: true, commenceTimeUtc: true },
    orderBy: [{ gameDateEt: "asc" }, { commenceTimeUtc: "asc" }],
  });
  const firstByDate = new Map<string, Date | null>();
  dates.forEach((date) => firstByDate.set(date, null));
  games.forEach((game) => {
    const current = firstByDate.get(game.gameDateEt) ?? null;
    if (!game.commenceTimeUtc) return;
    if (!current || game.commenceTimeUtc.getTime() < current.getTime()) {
      firstByDate.set(game.gameDateEt, game.commenceTimeUtc);
    }
  });
  return firstByDate;
}

type NbaCdnScheduleGame = {
  gameCode?: unknown;
  gameDateTimeUTC?: unknown;
};

type NbaCdnScheduleDate = {
  games?: unknown;
};

type NbaCdnSchedulePayload = {
  leagueSchedule?: {
    gameDates?: NbaCdnScheduleDate[];
  };
};

function nbaCodeDateToEtDate(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})\//);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function loadOnlineNbaFirstGameTimeByDate(dates: string[]): Promise<Map<string, Date | null>> {
  const wantedDates = new Set(dates);
  const response = await fetch(NBA_CDN_SCHEDULE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; precision-lock-backtest/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`NBA CDN schedule fetch failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as NbaCdnSchedulePayload;
  const firstByDate = new Map<string, Date | null>();
  dates.forEach((date) => firstByDate.set(date, null));

  (payload.leagueSchedule?.gameDates ?? []).forEach((dateBucket) => {
    const games = Array.isArray(dateBucket.games) ? dateBucket.games : [];
    games.forEach((rawGame) => {
      const game = rawGame as NbaCdnScheduleGame;
      const gameCode = typeof game.gameCode === "string" ? game.gameCode : "";
      const dateEt = nbaCodeDateToEtDate(gameCode);
      if (!dateEt || !wantedDates.has(dateEt)) return;
      const gameDateTimeUtc = typeof game.gameDateTimeUTC === "string" ? game.gameDateTimeUTC : "";
      const parsed = new Date(gameDateTimeUtc);
      if (!Number.isFinite(parsed.getTime())) return;
      const current = firstByDate.get(dateEt) ?? null;
      if (!current || parsed.getTime() < current.getTime()) {
        firstByDate.set(dateEt, parsed);
      }
    });
  });

  return firstByDate;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const replay = buildPrecisionUpstreamLockedHistoryReplay();
  if (!replay) {
    throw new Error("No Precision upstream history rows are available.");
  }

  const dates = replay.daily.map((day) => day.date);
  const firstGameTimeByDate =
    args.timeSource === "nba-cdn"
      ? await loadOnlineNbaFirstGameTimeByDate(dates)
      : await loadFirstGameTimeByDate(dates);
  const lockMetaByDate = new Map(
    dates.map((date) => [
      date,
      buildLockMeta(firstGameTimeByDate.get(date) ?? null, args.lockLeadMinutes),
    ]),
  );
  const lockCoverage = replay.daily.filter((day) => lockMetaByDate.get(day.date)?.firstGameTimeUtc).length;
  const output: LockedReplayWithFirstGameLocks = {
    ...replay,
    firstGameLockPolicy: {
      source: args.timeSource === "nba-cdn" ? "nba_cdn_schedule" : "database_game_commence_time",
      sourceUrl: args.timeSource === "nba-cdn" ? NBA_CDN_SCHEDULE_URL : null,
      lockLeadMinutes: args.lockLeadMinutes,
      caveat:
        "This is a locked-card replay: the card is selected once per slate and stamped before the first game using online NBA schedule times. It can validate fixed-card selection accuracy, but historical row inputs do not carry intraday capture timestamps, so it is not proof that every input field existed at that exact lock time.",
    },
    summary: {
      ...replay.summary,
      firstGameLockCoveragePct: round((lockCoverage / Math.max(replay.daily.length, 1)) * 100, 2),
    },
    daily: replay.daily.map((day) => ({
      ...day,
      ...(lockMetaByDate.get(day.date) ?? buildLockMeta(null, args.lockLeadMinutes)),
    })),
    picks: replay.picks.map((pick) => ({
      ...pick,
      ...(lockMetaByDate.get(pick.date) ?? buildLockMeta(null, args.lockLeadMinutes)),
    })),
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output.summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
