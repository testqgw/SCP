import { prisma } from "@/lib/prisma";
import {
  canonicalTeamCode,
  normalizePlayerName,
  type LineupStatus,
  type RotowireLineupSnapshot,
  type RotowireTeamLineup,
} from "@/lib/lineups/rotowire";
import {
  applyPointsGameOddsAdjustment,
  fetchDailyGameOddsMap,
  resolveTeamSpreadForMatchup,
} from "@/lib/snapshot/gameOdds";
import {
  applyEnhancedPointsProjection,
  buildLiveAstSignal,
  buildLivePaSignal,
  buildLivePraSignal,
  buildLivePrSignal,
  buildLiveRaSignal,
  buildLiveRebSignal,
  buildLiveThreesSignal,
  buildLivePtsSignal,
  buildShotPressureSummary,
  fetchDailyAstLineMap,
  fetchDailyPaLineMap,
  fetchDailyPraLineMap,
  fetchDailyPrLineMap,
  fetchDailyRaLineMap,
  fetchDailyRebLineMap,
  fetchDailyThreesLineMap,
  fetchDailyPtsLineMap,
  fetchSeasonVolumeLogs,
  resolveOpponentShotVolumeMetrics,
} from "@/lib/snapshot/pointsContext";
import {
  buildPlayerPersonalModels,
  projectMinutesProfile,
  projectTonightMetrics,
} from "@/lib/snapshot/projection";
import { buildModelLineRecord } from "@/lib/snapshot/modelLines";
import { formatUtcToEt, getTodayEtDateString } from "@/lib/snapshot/time";
import type {
  SnapshotDataCompleteness,
  SnapshotGameIntel,
  SnapshotMarket,
  SnapshotMetricRecord,
  SnapshotPlayerContext,
  SnapshotPlayerLookupData,
  SnapshotRow,
  SnapshotStatLog,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type PlayerLookupTarget = {
  id: string;
  externalId: string | null;
  fullName: string;
  position: string | null;
  teamId: string | null;
  teamCode: string | null;
};

type LineupTeamSignal = {
  status: LineupStatus;
  starterNames: Set<string>;
};

type LineupPlayerSignal = {
  lineupStarter: boolean | null;
  status: LineupStatus;
};

type PositionToken = "G" | "F" | "C";

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const LIVE_FEED_TIMEOUT_MS = 8000;

async function withTimeoutFallback<T>(promise: Promise<T>, fallback: T, timeoutMs = LIVE_FEED_TIMEOUT_MS): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  return await new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      });
  });
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function getSeasonStartDateEt(dateEt: string): string {
  const [yearText, monthText] = dateEt.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return dateEt;
  const seasonStartYear = month >= 9 ? year : year - 1;
  return `${seasonStartYear}-10-01`;
}

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function isLineupStatus(value: string): value is LineupStatus {
  return value === "CONFIRMED" || value === "EXPECTED" || value === "UNKNOWN";
}

function parseLineupSnapshot(value: unknown, dateEt: string): RotowireLineupSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.dateEt === "string" && record.dateEt !== dateEt) return null;
  if (!Array.isArray(record.teams)) return null;

  const teams: RotowireTeamLineup[] = [];
  record.teams.forEach((team) => {
    if (!team || typeof team !== "object" || Array.isArray(team)) return;
    const row = team as Record<string, unknown>;
    const teamCode = typeof row.teamCode === "string" ? canonicalTeamCode(row.teamCode) : null;
    if (!teamCode) return;
    const status = typeof row.status === "string" && isLineupStatus(row.status) ? row.status : "UNKNOWN";
    const starters = Array.isArray(row.starters)
      ? row.starters
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    if (starters.length === 0) return;
    teams.push({ teamCode, status, starters });
  });

  if (teams.length === 0) return null;

  return {
    source: "rotowire",
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : "",
    pageDateLabel: typeof record.pageDateLabel === "string" ? record.pageDateLabel : null,
    teams,
  };
}

function buildLineupSignalMap(snapshot: RotowireLineupSnapshot | null): Map<string, LineupTeamSignal> {
  const map = new Map<string, LineupTeamSignal>();
  if (!snapshot) return map;

  snapshot.teams.forEach((team) => {
    map.set(canonicalTeamCode(team.teamCode), {
      status: team.status,
      starterNames: new Set(team.starters.map((name) => normalizePlayerName(name))),
    });
  });

  return map;
}

