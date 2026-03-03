import { prisma } from "../lib/prisma";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { logger } from "../lib/snapshot/log";

type Args = {
  seasonsBack: number;
  dryRun: boolean;
  includeCurrentSeason: boolean;
};

type LeagueGameLogRow = {
  playerExternalId: string;
  playerName: string;
  teamCode: string;
  opponentCode: string | null;
  gameDateEt: string;
  externalGameId: string;
  isHome: boolean | null;
  starter: boolean | null;
  played: boolean;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BR_TO_NBA: Record<string, string> = {
  BRK: "BKN",
  CHO: "CHA",
  PHO: "PHX",
  NOH: "NOP",
  NOK: "NOP",
  NJN: "BKN",
  SEA: "OKC",
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let seasonsBack = 2;
  let dryRun = false;
  let includeCurrentSeason = false;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--include-current-season") {
      includeCurrentSeason = true;
      continue;
    }
    if (token === "--seasons-back" && next) {
      seasonsBack = Number(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--seasons-back=")) {
      seasonsBack = Number(token.slice("--seasons-back=".length));
      continue;
    }
  }

  seasonsBack = Number.isFinite(seasonsBack) ? Math.max(1, Math.min(6, Math.floor(seasonsBack))) : 2;
  return { seasonsBack, dryRun, includeCurrentSeason };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalTeamCode(value: string): string {
  const upper = value.trim().toUpperCase();
  return BR_TO_NBA[upper] ?? upper;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^\d+:\d+$/.test(trimmed)) {
    const [minutes, seconds] = trimmed.split(":").map((part) => Number(part));
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return Math.round((minutes + seconds / 60) * 100) / 100;
    }
  }
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return parsed;
  return 0;
}

