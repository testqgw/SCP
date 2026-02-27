
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/auth/guard";
import { ALL_MARKETS, isLineReasonableForMarket, marketValueFromLog } from "@/lib/snapshot/markets";
import {
  buildArchetypeKey,
  computeBounceBack,
  computeHitRate,
  computeInjuryContext,
  computeLineValueScores,
  computeMinutesTrend,
  computeOpponentAllowanceScore,
  computePaceTotal,
} from "@/lib/snapshot/metrics";
import { scoreEdge } from "@/lib/snapshot/scoring";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "@/lib/snapshot/time";
import { logger } from "@/lib/snapshot/log";
import { SportsDataClient } from "@/lib/sportsdata/client";
import {
  normalizeActiveSportsbooks,
  normalizeBettingEvents,
  normalizeBettingMetadata,
  normalizeBettingPlayerProps,
  normalizeBoxScorePlayerLogs,
  normalizeGames,
  normalizeInjuries,
  normalizeLegacyPlayerPropsByDate,
  normalizeSeasonPlayers,
} from "@/lib/sportsdata/normalize";
import type {
  NormalizedPlayerGameStat,
  NormalizedPlayerProp,
  NormalizedPlayerSeason,
  NormalizedSportsbook,
} from "@/lib/sportsdata/types";
import { clamp, round, toStringOrNull } from "@/lib/utils";

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
    lines: number;
    edges: number;
  };
};

type GameTeamProviders = {
  homeTeamProvider: string | null;
  awayTeamProvider: string | null;
};

const QUALITY_GATE_ENABLED = process.env.SNAPSHOT_QUALITY_GATE_ENABLED !== "false";
const ALLOW_LEGACY_PUBLISH = process.env.SNAPSHOT_ALLOW_LEGACY_PUBLISH !== "false";

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

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function buildProviderGameTeams(rawGames: unknown[]): Map<string, GameTeamProviders> {
  const map = new Map<string, GameTeamProviders>();

  rawGames.forEach((item) => {
    const row = asRecord(item);
    if (!row) return;
    const gameId = toStringOrNull(row.GameID ?? row.GameId ?? row.gameId);
    if (!gameId) return;
    const homeTeamProvider = toStringOrNull(row.HomeTeam ?? row.homeTeam);
    const awayTeamProvider = toStringOrNull(row.AwayTeam ?? row.awayTeam);
    map.set(gameId, { homeTeamProvider, awayTeamProvider });
  });

  return map;
}

async function ensureSportsbooks(providerBooks: NormalizedSportsbook[], props: NormalizedPlayerProp[]): Promise<Map<string, string>> {
  const known = new Map<string, NormalizedSportsbook>();
  providerBooks.forEach((book) => {
    known.set(book.key, book);
  });
  props.forEach((prop) => {
    if (!known.has(prop.sportsbookKey)) {
      known.set(prop.sportsbookKey, {
        key: prop.sportsbookKey,
        displayName: prop.sportsbookDisplayName,
        providerSportsbookId: prop.providerSportsbookId,
        providerNameRaw: prop.sportsbookDisplayName,
      });
    }
  });

  const result = new Map<string, string>();
  for (const book of known.values()) {
    const saved = await prisma.sportsbook.upsert({
      where: { code: book.key },
      update: {
        displayName: book.displayName,
        providerSportsbookId: book.providerSportsbookId,
        providerNameRaw: book.providerNameRaw,
        isActive: true,
      },
      create: {
        code: book.key,
        displayName: book.displayName,
        providerSportsbookId: book.providerSportsbookId,
        providerNameRaw: book.providerNameRaw,
        isActive: true,
      },
      select: { id: true, code: true },
    });
    result.set(saved.code, saved.id);
  }
  return result;
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
  const map = new Map<string, string>();

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
      map.set(saved.externalId, saved.id);
    }
  }

  return map;
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

