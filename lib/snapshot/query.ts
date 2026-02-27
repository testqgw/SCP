import type { Confidence as DbConfidence, Market as DbMarket, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_MARKETS, toCanonicalTeamCode } from "@/lib/snapshot/markets";
import { formatUtcToEt, getTodayEtDateString } from "@/lib/snapshot/time";
import type {
  SnapshotDetailResponse,
  SnapshotFiltersResponse,
  SnapshotRow,
  SnapshotTodayResponse,
  TodayFilter,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

type QualityContext = {
  qualityStatus: "OK" | "BLOCKED";
  qualityIssues: string[];
  publishableRunId: string | null;
  publishableCompletedAt: string | null;
};

function confidenceForResponse(value: DbConfidence): SnapshotRow["confidence"] | null {
  if (value === "LOW") {
    return null;
  }
  return value;
}

function mapDbMarket(value: DbMarket): SnapshotRow["market"] {
  return value;
}

function parseStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string");
}

async function getLatestPublishableRun(dateEt: string): Promise<{ id: string; completedAt: Date | null } | null> {
  const run = await prisma.refreshRun.findFirst({
    where: {
      isPublishable: true,
      edgeSnapshots: {
        some: {
          game: {
            gameDateEt: dateEt,
          },
        },
      },
    },
    orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
    select: { id: true, completedAt: true },
  });

  return run ?? null;
}

async function getQualityContext(dateEt: string): Promise<QualityContext> {
  const publishableRun = await getLatestPublishableRun(dateEt);
  if (publishableRun) {
    return {
      qualityStatus: "OK",
      qualityIssues: [],
      publishableRunId: publishableRun.id,
      publishableCompletedAt: publishableRun.completedAt?.toISOString() ?? null,
    };
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "snapshot_last_refresh" },
    select: { value: true },
  });
  const value = (setting?.value as Record<string, unknown> | undefined) ?? {};
  const runDate = typeof value.dateEt === "string" ? value.dateEt : null;
  const issues = parseStringArray(value.qualityIssues);
  const isPublishable = Boolean(value.isPublishable);

  if (runDate === dateEt && !isPublishable) {
    return {
      qualityStatus: "BLOCKED",
      qualityIssues: issues.length ? issues : ["Latest refresh failed quality checks."],
      publishableRunId: null,
      publishableCompletedAt: null,
    };
  }

  return {
    qualityStatus: "BLOCKED",
    qualityIssues: ["No publishable snapshot run for selected date."],
    publishableRunId: null,
    publishableCompletedAt: null,
  };
}

