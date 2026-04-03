import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/auth/guard";
import { fetchRotowireLineups, parseStoredRotowireLineupSnapshot } from "@/lib/lineups/rotowire";
import { etDateShift, getTodayEtDateString } from "@/lib/snapshot/time";
import { logger } from "@/lib/snapshot/log";
import { NbaDataClient } from "@/lib/nba/client";
import type { NormalizedGame, NormalizedPlayerGameStat, NormalizedPlayerSeason } from "@/lib/sportsdata/types";

type RefreshMode = "FULL" | "DELTA" | "FAST";
type RefreshSource = "manual" | "visit" | "cron";
type RunRefreshOptions = {
  source?: RefreshSource;
};

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

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const whole = Math.floor(parsed);
  return Math.min(Math.max(1, whole), max);
}

const BOX_SCORE_CONCURRENCY = parsePositiveInt(process.env.SNAPSHOT_BOX_SCORE_CONCURRENCY, 8, 24);
const UPSERT_TEAM_BATCH = parsePositiveInt(process.env.SNAPSHOT_UPSERT_TEAM_BATCH, 10, 50);
const UPSERT_PLAYER_BATCH = parsePositiveInt(process.env.SNAPSHOT_UPSERT_PLAYER_BATCH, 25, 100);
const UPSERT_GAME_BATCH = parsePositiveInt(process.env.SNAPSHOT_UPSERT_GAME_BATCH, 20, 100);
const UPSERT_LOG_BATCH = parsePositiveInt(process.env.SNAPSHOT_UPSERT_LOG_BATCH, 50, 200);
const VISIT_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const FAST_REFRESH_LINEUP_REUSE_TTL_MS = parsePositiveInt(
  process.env.SNAPSHOT_FAST_REFRESH_LINEUP_REUSE_TTL_MS,
  60_000,
  10 * 60_000,
);
const DELTA_HISTORICAL_BOX_SCORE_REUSE_ENABLED = process.env.SNAPSHOT_DELTA_HISTORICAL_BOX_SCORE_REUSE !== "false";

type StoreLineupsSnapshotOptions = {
  allowFreshReuse?: boolean;
};