function parseGameDateEt(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { firstName: fullName.trim(), lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function seasonLabelFromStartYear(year: number): string {
  const next = String(year + 1).slice(-2);
  return `${year}-${next}`;
}

function targetSeasonLabels(args: Args): string[] {
  const currentSeasonStart = Number(inferSeasonFromEtDate(getTodayEtDateString()));
  const labels: string[] = [];

  if (args.includeCurrentSeason) {
    labels.push(seasonLabelFromStartYear(currentSeasonStart));
  }

  for (let i = 1; i <= args.seasonsBack; i += 1) {
    labels.push(seasonLabelFromStartYear(currentSeasonStart - i));
  }

  return Array.from(new Set(labels));
}

async function fetchLeagueGameLogSeason(season: string): Promise<LeagueGameLogRow[]> {
  const url = `https://stats.nba.com/stats/leaguegamelog?Counter=0&Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=${encodeURIComponent(
    season,
  )}&SeasonType=Regular%20Season&Sorter=DATE`;
  const delays = [0, 600, 1800, 4200, 8000];
  let payload: unknown = null;

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.nba.com/",
        Origin: "https://www.nba.com",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      if (RETRYABLE.has(response.status)) {
        continue;
      }
      throw new Error(`NBA Stats request failed (${response.status}) for season ${season}`);
    }

    payload = (await response.json()) as unknown;
    break;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(`No league game log payload for season ${season}`);
  }
  const root = payload as Record<string, unknown>;
  const resultSets = Array.isArray(root.resultSets) ? root.resultSets : [];
  if (resultSets.length === 0 || typeof resultSets[0] !== "object") {
    throw new Error(`Unexpected league game log shape for season ${season}`);
  }

  const primary = resultSets[0] as Record<string, unknown>;
  const headers = Array.isArray(primary.headers) ? primary.headers.map((value) => String(value)) : [];
  const rowSet = Array.isArray(primary.rowSet) ? primary.rowSet : [];
  if (headers.length === 0) {
    throw new Error(`Missing headers for season ${season}`);
  }

  const index = (name: string): number => headers.indexOf(name);
  const idxPlayerId = index("PLAYER_ID");
  const idxPlayerName = index("PLAYER_NAME");
  const idxTeamAbbr = index("TEAM_ABBREVIATION");
  const idxGameDate = index("GAME_DATE");
  const idxGameId = index("GAME_ID");
  const idxMatchup = index("MATCHUP");
  const idxMinutes = index("MIN");
  const idxPts = index("PTS");
  const idxReb = index("REB");
  const idxAst = index("AST");
  const idxFg3m = index("FG3M");
  const idxStl = index("STL");
  const idxBlk = index("BLK");
  const idxTov = index("TOV");
  const idxStartPos = index("START_POSITION");

  const required = [idxPlayerId, idxPlayerName, idxTeamAbbr, idxGameDate, idxGameId, idxMinutes];
  if (required.some((idx) => idx < 0)) {
    throw new Error(`Season ${season} missing required columns`);
  }

  const rows: LeagueGameLogRow[] = [];
  rowSet.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const playerExternalId = String(entry[idxPlayerId] ?? "").trim();
    const playerName = String(entry[idxPlayerName] ?? "").trim();
    const teamCode = canonicalTeamCode(String(entry[idxTeamAbbr] ?? ""));
    const gameDateEt = parseGameDateEt(String(entry[idxGameDate] ?? ""));
    const externalGameId = String(entry[idxGameId] ?? "").trim();
    const matchup = idxMatchup >= 0 ? String(entry[idxMatchup] ?? "").trim() : "";
    const minutes = parseMinutes(entry[idxMinutes]);
    const startPos = idxStartPos >= 0 ? String(entry[idxStartPos] ?? "").trim() : "";

    if (!playerExternalId || !playerName || !teamCode || !gameDateEt || !externalGameId) return;
    if (minutes <= 0) return;

    const matchupMatch = matchup.match(/^([A-Z]{2,3})\s+(vs\.|@)\s+([A-Z]{2,3})$/i);
    const isHome = matchupMatch ? matchupMatch[2].toLowerCase() !== "@" : null;
    const opponentCode = matchupMatch ? canonicalTeamCode(matchupMatch[3]) : null;

    rows.push({
      playerExternalId,
      playerName,
      teamCode,
      opponentCode,
      gameDateEt,
      externalGameId,
      isHome,
      starter: startPos ? true : false,
      played: true,
      minutes,
      points: idxPts >= 0 ? toNumber(entry[idxPts]) : 0,
      rebounds: idxReb >= 0 ? toNumber(entry[idxReb]) : 0,
      assists: idxAst >= 0 ? toNumber(entry[idxAst]) : 0,
      threes: idxFg3m >= 0 ? toNumber(entry[idxFg3m]) : 0,
      steals: idxStl >= 0 ? toNumber(entry[idxStl]) : 0,
      blocks: idxBlk >= 0 ? toNumber(entry[idxBlk]) : 0,
      turnovers: idxTov >= 0 ? toNumber(entry[idxTov]) : 0,
    });
  });

  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function ensureTeams(rows: LeagueGameLogRow[]): Promise<Map<string, string>> {
  const codes = Array.from(
    new Set(
      rows.flatMap((row) => {
        const values = [row.teamCode];
        if (row.opponentCode) values.push(row.opponentCode);
        return values;
      }),
    ),
  ).sort();

  const map = new Map<string, string>();
  for (const code of codes) {
    const team = await prisma.team.upsert({
      where: { abbreviation: code },
      update: { name: code },
      create: { abbreviation: code, name: code },
      select: { id: true, abbreviation: true },
    });
    map.set(team.abbreviation, team.id);
  }
  return map;
}

async function ensurePlayers(rows: LeagueGameLogRow[], teamMap: Map<string, string>): Promise<Map<string, string>> {
  const byExternal = new Map<string, LeagueGameLogRow>();
  rows.forEach((row) => {
    const existing = byExternal.get(row.playerExternalId);
    if (!existing || row.gameDateEt > existing.gameDateEt) {
      byExternal.set(row.playerExternalId, row);
    }
  });

  const map = new Map<string, string>();
  for (const row of byExternal.values()) {
    const teamId = teamMap.get(row.teamCode) ?? null;
    const { firstName, lastName } = splitName(row.playerName);
    const player = await prisma.player.upsert({
      where: { externalId: row.playerExternalId },
      update: {
        fullName: row.playerName,
        firstName,
        lastName,
        isActive: true,
        teamId,
      },
      create: {
        externalId: row.playerExternalId,
        fullName: row.playerName,
        firstName,
        lastName,
        position: null,
        usageRate: null,
        isActive: true,
        teamId,
      },
      select: { id: true, externalId: true },
    });
    if (player.externalId) {
      map.set(player.externalId, player.id);
    }
  }
  return map;
}