async function insertPropSnapshots(
  props: NormalizedPlayerProp[],
  playerMap: Map<string, string>,
  gameMap: Map<string, string>,
  sportsbookMap: Map<string, string>,
): Promise<number> {
  const payload: Prisma.PropLineSnapshotCreateManyInput[] = [];
  let rejectedCount = 0;

  props.forEach((prop) => {
    const playerId = playerMap.get(prop.externalPlayerId);
    const gameId = gameMap.get(prop.externalGameId);
    const sportsbookId = sportsbookMap.get(prop.sportsbookKey);
    if (!playerId || !gameId || !sportsbookId) {
      return;
    }

    // Sanity check: reject lines outside expected ranges for the market, unless from the legacy feed (which scrambles values)
    const isLegacy = prop.sourceFeed.includes("LEGACY");
    if (!isLegacy && !isLineReasonableForMarket(prop.market, prop.line)) {
      rejectedCount += 1;
      return;
    }

    payload.push({
      gameId,
      playerId,
      sportsbookId,
      market: prop.market,
      rawMarketName: prop.rawMarketName,
      line: prop.line,
      overPrice: prop.overPrice,
      underPrice: prop.underPrice,
      providerMarketId: prop.providerMarketId,
      providerBetTypeId: prop.providerBetTypeId,
      providerPeriodTypeId: prop.providerPeriodTypeId,
      providerOutcomeType: prop.providerOutcomeType,
      teamCodeProvider: prop.teamCodeProvider,
      opponentCodeProvider: prop.opponentCodeProvider,
      teamCodeCanonical: prop.teamCodeCanonical,
      opponentCodeCanonical: prop.opponentCodeCanonical,
      sourceFeed: prop.sourceFeed,
      capturedAt: prop.capturedAt,
    });
  });

  if (rejectedCount > 0) {
    logger.warn("Line sanity check rejected rows", {
      rejected: rejectedCount,
      accepted: payload.length,
      sampleRejected: props
        .filter((p) => !isLineReasonableForMarket(p.market, p.line))
        .slice(0, 3)
        .map((p) => ({ market: p.market, line: p.line, player: p.externalPlayerId })),
    });
  }

  if (!payload.length) {
    return 0;
  }

  const inserted = await prisma.propLineSnapshot.createMany({ data: payload });
  return inserted.count;
}

