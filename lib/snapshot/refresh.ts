import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/auth/guard";
import { etDateShift, getTodayEtDateString } from "@/lib/snapshot/time";
import { logger } from "@/lib/snapshot/log";
import { NbaDataClient } from "@/lib/nba/client";
import type { NormalizedGame, NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";

type RefreshMode = "FULL" | "DELTA";

type RefreshResult = {
  runId: string;
  status: "SUCCESS" | "PARTIAL";
  warnings: string[];
  isPublishable: boolean;
  qualityIssues: string[];
  totals: {
    games: number;
    players: number;
  };
};

const QUALITY_GATE_ENABLED = process.env.SNAPSHOT_QUALITY_GATE_ENABLED !== "false";

function teamNameFromAbbr(abbreviation: string | null): string {
  if (!abbreviation) return "Unknown";
  return abbreviation.toUpperCase();
}

function collectDateWindow(mode: RefreshMode, dateEt: string): { from: string; to: string } {
  if (mode === "FULL") {
    return {
      from: etDateShift(dateEt, -5),
      to: dateEt,
    };
  }
  return {
    from: etDateShift(dateEt, -2),
    to: dateEt,
  };
}

function dedupeGames(games: NormalizedGame[]): NormalizedGame[] {
  const map = new Map<string, NormalizedGame>();
  games.forEach((game) => {
    map.set(game.externalGameId, game);
  });
  return Array.from(map.values());
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

      if (log.teamAbbr) {
        existing.teamAbbr = log.teamAbbr;
      }
      if (log.position && !existing.position) {
        existing.position = log.position;
      }
      existing.isActive = true;
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
        starter: log.starter,
        played: log.played,
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
        starter: log.starter,
        played: log.played,
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

type FetchDataResult = {
  games: NormalizedGame[];
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
  warnings: string[];
};

async function fetchData(mode: RefreshMode, dateEt: string): Promise<FetchDataResult> {
  const client = new NbaDataClient();
  const warnings: string[] = [];
  const schedule = await client.fetchSchedule();
  const { from, to } = collectDateWindow(mode, dateEt);

  const todaysGames = schedule.filter((game) => game.gameDateEt === dateEt);
  const windowGames = schedule.filter((game) => game.gameDateEt >= from && game.gameDateEt <= to);
  const finalWindowGames = windowGames.filter((game) => game.statusNumber >= 3);

  const players: NormalizedPlayerSeason[] = [];
  const logs: NormalizedPlayerGameStat[] = [];

  for (const game of finalWindowGames) {
    try {
      const payload = await client.fetchGameBoxScore(game);
      players.push(...payload.players);
      logs.push(...payload.logs);
    } catch (error) {
      warnings.push(
        `Box score unavailable for ${game.externalGameId} (${game.gameDateEt}): ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  const mergedPlayers = mergePlayersFromLogs(players, logs);
  const games = dedupeGames([...todaysGames, ...windowGames]);

  logger.info("NBA payload summary", {
    dateEt,
    windowFrom: from,
    windowTo: to,
    scheduleGames: schedule.length,
    todaysGames: todaysGames.length,
    windowGames: windowGames.length,
    finalWindowGames: finalWindowGames.length,
    players: mergedPlayers.length,
    logs: logs.length,
  });

  return {
    games,
    players: mergedPlayers,
    logs,
    warnings,
  };
}

function evaluateQualityInput(data: { logs: NormalizedPlayerGameStat[]; games: NormalizedGame[] }): string[] {
  const issues: string[] = [];
  const completedLogs = data.logs.filter((log) => (log.minutes ?? 0) > 0);

  if (data.games.length === 0) {
    issues.push("No schedule games found for refresh window.");
  }
  if (completedLogs.length < 40) {
    issues.push(`Insufficient completed player logs (${completedLogs.length}) for stable board data.`);
  }

  return issues;
}

export async function runRefresh(mode: RefreshMode): Promise<RefreshResult> {
  const startedAt = Date.now();
  const dateEt = getTodayEtDateString();

  await prisma.refreshRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: {
        lt: new Date(Date.now() - 10 * 60 * 1000),
      },
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorCount: 1,
      errorMessage: "Run exceeded timeout window and was auto-marked failed.",
      isPublishable: false,
      qualityIssues: ["run_timeout"],
    },
  });

  const run = await prisma.refreshRun.create({
    data: {
      type: mode,
      status: "RUNNING",
      notes: { dateEt, source: "nba_official", qualityGateEnabled: QUALITY_GATE_ENABLED },
    },
    select: { id: true },
  });

  const warnings: string[] = [];

  try {
    const fetched = await fetchData(mode, dateEt);
    warnings.push(...fetched.warnings);

    const teamMap = await upsertTeams(fetched.games, fetched.players, fetched.logs);
    const playerMap = await upsertPlayers(fetched.players, teamMap);
    await upsertGames(fetched.games, teamMap);
    await upsertPlayerLogs(fetched.logs, playerMap, teamMap);
    await syncPlayerCurrentTeams();

    const qualityIssues = evaluateQualityInput({
      logs: fetched.logs,
      games: fetched.games,
    });
    const qualityPass = qualityIssues.length === 0;
    const isPublishable = QUALITY_GATE_ENABLED ? qualityPass : true;

    if (!qualityPass) {
      warnings.push(...qualityIssues.map((issue) => `Quality gate: ${issue}`));
    }

    const durationMs = Date.now() - startedAt;
    const status: "SUCCESS" | "PARTIAL" = warnings.length > 0 || !qualityPass ? "PARTIAL" : "SUCCESS";

    await prisma.refreshRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        durationMs,
        totalGames: fetched.games.length,
        totalPlayers: fetched.players.length,
        warningCount: warnings.length,
        isPublishable,
        qualityIssues,
        notes: { dateEt, warnings, source: "nba_official", qualityGateEnabled: QUALITY_GATE_ENABLED },
      },
    });

    await prisma.systemSetting.upsert({
      where: { key: "snapshot_last_refresh" },
      update: {
        value: {
          runId: run.id,
          dateEt,
          completedAt: new Date().toISOString(),
          status,
          isPublishable,
          qualityIssues,
          source: "nba_official",
        },
      },
      create: {
        key: "snapshot_last_refresh",
        value: {
          runId: run.id,
          dateEt,
          completedAt: new Date().toISOString(),
          status,
          isPublishable,
          qualityIssues,
          source: "nba_official",
        },
      },
    });

    if (isPublishable) {
      await prisma.systemSetting.upsert({
        where: { key: "snapshot_last_publishable_run" },
        update: {
          value: {
            runId: run.id,
            dateEt,
            completedAt: new Date().toISOString(),
            status,
            qualityIssues,
            source: "nba_official",
          },
        },
        create: {
          key: "snapshot_last_publishable_run",
          value: {
            runId: run.id,
            dateEt,
            completedAt: new Date().toISOString(),
            status,
            qualityIssues,
            source: "nba_official",
          },
        },
      });
    }

    return {
      runId: run.id,
      status,
      warnings,
      isPublishable,
      qualityIssues,
      totals: {
        games: fetched.games.length,
        players: fetched.players.length,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown refresh error";
    await prisma.refreshRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorCount: 1,
        errorMessage: reason,
        warningCount: warnings.length,
        isPublishable: false,
        qualityIssues: ["refresh_failed"],
        notes: { dateEt, warnings, source: "nba_official", qualityGateEnabled: QUALITY_GATE_ENABLED },
      },
    });
    logger.error("Refresh failed", { runId: run.id, mode, reason });
    throw error;
  }
}

export function assertCronGuard(request: Request): void {
  const nextRequest = request as unknown as Parameters<typeof isCronAuthorized>[0];
  if (!isCronAuthorized(nextRequest)) {
    const error = new Error("Unauthorized cron request");
    error.name = "UnauthorizedError";
    throw error;
  }
}