export async function getTodaySnapshot(filter: TodayFilter): Promise<SnapshotTodayResponse> {
  const quality = await getQualityContext(filter.dateEt);
  if (!quality.publishableRunId) {
    return {
      rows: [],
      total: 0,
      stale: true,
      lastUpdatedAt: null,
      qualityStatus: quality.qualityStatus,
      qualityIssues: quality.qualityIssues,
      publishableRunId: null,
    };
  }

  const canonicalTeam = filter.team ? toCanonicalTeamCode(filter.team) ?? filter.team.toUpperCase() : undefined;

  const whereClause: Prisma.EdgeSnapshotWhereInput = {
    refreshRunId: quality.publishableRunId,
    game: { gameDateEt: filter.dateEt },
    market: filter.market?.length ? { in: filter.market } : undefined,
    sportsbook: filter.book?.length ? { code: { in: filter.book } } : undefined,
    confidence: filter.includeLowConfidence
      ? undefined
      : {
          in: filter.confidence?.length ? filter.confidence : ["A", "B", "C"],
        },
    player: filter.player
      ? {
          fullName: {
            contains: filter.player,
            mode: "insensitive" as const,
          },
        }
      : undefined,
    OR: canonicalTeam
      ? [
          {
            game: {
              homeTeam: {
                abbreviation: canonicalTeam,
              },
            },
          },
          {
            game: {
              awayTeam: {
                abbreviation: canonicalTeam,
              },
            },
          },
        ]
      : undefined,
  };

  const [total, edges] = await Promise.all([
    prisma.edgeSnapshot.count({ where: whereClause }),
    prisma.edgeSnapshot.findMany({
      where: whereClause,
      orderBy: [{ edgeScore: "desc" }, { updatedAt: "desc" }],
      skip: filter.offset,
      take: filter.limit,
      include: {
        player: {
          include: {
            team: {
              select: {
                abbreviation: true,
              },
            },
          },
        },
        game: {
          include: {
            homeTeam: true,
            awayTeam: true,
          },
        },
        sportsbook: true,
      },
    }),
  ]);

  const rows: SnapshotRow[] = edges
    .map((edge) => {
      const confidence = confidenceForResponse(edge.confidence);
      if (!confidence) {
        return null;
      }

      const playerTeam = edge.player.team?.abbreviation ?? "UNK";
      const isHome = edge.game.homeTeam.abbreviation === playerTeam;
      const opponent = isHome ? edge.game.awayTeam.abbreviation : edge.game.homeTeam.abbreviation;

      return {
        edgeId: edge.id,
        playerId: edge.playerId,
        playerName: edge.player.fullName,
        team: playerTeam,
        opponent,
        teamCodeCanonical: playerTeam,
        opponentCodeCanonical: opponent,
        gameTimeEt: formatUtcToEt(edge.game.commenceTimeUtc),
        sportsbook: edge.sportsbook.code,
        sportsbookName: edge.sportsbook.displayName,
        market: mapDbMarket(edge.market),
        line: edge.line,
        overPrice: edge.overPrice,
        underPrice: edge.underPrice,
        recommendedSide: edge.recommendedSide,
        edgeScore: round(edge.edgeScore, 2),
        confidence,
        last5OverRate: round(edge.last5OverRate * 100, 2),
        bounceBackFlag: edge.bounceBackFlag,
        opponentAllowanceDelta: round(edge.opponentAllowanceDelta, 3),
        archetypeKey: edge.archetypeKey,
        lineMove24h: round(edge.lineMove24h, 3),
        dataSource: edge.dataSource ?? null,
        updatedAt: edge.updatedAt.toISOString(),
      };
    })
    .filter((row): row is SnapshotRow => row !== null);

  const latestUpdatedAt = rows[0]?.updatedAt ?? quality.publishableCompletedAt;
  const stale = latestUpdatedAt
    ? Date.now() - new Date(latestUpdatedAt).getTime() > STALE_THRESHOLD_MS
    : true;

  return {
    rows,
    total,
    stale,
    lastUpdatedAt: latestUpdatedAt,
    qualityStatus: quality.qualityStatus,
    qualityIssues: quality.qualityIssues,
    publishableRunId: quality.publishableRunId,
  };
}

export async function getPlayerSnapshotDetail(
  playerId: string,
  market?: SnapshotRow["market"],
  sportsbook?: SnapshotRow["sportsbook"],
): Promise<SnapshotDetailResponse | null> {
  const quality = await getQualityContext(getTodayEtDateString());
  if (!quality.publishableRunId) {
    return null;
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      team: true,
    },
  });
  if (!player) {
    return null;
  }

  const edges = await prisma.edgeSnapshot.findMany({
    where: {
      refreshRunId: quality.publishableRunId,
      playerId,
      market: market ? market : undefined,
      sportsbook: sportsbook ? { code: sportsbook } : undefined,
    },
    orderBy: [{ edgeScore: "desc" }],
    include: {
      sportsbook: true,
    },
  });

  const last10Logs = await prisma.playerGameLog.findMany({
    where: { playerId },
    orderBy: [{ gameDateEt: "desc" }],
    take: 10,
    include: {
      opponentTeam: true,
    },
  });

  const homeLogs = last10Logs.filter((log) => log.isHome === true);
  const awayLogs = last10Logs.filter((log) => log.isHome === false);

  const homeAvg = homeLogs.length
    ? homeLogs.reduce((sum, log) => sum + (log.points ?? 0), 0) / homeLogs.length
    : null;
  const awayAvg = awayLogs.length
    ? awayLogs.reduce((sum, log) => sum + (log.points ?? 0), 0) / awayLogs.length
    : null;

  return {
    playerId: player.id,
    playerName: player.fullName,
    position: player.position,
    team: player.team?.abbreviation ?? null,
    markets: edges.map((edge) => ({
      edgeId: edge.id,
      market: edge.market,
      sportsbook: edge.sportsbook.code,
      sportsbookName: edge.sportsbook.displayName,
      line: edge.line,
      recommendedSide: edge.recommendedSide,
      edgeScore: round(edge.edgeScore, 2),
      confidence: edge.confidence,
      componentScores: edge.componentScores as Record<string, number>,
      last5OverRate: round(edge.last5OverRate * 100, 2),
      bounceBackFlag: edge.bounceBackFlag,
      opponentAllowanceDelta: round(edge.opponentAllowanceDelta, 3),
      archetypeKey: edge.archetypeKey,
      lineMove24h: round(edge.lineMove24h, 3),
      updatedAt: edge.updatedAt.toISOString(),
    })),
    trends: {
      last10: last10Logs.map((log) => ({
        gameDateEt: log.gameDateEt,
        opponent: log.opponentTeam?.abbreviation ?? null,
        isHome: log.isHome,
        points: log.points,
        rebounds: log.rebounds,
        assists: log.assists,
        threes: log.threes,
        steals: log.steals,
        blocks: log.blocks,
        turnovers: log.turnovers,
        minutes: log.minutes,
      })),
      homeAwaySplit: {
        homeAveragePoints: homeAvg == null ? null : round(homeAvg, 2),
        awayAveragePoints: awayAvg == null ? null : round(awayAvg, 2),
        homeGames: homeLogs.length,
        awayGames: awayLogs.length,
      },
    },
  };
}