async function runInBatches<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item, batchIndex) => worker(item, index + batchIndex)));
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) {
          return;
        }
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function storeLineupsSnapshot(
  dateEt: string,
  options?: StoreLineupsSnapshotOptions,
): Promise<{ teamCount: number; source: string }> {
  const existing = await prisma.systemSetting.findUnique({
    where: { key: "snapshot_lineups_today" },
    select: { value: true, updatedAt: true },
  });

  const canReuseFreshSnapshot =
    options?.allowFreshReuse === true &&
    dateEt === getTodayEtDateString() &&
    existing?.updatedAt != null &&
    Date.now() - existing.updatedAt.getTime() <= FAST_REFRESH_LINEUP_REUSE_TTL_MS;

  if (canReuseFreshSnapshot) {
    const parsedSnapshot = parseStoredRotowireLineupSnapshot(existing?.value ?? null, dateEt);
    if (parsedSnapshot) {
      return {
        teamCount: parsedSnapshot.teams.length,
        source: parsedSnapshot.sourceUrl,
      };
    }
  }

  const snapshot = await fetchRotowireLineups();
  const nextValue = {
    dateEt,
    ...snapshot,
  };

  if (JSON.stringify(existing?.value ?? null) !== JSON.stringify(nextValue)) {
    await prisma.systemSetting.upsert({
      where: { key: "snapshot_lineups_today" },
      update: {
        value: nextValue,
      },
      create: {
        key: "snapshot_lineups_today",
        value: nextValue,
      },
    });
  }

  return {
    teamCount: snapshot.teams.length,
    source: snapshot.sourceUrl,
  };
}

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
  const rememberTeam = (abbreviation: string | null | undefined, preferredName?: string | null) => {
    if (!abbreviation) return;

    const normalizedAbbreviation = abbreviation.toUpperCase();
    const fallbackName = teamNameFromAbbr(normalizedAbbreviation);
    const nextName = preferredName?.trim() ? preferredName.trim() : fallbackName;
    const existing = teams.get(normalizedAbbreviation);

    if (!existing) {
      teams.set(normalizedAbbreviation, {
        abbreviation: normalizedAbbreviation,
        name: nextName,
      });
      return;
    }

    const existingIsFallback = existing.name === fallbackName;
    const nextIsFallback = nextName === fallbackName;
    if ((existingIsFallback && !nextIsFallback) || (!existingIsFallback && !nextIsFallback && existing.name !== nextName)) {
      existing.name = nextName;
    }
  };

  games.forEach((game) => {
    rememberTeam(game.homeTeamAbbr, game.homeTeamName);
    rememberTeam(game.awayTeamAbbr, game.awayTeamName);
  });

  players.forEach((player) => {
    rememberTeam(player.teamAbbr);
  });

  logs.forEach((log) => {
    rememberTeam(log.teamAbbr);
    rememberTeam(log.opponentAbbr);
  });

  const uniqueTeams = Array.from(teams.values());
  if (uniqueTeams.length === 0) {
    return new Map<string, string>();
  }

  const abbreviations = uniqueTeams.map((team) => team.abbreviation);
  const existingTeams = await prisma.team.findMany({
    where: { abbreviation: { in: abbreviations } },
    select: { id: true, abbreviation: true, name: true },
  });
  const existingByAbbreviation = new Map(existingTeams.map((team) => [team.abbreviation, team]));

  const missingTeams = uniqueTeams.filter((team) => !existingByAbbreviation.has(team.abbreviation));
  const teamsNeedingUpdate = uniqueTeams.filter((team) => {
    const existing = existingByAbbreviation.get(team.abbreviation);
    return existing != null && existing.name !== team.name;
  });

  if (missingTeams.length === 0 && teamsNeedingUpdate.length === 0) {
    return new Map(existingTeams.map((team) => [team.abbreviation, team.id]));
  }

  if (missingTeams.length > 0) {
    await prisma.team.createMany({
      data: missingTeams.map((team) => ({
        abbreviation: team.abbreviation,
        name: team.name,
      })),
      skipDuplicates: true,
    });
  }

  await runInBatches(teamsNeedingUpdate, UPSERT_TEAM_BATCH, async (team) => {
    await prisma.team.update({
      where: { abbreviation: team.abbreviation },
      data: { name: team.name },
    });
  });

  if (missingTeams.length === 0) {
    return new Map(existingTeams.map((team) => [team.abbreviation, team.id]));
  }

  const savedTeams = await prisma.team.findMany({
    where: { abbreviation: { in: abbreviations } },
    select: { id: true, abbreviation: true },
  });

  return new Map(savedTeams.map((team) => [team.abbreviation, team.id]));
}

async function upsertPlayers(players: NormalizedPlayerSeason[], teamMap: Map<string, string>): Promise<Map<string, string>> {
  if (players.length === 0) {
    return new Map<string, string>();
  }

  const uniquePlayers = Array.from(new Map(players.map((player) => [player.externalPlayerId, player])).values());
  const externalIds = uniquePlayers.map((player) => player.externalPlayerId);
  const existingPlayers = await prisma.player.findMany({
    where: { externalId: { in: externalIds } },
    select: {
      id: true,
      externalId: true,
      fullName: true,
      firstName: true,
      lastName: true,
      position: true,
      usageRate: true,
      isActive: true,
      teamId: true,
    },
  });
  const existingByExternalId = new Map(
    existingPlayers
      .filter((player): player is typeof player & { externalId: string } => player.externalId != null)
      .map((player) => [player.externalId, player]),
  );

  const missingPlayers = uniquePlayers.filter((player) => !existingByExternalId.has(player.externalPlayerId));
  const playersNeedingUpdate = uniquePlayers.filter((player) => {
    const existing = existingByExternalId.get(player.externalPlayerId);
    if (!existing) {
      return false;
    }

    const teamId = player.teamAbbr ? teamMap.get(player.teamAbbr) ?? null : null;
    return (
      existing.fullName !== player.fullName ||
      existing.firstName !== player.firstName ||
      existing.lastName !== player.lastName ||
      existing.position !== player.position ||
      existing.usageRate !== player.usageRate ||
      existing.isActive !== player.isActive ||
      existing.teamId !== teamId
    );
  });

  if (missingPlayers.length > 0) {
    for (let index = 0; index < missingPlayers.length; index += UPSERT_PLAYER_BATCH) {
      const batch = missingPlayers.slice(index, index + UPSERT_PLAYER_BATCH);
      await prisma.player.createMany({
        data: batch.map((player) => ({
          externalId: player.externalPlayerId,
          fullName: player.fullName,
          firstName: player.firstName,
          lastName: player.lastName,
          position: player.position,
          usageRate: player.usageRate,
          isActive: player.isActive,
          teamId: player.teamAbbr ? teamMap.get(player.teamAbbr) ?? null : null,
        })),
        skipDuplicates: true,
      });
    }
  }

  await runInBatches(playersNeedingUpdate, UPSERT_PLAYER_BATCH, async (player) => {
    await prisma.player.update({
      where: { externalId: player.externalPlayerId },
      data: {
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        usageRate: player.usageRate,
        isActive: player.isActive,
        teamId: player.teamAbbr ? teamMap.get(player.teamAbbr) ?? null : null,
      },
    });
  });

  const savedPlayers =
    missingPlayers.length === 0
      ? existingPlayers
      : await prisma.player.findMany({
          where: { externalId: { in: externalIds } },
          select: { id: true, externalId: true },
        });

  return new Map(
    savedPlayers
      .filter((player): player is typeof player & { externalId: string } => player.externalId != null)
      .map((player) => [player.externalId, player.id]),
  );
}

