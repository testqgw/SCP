import { prisma } from "@/lib/prisma";
import {
  canonicalTeamCode,
  deriveRotowireAvailabilityImpact,
  formatRotowireAvailabilityLabel,
  normalizePlayerName,
  parseStoredRotowireLineupSnapshot,
  type LineupStatus,
  type RotowireLineupSnapshot,
  type RotowireAvailabilityStatus,
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
  buildSameOpponentProjectionSignal,
  projectMinutesProfile,
  projectTonightMetrics,
  type MinutesProjectionProfile,
  type SameOpponentProjectionSignal,
} from "@/lib/snapshot/projection";
import { computeCurrentLineRecencyMetrics } from "@/lib/snapshot/currentLineRecency";
import { buildModelLineRecord } from "@/lib/snapshot/modelLines";
import { maybeRefreshTodayLineupSnapshot } from "@/lib/snapshot/liveLineups";
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
  hasStarterData: boolean;
  starterNames: Set<string>;
  availabilityByName: Map<
    string,
    {
      status: RotowireAvailabilityStatus;
      percentPlay: number | null;
      title: string | null;
    }
  >;
};

type LineupPlayerSignal = {
  lineupStarter: boolean | null;
  status: LineupStatus;
  availabilityStatus: RotowireAvailabilityStatus | null;
  availabilityPercentPlay: number | null;
  availabilityTitle: string | null;
};

type PositionToken = "G" | "F" | "C";

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const LIVE_FEED_TIMEOUT_MS = 25000;

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