function readLineupSignal(
  lineupMap: Map<string, LineupTeamSignal>,
  teamCode: string,
  playerName: string,
): LineupPlayerSignal | null {
  const teamSignal = lineupMap.get(canonicalTeamCode(teamCode));
  if (!teamSignal) return null;
  return {
    lineupStarter: teamSignal.starterNames.has(normalizePlayerName(playerName)),
    status: teamSignal.status,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  const avg = average(values);
  if (avg == null || values.length === 0) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const text = formatNumber(value);
  return value > 0 ? `+${text}` : text;
}

function metricsFromBase(points: number, rebounds: number, assists: number, threes: number): SnapshotMetricRecord {
  return {
    PTS: points,
    REB: rebounds,
    AST: assists,
    THREES: threes,
    PRA: points + rebounds + assists,
    PA: points + assists,
    PR: points + rebounds,
    RA: rebounds + assists,
  };
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  return {
    PTS: average(logs.map((log) => log.points)),
    REB: average(logs.map((log) => log.rebounds)),
    AST: average(logs.map((log) => log.assists)),
    THREES: average(logs.map((log) => log.threes)),
    PRA: average(logs.map((log) => log.points + log.rebounds + log.assists)),
    PA: average(logs.map((log) => log.points + log.assists)),
    PR: average(logs.map((log) => log.points + log.rebounds)),
    RA: average(logs.map((log) => log.rebounds + log.assists)),
  };
}

function arraysByMarket(logs: SnapshotStatLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.points),
    REB: logs.map((log) => log.rebounds),
    AST: logs.map((log) => log.assists),
    THREES: logs.map((log) => log.threes),
    PRA: logs.map((log) => log.points + log.rebounds + log.assists),
    PA: logs.map((log) => log.points + log.assists),
    PR: logs.map((log) => log.points + log.rebounds),
    RA: logs.map((log) => log.rebounds + log.assists),
  };
}

function trendFrom(last3: SnapshotMetricRecord, season: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const left = last3[market];
    const right = season[market];
    result[market] = left == null || right == null ? null : round(left - right, 2);
  });
  return result;
}

function averageFromMetricList(metricsList: SnapshotMetricRecord[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const values = metricsList
      .map((metric) => metric[market])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    result[market] = average(values);
  });
  return result;
}

function deltaFromLeague(teamAverage: SnapshotMetricRecord, leagueAverage: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const teamValue = teamAverage[market];
    const leagueValue = leagueAverage[market];
    result[market] = teamValue == null || leagueValue == null ? null : round(teamValue - leagueValue, 2);
  });
  return result;
}

function parsePositionTokens(position: string | null): Set<PositionToken> {
  const normalized = (position ?? "").toUpperCase();
  const tokens = new Set<PositionToken>();
  if (normalized.includes("G")) tokens.add("G");
  if (normalized.includes("F")) tokens.add("F");
  if (normalized.includes("C")) tokens.add("C");
  return tokens;
}

function determineArchetype(last10Average: SnapshotMetricRecord, minutesLast10Avg: number | null): string {
  const pts = last10Average.PTS ?? 0;
  const reb = last10Average.REB ?? 0;
  const ast = last10Average.AST ?? 0;
  const threes = last10Average.THREES ?? 0;
  const mins = minutesLast10Avg ?? 0;

  if (mins < 16) return "Bench Spark";
  if (ast >= 7 && pts >= 16) return "Primary Creator";
  if (pts >= 24 && ast < 6) return "High-Usage Scorer";
  if (reb >= 10 && ast < 5) return "Interior Big";
  if (threes >= 2.5 && ast < 5 && reb < 7) return "Perimeter Spacer";
  if (ast >= 5 && reb >= 6) return "Point Forward";
  if (pts >= 15 && reb >= 5 && ast >= 4) return "Two-Way Wing";
  return "Balanced Rotation";
}

function starterStatusLabel(startedLastGame: boolean | null, starterRateLast10: number | null): string {
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter";
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.3) return "Spot Starter";
  if (startedLastGame === false && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter (recent bench)";
  if (starterRateLast10 != null && starterRateLast10 >= 0.5) return "Likely Starter";
  if (starterRateLast10 != null && starterRateLast10 <= 0.2) return "Bench";
  return "Unknown";
}

function computeCompleteness(input: {
  last10Logs: SnapshotStatLog[];
  statusLast10: Array<{ starter: boolean | null; played: boolean | null }>;
  opponentAllowance: SnapshotMetricRecord;
  minutesVolatility: number | null;
}): SnapshotDataCompleteness {
  const sampleCoverage = Math.min(100, input.last10Logs.length * 10);
  const statusCoverage = Math.min(100, input.statusLast10.length * 10);
  const contextCoverage =
    input.opponentAllowance.PTS != null && input.opponentAllowance.REB != null && input.opponentAllowance.AST != null
      ? 90
      : 55;
  const stabilityCoverage =
    input.minutesVolatility == null ? 45 : Math.max(30, Math.min(100, Math.round(100 - input.minutesVolatility * 8)));
  const score = Math.round(sampleCoverage * 0.4 + statusCoverage * 0.2 + contextCoverage * 0.2 + stabilityCoverage * 0.2);
  const tier: SnapshotDataCompleteness["tier"] = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

  const issues: string[] = [];
  if (input.last10Logs.length < 10) issues.push("Limited last-10 completed game sample.");
  if (input.statusLast10.length < 10) issues.push("Starter status history is incomplete.");
  if (input.opponentAllowance.PTS == null) issues.push("Opponent allowance sample is thin.");
  if (input.minutesVolatility == null) issues.push("Minutes volatility sample is incomplete.");

  return {
    score,
    tier,
    issues,
    components: {
      sampleCoverage,
      statusCoverage,
      contextCoverage,
      stabilityCoverage,
    },
  };
}