async function upsertGames(games: NormalizedGame[], teamMap: Map<string, string>): Promise<void> {
  if (games.length === 0) {
    return;
  }

  const existingGames = await prisma.game.findMany({
    where: { externalId: { in: games.map((game) => game.externalGameId) } },
    select: {
      externalId: true,
      gameDateEt: true,
      season: true,
      status: true,
      commenceTimeUtc: true,
      homeTeamId: true,
      awayTeamId: true,
    },
  });
  const existingByExternalId = new Map(existingGames.map((game) => [game.externalId, game]));

  await runInBatches(games, UPSERT_GAME_BATCH, async (game) => {
    const homeTeamId = teamMap.get(game.homeTeamAbbr);
    const awayTeamId = teamMap.get(game.awayTeamAbbr);
    if (!homeTeamId || !awayTeamId) {
      return;
    }

    const existing = existingByExternalId.get(game.externalGameId);
    const nextCommenceTimeMs = game.commenceTimeUtc?.getTime() ?? null;

    if (existing) {
      const existingCommenceTimeMs = existing.commenceTimeUtc?.getTime() ?? null;
      const isUnchanged =
        existing.gameDateEt === game.gameDateEt &&
        existing.season === game.season &&
        existing.status === game.status &&
        existingCommenceTimeMs === nextCommenceTimeMs &&
        existing.homeTeamId === homeTeamId &&
        existing.awayTeamId === awayTeamId;

      if (isUnchanged) {
        return;
      }

      await prisma.game.update({
        where: { externalId: game.externalGameId },
        data: {
          gameDateEt: game.gameDateEt,
          season: game.season,
          status: game.status,
          commenceTimeUtc: game.commenceTimeUtc,
          homeTeamId,
          awayTeamId,
        },
      });
      return;
    }

    await prisma.game.create({
      data: {
        externalId: game.externalGameId,
        gameDateEt: game.gameDateEt,
        season: game.season,
        status: game.status,
        commenceTimeUtc: game.commenceTimeUtc,
        homeTeamId,
        awayTeamId,
      },
    });
  });
}

