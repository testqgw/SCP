import { prisma } from "../lib/prisma";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { SportsDataClient } from "../lib/sportsdata/client";
import { normalizeBoxScorePlayerLogs, normalizeGames, normalizeSeasonPlayers } from "../lib/sportsdata/normalize";
import type { NormalizedPlayerGameStat, NormalizedPlayerSeason } from "../lib/sportsdata/types";

type Args = {
  season: string;
  from: string;
  to: string;
  dryRun: boolean;
};

function parseArgs(): Args {
  const todayEt = getTodayEtDateString();
  const defaultSeason = inferSeasonFromEtDate(todayEt);
  const raw = process.argv.slice(2);

  let season = defaultSeason;
  let from = `${defaultSeason}-10-01`;
  let to = todayEt;
  let dryRun = false;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    const next = raw[i + 1];
    if ((token === "--season" || token === "-s") && next) {
      season = next;
      from = `${season}-10-01`;
      i += 1;
      continue;
    }
    if (token.startsWith("--season=")) {
      season = token.slice("--season=".length);
      from = `${season}-10-01`;
      continue;
    }

    if (token === "--from" && next) {
      from = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }

    if (token === "--to" && next) {
      to = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }
  }

  return { season, from, to, dryRun };
}

function isEtDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function listDatesInclusive(fromEt: string, toEt: string): string[] {
  const start = toUtcDate(fromEt);
  const end = toUtcDate(toEt);
  const result: string[] = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");
    result.push(`${year}-${month}-${day}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function teamNameFromAbbr(abbreviation: string | null): string {
  if (!abbreviation) return "Unknown";
  return abbreviation.toUpperCase();
}

function mergePlayers(
  seasonPlayers: NormalizedPlayerSeason[],
  gameStats: NormalizedPlayerGameStat[],
): NormalizedPlayerSeason[] {
  const merged = new Map<string, NormalizedPlayerSeason>();

  seasonPlayers.forEach((player) => {
    merged.set(player.externalPlayerId, player);
  });

  gameStats.forEach((log) => {
    if (!merged.has(log.externalPlayerId)) {
      const fallbackName =
        log.fullName ??
        [log.firstName, log.lastName].filter((part): part is string => Boolean(part)).join(" ").trim();

      merged.set(log.externalPlayerId, {
        externalPlayerId: log.externalPlayerId,
        fullName: fallbackName || `Player ${log.externalPlayerId}`,
        firstName: log.firstName,
        lastName: log.lastName,
        teamAbbr: log.teamAbbr,
        position: log.position,
        usageRate: null,
        isActive: true,
      });
    }
  });

  return Array.from(merged.values());
}

async function upsertTeams(
  games: ReturnType<typeof normalizeGames>,
  players: NormalizedPlayerSeason[],
  logs: NormalizedPlayerGameStat[],
): Promise<Map<string, string>> {
  const teams = new Map<string, { abbreviation: string; name: string }>();

  games.forEach((game) => {
    teams.set(game.homeTeamAbbr, {
      abbreviation: game.homeTeamAbbr,
      name: game.homeTeamName ?? teamNameFromAbbr(game.homeTeamAbbr),
    });
    teams.set(game.awayTeamAbbr, {
      abbreviation: game.awayTeamAbbr,
      name: game.awayTeamName ?? teamNameFromAbbr(game.awayTeamAbbr),
    });
  });

  players.forEach((player) => {
    if (player.teamAbbr) {
      teams.set(player.teamAbbr, {
        abbreviation: player.teamAbbr,
        name: teamNameFromAbbr(player.teamAbbr),
      });
    }
  });

  logs.forEach((log) => {
    if (log.teamAbbr) {
      teams.set(log.teamAbbr, { abbreviation: log.teamAbbr, name: teamNameFromAbbr(log.teamAbbr) });
    }
    if (log.opponentAbbr) {
      teams.set(log.opponentAbbr, { abbreviation: log.opponentAbbr, name: teamNameFromAbbr(log.opponentAbbr) });
    }
  });

  const map = new Map<string, string>();
  for (const team of teams.values()) {
    const saved = await prisma.team.upsert({
      where: { abbreviation: team.abbreviation },
      update: { name: team.name },
      create: {
        abbreviation: team.abbreviation,
        name: team.name,
      },
      select: { id: true, abbreviation: true },
    });
    map.set(saved.abbreviation, saved.id);
  }

  return map;
}

async function upsertPlayers(players: NormalizedPlayerSeason[], teamMap: Map<string, string>): Promise<Map<string, string>> {
  const playerMap = new Map<string, string>();

  for (const player of players) {
    const teamId = player.teamAbbr ? teamMap.get(player.teamAbbr) ?? null : null;
    const saved = await prisma.player.upsert({
      where: { externalId: player.externalPlayerId },
      update: {
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        usageRate: player.usageRate,
        isActive: player.isActive,
        teamId,
      },
      create: {
        externalId: player.externalPlayerId,
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        usageRate: player.usageRate,
        isActive: player.isActive,
        teamId,
      },
      select: { id: true, externalId: true },
    });
    if (saved.externalId) {
      playerMap.set(saved.externalId, saved.id);
    }
  }

  return playerMap;
}

async function upsertGames(
  games: ReturnType<typeof normalizeGames>,
  teamMap: Map<string, string>,
): Promise<void> {
  for (const game of games) {
    const homeTeamId = teamMap.get(game.homeTeamAbbr);
    const awayTeamId = teamMap.get(game.awayTeamAbbr);
    if (!homeTeamId || !awayTeamId) {
      continue;
    }

    await prisma.game.upsert({
      where: { externalId: game.externalGameId },
      update: {
        gameDateEt: game.gameDateEt,
        season: game.season,
        status: game.status,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId,
        awayTeamId,
      },
      create: {
        externalId: game.externalGameId,
        gameDateEt: game.gameDateEt,
        season: game.season,
        status: game.status,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId,
        awayTeamId,
      },
    });
  }
}

async function upsertPlayerLogs(
  logs: NormalizedPlayerGameStat[],
  playerMap: Map<string, string>,
  teamMap: Map<string, string>,
): Promise<number> {
  let inserted = 0;

  for (const log of logs) {
    const playerId = playerMap.get(log.externalPlayerId);
    if (!playerId) {
      continue;
    }

    const externalGameId = log.externalGameId ?? `${log.gameDateEt}:${log.externalPlayerId}:${log.opponentAbbr ?? "UNK"}`;
    const teamId = log.teamAbbr ? teamMap.get(log.teamAbbr) ?? null : null;
    const opponentTeamId = log.opponentAbbr ? teamMap.get(log.opponentAbbr) ?? null : null;

    await prisma.playerGameLog.upsert({
      where: {
        playerId_externalGameId: {
          playerId,
          externalGameId,
        },
      },
      update: {
        gameDateEt: log.gameDateEt,
        teamId,
        opponentTeamId,
        isHome: log.isHome,
        minutes: log.minutes,
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
        pace: log.pace,
        total: log.total,
      },
      create: {
        playerId,
        externalGameId,
        gameDateEt: log.gameDateEt,
        teamId,
        opponentTeamId,
        isHome: log.isHome,
        minutes: log.minutes,
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
        pace: log.pace,
        total: log.total,
      },
    });

    inserted += 1;
  }

  return inserted;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isEtDate(args.from) || !isEtDate(args.to)) {
    throw new Error("Dates must be YYYY-MM-DD (ET). Example: --from 2025-10-01 --to 2026-02-28");
  }

  if (toUtcDate(args.from) > toUtcDate(args.to)) {
    throw new Error(`Invalid range: from ${args.from} is after to ${args.to}`);
  }

  const dates = listDatesInclusive(args.from, args.to);
  const client = new SportsDataClient();

  // eslint-disable-next-line no-console
  console.log(`Backfill start | season=${args.season} | range=${args.from}..${args.to} | dates=${dates.length}`);

  const rawSeasonPlayers = await client.fetchSeasonStats(args.season).catch((error) => {
    // eslint-disable-next-line no-console
    console.warn(`Season player stats unavailable for ${args.season}:`, error);
    return [];
  });

  const seasonPlayers = normalizeSeasonPlayers(rawSeasonPlayers);
  const rawBoxScores: unknown[] = [];
  const rawGameRows: unknown[] = [];
  const warnings: string[] = [];
  let successDates = 0;

  for (let i = 0; i < dates.length; i += 1) {
    const dateEt = dates[i];
    try {
      const rows = await client.fetchBoxScoresFinalByDate(dateEt);
      if (rows.length > 0) {
        rawBoxScores.push(...rows);
        successDates += 1;

        rows.forEach((boxScore) => {
          if (boxScore && typeof boxScore === "object" && !Array.isArray(boxScore)) {
            const record = boxScore as Record<string, unknown>;
            if (record.Game) {
              rawGameRows.push(record.Game);
            }
          }
        });
      }
    } catch (error) {
      const message = `Failed date ${dateEt}: ${error instanceof Error ? error.message : "unknown"}`;
      warnings.push(message);
    }

    if ((i + 1) % 7 === 0 || i === dates.length - 1) {
      // eslint-disable-next-line no-console
      console.log(`Progress ${i + 1}/${dates.length} dates | boxscoreDays=${successDates} | warnings=${warnings.length}`);
    }
  }

  const normalizedGames = normalizeGames(rawGameRows);
  const normalizedLogs = normalizeBoxScorePlayerLogs(rawBoxScores);
  const mergedPlayers = mergePlayers(seasonPlayers, normalizedLogs);

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          season: args.season,
          from: args.from,
          to: args.to,
          seasonPlayers: seasonPlayers.length,
          mergedPlayers: mergedPlayers.length,
          games: normalizedGames.length,
          logs: normalizedLogs.length,
          warningCount: warnings.length,
          warnings: warnings.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  const teamMap = await upsertTeams(normalizedGames, mergedPlayers, normalizedLogs);
  const playerMap = await upsertPlayers(mergedPlayers, teamMap);
  await upsertGames(normalizedGames, teamMap);
  const writtenLogs = await upsertPlayerLogs(normalizedLogs, playerMap, teamMap);

  await prisma.systemSetting.upsert({
    where: { key: "snapshot_season_backfill" },
    update: {
      value: {
        season: args.season,
        from: args.from,
        to: args.to,
        completedAt: new Date().toISOString(),
        datesAttempted: dates.length,
        datesWithBoxScores: successDates,
        logsWritten: writtenLogs,
        warningCount: warnings.length,
        nextSuggestedFrom: etDateShift(args.to, 1),
      },
    },
    create: {
      key: "snapshot_season_backfill",
      value: {
        season: args.season,
        from: args.from,
        to: args.to,
        completedAt: new Date().toISOString(),
        datesAttempted: dates.length,
        datesWithBoxScores: successDates,
        logsWritten: writtenLogs,
        warningCount: warnings.length,
        nextSuggestedFrom: etDateShift(args.to, 1),
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        season: args.season,
        from: args.from,
        to: args.to,
        datesAttempted: dates.length,
        datesWithBoxScores: successDates,
        seasonPlayers: seasonPlayers.length,
        mergedPlayers: mergedPlayers.length,
        gamesUpserted: normalizedGames.length,
        logsUpserted: writtenLogs,
        warningCount: warnings.length,
      },
      null,
      2,
    ),
  );

  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("Warnings (first 20):");
    warnings.slice(0, 20).forEach((warning) => {
      // eslint-disable-next-line no-console
      console.warn(`- ${warning}`);
    });
  }
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Season backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
