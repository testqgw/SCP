
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/auth/guard";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "@/lib/snapshot/time";
import { logger } from "@/lib/snapshot/log";
import { SportsDataClient } from "@/lib/sportsdata/client";
import {
  normalizeBoxScorePlayerLogs,
  normalizeGames,
  normalizeInjuries,
  normalizeSeasonPlayers,
} from "@/lib/sportsdata/normalize";
import type {
  NormalizedPlayerGameStat,
  NormalizedPlayerSeason,
} from "@/lib/sportsdata/types";

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

function collectHistoricalFetchDates(mode: RefreshMode, dateEt: string): string[] {
  const days = mode === "FULL" ? 14 : 7;
  const result: string[] = [];
  for (let offset = 1; offset <= days; offset += 1) {
    result.push(etDateShift(dateEt, -offset));
  }
  return result;
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

function teamNameFromAbbr(abbreviation: string | null): string {
  if (!abbreviation) return "Unknown";
  return abbreviation.toUpperCase();
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

async function upsertPlayers(players: NormalizedPlayerSeason[], teamMap: Map<string, string>): Promise<{ playerMap: Map<string, string>; playerNameMap: Map<string, string> }> {
  const playerMap = new Map<string, string>();
  const playerNameMap = new Map<string, string>();

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
      select: { id: true, externalId: true, fullName: true },
    });
    if (saved.externalId) {
      playerMap.set(saved.externalId, saved.id);
    }
    if (saved.fullName) {
      playerNameMap.set(saved.fullName.toLowerCase().trim(), saved.id);
    }
  }

  return { playerMap, playerNameMap };
}

async function upsertGames(
  games: ReturnType<typeof normalizeGames>,
  teamMap: Map<string, string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const game of games) {
    const homeTeamId = teamMap.get(game.homeTeamAbbr);
    const awayTeamId = teamMap.get(game.awayTeamAbbr);
    if (!homeTeamId || !awayTeamId) {
      continue;
    }

    const saved = await prisma.game.upsert({
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
      select: { id: true, externalId: true },
    });
    map.set(saved.externalId, saved.id);
  }
  return map;
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



type FetchDataResult = {
  games: ReturnType<typeof normalizeGames>;
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
  injuriesByTeam: Map<string, string[]>;
  warnings: string[];
};
async function fetchData(mode: RefreshMode, dateEt: string): Promise<FetchDataResult> {
  const client = new SportsDataClient();
  const warnings: string[] = [];
  const season = inferSeasonFromEtDate(dateEt);

  const [rawGames, rawSeasonPlayers, rawInjuries] = await Promise.all([
    client.fetchSchedule(dateEt),
    client.fetchSeasonStats(season).catch((error) => {
      warnings.push(`Season stats unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
    client.fetchInjuries().catch((error) => {
      warnings.push(`Injury feed unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
  ]);

  const games = normalizeGames(rawGames);
  const datesToFetch = collectHistoricalFetchDates(mode, dateEt);
  const rawLogs: unknown[] = [];
  for (const fetchDate of datesToFetch) {
    try {
      const rows = await client.fetchBoxScoresFinalByDate(fetchDate);
      rawLogs.push(...rows);
    } catch (error) {
      warnings.push(
        `Box scores final unavailable for ${fetchDate}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  const seasonPlayers = normalizeSeasonPlayers(rawSeasonPlayers);

  const logs = normalizeBoxScorePlayerLogs(rawLogs);
  const players = mergePlayers(seasonPlayers, logs);
  const injuries = normalizeInjuries(rawInjuries);

  logger.info("Provider payload summary", {
    dateEt,
    rawGames: rawGames.length,
    normalizedGames: games.length,
    rawSeasonPlayers: rawSeasonPlayers.length,
    normalizedPlayers: players.length,
    rawBoxScores: rawLogs.length,
    normalizedLogs: logs.length,
  });

  const injuriesByTeam = injuries.reduce((map, injury) => {
    if (!injury.teamAbbr) return map;
    const existing = map.get(injury.teamAbbr) ?? [];
    existing.push(injury.status);
    map.set(injury.teamAbbr, existing);
    return map;
  }, new Map<string, string[]>());

  return {
    games,
    players,
    logs,
    injuriesByTeam,
    warnings,
  };
}

function evaluateQualityInput(data: {
  logs: NormalizedPlayerGameStat[];
}): string[] {
  const issues: string[] = [];

  const completedLogs = data.logs.filter((log) => (log.minutes ?? 0) > 0);
  if (completedLogs.length < 120) {
    issues.push(`Insufficient completed player logs (${completedLogs.length}) for stable metrics.`);
  }

  return issues;
}

export async function runRefresh(mode: RefreshMode): Promise<RefreshResult> {
  const startedAt = Date.now();
  const runStartedAt = new Date();
  const dateEt = getTodayEtDateString();

  await prisma.refreshRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: {
        lt: new Date(Date.now() - 5 * 60 * 1000),
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
      startedAt: runStartedAt,
      notes: { dateEt, qualityGateEnabled: QUALITY_GATE_ENABLED },
    },
    select: { id: true },
  });

  const warnings: string[] = [];

  try {
    const fetched = await fetchData(mode, dateEt);
    warnings.push(...fetched.warnings);

    const teamMap = await upsertTeams(fetched.games, fetched.players, fetched.logs);
    const { playerMap } = await upsertPlayers(fetched.players, teamMap);
    await upsertGames(fetched.games, teamMap);
    await upsertPlayerLogs(fetched.logs, playerMap, teamMap);

    const qualityIssues = evaluateQualityInput({
      logs: fetched.logs,
    });
    const qualityPass = qualityIssues.length === 0;
    const isPublishable = QUALITY_GATE_ENABLED ? qualityPass : true;
    if (!qualityPass) {
      warnings.push(...qualityIssues.map((issue) => `Quality gate: ${issue}`));
    }

    const durationMs = Date.now() - startedAt;
    const status = warnings.length > 0 || !qualityPass ? "PARTIAL" : "SUCCESS";

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
        notes: { dateEt, warnings, qualityGateEnabled: QUALITY_GATE_ENABLED },
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
        notes: { dateEt, warnings, qualityGateEnabled: QUALITY_GATE_ENABLED },
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