async function upsertPlayerLogs(
  logs: NormalizedPlayerGameStat[],
  playerMap: Map<string, string>,
  teamMap: Map<string, string>,
): Promise<number> {
  if (logs.length === 0 || playerMap.size === 0) {
    return 0;
  }

  const preparedLogs = logs.flatMap((log) => {
    const playerId = playerMap.get(log.externalPlayerId);
    if (!playerId) {
      return [];
    }

    const externalGameId = log.externalGameId ?? `${log.gameDateEt}:${log.externalPlayerId}:${log.opponentAbbr ?? "UNK"}`;
    return [
      {
        key: `${playerId}:${externalGameId}`,
        playerId,
        externalGameId,
        gameDateEt: log.gameDateEt,
        teamId: log.teamAbbr ? teamMap.get(log.teamAbbr) ?? null : null,
        opponentTeamId: log.opponentAbbr ? teamMap.get(log.opponentAbbr) ?? null : null,
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
    ];
  });

  if (preparedLogs.length === 0) {
    return 0;
  }

  const playerIds = Array.from(new Set(preparedLogs.map((log) => log.playerId)));
  const externalGameIds = Array.from(new Set(preparedLogs.map((log) => log.externalGameId)));
  const existingLogs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      externalGameId: { in: externalGameIds },
    },
    select: {
      id: true,
      playerId: true,
      externalGameId: true,
      gameDateEt: true,
      teamId: true,
      opponentTeamId: true,
      isHome: true,
      starter: true,
      played: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
      steals: true,
      blocks: true,
      turnovers: true,
      pace: true,
      total: true,
    },
  });
  const existingByKey = new Map(existingLogs.map((log) => [`${log.playerId}:${log.externalGameId}`, log]));

  const missingLogs = preparedLogs.filter((log) => !existingByKey.has(log.key));
  const logsNeedingUpdate = preparedLogs.filter((log) => {
    const existing = existingByKey.get(log.key);
    if (!existing) {
      return false;
    }
    return (
      existing.gameDateEt !== log.gameDateEt ||
      existing.teamId !== log.teamId ||
      existing.opponentTeamId !== log.opponentTeamId ||
      existing.isHome !== log.isHome ||
      existing.starter !== log.starter ||
      existing.played !== log.played ||
      existing.minutes !== log.minutes ||
      existing.points !== log.points ||
      existing.rebounds !== log.rebounds ||
      existing.assists !== log.assists ||
      existing.threes !== log.threes ||
      existing.steals !== log.steals ||
      existing.blocks !== log.blocks ||
      existing.turnovers !== log.turnovers ||
      existing.pace !== log.pace ||
      existing.total !== log.total
    );
  });

  if (missingLogs.length > 0) {
    for (let index = 0; index < missingLogs.length; index += UPSERT_LOG_BATCH) {
      const batch = missingLogs.slice(index, index + UPSERT_LOG_BATCH);
      await prisma.playerGameLog.createMany({
        data: batch.map((log) => ({
          playerId: log.playerId,
          externalGameId: log.externalGameId,
          gameDateEt: log.gameDateEt,
          teamId: log.teamId,
          opponentTeamId: log.opponentTeamId,
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
        })),
        skipDuplicates: true,
      });
    }
  }

  await runInBatches(logsNeedingUpdate, UPSERT_LOG_BATCH, async (log) => {
    const existing = existingByKey.get(log.key);
    if (!existing) {
      return;
    }
    await prisma.playerGameLog.update({
      where: { id: existing.id },
      data: {
        gameDateEt: log.gameDateEt,
        teamId: log.teamId,
        opponentTeamId: log.opponentTeamId,
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
  });

  return missingLogs.length + logsNeedingUpdate.length;
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
  const todaysGames = schedule.filter((game) => game.gameDateEt === dateEt);
  if (mode === "FAST") {
    const games = dedupeGames(todaysGames);

    logger.info("NBA payload summary", {
      dateEt,
      refreshMode: mode,
      scheduleGames: schedule.length,
      todaysGames: todaysGames.length,
      windowGames: todaysGames.length,
      finalWindowGames: 0,
      players: 0,
      logs: 0,
    });

    return {
      games,
      players: [],
      logs: [],
      warnings,
    };
  }

  const { from, to } = collectDateWindow(mode, dateEt);
  const windowGames = schedule.filter((game) => game.gameDateEt >= from && game.gameDateEt <= to);
  const finalWindowGames = windowGames.filter((game) => game.statusNumber >= 3);
  const historicalCompletedGameIds = new Set(
    finalWindowGames.filter((game) => game.gameDateEt < dateEt).map((game) => game.externalGameId),
  );
  let reusableHistoricalGameIds = new Set<string>();

  if (mode === "DELTA" && DELTA_HISTORICAL_BOX_SCORE_REUSE_ENABLED && historicalCompletedGameIds.size > 0) {
    const historicalLoggedGames = await prisma.playerGameLog.findMany({
      where: {
        gameDateEt: { gte: from, lt: dateEt },
      },
      distinct: ["externalGameId"],
      select: { externalGameId: true },
    });

    reusableHistoricalGameIds = new Set(
      historicalLoggedGames
        .map((log) => log.externalGameId)
        .filter((externalGameId): externalGameId is string => historicalCompletedGameIds.has(externalGameId)),
    );
  }

  const boxScoreGames = finalWindowGames.filter(
    (game) => game.gameDateEt === dateEt || !reusableHistoricalGameIds.has(game.externalGameId),
  );
  const reusedHistoricalLogsFromDb =
    reusableHistoricalGameIds.size > 0
      ? await prisma.playerGameLog.findMany({
          where: { externalGameId: { in: Array.from(reusableHistoricalGameIds) } },
          select: {
            externalGameId: true,
            gameDateEt: true,
            isHome: true,
            starter: true,
            played: true,
            minutes: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
            steals: true,
            blocks: true,
            turnovers: true,
            pace: true,
            total: true,
            player: {
              select: {
                externalId: true,
                fullName: true,
                firstName: true,
                lastName: true,
                position: true,
                usageRate: true,
                isActive: true,
                team: {
                  select: {
                    abbreviation: true,
                  },
                },
              },
            },
            team: {
              select: {
                abbreviation: true,
              },
            },
            opponentTeam: {
              select: {
                abbreviation: true,
              },
            },
          },
        })
      : [];

  const players: NormalizedPlayerSeason[] = [];
  const logs: NormalizedPlayerGameStat[] = [];

  reusedHistoricalLogsFromDb.forEach((log) => {
    if (!log.player.externalId) {
      return;
    }

    players.push({
      externalPlayerId: log.player.externalId,
      fullName: log.player.fullName,
      firstName: log.player.firstName,
      lastName: log.player.lastName,
      teamAbbr: log.player.team?.abbreviation ?? log.team?.abbreviation ?? null,
      position: log.player.position,
      usageRate: log.player.usageRate,
      isActive: log.player.isActive,
    });

    logs.push({
      externalPlayerId: log.player.externalId,
      externalGameId: log.externalGameId,
      gameDateEt: log.gameDateEt,
      fullName: log.player.fullName,
      firstName: log.player.firstName,
      lastName: log.player.lastName,
      position: log.player.position,
      teamAbbr: log.team?.abbreviation ?? null,
      opponentAbbr: log.opponentTeam?.abbreviation ?? null,
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
    });
  });

  const boxScores = await mapWithConcurrency(boxScoreGames, BOX_SCORE_CONCURRENCY, async (game) => {
    try {
      const payload = await client.fetchGameBoxScore(game);
      return { game, payload, error: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return { game, payload: null, error: message };
    }
  });

  boxScores.forEach(({ game, payload, error }) => {
    if (error || !payload) {
      warnings.push(`Box score unavailable for ${game.externalGameId} (${game.gameDateEt}): ${error ?? "unknown"}`);
      return;
    }
    players.push(...payload.players);
    logs.push(...payload.logs);
  });

  const mergedPlayers = mergePlayersFromLogs(players, logs);
  const games = dedupeGames([...todaysGames, ...windowGames]);

  logger.info("NBA payload summary", {
    dateEt,
    refreshMode: mode,
    windowFrom: from,
    windowTo: to,
    scheduleGames: schedule.length,
    todaysGames: todaysGames.length,
    windowGames: windowGames.length,
    finalWindowGames: finalWindowGames.length,
    fetchedBoxScoreGames: boxScoreGames.length,
    reusedHistoricalFinalGames: reusableHistoricalGameIds.size,
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

export async function runRefresh(mode: RefreshMode, options?: RunRefreshOptions): Promise<RefreshResult> {
  const startedAt = Date.now();
  const dateEt = getTodayEtDateString();
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const visitCooldownThreshold = new Date(Date.now() - VISIT_REFRESH_COOLDOWN_MS);
  const runType = mode === "FULL" ? "FULL" : "DELTA";
  const isLightweightRefresh = mode === "FAST";
  const source = options?.source ?? "manual";

  const [activeRun, latestRefreshSetting] = await Promise.all([
    prisma.refreshRun.findFirst({
      where: {
        status: "RUNNING",
        startedAt: { gte: staleThreshold },
      },
      orderBy: [{ startedAt: "desc" }],
      select: { id: true, totalGames: true, totalPlayers: true, startedAt: true },
    }),
    source === "visit"
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_last_refresh" },
          select: { value: true, updatedAt: true },
        })
      : Promise.resolve(null),
  ]);

  if (activeRun) {
    logger.info("Refresh skipped because another run is active", {
      activeRunId: activeRun.id,
      mode,
      source,
      startedAt: activeRun.startedAt.toISOString(),
    });
    return {
      runId: activeRun.id,
      status: "PARTIAL",
      warnings: ["Refresh already running. Please wait for completion."],
      isPublishable: false,
      qualityIssues: ["refresh_running"],
      totals: {
        games: activeRun.totalGames,
        players: activeRun.totalPlayers,
      },
    };
  }

  const recentVisitRefreshAt =
    source === "visit" &&
    latestRefreshSetting?.value &&
    typeof latestRefreshSetting.value === "object" &&
    (latestRefreshSetting.value as { dateEt?: unknown }).dateEt === dateEt
      ? latestRefreshSetting.updatedAt
      : null;

  if (source === "visit" && recentVisitRefreshAt != null && recentVisitRefreshAt >= visitCooldownThreshold) {
    logger.info("Visit refresh skipped because slate was refreshed recently", {
      mode,
      source,
      refreshedAt: recentVisitRefreshAt.toISOString(),
    });
    return {
      runId: `recent:${dateEt}`,
      status: "PARTIAL",
      warnings: ["Refresh completed recently. Loading the latest board instead."],
      isPublishable: false,
      qualityIssues: ["recent_refresh"],
      totals: {
        games: 0,
        players: 0,
      },
    };
  }

  await prisma.refreshRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleThreshold },
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
      type: runType,
      status: "RUNNING",
      notes: {
        dateEt,
        source: "nba_official",
        qualityGateEnabled: QUALITY_GATE_ENABLED,
        requestedMode: mode,
        requestedBy: source,
      },
    },
    select: { id: true },
  });

  const warnings: string[] = [];

  try {
    let lineupMeta: { teamCount: number; source: string } | null = null;
    const [fetchedResult, lineupResult] = await Promise.allSettled([
      fetchData(mode, dateEt),
      storeLineupsSnapshot(dateEt, { allowFreshReuse: isLightweightRefresh }),
    ]);
    if (fetchedResult.status === "rejected") {
      throw fetchedResult.reason;
    }
    const fetched = fetchedResult.value;
    warnings.push(...fetched.warnings);

    if (lineupResult.status === "fulfilled") {
      lineupMeta = lineupResult.value;
    } else {
      warnings.push(
        `Lineup feed unavailable: ${lineupResult.reason instanceof Error ? lineupResult.reason.message : "unknown lineup fetch error"}`,
      );
    }

    const teamMap = await upsertTeams(fetched.games, fetched.players, fetched.logs);
    const [playerMap] = await Promise.all([
      upsertPlayers(fetched.players, teamMap),
      upsertGames(fetched.games, teamMap),
    ]);
    if (fetched.logs.length > 0) {
      await upsertPlayerLogs(fetched.logs, playerMap, teamMap);
    }

    const qualityIssues = isLightweightRefresh
      ? []
      : evaluateQualityInput({
          logs: fetched.logs,
          games: fetched.games,
        });
    const qualityPass = qualityIssues.length === 0;
    const isPublishable = isLightweightRefresh ? true : QUALITY_GATE_ENABLED ? qualityPass : true;

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
        notes: {
          dateEt,
          warnings,
          source: "nba_official",
          qualityGateEnabled: QUALITY_GATE_ENABLED,
          lineupMeta,
          requestedMode: mode,
          requestedBy: source,
        },
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
          lineupMeta,
          requestedMode: mode,
          requestedBy: source,
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
          lineupMeta,
          requestedMode: mode,
          requestedBy: source,
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
            lineupMeta,
            requestedMode: mode,
            requestedBy: source,
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
            lineupMeta,
            requestedMode: mode,
            requestedBy: source,
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
        notes: {
          dateEt,
          warnings,
          source: "nba_official",
          qualityGateEnabled: QUALITY_GATE_ENABLED,
          requestedMode: mode,
          requestedBy: source,
        },
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