export async function getSnapshotFilters(dateEt: string): Promise<SnapshotFiltersResponse> {
  const quality = await getQualityContext(dateEt);

  const [games, books, teamRows] = await Promise.all([
    prisma.game.findMany({
      where: { gameDateEt: dateEt },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ commenceTimeUtc: "asc" }],
    }),
    prisma.sportsbook.findMany({
      where: quality.publishableRunId
        ? {
            edgeSnapshots: {
              some: {
                refreshRunId: quality.publishableRunId,
              },
            },
          }
        : { isActive: true },
      orderBy: [{ displayName: "asc" }],
      select: {
        code: true,
        displayName: true,
      },
    }),
    prisma.propLineSnapshot.findMany({
      where: {
        game: { gameDateEt: dateEt },
      },
      select: {
        teamCodeCanonical: true,
        teamCodeProvider: true,
      },
      distinct: ["teamCodeCanonical", "teamCodeProvider"],
    }),
  ]);

  const providerCodeByCanonical = new Map<string, string>();
  teamRows.forEach((row) => {
    if (row.teamCodeCanonical && row.teamCodeProvider) {
      providerCodeByCanonical.set(row.teamCodeCanonical, row.teamCodeProvider);
    }
  });

  const teams = games.flatMap((game) => {
    const gameLabelTime = formatUtcToEt(game.commenceTimeUtc);
    const home = game.homeTeam.abbreviation;
    const away = game.awayTeam.abbreviation;
    return [
      {
        code: home,
        providerCode: providerCodeByCanonical.get(home) ?? home,
        label: `${home} vs ${away} - ${gameLabelTime}`,
      },
      {
        code: away,
        providerCode: providerCodeByCanonical.get(away) ?? away,
        label: `${away} at ${home} - ${gameLabelTime}`,
      },
    ];
  });

  const dedupedTeams = Array.from(new Map(teams.map((team) => [team.code, team])).values());

  return {
    dateEt,
    teams: dedupedTeams,
    books: books.map((book) => ({ key: book.code, name: book.displayName })),
    markets: ALL_MARKETS,
    qualityStatus: quality.qualityStatus,
    qualityIssues: quality.qualityIssues,
    lastUpdatedAt: quality.publishableCompletedAt,
  };
}

export function parseTodayFilter(params: URLSearchParams): TodayFilter {
  const parseList = (key: string): string[] =>
    (params.get(key) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(params.get("offset") ?? 0), 0);

  const confidence = parseList("confidence").filter(
    (value): value is "A" | "B" | "C" => ["A", "B", "C"].includes(value),
  );

  const markets = parseList("market").filter((value): value is SnapshotRow["market"] =>
    ALL_MARKETS.includes(value as SnapshotRow["market"]),
  );
  const books = parseList("book");

  return {
    dateEt: params.get("date") ?? getTodayEtDateString(),
    market: markets.length ? markets : undefined,
    book: books.length ? books : undefined,
    team: params.get("team") ?? undefined,
    confidence: confidence.length ? confidence : undefined,
    player: params.get("player") ?? undefined,
    includeLowConfidence: params.get("includeLow") === "true",
    limit,
    offset,
  };
}