type FetchDataResult = {
  games: ReturnType<typeof normalizeGames>;
  props: NormalizedPlayerProp[];
  players: NormalizedPlayerSeason[];
  logs: NormalizedPlayerGameStat[];
  sportsbooks: NormalizedSportsbook[];
  injuriesByTeam: Map<string, string[]>;
  warnings: string[];
};
async function fetchData(mode: RefreshMode, dateEt: string): Promise<FetchDataResult> {
  const client = new SportsDataClient();
  const warnings: string[] = [];
  const season = inferSeasonFromEtDate(dateEt);

  const [rawGames, rawSeasonPlayers, rawInjuries, rawSportsbooks, rawMetadata, rawEvents] = await Promise.all([
    client.fetchSchedule(dateEt),
    client.fetchSeasonStats(season).catch((error) => {
      warnings.push(`Season stats unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
    client.fetchInjuries().catch((error) => {
      warnings.push(`Injury feed unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
    client.fetchActiveSportsbooks().catch((error) => {
      warnings.push(`Active sportsbooks unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
    client.fetchBettingMetadata().catch((error) => {
      warnings.push(`Betting metadata unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return {};
    }),
    client.fetchBettingEventsByDate(dateEt).catch((error) => {
      warnings.push(`Betting events unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return [];
    }),
  ]);

  const games = normalizeGames(rawGames);
  const sportsbooks = normalizeActiveSportsbooks(rawSportsbooks);
  const metadata = normalizeBettingMetadata(rawMetadata);
  const events = normalizeBettingEvents(rawEvents);
  const gameProviderMap = buildProviderGameTeams(rawGames);
  const eventGameIds = new Set(events.map((event) => event.gameId));

  const rawPropsByGame: unknown[] = [];
  let primaryGamesAttempted = 0;
  let primaryGamesSucceeded = 0;
  for (const game of games) {
    if (eventGameIds.size > 0 && !eventGameIds.has(game.externalGameId)) {
      continue;
    }
    primaryGamesAttempted += 1;
    try {
      const rows = await client.fetchBettingPlayerPropsByGameId(game.externalGameId);
      const providers = gameProviderMap.get(game.externalGameId) ?? { homeTeamProvider: null, awayTeamProvider: null };
      const normalized = normalizeBettingPlayerProps(rows, {
        metadata,
        externalGameId: game.externalGameId,
        capturedAt: new Date(),
        homeTeamProvider: providers.homeTeamProvider,
        awayTeamProvider: providers.awayTeamProvider,
      });
      if (normalized.length > 0) {
        primaryGamesSucceeded += 1;
      }
      rawPropsByGame.push(...normalized);
    } catch (error) {
      warnings.push(
        `Betting player props unavailable for game ${game.externalGameId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  let props = rawPropsByGame as NormalizedPlayerProp[];
  if (props.length === 0) {
    logger.warn("Primary BettingPlayerPropsByGameID produced no data", {
      gamesAttempted: primaryGamesAttempted,
      gamesSucceeded: primaryGamesSucceeded,
      totalGames: games.length,
      eventGameIds: eventGameIds.size,
    });
    try {
      const legacyRows = await client.fetchLegacyPlayerPropsByDate(dateEt);
      logger.info("Legacy PlayerPropsByDate response", {
        rowCount: legacyRows.length,
      });
      const legacyProps = normalizeLegacyPlayerPropsByDate(legacyRows, new Date());
      if (legacyProps.length > 0) {
        props = legacyProps;
        warnings.push(`Using legacy PlayerPropsByDate fallback feed (${legacyRows.length} raw rows → ${legacyProps.length} props).`);
      }
    } catch (error) {
      warnings.push(`Legacy player props unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    }
  } else {
    logger.info("Primary endpoint produced props", {
      totalProps: props.length,
      gamesAttempted: primaryGamesAttempted,
      gamesSucceeded: primaryGamesSucceeded,
    });
  }

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
    normalizedProps: props.length,
    rawSeasonPlayers: rawSeasonPlayers.length,
    normalizedPlayers: players.length,
    rawBoxScores: rawLogs.length,
    normalizedLogs: logs.length,
    sportsbooks: sportsbooks.length,
    events: events.length,
  });

  if (props.length === 0) {
    warnings.push("No normalized sportsbook props for current slate.");
  }

  const injuriesByTeam = injuries.reduce((map, injury) => {
    if (!injury.teamAbbr) return map;
    const existing = map.get(injury.teamAbbr) ?? [];
    existing.push(injury.status);
    map.set(injury.teamAbbr, existing);
    return map;
  }, new Map<string, string[]>());

  return {
    games,
    props,
    players,
    logs,
    sportsbooks,
    injuriesByTeam,
    warnings,
  };
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function pushLimited(map: Map<string, number[]>, key: string, value: number, limit: number): void {
  const list = map.get(key) ?? [];
  if (list.length < limit) {
    list.push(value);
  }
  map.set(key, list);
}

function confidenceForApi(confidence: "A" | "B" | "C" | "LOW"): "A" | "B" | "C" | "LOW" {
  return confidence;
}

function evaluateQualityInput(data: {
  props: NormalizedPlayerProp[];
  logs: NormalizedPlayerGameStat[];
  edges: number;
}): string[] {
  const issues: string[] = [];
  if (data.props.length === 0) {
    issues.push("No parsed sportsbook props were produced.");
    return issues;
  }

  const sourceSet = new Set(data.props.map((prop) => prop.sourceFeed));
  const isLegacyOnly = sourceSet.size === 1 && sourceSet.has("PLAYER_PROPS_BY_DATE_LEGACY");

  if (!isLegacyOnly) {
    const uniqueBooks = new Set(data.props.map((prop) => prop.sportsbookKey));
    if (uniqueBooks.size < 2) {
      issues.push(`Only ${uniqueBooks.size} sportsbook(s) detected for today's props.`);
    }

    const allScrambledNames = data.props.every((prop) => prop.sportsbookDisplayName.toLowerCase().includes("scrambled"));
    if (allScrambledNames) {
      issues.push("All sportsbook names appear scrambled from provider feed.");
    }

    const reasonableCount = data.props.filter((prop) => isLineReasonableForMarket(prop.market, prop.line)).length;
    const reasonableRatio = reasonableCount / Math.max(data.props.length, 1);
    if (reasonableRatio < 0.8) {
      issues.push(`Line sanity check failed (${round(reasonableRatio * 100, 1)}% within expected range).`);
    }
  } else if (!ALLOW_LEGACY_PUBLISH) {
    issues.push("Legacy props fallback is disabled.");
  }

  const completedLogs = data.logs.filter((log) => (log.minutes ?? 0) > 0);
  if (completedLogs.length < 120) {
    issues.push(`Insufficient completed player logs (${completedLogs.length}) for stable metrics.`);
  }

  if (data.edges === 0) {
    issues.push("No edge rows were generated.");
  }

  return issues;
}
async function scoreAndPersistEdges(
  runId: string,
  dateEt: string,
  capturedAfter: Date,
  injuriesByTeam: Map<string, string[]>,
): Promise<{ edges: number }> {
  const latestLines = await prisma.propLineSnapshot.findMany({
    where: {
      game: { gameDateEt: dateEt },
      capturedAt: { gte: capturedAfter },
    },
    orderBy: [{ capturedAt: "desc" }],
    distinct: ["gameId", "playerId", "sportsbookId", "market"],
    select: {
      id: true,
      gameId: true,
      playerId: true,
      sportsbookId: true,
      market: true,
      line: true,
      overPrice: true,
      underPrice: true,
      sourceFeed: true,
      capturedAt: true,
    },
  });

  if (!latestLines.length) {
    return { edges: 0 };
  }

  const lineGroup = new Map<string, typeof latestLines>();
  latestLines.forEach((line) => {
    const key = `${line.gameId}|${line.playerId}|${line.market}`;
    const list = lineGroup.get(key) ?? [];
    list.push(line);
    lineGroup.set(key, list);
  });

  const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 30);
  const history = await prisma.propLineSnapshot.findMany({
    where: {
      game: { gameDateEt: dateEt },
      capturedAt: { gte: twoDaysAgo },
    },
    orderBy: [{ capturedAt: "asc" }],
    select: {
      gameId: true,
      playerId: true,
      sportsbookId: true,
      market: true,
      line: true,
      capturedAt: true,
    },
  });

  const historyMap = new Map<string, Array<{ line: number; capturedAt: Date }>>();
  history.forEach((entry) => {
    const key = `${entry.gameId}|${entry.playerId}|${entry.sportsbookId}|${entry.market}`;
    const list = historyMap.get(key) ?? [];
    list.push({ line: entry.line, capturedAt: entry.capturedAt });
    historyMap.set(key, list);
  });

  const [players, games] = await Promise.all([
    prisma.player.findMany({ select: { id: true, position: true, usageRate: true, teamId: true } }),
    prisma.game.findMany({
      where: { id: { in: Array.from(new Set(latestLines.map((line) => line.gameId))) } },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { abbreviation: true } },
        awayTeam: { select: { abbreviation: true } },
      },
    }),
  ]);

  const playerMap = new Map(players.map((player) => [player.id, player]));
  const gameMap = new Map(games.map((game) => [game.id, game]));
  const playerIds = Array.from(new Set(latestLines.map((line) => line.playerId)));

  const playerLogs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      minutes: { gt: 0 },
    },
    orderBy: [{ gameDateEt: "desc" }],
    take: 6000,
  });

  const logsByPlayer = new Map<string, (typeof playerLogs)[number][]>();
  playerLogs.forEach((log) => {
    const list = logsByPlayer.get(log.playerId) ?? [];
    list.push(log);
    logsByPlayer.set(log.playerId, list);
  });

  const allowanceLogs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: { gte: etDateShift(dateEt, -45) },
      minutes: { gt: 0 },
      opponentTeamId: { not: null },
    },
    orderBy: [{ gameDateEt: "desc" }],
    take: 20000,
    select: {
      playerId: true,
      opponentTeamId: true,
      gameDateEt: true,
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
      steals: true,
      blocks: true,
      turnovers: true,
      minutes: true,
      pace: true,
      total: true,
    },
  });

  const missingPlayers = Array.from(new Set(allowanceLogs.map((entry) => entry.playerId))).filter(
    (playerId) => !playerMap.has(playerId),
  );
  if (missingPlayers.length) {
    const extraPlayers = await prisma.player.findMany({
      where: { id: { in: missingPlayers } },
      select: { id: true, position: true, usageRate: true, teamId: true },
    });
    extraPlayers.forEach((player) => {
      playerMap.set(player.id, player);
    });
  }

  const archetypeByPlayer = new Map<string, string>();
  playerMap.forEach((player, playerId) => {
    archetypeByPlayer.set(playerId, buildArchetypeKey(player));
  });

  const leagueArchetypeMarket = new Map<string, number[]>();
  const opponentArchetypeMarket = new Map<string, number[]>();
  allowanceLogs.forEach((log) => {
    const archetype = archetypeByPlayer.get(log.playerId);
    if (!archetype || !log.opponentTeamId) return;

    ALL_MARKETS.forEach((market) => {
      const value = marketValueFromLog(market, {
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
      });
      if (value == null) return;

      pushLimited(leagueArchetypeMarket, `${archetype}|${market}`, value, 250);
      pushLimited(opponentArchetypeMarket, `${log.opponentTeamId}|${archetype}|${market}`, value, 10);
    });
  });

  const metricsRows: Prisma.PlayerMarketMetricCreateManyInput[] = [];
  const edgeRows: Prisma.EdgeSnapshotCreateManyInput[] = [];
  const dayAgo = new Date(Date.now() - 1000 * 60 * 60 * 24);
  for (const line of latestLines) {
    const player = playerMap.get(line.playerId);
    const game = gameMap.get(line.gameId);
    if (!player || !game) {
      continue;
    }

    const playerLogList = (logsByPlayer.get(line.playerId) ?? []).sort((a, b) => b.gameDateEt.localeCompare(a.gameDateEt));
    const last5Logs = playerLogList.slice(0, 5);
    const seasonLogs = playerLogList.slice(0, 82);
    const lastGame = playerLogList[0] ?? null;

    const last5OverRate = computeHitRate(last5Logs, line.market, line.line, "OVER");
    const last5UnderRate = computeHitRate(last5Logs, line.market, line.line, "UNDER");
    const seasonOverRate = computeHitRate(seasonLogs, line.market, line.line, "OVER");
    const seasonUnderRate = computeHitRate(seasonLogs, line.market, line.line, "UNDER");
    const { bounceBackFlag, bounceBackScore } = computeBounceBack(lastGame, line.market, line.line);
    const archetypeKey = buildArchetypeKey(player);

    const opponentTeamId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
    const oppValues = opponentArchetypeMarket.get(`${opponentTeamId}|${archetypeKey}|${line.market}`) ?? [];
    const leagueValues = leagueArchetypeMarket.get(`${archetypeKey}|${line.market}`) ?? [];
    const opponentAverage = average(oppValues);
    const leagueAverage = average(leagueValues);
    const opponentAllowanceDelta = round((opponentAverage ?? 0) - (leagueAverage ?? 0), 3);
    const opponentAllowanceScores = computeOpponentAllowanceScore(opponentAllowanceDelta, line.line);

    const siblingLines = lineGroup.get(`${line.gameId}|${line.playerId}|${line.market}`) ?? [line];
    const consensusLine = average(siblingLines.map((entry) => entry.line)) ?? line.line;
    const lineValue = computeLineValueScores(line.line, consensusLine, line.overPrice, line.underPrice);

    const minutesTrendScore = computeMinutesTrend(last5Logs);
    const paceTotalScore = computePaceTotal(last5Logs);

    const opponentAbbreviation =
      opponentTeamId === game.homeTeamId ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
    const injuryStatuses = injuriesByTeam.get(opponentAbbreviation) ?? [];
    const injuryContextScore = computeInjuryContext(injuryStatuses);

    const overRecentForm = round(last5OverRate * 100, 2);
    const underRecentForm = round(last5UnderRate * 100, 2);
    const overSeasonScore = round(seasonOverRate * 100, 2);
    const underSeasonScore = round(seasonUnderRate * 100, 2);

    const edge = scoreEdge({
      recentFormOver: overRecentForm,
      recentFormUnder: underRecentForm,
      opponentOver: opponentAllowanceScores.overScore,
      opponentUnder: opponentAllowanceScores.underScore,
      seasonOver: overSeasonScore,
      seasonUnder: underSeasonScore,
      bounceOver: bounceBackScore,
      bounceUnder: clamp(100 - bounceBackScore, 0, 100),
      minutesTrend: minutesTrendScore,
      paceTotal: paceTotalScore,
      lineValueOver: lineValue.overScore,
      lineValueUnder: lineValue.underScore,
    });

    const historyKey = `${line.gameId}|${line.playerId}|${line.sportsbookId}|${line.market}`;
    const historicalPoints = historyMap.get(historyKey) ?? [];
    let baseline24h = historicalPoints[0]?.line ?? line.line;
    for (let index = historicalPoints.length - 1; index >= 0; index -= 1) {
      if (historicalPoints[index].capturedAt <= dayAgo) {
        baseline24h = historicalPoints[index].line;
        break;
      }
    }
    const lineMove24h = round(line.line - baseline24h, 3);

    metricsRows.push({
      refreshRunId: runId,
      playerId: line.playerId,
      gameId: line.gameId,
      sportsbookId: line.sportsbookId,
      market: line.market,
      line: line.line,
      last5OverRate: round(last5OverRate, 4),
      last5UnderRate: round(last5UnderRate, 4),
      seasonOverRate: round(seasonOverRate, 4),
      seasonUnderRate: round(seasonUnderRate, 4),
      bounceBackFlag,
      bounceBackScore,
      archetypeKey,
      opponentAllowanceDelta,
      lineValueScore: edge.recommendedSide === "OVER" ? lineValue.overScore : lineValue.underScore,
      minutesTrendScore,
      paceTotalScore,
      injuryContextScore,
      recentFormScore: edge.recommendedSide === "OVER" ? overRecentForm : underRecentForm,
      seasonVsLineScore: edge.recommendedSide === "OVER" ? overSeasonScore : underSeasonScore,
      updatedAt: new Date(),
    });

    edgeRows.push({
      refreshRunId: runId,
      playerId: line.playerId,
      gameId: line.gameId,
      sportsbookId: line.sportsbookId,
      market: line.market,
      line: line.line,
      overPrice: line.overPrice,
      underPrice: line.underPrice,
      recommendedSide: edge.recommendedSide,
      overEdgeScore: edge.overEdgeScore,
      underEdgeScore: edge.underEdgeScore,
      edgeScore: edge.edgeScore,
      confidence: confidenceForApi(edge.confidence),
      last5OverRate: round(last5OverRate, 4),
      bounceBackFlag,
      opponentAllowanceDelta,
      archetypeKey,
      lineMove24h,
      dataSource: line.sourceFeed,
      componentScores: {
        recentFormOver: overRecentForm,
        recentFormUnder: underRecentForm,
        opponentOver: opponentAllowanceScores.overScore,
        opponentUnder: opponentAllowanceScores.underScore,
        seasonOver: overSeasonScore,
        seasonUnder: underSeasonScore,
        bounceOver: bounceBackScore,
        bounceUnder: clamp(100 - bounceBackScore, 0, 100),
        minutesTrend: minutesTrendScore,
        paceTotal: paceTotalScore,
        lineValueOver: lineValue.overScore,
        lineValueUnder: lineValue.underScore,
        injuryContext: injuryContextScore,
      },
      updatedAt: new Date(),
    });
  }

  if (metricsRows.length) {
    await prisma.playerMarketMetric.createMany({ data: metricsRows, skipDuplicates: true });
  }
  if (edgeRows.length) {
    await prisma.edgeSnapshot.createMany({ data: edgeRows, skipDuplicates: true });
  }

  logger.info("Scoring complete", {
    runId,
    lines: latestLines.length,
    metrics: metricsRows.length,
    edges: edgeRows.length,
  });

  return { edges: edgeRows.length };
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

    const sportsbookMap = await ensureSportsbooks(fetched.sportsbooks, fetched.props);
    const teamMap = await upsertTeams(fetched.games, fetched.players, fetched.logs);
    const playerMap = await upsertPlayers(fetched.players, teamMap);
    const gameMap = await upsertGames(fetched.games, teamMap);
    await upsertPlayerLogs(fetched.logs, playerMap, teamMap);
    const lineCount = await insertPropSnapshots(fetched.props, playerMap, gameMap, sportsbookMap);
    const scored = await scoreAndPersistEdges(run.id, dateEt, runStartedAt, fetched.injuriesByTeam);

    const qualityIssues = evaluateQualityInput({
      props: fetched.props,
      logs: fetched.logs,
      edges: scored.edges,
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
        totalLines: lineCount,
        totalEdges: scored.edges,
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
        lines: lineCount,
        edges: scored.edges,
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

export async function pruneOldLineSnapshots(daysToKeep = 60): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const result = await prisma.propLineSnapshot.deleteMany({
    where: {
      capturedAt: { lt: cutoff },
    },
  });
  return result.count;
}

export function assertCronGuard(request: Request): void {
  const nextRequest = request as unknown as Parameters<typeof isCronAuthorized>[0];
  if (!isCronAuthorized(nextRequest)) {
    const error = new Error("Unauthorized cron request");
    error.name = "UnauthorizedError";
    throw error;
  }
}