function daysBetweenEt(fromEt: string, toEt: string): number | null {
  const from = new Date(`${fromEt}T00:00:00Z`).getTime();
  const to = new Date(`${toEt}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
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

function parseLineupSnapshot(value: unknown, dateEt: string): RotowireLineupSnapshot | null {
  return parseStoredRotowireLineupSnapshot(value, dateEt);
}

function buildLineupSignalMap(snapshot: RotowireLineupSnapshot | null): Map<string, LineupTeamSignal> {
  const map = new Map<string, LineupTeamSignal>();
  if (!snapshot) return map;

  snapshot.teams.forEach((team) => {
    map.set(canonicalTeamCode(team.teamCode), {
      status: team.status,
      hasStarterData: team.starters.length > 0,
      starterNames: new Set(team.starters.map((name) => normalizePlayerName(name))),
      availabilityByName: new Map(
        team.availabilityPlayers.map((player) => [
          normalizePlayerName(player.playerName),
          {
            status: player.status,
            percentPlay: player.percentPlay,
            title: player.title,
          },
        ]),
      ),
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
  const normalized = normalizePlayerName(playerName);
  const availability = teamSignal.availabilityByName.get(normalized);
  return {
    lineupStarter: teamSignal.hasStarterData ? teamSignal.starterNames.has(normalized) : null,
    status: teamSignal.status,
    availabilityStatus: availability?.status ?? null,
    availabilityPercentPlay: availability?.percentPlay ?? null,
    availabilityTitle: availability?.title ?? null,
  };
}

function lineupStarterLabel(baseLabel: string, signal: LineupPlayerSignal | null): string {
  if (!signal) return baseLabel;
  if (signal.availabilityStatus === "OUT" || signal.availabilityStatus === "DOUBTFUL") {
    return `${signal.availabilityStatus} (Lineup Feed)`;
  }
  if (signal.lineupStarter === true) {
    return signal.status === "CONFIRMED" ? "Confirmed Starter (Lineup Feed)" : "Expected Starter (Lineup Feed)";
  }
  if (signal.lineupStarter === false) {
    return signal.status === "CONFIRMED" ? "Confirmed Bench (Lineup Feed)" : "Projected Bench (Lineup Feed)";
  }
  return baseLabel;
}

function describeLineupSignal(signal: LineupPlayerSignal | null): string {
  if (!signal) return "-";
  const role = signal.lineupStarter == null ? "Role Unknown" : signal.lineupStarter ? "Starter" : "Bench";
  const availability = formatRotowireAvailabilityLabel(signal.availabilityStatus, signal.availabilityPercentPlay);
  return availability ? `${signal.status} / ${role} / ${availability}` : `${signal.status} / ${role}`;
}

function applyAvailabilityToMinutesProfile(
  profile: MinutesProjectionProfile,
  signal: LineupPlayerSignal | null,
): MinutesProjectionProfile {
  const impact = deriveRotowireAvailabilityImpact(signal?.availabilityStatus ?? null, signal?.availabilityPercentPlay ?? null);
  if (impact.severity <= 0) return profile;

  const scale = (value: number | null): number | null =>
    value == null ? null : round(Math.max(0, value * impact.minutesMultiplier), 2);

  return {
    expected: scale(profile.expected),
    floor: scale(profile.floor),
    ceiling: scale(profile.ceiling),
  };
}

function applyAvailabilityToMetricRecord(
  metrics: SnapshotMetricRecord,
  signal: LineupPlayerSignal | null,
): SnapshotMetricRecord {
  const impact = deriveRotowireAvailabilityImpact(signal?.availabilityStatus ?? null, signal?.availabilityPercentPlay ?? null);
  if (impact.severity <= 0) return metrics;

  const scaled = blankMetricRecord();
  MARKETS.forEach((market) => {
    const value = metrics[market];
    if (market === "PTS" || market === "AST") {
      scaled[market] = value;
      return;
    }
    scaled[market] = value == null ? null : round(Math.max(0, value * impact.projectionMultiplier), 2);
  });
  return scaled;
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

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function formatEmpiricalHitRateSummary(input: {
  weightedCurrentLineOverRate?: number | null;
  l10CurrentLineOverRate?: number | null;
  l15CurrentLineOverRate?: number | null;
}): string {
  const parts = [
    input.weightedCurrentLineOverRate == null ? null : `W ${formatPercent(input.weightedCurrentLineOverRate)}`,
    input.l10CurrentLineOverRate == null ? null : `L10 ${formatPercent(input.l10CurrentLineOverRate)}`,
    input.l15CurrentLineOverRate == null ? null : `L15 ${formatPercent(input.l15CurrentLineOverRate)}`,
  ].filter((value): value is string => value != null);
  return parts.length > 0 ? parts.join(" | ") : "-";
}

function formatSameOpponentSummary(signal: SameOpponentProjectionSignal | null): string {
  if (signal == null || signal.sample <= 0) return "-";
  return `${formatNumber(signal.weightedAverage ?? signal.average)} / ${formatSigned(signal.deltaVsAnchor)} / ${signal.sample}g / adj ${formatSigned(signal.adjustment)}`;
}

function filterSameOpponentLogs(logs: SnapshotStatLog[], opponentCode: string): SnapshotStatLog[] {
  const canonicalOpponent = canonicalTeamCode(opponentCode);
  if (!canonicalOpponent) return [];
  return logs.filter((log) => {
    if (!log.opponent) return false;
    return canonicalTeamCode(log.opponent) === canonicalOpponent;
  });
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

async function fetchPlayerCompletedLogs(playerId: string, beforeDateEt: string): Promise<SnapshotStatLog[]> {
  const logsRaw = await prisma.playerGameLog.findMany({
    where: {
      playerId,
      gameDateEt: { lt: beforeDateEt },
      minutes: { gt: 0 },
    },
    include: {
      team: { select: { abbreviation: true } },
      opponentTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ gameDateEt: "desc" }],
  });

  return logsRaw
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
    logsForPlayer,
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
    fetchPlayerCompletedLogs(player.id, dateEt),
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
          select: { value: true, updatedAt: true },
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
  const lineupSnapshot = (
    isTodayEt
      ? await withTimeoutFallback(
          maybeRefreshTodayLineupSnapshot({
            dateEt,
            currentValue: lineupSetting?.value ?? null,
            currentUpdatedAt: lineupSetting?.updatedAt ?? null,
          }),
          {
            snapshot: parseLineupSnapshot(lineupSetting?.value ?? null, dateEt),
            updatedAt: lineupSetting?.updatedAt ?? null,
          },
        )
      : {
          snapshot: parseLineupSnapshot(lineupSetting?.value ?? null, dateEt),
          updatedAt: lineupSetting?.updatedAt ?? null,
        }
  ).snapshot;
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
  const last15LogsChronological = logsChronological.slice(-15);

  const seasonAverage = averagesByMarket(logsForPlayer);
  const last3Average = averagesByMarket(last3Logs);
  const last10Average = averagesByMarket(last10Logs);
  const homeAwayAverage = averagesByMarket(homeAwayLogs);
  const last5ByMarket = arraysByMarket(last5Logs);
  const last15ByMarketChronological = arraysByMarket(last15LogsChronological);
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
  const projectedRestDays = last10Logs[0] ? daysBetweenEt(last10Logs[0].gameDateEt, dateEt) : null;
  const personalModels = buildPlayerPersonalModels({
    historyByMarket: arraysByMarket(logsChronological),
    minutesSeasonAvg,
  });
  const availabilitySeverity = deriveRotowireAvailabilityImpact(
    lineupSignal?.availabilityStatus ?? null,
    lineupSignal?.availabilityPercentPlay ?? null,
  ).severity;
  const minutesProfile = applyAvailabilityToMinutesProfile(
    projectMinutesProfile({
      minutesLast3Avg,
      minutesLast10Avg,
      minutesHomeAwayAvg,
      minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      starterRateLast10,
    }),
    lineupSignal,
  );
  const sameOpponentLogs = filterSameOpponentLogs(logsForPlayer, matchup.opponentCode);
  const sameOpponentByMarket = arraysByMarket(sameOpponentLogs);
  const sameOpponentMinutes = sameOpponentLogs.map((log) => log.minutes);
  const projectedTonight = applyAvailabilityToMetricRecord(
    projectTonightMetrics({
      last3Average,
      last10Average,
      seasonAverage,
      homeAwayAverage,
      opponentAllowance,
      opponentAllowanceDelta,
      last10ByMarket,
      historyByMarket: arraysByMarket(logsForPlayer),
      historyMinutes,
      sameOpponentByMarket,
      sameOpponentMinutes,
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
      isHome: matchup.isHome,
      playerPosition: player.position,
      restDays: projectedRestDays,
      openingTeamSpread,
      openingTotal,
      availabilitySeverity,
    }),
    lineupSignal,
  );
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
  const openingSpreadAbs = openingTeamSpread == null ? null : round(Math.abs(openingTeamSpread), 3);
  const competitivePaceFactor =
    openingTotal == null ? null : round(openingTotal / Math.max(openingSpreadAbs ?? 0, 1), 4);
  const blowoutRisk =
    openingTotal == null || openingSpreadAbs == null ? null : round(openingSpreadAbs / Math.max(openingTotal, 1), 4);
  const recent15Minutes = last15LogsChronological.map((entry) => entry.minutes);
  const ptsCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.PTS,
    recentMinutes: recent15Minutes,
    currentLine: ptsMarketLine?.line ?? null,
  });
  const rebCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.REB,
    recentMinutes: recent15Minutes,
    currentLine: rebMarketLine?.line ?? null,
  });
  const astCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.AST,
    recentMinutes: recent15Minutes,
    currentLine: astMarketLine?.line ?? null,
  });
  const threesCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.THREES,
    recentMinutes: recent15Minutes,
    currentLine: threesMarketLine?.line ?? null,
  });
  const praCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.PRA,
    recentMinutes: recent15Minutes,
    currentLine: praMarketLine?.line ?? null,
  });
  const paCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.PA,
    recentMinutes: recent15Minutes,
    currentLine: paMarketLine?.line ?? null,
  });
  const prCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.PR,
    recentMinutes: recent15Minutes,
    currentLine: prMarketLine?.line ?? null,
  });
  const raCurrentLineRecency = computeCurrentLineRecencyMetrics({
    recentActualValues: last15ByMarketChronological.RA,
    recentMinutes: recent15Minutes,
    currentLine: raMarketLine?.line ?? null,
  });
  projectedTonight.PTS = applyEnhancedPointsProjection({
    baseProjection: applyPointsGameOddsAdjustment(projectedTonight.PTS, openingTotal, openingTeamSpread),
    openingTotal,
    openingTeamSpread,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
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
  const ptsSameOpponentSignal = buildSameOpponentProjectionSignal({
    market: "PTS",
    sameOpponentValues: sameOpponentByMarket.PTS,
    sameOpponentMinutes,
    expectedMinutes: minutesProfile.expected,
    anchorValue: seasonAverage.PTS ?? last10Average.PTS ?? null,
  });
  const rebSameOpponentSignal = buildSameOpponentProjectionSignal({
    market: "REB",
    sameOpponentValues: sameOpponentByMarket.REB,
    sameOpponentMinutes,
    expectedMinutes: minutesProfile.expected,
    anchorValue: seasonAverage.REB ?? last10Average.REB ?? null,
  });
  const astSameOpponentSignal = buildSameOpponentProjectionSignal({
    market: "AST",
    sameOpponentValues: sameOpponentByMarket.AST,
    sameOpponentMinutes,
    expectedMinutes: minutesProfile.expected,
    anchorValue: seasonAverage.AST ?? last10Average.AST ?? null,
  });
  const threesSameOpponentSignal = buildSameOpponentProjectionSignal({
    market: "THREES",
    sameOpponentValues: sameOpponentByMarket.THREES,
    sameOpponentMinutes,
    expectedMinutes: minutesProfile.expected,
    anchorValue: seasonAverage.THREES ?? last10Average.THREES ?? null,
  });
  const ptsSignal = buildLivePtsSignal({
    gameDateEt: dateEt,
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
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    ...ptsCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.PTS == null || ptsCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.PTS - ptsCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      ptsMarketLine?.line == null || ptsCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(ptsCurrentLineRecency.l15ValueMedian - ptsMarketLine.line, 4),
    competitivePaceFactor,
    blowoutRisk,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const rebSignal = buildLiveRebSignal({
    gameDateEt: dateEt,
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
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    ...rebCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.REB == null || rebCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.REB - rebCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      rebMarketLine?.line == null || rebCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(rebCurrentLineRecency.l15ValueMedian - rebMarketLine.line, 4),
    competitivePaceFactor,
    blowoutRisk,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const astSignal = buildLiveAstSignal({
    gameDateEt: dateEt,
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
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    ...astCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.AST == null || astCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.AST - astCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      astMarketLine?.line == null || astCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(astCurrentLineRecency.l15ValueMedian - astMarketLine.line, 4),
    competitivePaceFactor,
    blowoutRisk,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const threesSignal = buildLiveThreesSignal({
    gameDateEt: dateEt,
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
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    ...threesCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.THREES == null || threesCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.THREES - threesCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      threesMarketLine?.line == null || threesCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(threesCurrentLineRecency.l15ValueMedian - threesMarketLine.line, 4),
    competitivePaceFactor,
    blowoutRisk,
    playerShotPressure,
    opponentShotVolume,
    completenessScore: completeness.score,
  });
  const comboSignalInput = {
    gameDateEt: dateEt,
    openingTotal,
    openingTeamSpread,
    playerName: player.fullName,
    playerPosition: player.position,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    lineupStatus: lineupSignal?.status ?? null,
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    starterRateLast10,
    archetypeExpectedMinutes: minutesLast10Avg,
    projectedMinutes: minutesProfile.expected,
    projectedMinutesFloor: minutesProfile.floor,
    projectedMinutesCeiling: minutesProfile.ceiling,
    minutesVolatility,
    competitivePaceFactor,
    blowoutRisk,
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
    ...praCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.PRA == null || praCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.PRA - praCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      praMarketLine?.line == null || praCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(praCurrentLineRecency.l15ValueMedian - praMarketLine.line, 4),
  });
  const paSignal = buildLivePaSignal({
    ...comboSignalInput,
    projection: projectedTonight.PA,
    marketLine: paMarketLine,
    ...paCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.PA == null || paCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.PA - paCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      paMarketLine?.line == null || paCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(paCurrentLineRecency.l15ValueMedian - paMarketLine.line, 4),
  });
  const prSignal = buildLivePrSignal({
    ...comboSignalInput,
    projection: projectedTonight.PR,
    marketLine: prMarketLine,
    ...prCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.PR == null || prCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.PR - prCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      prMarketLine?.line == null || prCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(prCurrentLineRecency.l15ValueMedian - prMarketLine.line, 4),
  });
  const raSignal = buildLiveRaSignal({
    ...comboSignalInput,
    projection: projectedTonight.RA,
    marketLine: raMarketLine,
    ...raCurrentLineRecency,
    projectionMedianDelta:
      projectedTonight.RA == null || raCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(projectedTonight.RA - raCurrentLineRecency.l15ValueMedian, 4),
    medianLineGap:
      raMarketLine?.line == null || raCurrentLineRecency.l15ValueMedian == null
        ? null
        : round(raCurrentLineRecency.l15ValueMedian - raMarketLine.line, 4),
  });
  const liveAvailabilityLabel = formatRotowireAvailabilityLabel(
    lineupSignal?.availabilityStatus ?? null,
    lineupSignal?.availabilityPercentPlay ?? null,
  );

  const playerContext: SnapshotPlayerContext = {
    archetype,
    projectedStarter: lineupStarterLabel(starterStatusLabel(startedLastGame, starterRateLast10), lineupSignal),
    lineupStatus: lineupSignal?.status ?? null,
    lineupStarter: lineupSignal?.lineupStarter ?? null,
    availabilityStatus: lineupSignal?.availabilityStatus ?? null,
    availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
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
          {
            label: "Volatility P/R/A/3",
            value: `${formatNumber(modelLines.PTS.volatility)} / ${formatNumber(modelLines.REB.volatility)} / ${formatNumber(modelLines.AST.volatility)} / ${formatNumber(modelLines.THREES.volatility)}`,
          },
        ],
      },
      {
        id: "lookup-diagnostics",
        title: "Projection Diagnostics",
        description: "Same-opponent nudges, empirical hit rates, and volatility context for the projection engine.",
        status: "DERIVED",
        items: [
          { label: "PTS Same Opp", value: formatSameOpponentSummary(ptsSameOpponentSignal) },
          { label: "REB Same Opp", value: formatSameOpponentSummary(rebSameOpponentSignal) },
          { label: "AST Same Opp", value: formatSameOpponentSummary(astSameOpponentSignal) },
          { label: "3PM Same Opp", value: formatSameOpponentSummary(threesSameOpponentSignal) },
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
            label: "PTS Signal Score",
            value: ptsSignal?.confidence == null ? "-" : `${formatNumber(ptsSignal.confidence)} (${ptsSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "PTS Card Status",
            value: ptsSignal == null ? "-" : ptsSignal.qualified ? "PRECISION READY" : "RAW ONLY",
          },
          {
            label: "PTS Gap / Risk",
            value:
              ptsSignal == null
                ? "-"
                : `${formatSigned(ptsSignal.projectionGap)} / ${formatNumber(ptsSignal.minutesRisk)}`,
          },
          { label: "Empirical O Rate", value: formatEmpiricalHitRateSummary(ptsCurrentLineRecency) },
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
            label: "REB Signal Score",
            value: rebSignal?.confidence == null ? "-" : `${formatNumber(rebSignal.confidence)} (${rebSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "REB Card Status",
            value: rebSignal == null ? "-" : rebSignal.qualified ? "PRECISION READY" : "RAW ONLY",
          },
          {
            label: "REB Gap / Risk",
            value:
              rebSignal == null
                ? "-"
                : `${formatSigned(rebSignal.projectionGap)} / ${formatNumber(rebSignal.minutesRisk)}`,
          },
          { label: "Empirical O Rate", value: formatEmpiricalHitRateSummary(rebCurrentLineRecency) },
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
            label: "AST Signal Score",
            value: astSignal?.confidence == null ? "-" : `${formatNumber(astSignal.confidence)} (${astSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "AST Card Status",
            value: astSignal == null ? "-" : astSignal.qualified ? "PRECISION READY" : "RAW ONLY",
          },
          {
            label: "AST Gap / Risk",
            value:
              astSignal == null
                ? "-"
                : `${formatSigned(astSignal.projectionGap)} / ${formatNumber(astSignal.minutesRisk)}`,
          },
          { label: "Empirical O Rate", value: formatEmpiricalHitRateSummary(astCurrentLineRecency) },
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
            label: "3PM Signal Score",
            value: threesSignal?.confidence == null ? "-" : `${formatNumber(threesSignal.confidence)} (${threesSignal.confidenceTier ?? "LOW"})`,
          },
          {
            label: "3PM Card Status",
            value: threesSignal == null ? "-" : threesSignal.qualified ? "PRECISION READY" : "RAW ONLY",
          },
          {
            label: "3PM Gap / Risk",
            value:
              threesSignal == null
                ? "-"
                : `${formatSigned(threesSignal.projectionGap)} / ${formatNumber(threesSignal.minutesRisk)}`,
          },
          { label: "Empirical O Rate", value: formatEmpiricalHitRateSummary(threesCurrentLineRecency) },
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
          { label: "PRA Card Status", value: praSignal == null ? "-" : praSignal.qualified ? "PRECISION READY" : "RAW ONLY" },
          { label: "Consensus PA Line", value: paMarketLine == null ? "-" : formatNumber(paMarketLine.line) },
          { label: "PA Side", value: paSignal == null ? "-" : paSignal.side },
          { label: "PA Card Status", value: paSignal == null ? "-" : paSignal.qualified ? "PRECISION READY" : "RAW ONLY" },
          { label: "Consensus PR Line", value: prMarketLine == null ? "-" : formatNumber(prMarketLine.line) },
          { label: "PR Side", value: prSignal == null ? "-" : prSignal.side },
          { label: "PR Card Status", value: prSignal == null ? "-" : prSignal.qualified ? "PRECISION READY" : "RAW ONLY" },
          { label: "Consensus RA Line", value: raMarketLine == null ? "-" : formatNumber(raMarketLine.line) },
          { label: "RA Side", value: raSignal == null ? "-" : raSignal.side },
          { label: "RA Card Status", value: raSignal == null ? "-" : raSignal.qualified ? "PRECISION READY" : "RAW ONLY" },
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
          { label: "Lineup Signal", value: describeLineupSignal(lineupSignal) },
          { label: "Live Injury Tag", value: liveAvailabilityLabel ?? "-" },
        ],
      },
    ],
  };

  return {
    detailLevel: "FULL",
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

export async function getSnapshotPlayerRecentLogsData(input: {
  dateEt: string;
  playerId?: string | null;
  playerSearch?: string | null;
}): Promise<{
  playerId: string;
  recentLogs: SnapshotStatLog[];
  analysisLogs: SnapshotStatLog[];
}> {
  const player = await resolveSnapshotPlayer(input);
  if (!player) {
    throw new Error("Player not found.");
  }

  const logsForPlayer = await fetchPlayerCompletedLogs(player.id, input.dateEt);
  if (logsForPlayer.length === 0) {
    throw new Error("No completed-game logs available for this player.");
  }

  return {
    playerId: player.id,
    recentLogs: logsForPlayer.slice(0, 10),
    analysisLogs: logsForPlayer,
  };
}