async function resolveSnapshotPlayer(input: {
  playerId?: string | null;
  playerSearch?: string | null;
}): Promise<PlayerLookupTarget | null> {
  if (input.playerId?.trim()) {
    const player = await prisma.player.findUnique({
      where: { id: input.playerId.trim() },
      select: {
        id: true,
        externalId: true,
        fullName: true,
        position: true,
        teamId: true,
        team: { select: { abbreviation: true } },
      },
    });
    if (player) {
      return {
        id: player.id,
        externalId: player.externalId,
        fullName: player.fullName,
        position: player.position,
        teamId: player.teamId,
        teamCode: player.team?.abbreviation ?? null,
      };
    }
  }

  const search = normalizeSearchText(input.playerSearch ?? "");
  if (!search) return null;

  const candidates = await prisma.player.findMany({
    where: {
      OR: [{ isActive: true }, { teamId: { not: null } }],
    },
    select: {
      id: true,
      externalId: true,
      fullName: true,
      firstName: true,
      lastName: true,
      position: true,
      teamId: true,
      team: { select: { abbreviation: true } },
    },
  });

  const searchTokens = search.split(" ");
  const ranked = candidates
    .map((candidate) => {
      const fullName = normalizeSearchText(candidate.fullName);
      const firstName = normalizeSearchText(candidate.firstName ?? "");
      const lastName = normalizeSearchText(candidate.lastName ?? "");
      const fullWithParts = normalizeSearchText(`${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`);

      let score = 0;
      if (fullName === search || fullWithParts === search) score += 500;
      if (lastName === search) score += 360;
      if (fullName.startsWith(search) || fullWithParts.startsWith(search)) score += 260;
      if (lastName.startsWith(search)) score += 220;
      if (firstName.startsWith(search)) score += 160;
      if (searchTokens.length > 1 && searchTokens.every((token) => fullName.includes(token))) score += 180;
      if (searchTokens.length > 1 && searchTokens.every((token) => fullWithParts.includes(token))) score += 180;
      if (fullName.includes(search) || fullWithParts.includes(search)) score += 100;
      if (searchTokens.some((token) => token.length >= 3 && lastName.includes(token))) score += 80;
      if (searchTokens.some((token) => token.length >= 3 && firstName.includes(token))) score += 50;

      return {
        score,
        player: {
          id: candidate.id,
          externalId: candidate.externalId,
          fullName: candidate.fullName,
          position: candidate.position,
          teamId: candidate.teamId,
          teamCode: candidate.team?.abbreviation ?? null,
        },
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.player.fullName.localeCompare(right.player.fullName);
    });

  return ranked[0]?.player ?? null;
}

async function buildPlayerRow(player: PlayerLookupTarget, dateEt: string): Promise<SnapshotRow | null> {
  if (!player.teamId) return null;

  const game = await prisma.game.findFirst({
    where: {
      gameDateEt: dateEt,
      OR: [{ homeTeamId: player.teamId }, { awayTeamId: player.teamId }],
    },
    include: {
      homeTeam: true,
      awayTeam: true,
    },
  });
  if (!game) return null;

  const matchup =
    game.homeTeamId === player.teamId
      ? {
          teamCode: game.homeTeam.abbreviation,
          opponentCode: game.awayTeam.abbreviation,
          opponentTeamId: game.awayTeamId,
          matchupKey: `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
          gameTimeEt: formatUtcToEt(game.commenceTimeUtc),
          isHome: true,
        }
      : {
          teamCode: game.awayTeam.abbreviation,
          opponentCode: game.homeTeam.abbreviation,
          opponentTeamId: game.homeTeamId,
          matchupKey: `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
          gameTimeEt: formatUtcToEt(game.commenceTimeUtc),
          isHome: false,
        };

  const seasonStartDateEt = getSeasonStartDateEt(dateEt);
  const isTodayEt = dateEt === getTodayEtDateString();

  const [
    logsRaw,
    leagueAverageRaw,
    opponentGames,
    dailyOddsMap,
    lineupSetting,
    allPlayerPositions,
    seasonVolumeLogs,
    dailyPtsLineMap,
    dailyRebLineMap,
    dailyAstLineMap,
    dailyThreesLineMap,
    dailyPraLineMap,
    dailyPaLineMap,
    dailyPrLineMap,
    dailyRaLineMap,
  ] = await Promise.all([
    prisma.playerGameLog.findMany({
      where: {
        playerId: player.id,
        gameDateEt: { lt: dateEt },
        minutes: { gt: 0 },
      },
      include: {
        team: { select: { abbreviation: true } },
        opponentTeam: { select: { abbreviation: true } },
      },
      orderBy: [{ gameDateEt: "desc" }],
    }),
    prisma.playerGameLog.aggregate({
      where: {
        gameDateEt: { gte: seasonStartDateEt, lt: dateEt },
        minutes: { gt: 0 },
      },
      _avg: {
        points: true,
        rebounds: true,
        assists: true,
        threes: true,
      },
    }),
    prisma.game.findMany({
      where: {
        gameDateEt: { lt: dateEt },
        OR: [{ homeTeamId: matchup.opponentTeamId }, { awayTeamId: matchup.opponentTeamId }],
      },
      select: { externalId: true },
      orderBy: [{ gameDateEt: "desc" }, { externalId: "desc" }],
      take: 10,
    }),
    withTimeoutFallback(fetchDailyGameOddsMap(dateEt), new Map()),
    isTodayEt
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_lineups_today" },
          select: { value: true },
        })
      : Promise.resolve(null),
    prisma.player.findMany({
      where: { externalId: { not: null } },
      select: { externalId: true, position: true },
    }),
    withTimeoutFallback(fetchSeasonVolumeLogs(dateEt), []),
    withTimeoutFallback(fetchDailyPtsLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyRebLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyAstLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyThreesLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyPraLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyPaLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyPrLineMap(dateEt), new Map()),
    withTimeoutFallback(fetchDailyRaLineMap(dateEt), new Map()),
  ]);
  const positionByExternalId = new Map(
    allPlayerPositions
      .filter((candidate) => typeof candidate.externalId === "string" && candidate.externalId.trim().length > 0)
      .map((candidate) => [candidate.externalId as string, candidate.position]),
  );

  const logsForPlayer: SnapshotStatLog[] = logsRaw
    .map((log) => ({
      gameDateEt: log.gameDateEt,
      teamCode: log.team?.abbreviation ?? null,
      opponent: log.opponentTeam?.abbreviation ?? null,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      minutes: toStat(log.minutes),
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
      steals: toStat(log.steals),
      blocks: toStat(log.blocks),
    }))
    .filter((log) => log.teamCode !== "WLD" && log.opponent !== "STR");

  if (logsForPlayer.length === 0) return null;

  const opponentGameIds = opponentGames.map((row) => row.externalId);
  const opponentAllowanceLogs =
    opponentGameIds.length > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            opponentTeamId: matchup.opponentTeamId,
            externalGameId: { in: opponentGameIds },
            minutes: { gt: 0 },
          },
          select: {
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];

  const opponentAllowance = averageFromMetricList(
    opponentAllowanceLogs.map((log) =>
      metricsFromBase(
        toStat(log.points),
        toStat(log.rebounds),
        toStat(log.assists),
        toStat(log.threes),
      ),
    ),
  );
  const leagueAverage = metricsFromBase(
    toStat(leagueAverageRaw._avg.points),
    toStat(leagueAverageRaw._avg.rebounds),
    toStat(leagueAverageRaw._avg.assists),
    toStat(leagueAverageRaw._avg.threes),
  );
  const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);

  const statusLast10 = logsForPlayer.slice(0, 10).map((log) => ({
    starter: log.starter,
    played: log.played,
  }));
  const lineupSnapshot = parseLineupSnapshot(lineupSetting?.value ?? null, dateEt);
  const lineupMap = buildLineupSignalMap(lineupSnapshot);
  const lineupSignal = readLineupSignal(lineupMap, matchup.teamCode, player.fullName);
  const dailyOdds = dailyOddsMap.get(matchup.matchupKey) ?? null;
  const openingTeamSpread = resolveTeamSpreadForMatchup(dailyOdds, matchup.isHome);
  const openingTotal = dailyOdds?.openingTotal ?? null;
  const last5Logs = logsForPlayer.slice(0, 5);
  const last10Logs = logsForPlayer.slice(0, 10);
  const last3Logs = logsForPlayer.slice(0, 3);
  const homeAwayLogs = logsForPlayer.filter((log) => log.isHome === matchup.isHome);
  const sameTeamLogs = logsForPlayer.filter((log) => log.teamCode === matchup.teamCode);
  const logsChronological = logsForPlayer.slice().reverse();

  const seasonAverage = averagesByMarket(logsForPlayer);
  const last3Average = averagesByMarket(last3Logs);
  const last10Average = averagesByMarket(last10Logs);
  const homeAwayAverage = averagesByMarket(homeAwayLogs);
  const last5ByMarket = arraysByMarket(last5Logs);
  const last10ByMarket = arraysByMarket(last10Logs);
  const trendVsSeason = trendFrom(last3Average, seasonAverage);
  const historyMinutes = logsForPlayer.map((log) => log.minutes);
  const minutesSeasonAvg = average(logsChronological.map((log) => log.minutes));
  const minutesLast3Avg = average(last3Logs.map((log) => log.minutes));
  const minutesLast10Avg = average(last10Logs.map((log) => log.minutes));
  const minutesHomeAwayAvg = average(homeAwayLogs.map((log) => log.minutes));
  const minutesCurrentTeamLast5Avg = average(sameTeamLogs.slice(0, 5).map((log) => log.minutes));
  const minutesVolatility = standardDeviation(last10Logs.map((log) => log.minutes));
  const startsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
  const starterRateLast10 = statusLast10.length > 0 ? round(startsLast10 / statusLast10.length, 2) : null;
  const startedLastGame = statusLast10[0]?.starter ?? null;
  const personalModels = buildPlayerPersonalModels({
    historyByMarket: arraysByMarket(logsChronological),
    minutesSeasonAvg,
  });
  const minutesProfile = projectMinutesProfile({
    minutesLast3Avg,
    minutesLast10Avg,
    minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: sameTeamLogs.length,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    starterRateLast10,
  });
  const projectedTonight = projectTonightMetrics({
    last3Average,
    last10Average,
    seasonAverage,
    homeAwayAverage,
    opponentAllowance,
    opponentAllowanceDelta,
    last10ByMarket,
    historyByMarket: arraysByMarket(logsForPlayer),
    historyMinutes,
    sampleSize: logsForPlayer.length,
    personalModels,
    minutesSeasonAvg,
    minutesLast3Avg,
    minutesLast10Avg,
    minutesVolatility,
    minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: sameTeamLogs.length,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    starterRateLast10,
  });
  const playerShotPressure = buildShotPressureSummary(seasonVolumeLogs, player.externalId, dateEt);
  const opponentShotVolume = resolveOpponentShotVolumeMetrics({
    opponentCode: matchup.opponentCode,
    dateEt,
    playerPositionTokens: parsePositionTokens(player.position),
    seasonLogs: seasonVolumeLogs,
    positionByExternalId,
  });
  const normalizedPlayerName = normalizePlayerName(player.fullName);
  const marketKey = `${matchup.matchupKey}|${normalizedPlayerName}`;
  const ptsMarketLine = dailyPtsLineMap.get(marketKey) ?? null;
  const rebMarketLine = dailyRebLineMap.get(marketKey) ?? null;
  const astMarketLine = dailyAstLineMap.get(marketKey) ?? null;
  const threesMarketLine = dailyThreesLineMap.get(marketKey) ?? null;
  const praMarketLine = dailyPraLineMap.get(marketKey) ?? null;
  const paMarketLine = dailyPaLineMap.get(marketKey) ?? null;
  const prMarketLine = dailyPrLineMap.get(marketKey) ?? null;
  const raMarketLine = dailyRaLineMap.get(marketKey) ?? null;
  projectedTonight.PTS = applyEnhancedPointsProjection({
    baseProjection: applyPointsGameOddsAdjustment(projectedTonight.PTS, openingTotal, openingTeamSpread),
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    playerShotPressure,
    opponentShotVolume,
    marketLine: ptsMarketLine,
  });
  if (projectedTonight.PTS != null && projectedTonight.REB != null && projectedTonight.AST != null) {
    projectedTonight.PRA = round(projectedTonight.PTS + projectedTonight.REB + projectedTonight.AST, 2);
    projectedTonight.PA = round(projectedTonight.PTS + projectedTonight.AST, 2);
    projectedTonight.PR = round(projectedTonight.PTS + projectedTonight.REB, 2);
    projectedTonight.RA = round(projectedTonight.REB + projectedTonight.AST, 2);
  }

  const archetype = determineArchetype(last10Average, minutesLast10Avg);
  const completeness = computeCompleteness({
    last10Logs,
    statusLast10,
    opponentAllowance,
    minutesVolatility,
  });
  const modelLines = buildModelLineRecord({
    projectedTonight,
    last10ByMarket,
    dataCompletenessScore: completeness.score,
  });
  const ptsSignal = buildLivePtsSignal({
    playerName: player.fullName,
    playerPosition: player.position,
    projection: projectedTonight.PTS,
    pointsProjection: projectedTonight.PTS,
    reboundsProjection: projectedTonight.REB,
    assistProjection: projectedTonight.AST,
    threesProjection: projectedTonight.THREES,
    marketLine: ptsMarketLine,
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const rebSignal = buildLiveRebSignal({
    playerName: player.fullName,
    playerPosition: player.position,
    projection: projectedTonight.REB,
    pointsProjection: projectedTonight.PTS,
    reboundsProjection: projectedTonight.REB,
    assistProjection: projectedTonight.AST,
    threesProjection: projectedTonight.THREES,
    marketLine: rebMarketLine,
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const astSignal = buildLiveAstSignal({
    playerName: player.fullName,
    playerPosition: player.position,
    projection: projectedTonight.AST,
    pointsProjection: projectedTonight.PTS,
    reboundsProjection: projectedTonight.REB,
    assistProjection: projectedTonight.AST,
    threesProjection: projectedTonight.THREES,
    marketLine: astMarketLine,
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const threesSignal = buildLiveThreesSignal({
    playerName: player.fullName,
    playerPosition: player.position,
    projection: projectedTonight.THREES,
    pointsProjection: projectedTonight.PTS,
    reboundsProjection: projectedTonight.REB,
    assistProjection: projectedTonight.AST,
    threesProjection: projectedTonight.THREES,
    marketLine: threesMarketLine,
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const comboSignalInput = {
    openingTotal,
    openingTeamSpread,
    playerName: player.fullName,
    playerPosition: player.position,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    completenessScore: completeness.score,
    assistProjection: projectedTonight.AST,
    projectedPoints: projectedTonight.PTS,
    projectedRebounds: projectedTonight.REB,
    projectedAssists: projectedTonight.AST,
    threesProjection: projectedTonight.THREES,
    playerShotPressure,
    opponentShotVolume,
  };
  const praSignal = buildLivePraSignal({
    ...comboSignalInput,
    projection: projectedTonight.PRA,
    marketLine: praMarketLine,
  });
  const paSignal = buildLivePaSignal({
    ...comboSignalInput,
    projection: projectedTonight.PA,
    marketLine: paMarketLine,
  });
  const prSignal = buildLivePrSignal({
    ...comboSignalInput,
    projection: projectedTonight.PR,
    marketLine: prMarketLine,
  });
  const raSignal = buildLiveRaSignal({
    ...comboSignalInput,
    projection: projectedTonight.RA,
    marketLine: raMarketLine,
  });

  const playerContext: SnapshotPlayerContext = {
    archetype,
    projectedStarter:
      lineupSignal?.lineupStarter === true
        ? lineupSignal.status === "CONFIRMED"
          ? "Confirmed Starter (Lineup Feed)"
          : "Expected Starter (Lineup Feed)"
        : lineupSignal?.lineupStarter === false
          ? lineupSignal.status === "CONFIRMED"
            ? "Confirmed Bench (Lineup Feed)"
            : "Projected Bench (Lineup Feed)"
          : starterStatusLabel(startedLastGame, starterRateLast10),
    startedLastGame,
    startsLast10,
    starterRateLast10,
    rotationRank: null,
    minutesLast3Avg,
    minutesLast10Avg,
    minutesCurrentTeamAvg: minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: sameTeamLogs.length,
    minutesTrend:
      minutesLast3Avg == null || minutesLast10Avg == null ? null : round(minutesLast3Avg - minutesLast10Avg, 2),
    minutesVolatility,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    primaryDefender: null,
    teammateCore: [],
  };

  const gameIntel: SnapshotGameIntel = {
    generatedAt: new Date().toISOString(),
    modules: [
      {
        id: "lookup-projection",
        title: "Projection Snapshot",
        description: "Fast single-player lookup projection using the same underlying projection engine.",
        status: "DERIVED",
        items: [
          { label: "Projected Minutes", value: formatNumber(minutesProfile.expected) },
          {
            label: "Minutes Band",
            value:
              minutesProfile.floor == null || minutesProfile.ceiling == null
                ? "-"
                : `${formatNumber(minutesProfile.floor)}-${formatNumber(minutesProfile.ceiling)}`,
          },
          { label: "PTS / REB / AST", value: `${formatNumber(projectedTonight.PTS)} / ${formatNumber(projectedTonight.REB)} / ${formatNumber(projectedTonight.AST)}` },
          { label: "PRA / PA / PR / RA", value: `${formatNumber(projectedTonight.PRA)} / ${formatNumber(projectedTonight.PA)} / ${formatNumber(projectedTonight.PR)} / ${formatNumber(projectedTonight.RA)}` },
          { label: "Game Total / Spread", value: `${formatNumber(openingTotal)} / ${formatSigned(openingTeamSpread)}` },
        ],
      },
      {
        id: "lookup-pts-context",
        title: "Live PTS Context",
        description: "Sportsbook anchor plus recent shot-volume and opponent pressure inputs.",
        status: "LIVE",
        items: [
          { label: "Consensus PTS Line", value: ptsMarketLine == null ? "-" : formatNumber(ptsMarketLine.line) },
          { label: "Market Books", value: ptsMarketLine == null ? "-" : String(ptsMarketLine.sportsbookCount) },
          { label: "PTS Side", value: ptsSignal == null ? "-" : ptsSignal.side },
          {
            label: "PTS Confidence",
            value: ptsSignal?.confidence == null ? "-" : `${formatNumber(ptsSignal.confidence)} (${ptsSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "PTS Filter",
            value: ptsSignal == null ? "-" : ptsSignal.qualified ? "QUALIFIED" : "PASS",
          },
          {
            label: "PTS Gap / Risk",
            value:
              ptsSignal == null
                ? "-"
                : `${formatSigned(ptsSignal.projectionGap)} / ${formatNumber(ptsSignal.minutesRisk)}`,
          },
          { label: "FGA / Min (L10)", value: playerShotPressure?.fgaRate == null ? "-" : playerShotPressure.fgaRate.toFixed(3) },
          { label: "FTA / Min (L10)", value: playerShotPressure?.ftaRate == null ? "-" : playerShotPressure.ftaRate.toFixed(3) },
          {
            label: "Opp FGA Allowed / Min",
            value: opponentShotVolume?.fgaPerMinute == null ? "-" : opponentShotVolume.fgaPerMinute.toFixed(3),
          },
          {
            label: "Opp FT Pressure",
            value: opponentShotVolume?.freeThrowPressure == null ? "-" : opponentShotVolume.freeThrowPressure.toFixed(3),
          },
        ],
      },
      {
        id: "lookup-reb-context",
        title: "Live REB Context",
        description: "Sportsbook rebound line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: [
          { label: "Consensus REB Line", value: rebMarketLine == null ? "-" : formatNumber(rebMarketLine.line) },
          { label: "Market Books", value: rebMarketLine == null ? "-" : String(rebMarketLine.sportsbookCount) },
          { label: "REB Side", value: rebSignal == null ? "-" : rebSignal.side },
          {
            label: "REB Confidence",
            value: rebSignal?.confidence == null ? "-" : `${formatNumber(rebSignal.confidence)} (${rebSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "REB Filter",
            value: rebSignal == null ? "-" : rebSignal.qualified ? "QUALIFIED" : "PASS",
          },
          {
            label: "REB Gap / Risk",
            value:
              rebSignal == null
                ? "-"
                : `${formatSigned(rebSignal.projectionGap)} / ${formatNumber(rebSignal.minutesRisk)}`,
          },
        ],
      },
      {
        id: "lookup-ast-context",
        title: "Live AST Context",
        description: "Sportsbook assist line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: [
          { label: "Consensus AST Line", value: astMarketLine == null ? "-" : formatNumber(astMarketLine.line) },
          { label: "Market Books", value: astMarketLine == null ? "-" : String(astMarketLine.sportsbookCount) },
          { label: "AST Side", value: astSignal == null ? "-" : astSignal.side },
          {
            label: "AST Confidence",
            value: astSignal?.confidence == null ? "-" : `${formatNumber(astSignal.confidence)} (${astSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "AST Filter",
            value: astSignal == null ? "-" : astSignal.qualified ? "QUALIFIED" : "PASS",
          },
          {
            label: "AST Gap / Risk",
            value:
              astSignal == null
                ? "-"
                : `${formatSigned(astSignal.projectionGap)} / ${formatNumber(astSignal.minutesRisk)}`,
          },
        ],
      },
      {
        id: "lookup-threes-context",
        title: "Live 3PM Context",
        description: "Sportsbook 3PM line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: [
          { label: "Consensus 3PM Line", value: threesMarketLine == null ? "-" : formatNumber(threesMarketLine.line) },
          { label: "Market Books", value: threesMarketLine == null ? "-" : String(threesMarketLine.sportsbookCount) },
          { label: "3PM Side", value: threesSignal == null ? "-" : threesSignal.side },
          {
            label: "3PM Confidence",
            value: threesSignal?.confidence == null ? "-" : `${formatNumber(threesSignal.confidence)} (${threesSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "3PM Filter",
            value: threesSignal == null ? "-" : threesSignal.qualified ? "QUALIFIED" : "PASS",
          },
          {
            label: "3PM Gap / Risk",
            value:
              threesSignal == null
                ? "-"
                : `${formatSigned(threesSignal.projectionGap)} / ${formatNumber(threesSignal.minutesRisk)}`,
          },
        ],
      },
      {
        id: "lookup-combo-context",
        title: "Live Combo Context",
        description: "Sportsbook combo lines plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: [
          { label: "Consensus PRA Line", value: praMarketLine == null ? "-" : formatNumber(praMarketLine.line) },
          { label: "PRA Side", value: praSignal == null ? "-" : praSignal.side },
          { label: "PRA Filter", value: praSignal == null ? "-" : praSignal.qualified ? "QUALIFIED" : "PASS" },
          { label: "Consensus PA Line", value: paMarketLine == null ? "-" : formatNumber(paMarketLine.line) },
          { label: "PA Side", value: paSignal == null ? "-" : paSignal.side },
          { label: "PA Filter", value: paSignal == null ? "-" : paSignal.qualified ? "QUALIFIED" : "PASS" },
          { label: "Consensus PR Line", value: prMarketLine == null ? "-" : formatNumber(prMarketLine.line) },
          { label: "PR Side", value: prSignal == null ? "-" : prSignal.side },
          { label: "PR Filter", value: prSignal == null ? "-" : prSignal.qualified ? "QUALIFIED" : "PASS" },
          { label: "Consensus RA Line", value: raMarketLine == null ? "-" : formatNumber(raMarketLine.line) },
          { label: "RA Side", value: raSignal == null ? "-" : raSignal.side },
          { label: "RA Filter", value: raSignal == null ? "-" : raSignal.qualified ? "QUALIFIED" : "PASS" },
        ],
      },
      {
        id: "lookup-context",
        title: "Form + Matchup",
        description: "Recent form, split context, and opponent allowance delta for the selected player.",
        status: "DERIVED",
        items: [
          { label: "L3 vs L10 PTS", value: `${formatNumber(last3Average.PTS)} vs ${formatNumber(last10Average.PTS)}` },
          { label: "Home/Away PTS", value: formatNumber(homeAwayAverage.PTS) },
          { label: "Opponent Delta PTS", value: formatSigned(opponentAllowanceDelta.PTS) },
          { label: "Current Team Minutes", value: `${formatNumber(minutesCurrentTeamLast5Avg)} (${sameTeamLogs.length} g)` },
          { label: "Lineup Signal", value: lineupSignal == null ? "-" : `${lineupSignal.status} / ${lineupSignal.lineupStarter ? "Starter" : "Bench"}` },
        ],
      },
    ],
  };

  return {
    playerId: player.id,
    playerName: player.fullName,
    position: player.position,
    teamCode: matchup.teamCode,
    opponentCode: matchup.opponentCode,
    matchupKey: matchup.matchupKey,
    isHome: matchup.isHome,
    gameTimeEt: matchup.gameTimeEt,
    last5: last5ByMarket,
    last10: last10ByMarket,
    last3Average,
    last10Average,
    seasonAverage,
    homeAwayAverage,
    trendVsSeason,
    opponentAllowance,
    opponentAllowanceDelta,
    projectedTonight,
    modelLines,
    ptsSignal,
    rebSignal,
    astSignal,
    threesSignal,
    praSignal,
    paSignal,
    prSignal,
    raSignal,
    recentLogs: last10Logs,
    analysisLogs: logsForPlayer,
    dataCompleteness: completeness,
    playerContext,
    gameIntel,
  };
}

export async function getSnapshotPlayerLookupData(input: {
  dateEt: string;
  playerId?: string | null;
  playerSearch?: string | null;
}): Promise<SnapshotPlayerLookupData> {
  const player = await resolveSnapshotPlayer(input);
  if (!player) {
    throw new Error("Player not found.");
  }

  const exactRow = await buildPlayerRow(player, input.dateEt);
  if (exactRow) {
    return {
      requestedDateEt: input.dateEt,
      resolvedDateEt: input.dateEt,
      note: null,
      row: exactRow,
    };
  }

  if (!player.teamId) {
    throw new Error("Player has no team assignment for lookup.");
  }

  const previousGame = await prisma.game.findFirst({
    where: {
      gameDateEt: { lt: input.dateEt },
      OR: [{ homeTeamId: player.teamId }, { awayTeamId: player.teamId }],
    },
    orderBy: [{ gameDateEt: "desc" }, { commenceTimeUtc: "desc" }],
    select: { gameDateEt: true },
  });

  if (previousGame) {
    const previousRow = await buildPlayerRow(player, previousGame.gameDateEt);
    if (previousRow) {
      return {
        requestedDateEt: input.dateEt,
        resolvedDateEt: previousGame.gameDateEt,
        note: `No ${player.teamCode ?? "team"} game on ${input.dateEt}. Showing the latest available projection from ${previousGame.gameDateEt}.`,
        row: previousRow,
      };
    }
  }

  const nextGame = await prisma.game.findFirst({
    where: {
      gameDateEt: { gt: input.dateEt },
      OR: [{ homeTeamId: player.teamId }, { awayTeamId: player.teamId }],
    },
    orderBy: [{ gameDateEt: "asc" }, { commenceTimeUtc: "asc" }],
    select: { gameDateEt: true },
  });

  if (nextGame) {
    const nextRow = await buildPlayerRow(player, nextGame.gameDateEt);
    if (nextRow) {
      return {
        requestedDateEt: input.dateEt,
        resolvedDateEt: nextGame.gameDateEt,
        note: `No ${player.teamCode ?? "team"} game on ${input.dateEt}. Showing the next available matchup on ${nextGame.gameDateEt}.`,
        row: nextRow,
      };
    }
  }

  throw new Error("No projected matchup could be built for this player.");
}