async function writeLogs(
  rows: LeagueGameLogRow[],
  teamMap: Map<string, string>,
  playerMap: Map<string, string>,
): Promise<number> {
  const payload = rows
    .map((row) => {
      const playerId = playerMap.get(row.playerExternalId);
      if (!playerId) return null;
      return {
        playerId,
        externalGameId: row.externalGameId,
        gameDateEt: row.gameDateEt,
        teamId: teamMap.get(row.teamCode) ?? null,
        opponentTeamId: row.opponentCode ? teamMap.get(row.opponentCode) ?? null : null,
        isHome: row.isHome,
        starter: row.starter,
        played: row.played,
        minutes: row.minutes,
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        threes: row.threes,
        steals: row.steals,
        blocks: row.blocks,
        turnovers: row.turnovers,
        pace: null,
        total: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  let inserted = 0;
  const batches = chunk(payload, 2000);
  for (const batch of batches) {
    const result = await prisma.playerGameLog.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }
  return inserted;
}

async function syncPlayerCurrentTeams(): Promise<void> {
  const latestLogs = await prisma.playerGameLog.findMany({
    where: { teamId: { not: null } },
    distinct: ["playerId"],
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
    select: { playerId: true, teamId: true },
  });

  for (const log of latestLogs) {
    if (!log.teamId) continue;
    await prisma.player.update({
      where: { id: log.playerId },
      data: { teamId: log.teamId },
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const seasonLabels = targetSeasonLabels(args);

  const perSeasonRows = await Promise.all(
    seasonLabels.map(async (season) => ({
      season,
      rows: await fetchLeagueGameLogSeason(season),
    })),
  );

  const allRows = perSeasonRows.flatMap((entry) => entry.rows);
  const dedupe = new Map<string, LeagueGameLogRow>();
  allRows.forEach((row) => {
    dedupe.set(`${row.playerExternalId}:${row.externalGameId}`, row);
  });
  const uniqueRows = Array.from(dedupe.values());

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          seasonLabels,
          perSeasonCounts: perSeasonRows.map((entry) => ({ season: entry.season, rows: entry.rows.length })),
          rows: allRows.length,
          uniqueRows: uniqueRows.length,
          players: new Set(uniqueRows.map((row) => row.playerExternalId)).size,
        },
        null,
        2,
      ),
    );
    return;
  }

  const teamMap = await ensureTeams(uniqueRows);
  const playerMap = await ensurePlayers(uniqueRows, teamMap);
  const inserted = await writeLogs(uniqueRows, teamMap, playerMap);
  await syncPlayerCurrentTeams();

  await prisma.systemSetting.upsert({
    where: { key: "snapshot_last3_backfill_nbastats" },
    update: {
      value: {
        source: "nba_stats_api",
        seasonLabels,
        completedAt: new Date().toISOString(),
        rows: allRows.length,
        uniqueRows: uniqueRows.length,
        players: playerMap.size,
        insertedLogs: inserted,
      },
    },
    create: {
      key: "snapshot_last3_backfill_nbastats",
      value: {
        source: "nba_stats_api",
        seasonLabels,
        completedAt: new Date().toISOString(),
        rows: allRows.length,
        uniqueRows: uniqueRows.length,
        players: playerMap.size,
        insertedLogs: inserted,
      },
    },
  });

  logger.info("Last3 season backfill complete (NBA stats)", {
    seasonLabels,
    rows: allRows.length,
    uniqueRows: uniqueRows.length,
    players: playerMap.size,
    insertedLogs: inserted,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        source: "nba_stats_api",
        seasonLabels,
        rows: allRows.length,
        uniqueRows: uniqueRows.length,
        players: playerMap.size,
        insertedLogs: inserted,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("NBA stats last3 backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
