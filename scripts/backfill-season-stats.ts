import { prisma } from "../lib/prisma";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { NbaDataClient } from "../lib/nba/client";
import type { NormalizedGame, NormalizedPlayerGameStat, NormalizedPlayerSeason } from "../lib/sportsdata/types";

type Args = {
  season: string;
  from: string;
  to: string;
  dryRun: boolean;
  reset: boolean;
};

function parseArgs(): Args {
  const todayEt = getTodayEtDateString();
  const defaultSeason = inferSeasonFromEtDate(todayEt);
  const raw = process.argv.slice(2);

  let season = defaultSeason;
  let from = `${defaultSeason}-10-01`;
  let to = todayEt;
  let dryRun = false;
  let reset = false;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--reset") {
      reset = true;
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

  return { season, from, to, dryRun, reset };
}

function isEtDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function teamNameFromAbbr(abbreviation: string | null): string {
  if (!abbreviation) return "Unknown";
  return abbreviation.toUpperCase();
}

function mergePlayersFromLogs(players: NormalizedPlayerSeason[], logs: NormalizedPlayerGameStat[]): NormalizedPlayerSeason[] {
  const byId = new Map<string, NormalizedPlayerSeason>();

  players.forEach((player) => {
    byId.set(player.externalPlayerId, player);
  });

  logs
    .slice()
    .sort((a, b) => b.gameDateEt.localeCompare(a.gameDateEt))
    .forEach((log) => {
      const existing = byId.get(log.externalPlayerId);
      const fallbackName =
        log.fullName ??
        [log.firstName, log.lastName].filter((part): part is string => Boolean(part)).join(" ").trim();
      if (!fallbackName) {
        return;
      }

      if (!existing) {
        byId.set(log.externalPlayerId, {
          externalPlayerId: log.externalPlayerId,
          fullName: fallbackName,
          firstName: log.firstName,
          lastName: log.lastName,
          teamAbbr: log.teamAbbr,
          position: log.position,
          usageRate: null,
          isActive: true,
        });
        return;
      }

      if (log.teamAbbr && !existing.teamAbbr) {
        existing.teamAbbr = log.teamAbbr;
      }
      if (log.position && !existing.position) {
        existing.position = log.position;
      }
    });

  return Array.from(byId.values());
}

async function upsertTeams(
  games: NormalizedGame[],
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

async function upsertGames(games: NormalizedGame[], teamMap: Map<string, string>): Promise<void> {
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

async function resetAllCoreTables(): Promise<void> {
  await prisma.playerGameLog.deleteMany({});
  await prisma.game.deleteMany({});
  await prisma.player.deleteMany({});
  await prisma.team.deleteMany({});
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isEtDate(args.from) || !isEtDate(args.to)) {
    throw new Error("Dates must be YYYY-MM-DD (ET). Example: --from 2025-10-01 --to 2026-02-28");
  }
  if (toUtcDate(args.from) > toUtcDate(args.to)) {
    throw new Error(`Invalid range: from ${args.from} is after to ${args.to}`);
  }

  const client = new NbaDataClient();
  const schedule = await client.fetchSchedule();
  const inRangeGames = schedule
    .filter((game) => game.gameDateEt >= args.from && game.gameDateEt <= args.to)
    .filter((game) => inferSeasonFromEtDate(game.gameDateEt) === args.season);

  const finalGames = inRangeGames.filter((game) => game.statusNumber >= 3);

  // eslint-disable-next-line no-console
  console.log(
    `Backfill start | season=${args.season} | range=${args.from}..${args.to} | scheduleGames=${inRangeGames.length} | finalGames=${finalGames.length}`,
  );

  const normalizedPlayers: NormalizedPlayerSeason[] = [];
  const normalizedLogs: NormalizedPlayerGameStat[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < finalGames.length; i += 1) {
    const game = finalGames[i];
    try {
      const payload = await client.fetchGameBoxScore(game);
      normalizedPlayers.push(...payload.players);
      normalizedLogs.push(...payload.logs);
    } catch (error) {
      warnings.push(
        `Game ${game.externalGameId} (${game.gameDateEt}) failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    if ((i + 1) % 25 === 0 || i === finalGames.length - 1) {
      // eslint-disable-next-line no-console
      console.log(
        `Progress ${i + 1}/${finalGames.length} final games | logs=${normalizedLogs.length} | warnings=${warnings.length}`,
      );
    }
  }

  const mergedPlayers = mergePlayersFromLogs(normalizedPlayers, normalizedLogs);

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          season: args.season,
          from: args.from,
          to: args.to,
          scheduleGames: inRangeGames.length,
          finalGames: finalGames.length,
          players: mergedPlayers.length,
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

  if (args.reset) {
    // eslint-disable-next-line no-console
    console.log("Resetting teams/players/games/logs before backfill...");
    await resetAllCoreTables();
  }

  const teamMap = await upsertTeams(inRangeGames, mergedPlayers, normalizedLogs);
  const playerMap = await upsertPlayers(mergedPlayers, teamMap);
  await upsertGames(inRangeGames, teamMap);
  const logsWritten = await upsertPlayerLogs(normalizedLogs, playerMap, teamMap);
  await syncPlayerCurrentTeams();

  await prisma.systemSetting.upsert({
    where: { key: "snapshot_season_backfill" },
    update: {
      value: {
        source: "nba_official",
        season: args.season,
        from: args.from,
        to: args.to,
        completedAt: new Date().toISOString(),
        scheduleGames: inRangeGames.length,
        finalGames: finalGames.length,
        logsWritten,
        warningCount: warnings.length,
        reset: args.reset,
        nextSuggestedFrom: etDateShift(args.to, 1),
      },
    },
    create: {
      key: "snapshot_season_backfill",
      value: {
        source: "nba_official",
        season: args.season,
        from: args.from,
        to: args.to,
        completedAt: new Date().toISOString(),
        scheduleGames: inRangeGames.length,
        finalGames: finalGames.length,
        logsWritten,
        warningCount: warnings.length,
        reset: args.reset,
        nextSuggestedFrom: etDateShift(args.to, 1),
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        source: "nba_official",
        season: args.season,
        from: args.from,
        to: args.to,
        scheduleGames: inRangeGames.length,
        finalGames: finalGames.length,
        players: mergedPlayers.length,
        logsUpserted: logsWritten,
        warningCount: warnings.length,
      },
      null,
      2,
    ),
  );
  if (warnings.length) {
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
