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
  buildLiveAstSignal,
  buildLivePaSignal,
  buildLivePraSignal,
  buildLivePrSignal,
  buildLiveRaSignal,
  applyEnhancedPointsProjection,
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
  buildPrecision80Pick,
  PRECISION_80_SYSTEM_SUMMARY_VERSION,
  PRECISION_80_SYSTEM_SUMMARY,
} from "@/lib/snapshot/precisionPickSystem";
import { computeCurrentLineRecencyMetrics } from "@/lib/snapshot/currentLineRecency";
import {
  evaluateLiveUniversalModelSide,
  inspectLiveUniversalModelSide,
} from "@/lib/snapshot/liveUniversalSideModels";
  import {
    getLivePlayerOverrideRuntimeMeta,
    predictLivePlayerModelSide,
  } from "@/lib/snapshot/livePlayerSideModels";
import {
  getLivePraRawFeatureRuntimeMeta,
  predictLivePraRawFeatureSide,
} from "@/lib/snapshot/livePraRawFeatureModel";
import {
  UNIVERSAL_SYSTEM_SUMMARY,
  UNIVERSAL_SYSTEM_SUMMARY_VERSION,
} from "@/lib/snapshot/universalSystemSummary";
import {
  SNAPSHOT_MARKETS,
  buildPlayerPersonalModels,
  buildSameOpponentProjectionSignal,
  projectMinutesProfile,
  projectTonightMetrics,
  type MinutesProjectionProfile,
  type SameOpponentProjectionSignal,
  type TeamSynergyInput,
} from "@/lib/snapshot/projection";
import { computeBenchBigRoleStability, computeMissingFrontcourtLoad } from "@/lib/snapshot/benchBigRoleStability";
import { buildModelLineRecord } from "@/lib/snapshot/modelLines";
import { maybeRefreshTodayLineupSnapshot } from "@/lib/snapshot/liveLineups";
import { formatUtcToEt, getTodayEtDateString } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotDataCompleteness,
  SnapshotGameIntel,
  SnapshotIntelItem,
  SnapshotIntelModule,
  SnapshotMarket,
  SnapshotMatchupOption,
  SnapshotModelSide,
  SnapshotMetricRecord,
  SnapshotPlayerLookupData,
  SnapshotPrecisionPickSignal,
  SnapshotPrimaryDefender,
  SnapshotRow,
  SnapshotStatLog,
  SnapshotTeammateCore,
  SnapshotTeamMatchupStats,
  SnapshotTeamRecord,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type TeamMatchup = {
  teamCode: string;
  opponentCode: string;
  opponentTeamId: string;
  matchupKey: string;
  gameTimeEt: string;
  gameTimeUtc: Date | null;
  isHome: boolean;
};

type MatchupMeta = {
  matchupKey: string;
  awayTeamId: string;
  homeTeamId: string;
  awayTeamCode: string;
  homeTeamCode: string;
  gameTimeEt: string;
};

type TeamAllowanceAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
};

type TeamGameAggregate = {
  teamId: string;
  opponentTeamId: string | null;
  externalGameId: string;
  gameDateEt: string;
  metrics: SnapshotMetricRecord;
};

type TeamGameEnriched = TeamGameAggregate & {
  allowedMetrics: SnapshotMetricRecord | null;
  win: boolean | null;
};

type TeamSummary = {
  seasonFor: SnapshotMetricRecord;
  seasonAllowed: SnapshotMetricRecord;
  last10For: SnapshotMetricRecord;
  last10Allowed: SnapshotMetricRecord;
  seasonRecord: SnapshotTeamRecord;
  last10Record: SnapshotTeamRecord;
};

type PositionToken = "G" | "F" | "C";

type PlayerStatusLog = {
  gameDateEt: string;
  externalGameId: string;
  isHome: boolean | null;
  starter: boolean | null;
  played: boolean | null;
  teamId: string | null;
  opponentTeamId: string | null;
};

type PlayerProfile = {
  playerId: string;
  playerName: string;
  position: string | null;
  teamId: string | null;
  last10Average: SnapshotMetricRecord;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesTrend: number | null;
  minutesVolatility: number | null;
  stocksPer36Last10: number | null;
  startsLast10: number;
  starterRateLast10: number | null;
  startedLastGame: boolean | null;
  archetype: string;
  positionTokens: Set<PositionToken>;
};

const LIVE_FEED_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.SNAPSHOT_LIVE_FEED_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 6_000;
  return Math.min(Math.max(3_000, Math.floor(parsed)), 25_000);
})();

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

const MARKETS: SnapshotMarket[] = SNAPSHOT_MARKETS;
const SNAPSHOT_BOARD_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.SNAPSHOT_BOARD_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300_000;
  return Math.min(Math.max(5_000, Math.floor(parsed)), 10 * 60_000);
})();

type SnapshotBoardCacheEntry = {
  data: SnapshotBoardData;
  sourceSignal: string;
  expiresAt: number;
};

const snapshotBoardCache = new Map<string, SnapshotBoardCacheEntry>();
const SNAPSHOT_BOARD_SETTING_KEY_PREFIX = "snapshot_board:";

type PersistedSnapshotBoardSetting = {
  sourceSignal: string;
  data: SnapshotBoardData;
};

function getSnapshotBoardSettingKey(dateEt: string): string {
  return `${SNAPSHOT_BOARD_SETTING_KEY_PREFIX}${dateEt}`;
}

function latestUpdatedAtIso(...values: Array<Date | null | undefined>): string | null {
  const latestMs = values.reduce<number | null>((current, value) => {
    if (!value) return current;
    const nextMs = value.getTime();
    if (!Number.isFinite(nextMs)) return current;
    return current == null || nextMs > current ? nextMs : current;
  }, null);

  return latestMs == null ? null : new Date(latestMs).toISOString();
}

function isSnapshotBoardData(value: unknown): value is SnapshotBoardData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SnapshotBoardData>;
  return (
    typeof candidate.dateEt === "string" &&
    Array.isArray(candidate.matchups) &&
    Array.isArray(candidate.teamMatchups) &&
    Array.isArray(candidate.rows)
  );
}

function readPersistedSnapshotBoardSetting(value: unknown): PersistedSnapshotBoardSetting | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedSnapshotBoardSetting>;
  if (typeof candidate.sourceSignal !== "string" || !isSnapshotBoardData(candidate.data)) {
    return null;
  }
  return {
    sourceSignal: candidate.sourceSignal,
    data: candidate.data,
  };
}

function getSnapshotBoardRowKey(row: Pick<SnapshotRow, "matchupKey" | "playerId">): string {
  return `${row.matchupKey}|${row.playerId}`;
}

function buildPersistedSnapshotRowMap(
  persistedBoard: PersistedSnapshotBoardSetting | null,
): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>();
  if (!persistedBoard) return map;

  persistedBoard.data.rows.forEach((row) => {
    map.set(getSnapshotBoardRowKey(row), row);
  });

  return map;
}

function hasGameStarted(commenceTimeUtc: Date | null, referenceMs: number): boolean {
  return commenceTimeUtc != null && commenceTimeUtc.getTime() <= referenceMs;
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

function resolveBinarySide(
  value: SnapshotModelSide | null | undefined,
): "OVER" | "UNDER" | null {
  return value === "OVER" || value === "UNDER" ? value : null;
}

function impliedProbabilityFromAmerican(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function deriveProjectionSide(projectedValue: number | null, line: number | null): "OVER" | "UNDER" | null {
  if (projectedValue == null || line == null) return null;
  return projectedValue > line ? "OVER" : "UNDER";
}

function deriveFavoredSide(overPrice: number | null, underPrice: number | null): "OVER" | "UNDER" | "NEUTRAL" {
  const overProbability = impliedProbabilityFromAmerican(overPrice);
  const underProbability = impliedProbabilityFromAmerican(underPrice);
  if (overProbability == null || underProbability == null || overProbability === underProbability) {
    return "NEUTRAL";
  }
  return overProbability > underProbability ? "OVER" : "UNDER";
}

function toBoardPrecisionSignal(signal: SnapshotPrecisionPickSignal | null | undefined): SnapshotPrecisionPickSignal | undefined {
  if (!signal) return undefined;
  return {
    side: signal.side,
    qualified: signal.qualified ?? signal.side !== "NEUTRAL",
    historicalAccuracy: signal.historicalAccuracy,
    historicalPicks: signal.historicalPicks,
    historicalCoveragePct: signal.historicalCoveragePct,
    bucketRecentAccuracy: signal.bucketRecentAccuracy,
    leafAccuracy: signal.leafAccuracy,
    absLineGap: signal.absLineGap,
    projectionWinProbability: signal.projectionWinProbability,
    projectionPriceEdge: signal.projectionPriceEdge,
  };
}

function toBoardPrecisionSignals(
  signals: Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>> | undefined,
): Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>> | undefined {
  if (!signals) return undefined;

  const entries = Object.entries(signals)
    .map(([market, signal]) => {
      const boardSignal = toBoardPrecisionSignal(signal);
      return boardSignal ? ([market, boardSignal] as const) : null;
    })
    .filter((entry): entry is readonly [string, SnapshotPrecisionPickSignal] => entry !== null);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>>;
}

function toBoardSnapshotRow(row: SnapshotRow): SnapshotRow {
  return {
    ...row,
    detailLevel: "BOARD",
    precisionSignals: toBoardPrecisionSignals(row.precisionSignals),
    recentLogs: [],
    analysisLogs: [],
    playerContext: {
      ...row.playerContext,
      primaryDefender: null,
      teammateCore: [],
    },
    gameIntel: {
      generatedAt: "",
      modules: [],
    },
  };
}

function toBoardSnapshotData(data: SnapshotBoardData): SnapshotBoardData {
  return {
    ...data,
    rows: data.rows.map((row) => toBoardSnapshotRow(row)),
  };
}

function parseLineupSnapshot(value: unknown, dateEt: string): RotowireLineupSnapshot | null {
  return parseStoredRotowireLineupSnapshot(value, dateEt);
}

function buildLineupSignalMap(snapshot: RotowireLineupSnapshot | null): Map<string, LineupTeamSignal> {
  const map = new Map<string, LineupTeamSignal>();
  if (!snapshot) return map;

  snapshot.teams.forEach((team) => {
    const code = canonicalTeamCode(team.teamCode);
    map.set(code, {
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

function averageMetricRecordFromProfiles(profiles: PlayerProfile[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const values = profiles
      .map((profile) => profile.last10Average[market])
      .filter((value): value is number => value != null && Number.isFinite(value));
    result[market] = average(values);
  });
  return result;
}

function sumProjectedRotationPoints(profiles: PlayerProfile[], take = 8): number | null {
  const values = profiles
    .slice(0, take)
    .map((profile) => profile.last10Average.PTS)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0), 2);
}

function isLikelyMissingCoreTeammate(input: {
  profile: PlayerProfile;
  teamCode: string;
  lineupMap: Map<string, LineupTeamSignal>;
  statusLogsByPlayerId: Map<string, PlayerStatusLog[]>;
}): boolean {
  const lineupSignal = readLineupSignal(input.lineupMap, input.teamCode, input.profile.playerName);
  const availabilityImpact = deriveRotowireAvailabilityImpact(
    lineupSignal?.availabilityStatus ?? null,
    lineupSignal?.availabilityPercentPlay ?? null,
  );
  if (availabilityImpact.likelyOut) {
    return true;
  }
  if (
    lineupSignal?.status !== "UNKNOWN" &&
    lineupSignal?.lineupStarter === false &&
    (input.profile.starterRateLast10 ?? 0) >= 0.55 &&
    (input.profile.minutesLast10Avg ?? 0) >= 24
  ) {
    return true;
  }

  const latestStatus = input.statusLogsByPlayerId.get(input.profile.playerId)?.[0];
  return latestStatus?.played === false && (input.profile.minutesLast10Avg ?? 0) >= 24;
}

function buildTeammateSynergyInput(input: {
  playerId: string;
  teamCode: string;
  teamProfiles: PlayerProfile[];
  lineupMap: Map<string, LineupTeamSignal>;
  statusLogsByPlayerId: Map<string, PlayerStatusLog[]>;
}): TeamSynergyInput | null {
  const coreProfiles = input.teamProfiles.filter((profile) => profile.playerId !== input.playerId).slice(0, 4);
  if (coreProfiles.length === 0) return null;

  const missingCoreIds = new Set(
    coreProfiles
      .filter((profile) =>
        isLikelyMissingCoreTeammate({
          profile,
          teamCode: input.teamCode,
          lineupMap: input.lineupMap,
          statusLogsByPlayerId: input.statusLogsByPlayerId,
        }),
      )
      .map((profile) => profile.playerId),
  );

  return {
    activeCoreAverage: averageMetricRecordFromProfiles(coreProfiles.filter((profile) => !missingCoreIds.has(profile.playerId))),
    missingCoreAverage: averageMetricRecordFromProfiles(coreProfiles.filter((profile) => missingCoreIds.has(profile.playerId))),
    activeCoreCount: coreProfiles.filter((profile) => !missingCoreIds.has(profile.playerId)).length,
    missingCoreCount: coreProfiles.filter((profile) => missingCoreIds.has(profile.playerId)).length,
  };
}

function applyLineupStarterLabel(baseLabel: string, signal: LineupPlayerSignal | null): string {
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
  const role =
    signal.lineupStarter == null ? "Role Unknown" : signal.lineupStarter ? "Starter" : "Bench";
  const availability = formatRotowireAvailabilityLabel(signal.availabilityStatus, signal.availabilityPercentPlay);
  return availability ? `${signal.status} / ${role} / ${availability}` : `${signal.status} / ${role}`;
}

type CompletenessInput = {
  last10Logs: SnapshotStatLog[];
  statusLast10: PlayerStatusLog[];
  opponentAllowance: SnapshotMetricRecord;
  primaryDefender: SnapshotPrimaryDefender | null;
  teammateCore: SnapshotTeammateCore[];
  playerProfile: PlayerProfile | null;
};

function computeDataCompleteness(input: CompletenessInput): SnapshotDataCompleteness {
  const issues: string[] = [];

  const sampleCoverageRaw = Math.min(input.last10Logs.length / 10, 1);
  const sampleCoverage = round(sampleCoverageRaw * 100, 1);
  if (input.last10Logs.length < 8) {
    issues.push(`Only ${input.last10Logs.length} completed logs (need 10 for full confidence).`);
  }

  const statusDenominator = Math.max(1, input.statusLast10.length);
  const starterKnown = input.statusLast10.filter((log) => log.starter != null).length;
  const playedKnown = input.statusLast10.filter((log) => log.played != null).length;
  const statusCoverageRaw =
    input.statusLast10.length === 0 ? 0 : (starterKnown + playedKnown) / (2 * statusDenominator);
  const statusCoverage = round(statusCoverageRaw * 100, 1);
  if (input.statusLast10.length < 8) {
    issues.push(`Starter/availability logs only found for ${input.statusLast10.length} recent games.`);
  }
  if (statusCoverageRaw < 0.7) {
    issues.push("Starter/played status has partial null coverage.");
  }

  const contextSignals = [
    input.opponentAllowance.PTS != null,
    input.opponentAllowance.REB != null,
    input.opponentAllowance.AST != null,
    input.primaryDefender != null,
    input.teammateCore.length >= 2,
  ];
  const contextCoverageRaw = contextSignals.filter(Boolean).length / contextSignals.length;
  const contextCoverage = round(contextCoverageRaw * 100, 1);
  if (input.primaryDefender == null) {
    issues.push("Primary defender projection missing.");
  }
  if (input.teammateCore.length < 2) {
    issues.push("Limited teammate context.");
  }

  const stabilitySignals = [
    input.playerProfile?.minutesLast10Avg != null,
    input.playerProfile?.minutesVolatility != null,
    input.playerProfile?.starterRateLast10 != null,
    input.playerProfile?.stocksPer36Last10 != null,
  ];
  const stabilityCoverageRaw = stabilitySignals.filter(Boolean).length / stabilitySignals.length;
  const stabilityCoverage = round(stabilityCoverageRaw * 100, 1);
  if (input.playerProfile?.minutesLast10Avg == null) {
    issues.push("No minutes baseline.");
  }
  if (input.playerProfile?.minutesVolatility == null) {
    issues.push("No minutes volatility sample.");
  }

  const scoreRaw =
    sampleCoverageRaw * 0.35 +
    statusCoverageRaw * 0.25 +
    contextCoverageRaw * 0.25 +
    stabilityCoverageRaw * 0.15;
  const score = Math.max(0, Math.min(100, Math.round(scoreRaw * 100)));
  const tier: SnapshotDataCompleteness["tier"] = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

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

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function daysBetweenEt(fromEt: string, toEt: string): number | null {
  const from = new Date(`${fromEt}T00:00:00Z`).getTime();
  const to = new Date(`${toEt}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

function addIntelItem(items: SnapshotIntelItem[], label: string, value: string, hint?: string): void {
  items.push({ label, value, hint });
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

function valueByMarket(log: SnapshotStatLog, market: SnapshotMarket): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function parsePositionTokens(position: string | null): Set<PositionToken> {
  const tokens = new Set<PositionToken>();
  const normalized = (position ?? "").toUpperCase();
  if (normalized.includes("G")) tokens.add("G");
  if (normalized.includes("F")) tokens.add("F");
  if (normalized.includes("C")) tokens.add("C");
  return tokens;
}

function isDefenderCompatible(offense: Set<PositionToken>, defense: Set<PositionToken>): boolean {
  if (offense.size === 0 || defense.size === 0) return true;
  if (offense.has("G")) {
    return defense.has("G") || defense.has("F");
  }
  if (offense.has("C")) {
    return defense.has("C") || defense.has("F");
  }
  return defense.has("F") || defense.has("G") || defense.has("C");
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

function fallbackStarterLabel(rotationRank: number | null, minutesLast10Avg: number | null): string {
  if (rotationRank == null || minutesLast10Avg == null) return "Unknown";
  if (rotationRank <= 5 && minutesLast10Avg >= 20) return "Likely Starter";
  if (rotationRank <= 7 && minutesLast10Avg >= 16) return "Fringe Starter";
  return "Bench / Reserve";
}

function starterStatusLabel(input: {
  startedLastGame: boolean | null;
  starterRateLast10: number | null;
  rotationRank: number | null;
  minutesLast10Avg: number | null;
}): string {
  const { startedLastGame, starterRateLast10, rotationRank, minutesLast10Avg } = input;
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter";
  if (startedLastGame === true && starterRateLast10 != null && starterRateLast10 >= 0.3) return "Spot Starter";
  if (startedLastGame === false && starterRateLast10 != null && starterRateLast10 >= 0.6) return "Starter (recent bench)";
  if (starterRateLast10 != null && starterRateLast10 >= 0.5) return "Likely Starter";
  if (starterRateLast10 != null && starterRateLast10 <= 0.2) return "Bench";
  return fallbackStarterLabel(rotationRank, minutesLast10Avg);
}

function choosePrimaryDefender(
  player: PlayerProfile,
  opponentProfiles: PlayerProfile[],
): SnapshotPrimaryDefender | null {
  if (opponentProfiles.length === 0) return null;

  const compatible = opponentProfiles.filter((candidate) =>
    isDefenderCompatible(player.positionTokens, candidate.positionTokens),
  );
  const ranked = (compatible.length > 0 ? compatible : opponentProfiles)
    .filter((candidate) => (candidate.minutesLast10Avg ?? 0) > 8)
    .sort((a, b) => (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0));

  const defender = ranked[0] ?? null;
  if (!defender) return null;

  return {
    playerId: defender.playerId,
    playerName: defender.playerName,
    position: defender.position,
    avgMinutesLast10: defender.minutesLast10Avg,
    stocksPer36Last10: defender.stocksPer36Last10,
    matchupReason:
      compatible.length > 0
        ? "Position-matched highest-minute defender"
        : "Highest-minute defender available",
  };
}

type IntelBuildInput = {
  dateEt: string;
  teamCode: string;
  opponentCode: string;
  isHome: boolean;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  playerProfile: PlayerProfile | null;
  teamProfiles: PlayerProfile[];
  opponentProfiles: PlayerProfile[];
  primaryDefender: SnapshotPrimaryDefender | null;
  teammateCore: SnapshotTeammateCore[];
  last10Logs: SnapshotStatLog[];
  last5Logs: SnapshotStatLog[];
  statusLast10: PlayerStatusLog[];
  playerLineupSignal: LineupPlayerSignal | null;
  liveTaggedCoreTeammates: string[];
  liveUnavailableCoreCount: number;
  teammateUnavailableLastGame: number;
  teammateUnknownStatusLastGame: number;
  opponentStarterShareTop5: number | null;
  seasonAverage: SnapshotMetricRecord;
  last10Average: SnapshotMetricRecord;
  last3Average: SnapshotMetricRecord;
  opponentAllowance: SnapshotMetricRecord;
  opponentAllowanceDelta: SnapshotMetricRecord;
  teamSummary: TeamSummary;
  opponentSummary: TeamSummary;
};

function buildGameIntel(input: IntelBuildInput): SnapshotGameIntel {
  const modules: SnapshotIntelModule[] = [];
  const statusLogs = input.statusLast10;
  const playedLast10 = statusLogs.length
    ? statusLogs.filter((log) => log.played !== false).length
    : input.last10Logs.length;
  const startsLast10 = statusLogs.length
    ? statusLogs.filter((log) => log.starter === true).length
    : input.last10Logs.filter((log) => log.starter === true).length;
  const restDays = statusLogs[0]
    ? daysBetweenEt(statusLogs[0].gameDateEt, input.dateEt)
    : input.last10Logs[0]
      ? daysBetweenEt(input.last10Logs[0].gameDateEt, input.dateEt)
      : null;

  const minutes = input.playerProfile?.minutesLast10Avg;
  const pts = input.last10Average.PTS ?? 0;
  const reb = input.last10Average.REB ?? 0;
  const ast = input.last10Average.AST ?? 0;
  const threes = input.last10Average.THREES ?? 0;
  const usageProxy = minutes && minutes > 0 ? round(((pts + ast * 1.4) / minutes) * 36, 2) : null;
  const assistLoadPer36 = minutes && minutes > 0 ? round((ast / minutes) * 36, 2) : null;
  const reboundLoadPer36 = minutes && minutes > 0 ? round((reb / minutes) * 36, 2) : null;
  const threeRatePer36 = minutes && minutes > 0 ? round((threes / minutes) * 36, 2) : null;

  const rotationItems: SnapshotIntelItem[] = [];
  addIntelItem(rotationItems, "Expected Minutes", formatNumber(input.playerProfile?.minutesLast10Avg));
  addIntelItem(rotationItems, "Minutes Trend", formatSigned(input.playerProfile?.minutesTrend));
  addIntelItem(rotationItems, "Minutes Volatility", formatNumber(input.playerProfile?.minutesVolatility));
  addIntelItem(rotationItems, "Starter Rate L10", formatPercent(input.playerProfile?.starterRateLast10 ?? null));
  addIntelItem(
    rotationItems,
    "Closing Role Probability",
    minutes == null ? "-" : `${Math.max(10, Math.min(95, Math.round(((minutes - 16) / 18) * 100)))}%`,
  );
  addIntelItem(rotationItems, "Foul Risk Proxy", input.playerProfile?.stocksPer36Last10 != null && input.playerProfile.stocksPer36Last10 > 3.8 ? "HIGH" : "MED");
  modules.push({
    id: "rotation-tracker",
    title: "1. Live Rotation Tracker",
    description: "Minutes, starter role, and closing-time volatility.",
    status: "DERIVED",
    items: rotationItems,
  });

  const environmentItems: SnapshotIntelItem[] = [];
  addIntelItem(environmentItems, "Game Total", formatNumber(input.openingTotal));
  addIntelItem(environmentItems, "Team Spread", formatSigned(input.openingTeamSpread));
  addIntelItem(
    environmentItems,
    "Environment Signal",
    input.openingTotal != null && input.openingTotal >= 235
      ? "FAST/HIGH TOTAL"
      : input.openingTotal != null && input.openingTotal <= 222
        ? "SLOW/LOW TOTAL"
        : "NEUTRAL",
  );
  addIntelItem(
    environmentItems,
    "Blowout Risk",
    input.openingTeamSpread != null && Math.abs(input.openingTeamSpread) >= 8
      ? "HIGH"
      : input.openingTeamSpread != null && Math.abs(input.openingTeamSpread) >= 5
        ? "MEDIUM"
        : "LOW",
  );
  modules.push({
    id: "game-environment",
    title: "1B. Game Environment",
    description: "Opening spread and total context used by the projection layer.",
    status: "LIVE",
    items: environmentItems,
  });

  const lineupItems: SnapshotIntelItem[] = [];
  addIntelItem(
    lineupItems,
    "Top 3 Core Teammates",
    input.teammateCore.length
      ? input.teammateCore.map((mate) => `${mate.playerName} (${formatNumber(mate.avgMinutesLast10)}m)`).join(" | ")
      : "-",
  );
  const topAstMate = input.teammateCore
    .filter((mate) => mate.avgAST10 != null)
    .sort((a, b) => (b.avgAST10 ?? 0) - (a.avgAST10 ?? 0))[0];
  addIntelItem(
    lineupItems,
    "Primary Teammate Creator",
    topAstMate ? `${topAstMate.playerName} (${formatNumber(topAstMate.avgAST10)} AST)` : "-",
  );
  addIntelItem(
    lineupItems,
    "Teammate Usage Pressure",
    input.teammateCore.length > 0
      ? formatNumber(
          round(
            input.teammateCore.reduce((sum, mate) => sum + (mate.avgPRA10 ?? 0), 0) /
              input.teammateCore.length,
            2,
          ),
        )
      : "-",
  );
  addIntelItem(
    lineupItems,
    "On/Off Proxy",
    input.teammateCore.length > 0 && (input.teammateCore[0]?.avgPRA10 ?? 0) > 35 ? "Star teammate heavy" : "Balanced",
  );
  modules.push({
    id: "lineup-context",
    title: "2. On-Court Lineup Context",
    description: "Teammate-driven environment and role competition.",
    status: "DERIVED",
    items: lineupItems,
  });

  const usageItems: SnapshotIntelItem[] = [];
  addIntelItem(usageItems, "Usage Proxy /36", formatNumber(usageProxy));
  addIntelItem(usageItems, "Assist Load /36", formatNumber(assistLoadPer36));
  addIntelItem(usageItems, "Rebound Load /36", formatNumber(reboundLoadPer36));
  addIntelItem(usageItems, "3PM Rate /36", formatNumber(threeRatePer36));
  addIntelItem(
    usageItems,
    "Opportunity Signal",
    usageProxy != null && usageProxy >= 34 ? "ELITE" : usageProxy != null && usageProxy >= 26 ? "STRONG" : "NORMAL",
  );
  modules.push({
    id: "usage-opportunity",
    title: "3. Usage + Opportunity Metrics",
    description: "Possession-level opportunity based on per-minute production proxies.",
    status: "DERIVED",
    items: usageItems,
  });

  const defenderItems: SnapshotIntelItem[] = [];
  if (input.primaryDefender) {
    addIntelItem(
      defenderItems,
      "Expected Primary Defender",
      `${input.primaryDefender.playerName} (${input.primaryDefender.position ?? "N/A"})`,
    );
    addIntelItem(defenderItems, "Defender Minutes L10", formatNumber(input.primaryDefender.avgMinutesLast10));
    addIntelItem(defenderItems, "Defender Stocks/36", formatNumber(input.primaryDefender.stocksPer36Last10));
    addIntelItem(defenderItems, "Assignment Logic", input.primaryDefender.matchupReason);
  } else {
    addIntelItem(defenderItems, "Expected Primary Defender", "Not enough matchup data");
  }
  const secondaryDefenders = input.opponentProfiles
    .filter((profile) => profile.playerId !== input.primaryDefender?.playerId)
    .sort((a, b) => (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0))
    .slice(0, 2)
    .map((profile) => profile.playerName);
  addIntelItem(defenderItems, "Secondary Defenders", secondaryDefenders.length ? secondaryDefenders.join(", ") : "-");
  modules.push({
    id: "defender-timeline",
    title: "4. Primary Defender Timeline",
    description: "Likely direct and secondary defensive assignments.",
    status: "DERIVED",
    items: defenderItems,
  });

  const shotItems: SnapshotIntelItem[] = [];
  const nonThreePoints = pts - threes * 3;
  const threePointShare = pts > 0 ? round((threes * 3) / pts, 2) : null;
  addIntelItem(shotItems, "3PT Share of Points", formatPercent(threePointShare));
  addIntelItem(shotItems, "Non-3PT Scoring", formatNumber(nonThreePoints >= 0 ? nonThreePoints : null));
  addIntelItem(
    shotItems,
    "Rim Pressure Proxy",
    nonThreePoints >= 14 ? "HIGH" : nonThreePoints >= 8 ? "MED" : "LOW",
  );
  addIntelItem(
    shotItems,
    "Shot Profile",
    threePointShare != null && threePointShare >= 0.45
      ? "Perimeter Heavy"
      : nonThreePoints >= 16
        ? "Interior/Midrange Heavy"
        : "Balanced",
  );
  modules.push({
    id: "shot-quality",
    title: "5. Shot Quality + Zone Profile",
    description: "Scoring composition and floor profile proxies.",
    status: "DERIVED",
    items: shotItems,
  });

  const playTypeItems: SnapshotIntelItem[] = [];
  addIntelItem(playTypeItems, "Creator Index", formatNumber(assistLoadPer36));
  addIntelItem(
    playTypeItems,
    "Finisher Index",
    formatNumber(minutes && minutes > 0 ? round(((pts - ast * 0.6) / minutes) * 36, 2) : null),
  );
  addIntelItem(playTypeItems, "Board Impact /36", formatNumber(reboundLoadPer36));
  addIntelItem(
    playTypeItems,
    "Primary Play Type",
    assistLoadPer36 != null && assistLoadPer36 >= 9
      ? "Lead PnR Creator"
      : reboundLoadPer36 != null && reboundLoadPer36 >= 10
        ? "Interior Finisher"
        : threeRatePer36 != null && threeRatePer36 >= 3
          ? "Spot-up / Off-screen"
          : "Hybrid",
  );
  modules.push({
    id: "play-type",
    title: "6. Play-Type Profile",
    description: "How the player most likely generates stat volume.",
    status: "DERIVED",
    items: playTypeItems,
  });

  const scriptItems: SnapshotIntelItem[] = [];
  const teamPts = input.teamSummary.last10For.PTS ?? 0;
  const oppPts = input.opponentSummary.last10For.PTS ?? 0;
  const impliedTotalProxy = round(teamPts + oppPts, 1);
  const recordDiff =
    (input.teamSummary.last10Record.wins - input.teamSummary.last10Record.losses) -
    (input.opponentSummary.last10Record.wins - input.opponentSummary.last10Record.losses);
  addIntelItem(scriptItems, "Implied Total Proxy", formatNumber(impliedTotalProxy));
  addIntelItem(scriptItems, "Team Form Edge", formatSigned(recordDiff));
  addIntelItem(
    scriptItems,
    "Blowout Risk",
    Math.abs(recordDiff) >= 6 ? "HIGH" : Math.abs(recordDiff) >= 3 ? "MED" : "LOW",
  );
  addIntelItem(
    scriptItems,
    "Close-Game Minutes Boost",
    Math.abs(recordDiff) <= 2 ? "LIKELY" : "UNLIKELY",
  );
  addIntelItem(
    scriptItems,
    "OT Risk",
    Math.abs(recordDiff) <= 1 && impliedTotalProxy >= 225 ? "ELEVATED" : "NORMAL",
  );
  modules.push({
    id: "game-script",
    title: "7. Game Script Engine",
    description: "Projected game environment and volatility.",
    status: "DERIVED",
    items: scriptItems,
  });

  const schemeItems: SnapshotIntelItem[] = [];
  addIntelItem(schemeItems, "Opp Allow PTS", formatNumber(input.opponentAllowance.PTS));
  addIntelItem(schemeItems, "Opp Allow REB", formatNumber(input.opponentAllowance.REB));
  addIntelItem(schemeItems, "Opp Allow AST", formatNumber(input.opponentAllowance.AST));
  addIntelItem(schemeItems, "Opp Delta PTS", formatSigned(input.opponentAllowanceDelta.PTS));
  addIntelItem(schemeItems, "Opp Delta PRA", formatSigned(input.opponentAllowanceDelta.PRA));
  modules.push({
    id: "team-scheme",
    title: "8. Team Scheme Dashboard",
    description: "Opponent defensive allowance baseline by market.",
    status: "LIVE",
    items: schemeItems,
  });

  const newsItems: SnapshotIntelItem[] = [];
  const latestStatus = statusLogs[0] ?? null;
  const liveAvailabilityLabel = formatRotowireAvailabilityLabel(
    input.playerLineupSignal?.availabilityStatus ?? null,
    input.playerLineupSignal?.availabilityPercentPlay ?? null,
  );
  const latestStatusLabel =
    latestStatus == null
      ? "Unknown"
      : latestStatus.played === false
        ? "DNP"
        : latestStatus.starter === true
          ? "Started"
          : "Active (bench)";
  const availabilitySignal =
    playedLast10 >= 9
      ? "Stable Available"
      : playedLast10 >= 7
        ? "Mostly Available"
        : "Volatile Availability";
  addIntelItem(newsItems, "Played Last 10", `${playedLast10}/10`);
  addIntelItem(newsItems, "Started Last 10", `${startsLast10}/10`);
  addIntelItem(newsItems, "Latest Status", latestStatusLabel);
  addIntelItem(newsItems, "Live Lineup Feed", describeLineupSignal(input.playerLineupSignal));
  addIntelItem(newsItems, "Live Injury Tag", liveAvailabilityLabel ?? "-");
  addIntelItem(newsItems, "Availability Signal", availabilitySignal);
  addIntelItem(newsItems, "Core Teammates Tagged (Live)", `${input.liveTaggedCoreTeammates.length}/${input.teammateCore.length}`);
  addIntelItem(newsItems, "Core Teammates Likely Out (Live)", `${input.liveUnavailableCoreCount}/${input.teammateCore.length}`);
  addIntelItem(
    newsItems,
    "Tagged Core Teammates",
    input.liveTaggedCoreTeammates.length > 0 ? input.liveTaggedCoreTeammates.join(" | ") : "-",
  );
  addIntelItem(
    newsItems,
    "Core Teammates Out (Last Game)",
    `${input.teammateUnavailableLastGame}/${input.teammateCore.length}`,
  );
  addIntelItem(
    newsItems,
    "Core Teammates Unknown",
    `${input.teammateUnknownStatusLastGame}/${input.teammateCore.length}`,
  );
  addIntelItem(
    newsItems,
    "Opponent Starter Continuity",
    input.opponentStarterShareTop5 == null ? "-" : formatPercent(input.opponentStarterShareTop5),
  );
  modules.push({
    id: "news-status",
    title: "10. News/Status Event Feed",
    description: "Availability and lineup status signals.",
    status: "LIVE",
    items: newsItems,
  });

  const scheduleLogs = statusLogs.length
    ? statusLogs.map((log) => ({ gameDateEt: log.gameDateEt, isHome: log.isHome }))
    : input.last10Logs.map((log) => ({ gameDateEt: log.gameDateEt, isHome: log.isHome }));
  const gamesLast4 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 3;
  }).length;
  const gamesLast7 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 6;
  }).length;
  const last5Sites = scheduleLogs.slice(0, 5).map((log) => log.isHome);
  let siteSwitchesLast5 = 0;
  for (let index = 1; index < last5Sites.length; index += 1) {
    const previous = last5Sites[index - 1];
    const current = last5Sites[index];
    if (previous != null && current != null && previous !== current) {
      siteSwitchesLast5 += 1;
    }
  }
  const firstSite = scheduleLogs[0]?.isHome ?? null;
  let siteStreak = 0;
  for (const log of scheduleLogs) {
    if (log.isHome == null || firstSite == null || log.isHome !== firstSite) break;
    siteStreak += 1;
  }
  const awayLast4 = scheduleLogs.filter((log) => {
    const days = daysBetweenEt(log.gameDateEt, input.dateEt);
    return days != null && days <= 3 && log.isHome === false;
  }).length;
  const travelStress =
    awayLast4 >= 2 || siteSwitchesLast5 >= 2
      ? "HIGH"
      : awayLast4 >= 1 || siteSwitchesLast5 >= 1
        ? "MED"
        : "LOW";

  const refItems: SnapshotIntelItem[] = [];
  addIntelItem(refItems, "Rest Days", restDays == null ? "-" : String(restDays));
  addIntelItem(refItems, "Back-to-Back", restDays === 0 ? "YES" : "NO");
  addIntelItem(refItems, "Games Last 4 Days", String(gamesLast4));
  addIntelItem(refItems, "Games Last 7 Days", String(gamesLast7));
  addIntelItem(refItems, "Tonight Venue", input.isHome ? "Home" : "Away");
  addIntelItem(
    refItems,
    "Site Streak",
    firstSite == null ? "-" : `${firstSite ? "Home" : "Away"} x${siteStreak}`,
  );
  addIntelItem(refItems, "Site Switches L5", String(siteSwitchesLast5));
  addIntelItem(
    refItems,
    "Travel Load Proxy",
    travelStress,
  );
  addIntelItem(refItems, "Ref Crew Published", "No cached pregame assignment");
  modules.push({
    id: "ref-rest-travel",
    title: "11. Ref/Rest/Travel Layer",
    description: "Schedule stress, site movement, and officiating availability context.",
    status: "DERIVED",
    items: refItems,
  });

  const feedbackItems: SnapshotIntelItem[] = [];
  const aboveSeasonLast5 = input.last5Logs.filter((log) => log.points > (input.seasonAverage.PTS ?? 0)).length;
  addIntelItem(feedbackItems, "Above Season Baseline (L5)", `${aboveSeasonLast5}/5`);
  addIntelItem(
    feedbackItems,
    "L3 vs L10 Momentum",
    formatSigned(
      input.last3Average.PTS == null || input.last10Average.PTS == null
        ? null
        : round(input.last3Average.PTS - input.last10Average.PTS, 2),
    ),
  );
  addIntelItem(
    feedbackItems,
    "Calibration State",
    input.playerProfile?.minutesVolatility != null && input.playerProfile.minutesVolatility < 4 ? "STABLE" : "VOLATILE",
  );
  addIntelItem(feedbackItems, "Manual Bet Tracker", "Pending user bet/result logging");
  modules.push({
    id: "postgame-feedback",
    title: "12. Postgame Feedback Loop",
    description: "Performance calibration and learning loop.",
    status: "DERIVED",
    items: feedbackItems,
  });

  return {
    generatedAt: new Date().toISOString(),
    modules,
  };
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = average(logs.map((log) => valueByMarket(log, market)));
  });
  return result;
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

function createAllowanceAgg(): TeamAllowanceAgg {
  return {
    count: 0,
    sums: {
      PTS: 0,
      REB: 0,
      AST: 0,
      THREES: 0,
      PRA: 0,
      PA: 0,
      PR: 0,
      RA: 0,
    },
  };
}

function addToAllowance(agg: TeamAllowanceAgg, points: number, rebounds: number, assists: number, threes: number): void {
  const metrics = metricsFromBase(points, rebounds, assists, threes);
  agg.count += 1;
  MARKETS.forEach((market) => {
    agg.sums[market] += metrics[market] ?? 0;
  });
}

function averageFromAllowance(agg: TeamAllowanceAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) {
    return blankMetricRecord();
  }
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = round(agg.sums[market] / agg.count, 2);
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

function averageFromMetrics(metricsList: SnapshotMetricRecord[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const values = metricsList
      .map((metric) => metric[market])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    result[market] = average(values);
  });
  return result;
}

function recordFromGames(games: TeamGameEnriched[]): SnapshotTeamRecord {
  let wins = 0;
  let losses = 0;
  games.forEach((game) => {
    if (game.win === true) wins += 1;
    if (game.win === false) losses += 1;
  });
  return { wins, losses };
}

function emptyTeamSummary(): TeamSummary {
  return {
    seasonFor: blankMetricRecord(),
    seasonAllowed: blankMetricRecord(),
    last10For: blankMetricRecord(),
    last10Allowed: blankMetricRecord(),
    seasonRecord: { wins: 0, losses: 0 },
    last10Record: { wins: 0, losses: 0 },
  };
}

function toTimestamp(gameDateEt: string): number {
  return new Date(`${gameDateEt}T00:00:00Z`).getTime();
}

function teamSummaryFromGames(teamGames: TeamGameEnriched[]): TeamSummary {
  const sorted = teamGames.slice().sort((a, b) => {
    const dateDiff = toTimestamp(b.gameDateEt) - toTimestamp(a.gameDateEt);
    if (dateDiff !== 0) return dateDiff;
    return b.externalGameId.localeCompare(a.externalGameId);
  });

  const last10 = sorted.slice(0, 10);
  const seasonFor = averageFromMetrics(sorted.map((game) => game.metrics));
  const seasonAllowed = averageFromMetrics(
    sorted
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );
  const last10For = averageFromMetrics(last10.map((game) => game.metrics));
  const last10Allowed = averageFromMetrics(
    last10
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );

  return {
    seasonFor,
    seasonAllowed,
    last10For,
    last10Allowed,
    seasonRecord: recordFromGames(sorted),
    last10Record: recordFromGames(last10),
  };
}

async function resolveSnapshotPlayer(input: {
  playerId?: string | null;
  playerSearch?: string | null;
}): Promise<{
  id: string;
  fullName: string;
  position: string | null;
  teamId: string | null;
  teamCode: string | null;
} | null> {
  if (input.playerId?.trim()) {
    const player = await prisma.player.findUnique({
      where: { id: input.playerId.trim() },
      select: {
        id: true,
        fullName: true,
        position: true,
        teamId: true,
        team: { select: { abbreviation: true } },
      },
    });
    if (player) {
      return {
        id: player.id,
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
        candidate: {
          id: candidate.id,
          fullName: candidate.fullName,
          position: candidate.position,
          teamId: candidate.teamId,
          teamCode: candidate.team?.abbreviation ?? null,
        },
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.candidate.fullName.localeCompare(right.candidate.fullName);
    });

  return ranked[0]?.candidate ?? null;
}

async function buildSnapshotRowForPlayerDate(playerId: string, dateEt: string): Promise<SnapshotRow | null> {
  const isTodayEt = dateEt === getTodayEtDateString();
  const seasonStartDateEt = getSeasonStartDateEt(dateEt);
  const [player, lineupSetting] = await Promise.all([
    prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        fullName: true,
        position: true,
        teamId: true,
        team: { select: { abbreviation: true } },
      },
    }),
    isTodayEt
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_lineups_today" },
          select: { value: true, updatedAt: true },
        })
      : Promise.resolve(null),
  ]);

  if (!player?.teamId) return null;

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
          gameTimeUtc: game.commenceTimeUtc,
          isHome: true,
        }
      : {
          teamCode: game.awayTeam.abbreviation,
          opponentCode: game.homeTeam.abbreviation,
          opponentTeamId: game.homeTeamId,
          matchupKey: `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
          gameTimeEt: formatUtcToEt(game.commenceTimeUtc),
          gameTimeUtc: game.commenceTimeUtc,
          isHome: false,
        };

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
  const [selectedLogs, selectedStatusLogs, opponentGames, leagueAverageRaw] = await Promise.all([
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
    prisma.playerGameLog.findMany({
      where: {
        playerId: player.id,
        gameDateEt: { lt: dateEt },
      },
      select: {
        playerId: true,
        gameDateEt: true,
        externalGameId: true,
        isHome: true,
        starter: true,
        played: true,
        teamId: true,
        opponentTeamId: true,
      },
      orderBy: [{ gameDateEt: "desc" }],
    }),
    prisma.game.findMany({
      where: {
        gameDateEt: { lt: dateEt },
        OR: [{ homeTeamId: matchup.opponentTeamId }, { awayTeamId: matchup.opponentTeamId }],
      },
      select: {
        externalId: true,
      },
      orderBy: [{ gameDateEt: "desc" }, { externalId: "desc" }],
      take: 10,
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
  ]);

  const logsForPlayer: SnapshotStatLog[] = [];
  selectedLogs.forEach((log) => {
    if (logsForPlayer.length >= 280) return;
    logsForPlayer.push({
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
    });
  });

  const statusForPlayer: PlayerStatusLog[] = [];
  selectedStatusLogs.forEach((log) => {
    if (statusForPlayer.length >= 20) return;
    statusForPlayer.push({
      gameDateEt: log.gameDateEt,
      externalGameId: log.externalGameId,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      teamId: log.teamId,
      opponentTeamId: log.opponentTeamId,
    });
  });

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

  const opponentAgg = createAllowanceAgg();
  opponentAllowanceLogs.forEach((log) => {
    addToAllowance(
      opponentAgg,
      toStat(log.points),
      toStat(log.rebounds),
      toStat(log.assists),
      toStat(log.threes),
    );
  });

  const opponentAllowance = averageFromAllowance(opponentAgg.count > 0 ? opponentAgg : null);
  const leagueAverage = metricsFromBase(
    toStat(leagueAverageRaw._avg.points),
    toStat(leagueAverageRaw._avg.rebounds),
    toStat(leagueAverageRaw._avg.assists),
    toStat(leagueAverageRaw._avg.threes),
  );
  const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);
  if (logsForPlayer.length === 0) return null;

  const logsChronological = logsForPlayer.slice().reverse();
  const statusLast10 = statusForPlayer.slice(0, 10);
  const last5Logs = logsForPlayer.slice(0, 5);
  const last10Logs = logsForPlayer.slice(0, 10);
  const last3Logs = logsForPlayer.slice(0, 3);
  const sameTeamLogs = logsForPlayer.filter((log) => log.teamCode === matchup.teamCode);
  const minutesCurrentTeamLast5Avg = average(sameTeamLogs.slice(0, 5).map((log) => log.minutes));
  const homeAwayLogs = logsForPlayer.filter((log) => log.isHome === matchup.isHome);

  const seasonAverage = averagesByMarket(logsForPlayer);
  const seasonByMarketChronological = arraysByMarket(logsChronological);
  const seasonByMarketRecent = arraysByMarket(logsForPlayer);
  const historyMinutesRecent = logsForPlayer.map((log) => log.minutes);
  const minutesSeasonAvg = average(logsChronological.map((log) => log.minutes));
  const personalModels = buildPlayerPersonalModels({
    historyByMarket: seasonByMarketChronological,
    minutesSeasonAvg,
  });
  const last3Average = averagesByMarket(last3Logs);
  const last10Average = averagesByMarket(last10Logs);
  const homeAwayAverage = averagesByMarket(homeAwayLogs);
  const last5ByMarket = arraysByMarket(last5Logs);
  const last10ByMarket = arraysByMarket(last10Logs);
  const trendVsSeason = trendFrom(last3Average, seasonAverage);
  const computedStartsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
  const computedStarterRateLast10 =
    statusLast10.length > 0 ? round(computedStartsLast10 / statusLast10.length, 2) : null;
  const computedStartedLastGame = statusLast10[0]?.starter ?? null;
  const stealsLast10Avg = average(last10Logs.map((log) => log.steals));
  const blocksLast10Avg = average(last10Logs.map((log) => log.blocks));
  const minutesLast3Avg = average(last3Logs.map((log) => log.minutes));
  const lineupSignal = readLineupSignal(lineupMap, matchup.teamCode, player.fullName);
  const availabilitySeverity = deriveRotowireAvailabilityImpact(
    lineupSignal?.availabilityStatus ?? null,
    lineupSignal?.availabilityPercentPlay ?? null,
  ).severity;
  const minutesLast10Avg = average(last10Logs.map((log) => log.minutes));
  const minutesVolatility = standardDeviation(last10Logs.map((log) => log.minutes));
  const stocksPer36Last10 =
    minutesLast10Avg == null || minutesLast10Avg <= 0 || stealsLast10Avg == null || blocksLast10Avg == null
      ? null
      : round(((stealsLast10Avg + blocksLast10Avg) / minutesLast10Avg) * 36, 2);
  const playerProfile: PlayerProfile = {
    playerId: player.id,
    playerName: player.fullName,
    position: player.position,
    teamId: player.teamId,
    last10Average,
    minutesLast3Avg,
    minutesLast10Avg,
    minutesTrend:
      minutesLast3Avg == null || minutesLast10Avg == null ? null : round(minutesLast3Avg - minutesLast10Avg, 2),
    minutesVolatility,
    stocksPer36Last10,
    startsLast10: computedStartsLast10,
    starterRateLast10: computedStarterRateLast10,
    startedLastGame: computedStartedLastGame,
    archetype: determineArchetype(last10Average, minutesLast10Avg),
    positionTokens: parsePositionTokens(player.position),
  };
  const primaryDefender: SnapshotPrimaryDefender | null = null;
  const teammateCore: SnapshotTeammateCore[] = [];
  const projectedRestDays = statusLast10[0]
    ? daysBetweenEt(statusLast10[0].gameDateEt, dateEt)
    : last10Logs[0]
      ? daysBetweenEt(last10Logs[0].gameDateEt, dateEt)
      : null;
  const minutesProfile = applyAvailabilityToMinutesProfile(
    projectMinutesProfile({
      minutesLast3Avg,
      minutesLast10Avg,
      minutesHomeAwayAvg: average(homeAwayLogs.map((log) => log.minutes)),
      minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      starterRateLast10: computedStarterRateLast10,
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
      historyByMarket: seasonByMarketRecent,
      historyMinutes: historyMinutesRecent,
      sameOpponentByMarket,
      sameOpponentMinutes,
      sampleSize: logsForPlayer.length,
      personalModels,
      minutesSeasonAvg,
      minutesLast3Avg,
      minutesLast10Avg,
      minutesVolatility,
      minutesHomeAwayAvg: average(homeAwayLogs.map((log) => log.minutes)),
      minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      starterRateLast10: computedStarterRateLast10,
      isHome: matchup.isHome,
      playerPosition: player.position,
      restDays: projectedRestDays,
      openingTeamSpread: null,
      availabilitySeverity,
    }),
    lineupSignal,
  );
  const dataCompleteness = computeDataCompleteness({
    last10Logs,
    statusLast10,
    opponentAllowance,
    primaryDefender,
    teammateCore,
    playerProfile,
  });
  const modelLines = buildModelLineRecord({
    projectedTonight,
    last10ByMarket,
    dataCompletenessScore: dataCompleteness.score,
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

  const gameIntel: SnapshotGameIntel = {
    generatedAt: new Date().toISOString(),
    modules: [
      {
        id: "player-lookup-projection",
        title: "Projection Snapshot",
        description: "Single-player projection lookup using the same projection engine as the board.",
        status: "DERIVED",
        items: [
          { label: "Projected Minutes", value: formatNumber(minutesProfile.expected) },
          {
            label: "Minutes Range",
            value:
              minutesProfile.floor == null || minutesProfile.ceiling == null
                ? "-"
                : `${formatNumber(minutesProfile.floor)}-${formatNumber(minutesProfile.ceiling)}`,
          },
          { label: "PTS / REB / AST", value: `${formatNumber(projectedTonight.PTS)} / ${formatNumber(projectedTonight.REB)} / ${formatNumber(projectedTonight.AST)}` },
          { label: "PRA / PA / PR / RA", value: `${formatNumber(projectedTonight.PRA)} / ${formatNumber(projectedTonight.PA)} / ${formatNumber(projectedTonight.PR)} / ${formatNumber(projectedTonight.RA)}` },
          {
            label: "Volatility P/R/A/3",
            value: `${formatNumber(modelLines.PTS.volatility)} / ${formatNumber(modelLines.REB.volatility)} / ${formatNumber(modelLines.AST.volatility)} / ${formatNumber(modelLines.THREES.volatility)}`,
          },
        ],
      },
      {
        id: "player-lookup-diagnostics",
        title: "Projection Diagnostics",
        description: "Same-opponent nudges and volatility context behind the projection.",
        status: "DERIVED",
        items: [
          { label: "PTS Same Opp", value: formatSameOpponentSummary(ptsSameOpponentSignal) },
          { label: "REB Same Opp", value: formatSameOpponentSummary(rebSameOpponentSignal) },
          { label: "AST Same Opp", value: formatSameOpponentSummary(astSameOpponentSignal) },
          { label: "3PM Same Opp", value: formatSameOpponentSummary(threesSameOpponentSignal) },
        ],
      },
      {
        id: "player-lookup-context",
        title: "Matchup Context",
        description: "Fast lookup context for split, form, and opponent allowance.",
        status: "DERIVED",
        items: [
          { label: "L3 vs L10 PTS", value: `${formatNumber(last3Average.PTS)} vs ${formatNumber(last10Average.PTS)}` },
          { label: "Home/Away Split", value: formatNumber(homeAwayAverage.PTS) },
          { label: "Opp Delta PTS", value: formatSigned(opponentAllowanceDelta.PTS) },
          { label: "Current Team Minutes", value: `${formatNumber(minutesCurrentTeamLast5Avg)} (${sameTeamLogs.length} g)` },
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
    ptsSignal: null,
    rebSignal: null,
    astSignal: null,
    threesSignal: null,
    praSignal: null,
    paSignal: null,
    prSignal: null,
    raSignal: null,
    recentLogs: last10Logs,
    analysisLogs: logsForPlayer,
    dataCompleteness,
    playerContext: {
      archetype: playerProfile.archetype,
      projectedStarter: applyLineupStarterLabel(
        starterStatusLabel({
          startedLastGame: playerProfile.startedLastGame,
          starterRateLast10: playerProfile.starterRateLast10,
          rotationRank: null,
          minutesLast10Avg,
        }),
        lineupSignal,
      ),
      lineupStatus: lineupSignal?.status ?? null,
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      availabilityStatus: lineupSignal?.availabilityStatus ?? null,
      availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
      startedLastGame: playerProfile.startedLastGame,
      startsLast10: playerProfile.startsLast10,
      starterRateLast10: playerProfile.starterRateLast10,
      rotationRank: null,
      minutesLast3Avg,
      minutesLast10Avg,
      minutesCurrentTeamAvg: minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: sameTeamLogs.length,
      minutesTrend: playerProfile.minutesTrend,
      minutesVolatility,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      primaryDefender,
      teammateCore,
    },
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

  const exactRow = await buildSnapshotRowForPlayerDate(player.id, input.dateEt);
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
    const previousRow = await buildSnapshotRowForPlayerDate(player.id, previousGame.gameDateEt);
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
    const nextRow = await buildSnapshotRowForPlayerDate(player.id, nextGame.gameDateEt);
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

export async function getSnapshotBoardData(dateEt: string): Promise<SnapshotBoardData> {
  const isTodayEt = dateEt === getTodayEtDateString();
  const nowMs = Date.now();
  const [games, latestGameWrite, latestDataWrite, lineupSetting, refreshSetting] = await Promise.all([
    prisma.game.findMany({
      where: { gameDateEt: dateEt },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ commenceTimeUtc: "asc" }],
    }),
    prisma.game.aggregate({
      where: { gameDateEt: dateEt },
      _max: { updatedAt: true },
    }),
    prisma.playerGameLog.aggregate({
      _max: { updatedAt: true },
    }),
    isTodayEt
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_lineups_today" },
          select: { value: true, updatedAt: true },
        })
      : Promise.resolve(null),
    isTodayEt
      ? prisma.systemSetting.findUnique({
          where: { key: "snapshot_last_refresh" },
          select: { value: true, updatedAt: true },
        })
      : Promise.resolve(null),
  ]);

  const latestRefreshUpdatedAt =
    refreshSetting?.value && typeof refreshSetting.value === "object" && (refreshSetting.value as { dateEt?: unknown }).dateEt === dateEt
      ? refreshSetting.updatedAt
      : null;
  const sourceUpdatedAtIso = latestUpdatedAtIso(
    latestGameWrite._max.updatedAt,
    latestDataWrite._max.updatedAt,
    lineupSetting?.updatedAt,
    latestRefreshUpdatedAt,
  );
  const parsedLineupSnapshot = parseLineupSnapshot(lineupSetting?.value ?? null, dateEt);
    const lineupUpdatedAtIso = lineupSetting?.updatedAt?.toISOString() ?? null;
    const gameUpdatedAtIso = latestGameWrite._max.updatedAt?.toISOString() ?? null;
    const refreshUpdatedAtIso = latestRefreshUpdatedAt?.toISOString() ?? null;
    const promotedPraRuntime = getLivePraRawFeatureRuntimeMeta();
    const playerOverrideRuntime = getLivePlayerOverrideRuntimeMeta();
    const sourceSignal = [
      sourceUpdatedAtIso ?? "none",
      gameUpdatedAtIso ?? "none",
      latestDataWrite._max.updatedAt?.toISOString() ?? "none",
      lineupUpdatedAtIso ?? "none",
    refreshUpdatedAtIso ?? "none",
      UNIVERSAL_SYSTEM_SUMMARY_VERSION,
      PRECISION_80_SYSTEM_SUMMARY_VERSION,
      promotedPraRuntime.enabled
        ? `${promotedPraRuntime.version ?? "unknown"}:${promotedPraRuntime.label ?? "pra-live"}`
        : `pra-raw-feature:${promotedPraRuntime.mode}`,
      `player-overrides:${playerOverrideRuntime.mode}:${playerOverrideRuntime.joelMode}:${playerOverrideRuntime.javonMode}:${playerOverrideRuntime.jaMode}:${playerOverrideRuntime.naeMode}:${playerOverrideRuntime.coleMode}:${playerOverrideRuntime.dejounteMode}:${playerOverrideRuntime.devinMode}:${playerOverrideRuntime.aaronMode}:${playerOverrideRuntime.sabonisMode}:${playerOverrideRuntime.taureanMode}:${playerOverrideRuntime.tristanMode}:${playerOverrideRuntime.marcusMode}:${playerOverrideRuntime.kyleMode}`,
      `player-local-manifest:${playerOverrideRuntime.playerLocalRecoveryManifestMode}:${playerOverrideRuntime.playerLocalRecoveryManifestSignature ?? "none"}`,
    ].join("|");
  const cacheKey = dateEt;
  const cached = snapshotBoardCache.get(cacheKey);
  if (cached && cached.sourceSignal === sourceSignal && cached.expiresAt > Date.now()) {
    return toBoardSnapshotData(cached.data);
  }

  const persistedBoardSetting = await prisma.systemSetting.findUnique({
    where: { key: getSnapshotBoardSettingKey(dateEt) },
    select: { value: true },
  });
  const persistedBoard = readPersistedSnapshotBoardSetting(persistedBoardSetting?.value ?? null);
  const persistedRowMap = buildPersistedSnapshotRowMap(persistedBoard);
  if (persistedBoard && persistedBoard.sourceSignal === sourceSignal) {
    const normalizedPersistedBoard = toBoardSnapshotData(persistedBoard.data);
    snapshotBoardCache.set(cacheKey, {
      data: normalizedPersistedBoard,
      sourceSignal,
      expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
    });
    return normalizedPersistedBoard;
  }

  const lineupSnapshot = parsedLineupSnapshot;
  const lineupMap = buildLineupSignalMap(lineupSnapshot);

  if (games.length === 0) {
    const emptyData = {
      dateEt,
      lastUpdatedAt: sourceUpdatedAtIso,
      matchups: [],
      teamMatchups: [],
      rows: [],
      precisionSystem: PRECISION_80_SYSTEM_SUMMARY,
      universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
    };
    snapshotBoardCache.set(cacheKey, {
      data: emptyData,
      sourceSignal,
      expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
    });
    await prisma.systemSetting.upsert({
      where: { key: getSnapshotBoardSettingKey(dateEt) },
      update: {
        value: {
          sourceSignal,
          data: emptyData,
        },
      },
      create: {
        key: getSnapshotBoardSettingKey(dateEt),
        value: {
          sourceSignal,
          data: emptyData,
        },
      },
    });
    return emptyData;
  }

  const dailyOddsMap = await withTimeoutFallback(fetchDailyGameOddsMap(dateEt), new Map());

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const matchupOptionsByKey = new Map<string, SnapshotMatchupOption>();
  const matchupMetaByKey = new Map<string, MatchupMeta>();
  const startedMatchupTimesByKey = new Map<string, number>();

  for (const game of games) {
    const homeCode = game.homeTeam.abbreviation;
    const awayCode = game.awayTeam.abbreviation;
    const gameTimeEt = formatUtcToEt(game.commenceTimeUtc);
    const matchupKey = `${awayCode}@${homeCode}`;

    if (isTodayEt && hasGameStarted(game.commenceTimeUtc, nowMs)) {
      startedMatchupTimesByKey.set(matchupKey, game.commenceTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER);
    }

    matchupOptionsByKey.set(matchupKey, {
      key: matchupKey,
      awayTeam: awayCode,
      homeTeam: homeCode,
      gameTimeEt,
      label: `${awayCode} @ ${homeCode} - ${gameTimeEt}`,
    });

    matchupMetaByKey.set(matchupKey, {
      matchupKey,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      awayTeamCode: awayCode,
      homeTeamCode: homeCode,
      gameTimeEt,
    });

    if (!matchupByTeamId.has(game.homeTeamId)) {
      matchupByTeamId.set(game.homeTeamId, {
        teamCode: homeCode,
        opponentCode: awayCode,
        opponentTeamId: game.awayTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: true,
      });
    }

    if (!matchupByTeamId.has(game.awayTeamId)) {
      matchupByTeamId.set(game.awayTeamId, {
        teamCode: awayCode,
        opponentCode: homeCode,
        opponentTeamId: game.homeTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: false,
      });
    }
  }

  const relevantTeamIds = Array.from(
    new Set(
      Array.from(matchupMetaByKey.values()).flatMap((meta) => [meta.awayTeamId, meta.homeTeamId]),
    ),
  );

  const groupedTeamGames = await prisma.playerGameLog.groupBy({
    by: ["teamId", "opponentTeamId", "externalGameId", "gameDateEt"],
    where: {
      teamId: { in: relevantTeamIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    _sum: {
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
    },
  });

  const teamGameAggregates: TeamGameAggregate[] = groupedTeamGames
    .map((row) => {
      if (!row.teamId) return null;
      const points = toStat(row._sum.points);
      const rebounds = toStat(row._sum.rebounds);
      const assists = toStat(row._sum.assists);
      const threes = toStat(row._sum.threes);
      return {
        teamId: row.teamId,
        opponentTeamId: row.opponentTeamId,
        externalGameId: row.externalGameId,
        gameDateEt: row.gameDateEt,
        metrics: metricsFromBase(points, rebounds, assists, threes),
      };
    })
    .filter((row): row is TeamGameAggregate => row != null);

  const gameMetricsByGameTeam = new Map<string, SnapshotMetricRecord>();
  const teamGamesByTeamId = new Map<string, TeamGameAggregate[]>();
  teamGameAggregates.forEach((game) => {
    gameMetricsByGameTeam.set(`${game.externalGameId}:${game.teamId}`, game.metrics);
    const list = teamGamesByTeamId.get(game.teamId) ?? [];
    list.push(game);
    teamGamesByTeamId.set(game.teamId, list);
  });

  const teamSummaryByTeamId = new Map<string, TeamSummary>();
  teamGamesByTeamId.forEach((gamesForTeam, teamId) => {
    const enriched: TeamGameEnriched[] = gamesForTeam.map((game) => {
      const allowedMetrics =
        game.opponentTeamId != null
          ? gameMetricsByGameTeam.get(`${game.externalGameId}:${game.opponentTeamId}`) ?? null
          : null;
      const teamPoints = game.metrics.PTS;
      const opponentPoints = allowedMetrics?.PTS ?? null;
      const win =
        teamPoints == null || opponentPoints == null
          ? null
          : teamPoints > opponentPoints
            ? true
            : teamPoints < opponentPoints
              ? false
              : null;
      return {
        ...game,
        allowedMetrics,
        win,
      };
    });

    teamSummaryByTeamId.set(teamId, teamSummaryFromGames(enriched));
  });

  const teamMatchups: SnapshotTeamMatchupStats[] = Array.from(matchupMetaByKey.values())
    .map((meta) => {
      const awaySummary = teamSummaryByTeamId.get(meta.awayTeamId) ?? emptyTeamSummary();
      const homeSummary = teamSummaryByTeamId.get(meta.homeTeamId) ?? emptyTeamSummary();
      return {
        matchupKey: meta.matchupKey,
        awayTeam: meta.awayTeamCode,
        homeTeam: meta.homeTeamCode,
        gameTimeEt: meta.gameTimeEt,
        awaySeasonFor: awaySummary.seasonFor,
        awaySeasonAllowed: awaySummary.seasonAllowed,
        awayLast10For: awaySummary.last10For,
        awayLast10Allowed: awaySummary.last10Allowed,
        awaySeasonRecord: awaySummary.seasonRecord,
        awayLast10Record: awaySummary.last10Record,
        homeSeasonFor: homeSummary.seasonFor,
        homeSeasonAllowed: homeSummary.seasonAllowed,
        homeLast10For: homeSummary.last10For,
        homeLast10Allowed: homeSummary.last10Allowed,
        homeSeasonRecord: homeSummary.seasonRecord,
        homeLast10Record: homeSummary.last10Record,
      };
    })
    .sort((a, b) => a.matchupKey.localeCompare(b.matchupKey));

  const dailyMatchupHints = Array.from(matchupMetaByKey.values()).map((meta) => ({
    awayCode: meta.awayTeamCode,
    homeCode: meta.homeTeamCode,
    matchupKey: meta.matchupKey,
  }));

  const teamIds = Array.from(matchupByTeamId.keys());
  const players = await prisma.player.findMany({
    where: {
      teamId: { in: teamIds },
      isActive: true,
    },
    select: {
      id: true,
      externalId: true,
      fullName: true,
      position: true,
      teamId: true,
    },
    orderBy: [{ fullName: "asc" }],
  });

  if (players.length === 0) {
    const emptyData = {
      dateEt,
      lastUpdatedAt: sourceUpdatedAtIso,
      matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
      teamMatchups,
      rows: [],
    };
    snapshotBoardCache.set(cacheKey, {
      data: emptyData,
      sourceSignal,
      expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
    });
    return emptyData;
  }

  const [
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
      prisma.player.findMany({
        where: { externalId: { not: null } },
        select: { externalId: true, position: true },
      }),
      withTimeoutFallback(fetchSeasonVolumeLogs(dateEt), []),
      withTimeoutFallback(fetchDailyPtsLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyRebLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyAstLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyThreesLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyPraLineMap(dateEt), new Map()),
      withTimeoutFallback(fetchDailyPaLineMap(dateEt), new Map()),
      withTimeoutFallback(fetchDailyPrLineMap(dateEt), new Map()),
      withTimeoutFallback(fetchDailyRaLineMap(dateEt), new Map()),
    ]);
  const positionByExternalId = new Map(
    allPlayerPositions
      .filter((player) => typeof player.externalId === "string" && player.externalId.trim().length > 0)
      .map((player) => [player.externalId as string, player.position]),
  );

  const playerIds = players.map((player) => player.id);
  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    include: {
      team: { select: { abbreviation: true } },
      opponentTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
  });

  const statusLogsRaw = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { lt: dateEt },
    },
    select: {
      playerId: true,
      gameDateEt: true,
      externalGameId: true,
      isHome: true,
      starter: true,
      played: true,
      teamId: true,
      opponentTeamId: true,
    },
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
  });

  const logsByPlayerId = new Map<string, SnapshotStatLog[]>();
  for (const log of logs) {
    const existing = logsByPlayerId.get(log.playerId) ?? [];
    if (existing.length >= 280) {
      continue;
    }

    existing.push({
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
    });
    logsByPlayerId.set(log.playerId, existing);
  }

  const statusLogsByPlayerId = new Map<string, PlayerStatusLog[]>();
  for (const log of statusLogsRaw) {
    const existing = statusLogsByPlayerId.get(log.playerId) ?? [];
    if (existing.length >= 20) continue;
    existing.push({
      gameDateEt: log.gameDateEt,
      externalGameId: log.externalGameId,
      isHome: log.isHome,
      starter: log.starter,
      played: log.played,
      teamId: log.teamId,
      opponentTeamId: log.opponentTeamId,
    });
    statusLogsByPlayerId.set(log.playerId, existing);
  }

  const opponentTeamIds = Array.from(
    new Set(Array.from(matchupByTeamId.values()).map((matchup) => matchup.opponentTeamId)),
  );
  const opponentTeamIdSet = new Set(opponentTeamIds);

  const opponentGameRows = await prisma.game.findMany({
    where: {
      gameDateEt: { lt: dateEt },
      OR: [{ homeTeamId: { in: opponentTeamIds } }, { awayTeamId: { in: opponentTeamIds } }],
    },
    select: {
      externalId: true,
      gameDateEt: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: [{ gameDateEt: "desc" }, { externalId: "desc" }],
  });

  const gameIdsByOpponentTeamId = new Map<string, Set<string>>();
  for (const row of opponentGameRows) {
    const candidateTeamIds = [row.homeTeamId, row.awayTeamId];
    for (const teamId of candidateTeamIds) {
      if (!opponentTeamIdSet.has(teamId)) continue;
      const set = gameIdsByOpponentTeamId.get(teamId) ?? new Set<string>();
      if (set.size >= 10) continue;
      set.add(row.externalId);
      gameIdsByOpponentTeamId.set(teamId, set);
    }
  }

  const relevantGameIds = new Set<string>();
  gameIdsByOpponentTeamId.forEach((set) => {
    set.forEach((id) => relevantGameIds.add(id));
  });

  const opponentAllowanceLogs =
    relevantGameIds.size > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            opponentTeamId: { in: opponentTeamIds },
            externalGameId: { in: Array.from(relevantGameIds) },
            minutes: { gt: 0 },
          },
          select: {
            opponentTeamId: true,
            externalGameId: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];

  const allowanceByOpponentTeamId = new Map<string, TeamAllowanceAgg>();
  const leagueAgg = createAllowanceAgg();

  for (const log of opponentAllowanceLogs) {
    if (!log.opponentTeamId) continue;
    const validGames = gameIdsByOpponentTeamId.get(log.opponentTeamId);
    if (!validGames || !validGames.has(log.externalGameId)) {
      continue;
    }

    const points = toStat(log.points);
    const rebounds = toStat(log.rebounds);
    const assists = toStat(log.assists);
    const threes = toStat(log.threes);

    const teamAgg = allowanceByOpponentTeamId.get(log.opponentTeamId) ?? createAllowanceAgg();
    addToAllowance(teamAgg, points, rebounds, assists, threes);
    allowanceByOpponentTeamId.set(log.opponentTeamId, teamAgg);
    addToAllowance(leagueAgg, points, rebounds, assists, threes);
  }

  const leagueAverage = averageFromAllowance(leagueAgg.count > 0 ? leagueAgg : null);

  const playerProfilesById = new Map<string, PlayerProfile>();
  const teamProfilesByTeamId = new Map<string, PlayerProfile[]>();

  for (const player of players) {
    const logsForPlayer = logsByPlayerId.get(player.id) ?? [];
    const statusForPlayer = statusLogsByPlayerId.get(player.id) ?? [];
    const statusLast10 = statusForPlayer.slice(0, 10);
    const last10Logs = logsForPlayer.slice(0, 10);
    const last3Logs = logsForPlayer.slice(0, 3);
    const last10Average = averagesByMarket(last10Logs);
    const minutesLast10Avg = average(last10Logs.map((log) => log.minutes));
    const minutesLast3Avg = average(last3Logs.map((log) => log.minutes));
    const minutesTrend =
      minutesLast3Avg == null || minutesLast10Avg == null ? null : round(minutesLast3Avg - minutesLast10Avg, 2);
    const minutesVolatility = standardDeviation(last10Logs.map((log) => log.minutes));
    const stealsLast10Avg = average(last10Logs.map((log) => log.steals));
    const blocksLast10Avg = average(last10Logs.map((log) => log.blocks));
    const startsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
    const starterRateLast10 = statusLast10.length > 0 ? round(startsLast10 / statusLast10.length, 2) : null;
    const startedLastGame = statusLast10[0]?.starter ?? null;
    const stocksPer36Last10 =
      minutesLast10Avg == null || minutesLast10Avg <= 0 || stealsLast10Avg == null || blocksLast10Avg == null
        ? null
        : round(((stealsLast10Avg + blocksLast10Avg) / minutesLast10Avg) * 36, 2);

    const profile: PlayerProfile = {
      playerId: player.id,
      playerName: player.fullName,
      position: player.position,
      teamId: player.teamId,
      last10Average,
      minutesLast3Avg,
      minutesLast10Avg,
      minutesTrend,
      minutesVolatility,
      stocksPer36Last10,
      startsLast10,
      starterRateLast10,
      startedLastGame,
      archetype: determineArchetype(last10Average, minutesLast10Avg),
      positionTokens: parsePositionTokens(player.position),
    };

    playerProfilesById.set(player.id, profile);
    if (player.teamId) {
      const existing = teamProfilesByTeamId.get(player.teamId) ?? [];
      existing.push(profile);
      teamProfilesByTeamId.set(player.teamId, existing);
    }
  }

  teamProfilesByTeamId.forEach((profiles, teamId) => {
    profiles.sort((a, b) => {
      const minDiff = (b.minutesLast10Avg ?? 0) - (a.minutesLast10Avg ?? 0);
      if (minDiff !== 0) return minDiff;
      return (b.last10Average.PTS ?? 0) - (a.last10Average.PTS ?? 0);
    });
    teamProfilesByTeamId.set(teamId, profiles);
  });

  const rowsWithSortKeys: Array<{ sortTime: number; row: SnapshotRow }> = [];
  const builtRowKeys = new Set<string>();

  for (const player of players) {
    if (!player.teamId) {
      continue;
    }
    const matchup = matchupByTeamId.get(player.teamId);
    if (!matchup) {
      continue;
    }

    const logsForPlayer = logsByPlayerId.get(player.id) ?? [];
    const logsChronological = logsForPlayer.slice().reverse();
    const statusForPlayer = statusLogsByPlayerId.get(player.id) ?? [];
    const statusLast10 = statusForPlayer.slice(0, 10);
    const last5Logs = logsForPlayer.slice(0, 5);
    const last10Logs = logsForPlayer.slice(0, 10);
    const last3Logs = logsForPlayer.slice(0, 3);
    const last15LogsChronological = logsChronological.slice(-15);
    const sameTeamLogs = logsForPlayer.filter((log) => log.teamCode === matchup.teamCode);
    const minutesCurrentTeamLast5Avg = average(sameTeamLogs.slice(0, 5).map((log) => log.minutes));
    const homeAwayLogs = logsForPlayer.filter((log) => log.isHome === matchup.isHome);

    const seasonAverage = averagesByMarket(logsForPlayer);
    const seasonByMarketChronological = arraysByMarket(logsChronological);
    const seasonByMarketRecent = arraysByMarket(logsForPlayer);
    const historyMinutesRecent = logsForPlayer.map((log) => log.minutes);
    const minutesSeasonAvg = average(logsChronological.map((log) => log.minutes));
    const personalModels = buildPlayerPersonalModels({
      historyByMarket: seasonByMarketChronological,
      minutesSeasonAvg,
    });
    const last3Average = averagesByMarket(last3Logs);
    const last10Average = averagesByMarket(last10Logs);
    const homeAwayAverage = averagesByMarket(homeAwayLogs);
    const last5ByMarket = arraysByMarket(last5Logs);
    const last15ByMarketChronological = arraysByMarket(last15LogsChronological);
    const last10ByMarket = arraysByMarket(last10Logs);
    const trendVsSeason = trendFrom(last3Average, seasonAverage);

    const opponentAgg = allowanceByOpponentTeamId.get(matchup.opponentTeamId) ?? null;
    const opponentAllowance = averageFromAllowance(opponentAgg);
    const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);
    const playerProfile = playerProfilesById.get(player.id) ?? null;
    const teamProfiles = teamProfilesByTeamId.get(player.teamId) ?? [];
    const opponentProfiles = teamProfilesByTeamId.get(matchup.opponentTeamId) ?? [];
    const teamSummary = teamSummaryByTeamId.get(player.teamId) ?? emptyTeamSummary();
    const opponentSummary = teamSummaryByTeamId.get(matchup.opponentTeamId) ?? emptyTeamSummary();
    const rotationRankIndex = teamProfiles.findIndex((profile) => profile.playerId === player.id);
    const rotationRank = rotationRankIndex >= 0 ? rotationRankIndex + 1 : null;
    const primaryDefender = playerProfile ? choosePrimaryDefender(playerProfile, opponentProfiles) : null;
    const teammateCore: SnapshotTeammateCore[] = teamProfiles
      .filter((profile) => profile.playerId !== player.id)
      .slice(0, 3)
      .map((profile) => ({
        playerId: profile.playerId,
        playerName: profile.playerName,
        position: profile.position,
        avgMinutesLast10: profile.minutesLast10Avg,
        avgPRA10: profile.last10Average.PRA,
        avgAST10: profile.last10Average.AST,
      }));
    const teammateSynergy = buildTeammateSynergyInput({
      playerId: player.id,
      teamCode: matchup.teamCode,
      teamProfiles,
      lineupMap,
      statusLogsByPlayerId,
    });
    const teammateUnavailableLastGame = teammateCore.reduce((count, teammate) => {
      const latest = statusLogsByPlayerId.get(teammate.playerId)?.[0];
      return count + (latest?.played === false ? 1 : 0);
    }, 0);
    const teammateUnknownStatusLastGame = teammateCore.reduce((count, teammate) => {
      const latest = statusLogsByPlayerId.get(teammate.playerId)?.[0];
      return count + (latest == null || latest.played == null ? 1 : 0);
    }, 0);
    const opponentTop5 = opponentProfiles.slice(0, 5);
    const opponentStarterShareTop5 =
      opponentTop5.length > 0
        ? round(
            opponentTop5.reduce((sum, profile) => sum + (profile.starterRateLast10 ?? 0), 0) / opponentTop5.length,
            2,
          )
        : null;
    const computedStartsLast10 = statusLast10.reduce((count, log) => count + (log.starter === true ? 1 : 0), 0);
    const computedStarterRateLast10 =
      statusLast10.length > 0 ? round(computedStartsLast10 / statusLast10.length, 2) : null;
    const computedStartedLastGame = statusLast10[0]?.starter ?? null;
    const lineupSignal = readLineupSignal(lineupMap, matchup.teamCode, player.fullName);
    const availabilitySeverity = deriveRotowireAvailabilityImpact(
      lineupSignal?.availabilityStatus ?? null,
      lineupSignal?.availabilityPercentPlay ?? null,
    ).severity;
    const liveTaggedCoreSignals = teammateCore
      .map((teammate) => ({
        teammate,
        signal: readLineupSignal(lineupMap, matchup.teamCode, teammate.playerName),
      }))
      .filter(
        (entry) =>
          entry.signal?.availabilityStatus != null &&
          entry.signal.availabilityStatus !== "ACTIVE",
      );
    const liveTaggedCoreTeammates = liveTaggedCoreSignals.map((entry) => {
      const availability = formatRotowireAvailabilityLabel(
        entry.signal?.availabilityStatus ?? null,
        entry.signal?.availabilityPercentPlay ?? null,
      );
      return availability ? `${entry.teammate.playerName} (${availability})` : entry.teammate.playerName;
    });
    const liveUnavailableCoreCount = liveTaggedCoreSignals.reduce(
      (count, entry) =>
        count +
        (deriveRotowireAvailabilityImpact(
          entry.signal?.availabilityStatus ?? null,
          entry.signal?.availabilityPercentPlay ?? null,
        ).likelyOut
          ? 1
          : 0),
      0,
    );
    const dailyOdds = dailyOddsMap.get(matchup.matchupKey) ?? null;
    const openingTeamSpread = resolveTeamSpreadForMatchup(dailyOdds, matchup.isHome);
    const openingTotal = dailyOdds?.openingTotal ?? null;
    const projectedRestDays = statusLast10[0]
      ? daysBetweenEt(statusLast10[0].gameDateEt, dateEt)
      : last10Logs[0]
        ? daysBetweenEt(last10Logs[0].gameDateEt, dateEt)
        : null;
    const seasonMinutesAvg = average(logsChronological.map((log) => log.minutes));
    const minutesLast10Avg = playerProfile?.minutesLast10Avg ?? average(last10Logs.map((log) => log.minutes));
    const minutesVolatility =
      playerProfile?.minutesVolatility ?? standardDeviation(last10Logs.map((log) => log.minutes));
    const missingFrontcourtLoad = computeMissingFrontcourtLoad(teammateSynergy?.missingCoreAverage ?? null);
    const benchBigRoleStability = computeBenchBigRoleStability({
      archetype: playerProfile?.archetype ?? null,
      minutesVolatility,
      availabilitySeverity,
      missingFrontcourtLoad,
    });
    const minutesProfile = applyAvailabilityToMinutesProfile(
      projectMinutesProfile({
        minutesLast3Avg: playerProfile?.minutesLast3Avg ?? average(last3Logs.map((log) => log.minutes)),
        minutesLast10Avg,
        minutesHomeAwayAvg: average(homeAwayLogs.map((log) => log.minutes)),
        minutesCurrentTeamLast5Avg,
        minutesCurrentTeamGames: sameTeamLogs.length,
        lineupStarter: lineupSignal?.lineupStarter ?? null,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
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
        historyByMarket: seasonByMarketRecent,
        historyMinutes: historyMinutesRecent,
        sameOpponentByMarket,
        sameOpponentMinutes,
        sampleSize: logsForPlayer.length,
        personalModels,
        minutesSeasonAvg,
        minutesLast3Avg: playerProfile?.minutesLast3Avg ?? average(last3Logs.map((log) => log.minutes)),
        minutesLast10Avg,
        minutesVolatility,
        minutesHomeAwayAvg: average(homeAwayLogs.map((log) => log.minutes)),
        minutesCurrentTeamLast5Avg,
        minutesCurrentTeamGames: sameTeamLogs.length,
        lineupStarter: lineupSignal?.lineupStarter ?? null,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
        isHome: matchup.isHome,
        playerPosition: player.position,
        restDays: projectedRestDays,
        openingTeamSpread,
        openingTotal,
        availabilitySeverity,
        teammateSynergy,
      }),
      lineupSignal,
    );
    const activeCorePts =
      teammateSynergy == null
        ? null
        : round((teammateSynergy.activeCoreAverage.PTS ?? 0) * teammateSynergy.activeCoreCount, 2);
    const activeCoreAst =
      teammateSynergy == null
        ? null
        : round((teammateSynergy.activeCoreAverage.AST ?? 0) * teammateSynergy.activeCoreCount, 2);
    const missingCorePts =
      teammateSynergy == null
        ? null
        : round((teammateSynergy.missingCoreAverage.PTS ?? 0) * teammateSynergy.missingCoreCount, 2);
    const missingCoreAst =
      teammateSynergy == null
        ? null
        : round((teammateSynergy.missingCoreAverage.AST ?? 0) * teammateSynergy.missingCoreCount, 2);
    const teamRotationProjectedPts = sumProjectedRotationPoints(teamProfiles);
    const missingCoreShare =
      missingCorePts == null || teamRotationProjectedPts == null || teamRotationProjectedPts <= 0
        ? null
        : round(Math.max(0, Math.min(1, missingCorePts / teamRotationProjectedPts)), 4);
    const minutesLiftPct =
      minutesProfile.expected == null || seasonMinutesAvg == null || seasonMinutesAvg <= 0
        ? null
        : round(minutesProfile.expected / seasonMinutesAvg - 1, 4);
    const stepUpRoleFlag =
      missingCoreShare != null && minutesLiftPct != null && missingCoreShare > 0.2 && minutesLiftPct >= 0.15 ? 1 : 0;
    const openingSpreadAbs = openingTeamSpread == null ? null : round(Math.abs(openingTeamSpread), 3);
    const competitivePaceFactor =
      openingTotal == null ? null : round(openingTotal / Math.max(openingSpreadAbs ?? 0, 1), 4);
    const blowoutRisk =
      openingTotal == null || openingSpreadAbs == null ? null : round(openingSpreadAbs / Math.max(openingTotal, 1), 4);
    const universalUsageContext = {
      seasonMinutesAvg,
      minutesLiftPct,
      activeCorePts,
      activeCoreAst,
      missingCorePts,
      missingCoreAst,
      missingCoreShare,
      stepUpRoleFlag,
    } as const;
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
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
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
    const dataCompleteness = computeDataCompleteness({
      last10Logs,
      statusLast10,
      opponentAllowance,
      primaryDefender,
      teammateCore,
      playerProfile,
    });
    const modelLines = buildModelLineRecord({
      projectedTonight,
      last10ByMarket,
      dataCompletenessScore: dataCompleteness.score,
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
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      minutesVolatility,
      ...universalUsageContext,
      benchBigRoleStability,
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
      completenessScore: dataCompleteness.score,
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
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      minutesVolatility,
      ...universalUsageContext,
      benchBigRoleStability,
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
      completenessScore: dataCompleteness.score,
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
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      minutesVolatility,
      ...universalUsageContext,
      benchBigRoleStability,
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
      completenessScore: dataCompleteness.score,
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
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      minutesVolatility,
      ...universalUsageContext,
      benchBigRoleStability,
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
      completenessScore: dataCompleteness.score,
    });
    const comboSignalInput = {
      gameDateEt: dateEt,
      projection: null,
      marketLine: null,
      openingTotal,
      openingTeamSpread,
      playerName: player.fullName,
      playerPosition: player.position,
      lineupStarter: lineupSignal?.lineupStarter ?? null,
      lineupStatus: lineupSignal?.status ?? null,
      availabilityStatus: lineupSignal?.availabilityStatus ?? null,
      availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      projectedMinutes: minutesProfile.expected,
      projectedMinutesFloor: minutesProfile.floor,
      projectedMinutesCeiling: minutesProfile.ceiling,
      minutesVolatility,
      ...universalUsageContext,
      benchBigRoleStability,
      competitivePaceFactor,
      blowoutRisk,
      completenessScore: dataCompleteness.score,
      assistProjection: projectedTonight.AST,
      projectedPoints: projectedTonight.PTS,
      projectedRebounds: projectedTonight.REB,
      projectedAssists: projectedTonight.AST,
      threesProjection: projectedTonight.THREES,
      playerShotPressure,
      opponentShotVolume,
    };
    let praSignal = buildLivePraSignal({
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
    let promotedPraFinalSide: SnapshotModelSide = praSignal?.baselineSide ?? modelLines.PRA.modelSide;
    const praProjectionSide = deriveProjectionSide(projectedTonight.PRA, praMarketLine?.line ?? null);
    if (
      promotedPraRuntime.enabled &&
      praSignal != null &&
      projectedTonight.PRA != null &&
      praProjectionSide != null &&
      praMarketLine?.line != null
    ) {
      const praBaselineSide = resolveBinarySide(praSignal.baselineSide) ?? praProjectionSide;
      const praUniversalInput = {
        gameDateEt: dateEt,
        market: "PRA" as const,
        projectedValue: projectedTonight.PRA,
        line: praMarketLine.line,
        overPrice: praMarketLine.overPrice ?? null,
        underPrice: praMarketLine.underPrice ?? null,
        finalSide: praBaselineSide,
        l5CurrentLineDeltaAvg: praCurrentLineRecency.l5CurrentLineDeltaAvg ?? null,
        l5CurrentLineOverRate: praCurrentLineRecency.l5CurrentLineOverRate ?? null,
        l5MinutesAvg: praCurrentLineRecency.l5MinutesAvg ?? null,
        emaCurrentLineDelta: praCurrentLineRecency.emaCurrentLineDelta ?? null,
        emaCurrentLineOverRate: praCurrentLineRecency.emaCurrentLineOverRate ?? null,
        emaMinutesAvg: praCurrentLineRecency.emaMinutesAvg ?? null,
        l15ValueMean: praCurrentLineRecency.l15ValueMean ?? null,
        l15ValueMedian: praCurrentLineRecency.l15ValueMedian ?? null,
        l15ValueStdDev: praCurrentLineRecency.l15ValueStdDev ?? null,
        l15ValueSkew: praCurrentLineRecency.l15ValueSkew ?? null,
        projectionMedianDelta:
          projectedTonight.PRA == null || praCurrentLineRecency.l15ValueMedian == null
            ? null
            : round(projectedTonight.PRA - praCurrentLineRecency.l15ValueMedian, 4),
        medianLineGap:
          praCurrentLineRecency.l15ValueMedian == null
            ? null
            : round(praCurrentLineRecency.l15ValueMedian - praMarketLine.line, 4),
        competitivePaceFactor,
        blowoutRisk,
        seasonMinutesAvg: minutesLast10Avg,
        minutesLiftPct: universalUsageContext.minutesLiftPct ?? null,
        activeCorePts: universalUsageContext.activeCorePts ?? null,
        activeCoreAst: universalUsageContext.activeCoreAst ?? null,
        missingCorePts: universalUsageContext.missingCorePts ?? null,
        missingCoreAst: universalUsageContext.missingCoreAst ?? null,
        missingCoreShare: universalUsageContext.missingCoreShare ?? null,
        stepUpRoleFlag: universalUsageContext.stepUpRoleFlag ?? null,
        expectedMinutes: minutesProfile.expected,
        minutesVolatility,
        benchBigRoleStability,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
        archetypeExpectedMinutes: minutesLast10Avg,
        archetypeStarterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
        openingTeamSpread,
        openingTotal,
        lineupTimingConfidence: praSignal.lineupTimingConfidence ?? null,
        completenessScore: dataCompleteness.score,
        playerPosition: player.position,
        assistProjection: projectedTonight.AST,
        pointsProjection: projectedTonight.PTS,
        reboundsProjection: projectedTonight.REB,
        threesProjection: projectedTonight.THREES,
      };
      const praRawDecision = inspectLiveUniversalModelSide(praUniversalInput);
      const praLiveDecision = evaluateLiveUniversalModelSide(praUniversalInput);
      const praPlayerOverrideSide = predictLivePlayerModelSide({
        playerName: player.fullName,
        market: "PRA",
        projectedValue: projectedTonight.PRA,
        line: praMarketLine.line,
        overPrice: praMarketLine.overPrice ?? null,
        underPrice: praMarketLine.underPrice ?? null,
        rawSide: resolveBinarySide(praRawDecision.rawSide) ?? praBaselineSide,
        finalSide: resolveBinarySide(praLiveDecision.side) ?? praBaselineSide,
        baselineSide: praBaselineSide,
        expectedMinutes: minutesProfile.expected,
        minutesVolatility,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      });

      if (praPlayerOverrideSide === "NEUTRAL") {
        const praControlSide = resolveBinarySide(praRawDecision.rawSide) ?? praBaselineSide;
        const promotedPra = predictLivePraRawFeatureSide({
          market: "PRA",
          projectedValue: projectedTonight.PRA,
          line: praMarketLine.line,
          overPrice: praMarketLine.overPrice ?? null,
          underPrice: praMarketLine.underPrice ?? null,
          projectionSide: praProjectionSide,
          baselineSide: praBaselineSide,
          controlSide: praControlSide,
          universalSide: resolveBinarySide(praRawDecision.rawSide),
          playerSide: null,
          favoredSide: deriveFavoredSide(praMarketLine.overPrice ?? null, praMarketLine.underPrice ?? null),
          archetype: praRawDecision.archetype?.trim() || "UNKNOWN",
          modelKind: praRawDecision.modelKind?.trim() || "UNKNOWN",
          expectedMinutes: minutesProfile.expected,
          minutesVolatility,
          starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
          openingTeamSpread,
          openingTotal,
          lineupTimingConfidence: praSignal.lineupTimingConfidence ?? null,
          completenessScore: dataCompleteness.score,
          pointsProjection: projectedTonight.PTS,
          reboundsProjection: projectedTonight.REB,
          assistProjection: projectedTonight.AST,
          threesProjection: projectedTonight.THREES,
          lineGap: round(projectedTonight.PRA - praMarketLine.line, 4),
          absLineGap: Math.abs(round(projectedTonight.PRA - praMarketLine.line, 4)),
        });

        if (promotedPra && promotedPra.changedFromControl) {
          const promotedQualified = promotedPra.selectedSide !== praBaselineSide;
          promotedPraFinalSide = promotedPra.selectedSide;
          praSignal = {
            ...praSignal,
            side: promotedPra.selectedSide,
            qualified: promotedQualified,
            passReasons: Array.from(
              new Set([
                ...praSignal.passReasons,
                promotedQualified
                  ? `Promoted PRA raw feature override (${promotedPra.modelKind}).`
                  : `Promoted PRA raw feature fallback (${promotedPra.modelKind}).`,
              ]),
            ),
          };
        }
      }
    }
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
    const precisionCommonInput = {
      playerId: player.id,
      expectedMinutes: minutesProfile.expected,
      minutesVolatility,
      benchBigRoleStability,
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      archetypeStarterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      openingTeamSpread,
      openingTotal,
      completenessScore: dataCompleteness.score,
      playerPosition: player.position,
      pointsProjection: projectedTonight.PTS,
      reboundsProjection: projectedTonight.REB,
      assistProjection: projectedTonight.AST,
      threesProjection: projectedTonight.THREES,
      availabilityStatus: lineupSignal?.availabilityStatus ?? null,
      availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    };
    const precisionSignals = Object.fromEntries(
      (
        [
          [
            "PTS",
            buildPrecision80Pick({
              market: "PTS",
              projectedValue: projectedTonight.PTS,
              line: ptsMarketLine?.line ?? null,
              overPrice: ptsMarketLine?.overPrice ?? null,
              underPrice: ptsMarketLine?.underPrice ?? null,
              finalSide: ptsSignal?.baselineSide ?? modelLines.PTS.modelSide,
              lineupTimingConfidence: ptsSignal?.lineupTimingConfidence ?? null,
              ...ptsCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "REB",
            buildPrecision80Pick({
              market: "REB",
              projectedValue: projectedTonight.REB,
              line: rebMarketLine?.line ?? null,
              overPrice: rebMarketLine?.overPrice ?? null,
              underPrice: rebMarketLine?.underPrice ?? null,
              finalSide: rebSignal?.baselineSide ?? modelLines.REB.modelSide,
              lineupTimingConfidence: rebSignal?.lineupTimingConfidence ?? null,
              ...rebCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "AST",
            buildPrecision80Pick({
              market: "AST",
              projectedValue: projectedTonight.AST,
              line: astMarketLine?.line ?? null,
              overPrice: astMarketLine?.overPrice ?? null,
              underPrice: astMarketLine?.underPrice ?? null,
              finalSide: astSignal?.baselineSide ?? modelLines.AST.modelSide,
              lineupTimingConfidence: astSignal?.lineupTimingConfidence ?? null,
              ...astCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "THREES",
            buildPrecision80Pick({
              market: "THREES",
              projectedValue: projectedTonight.THREES,
              line: threesMarketLine?.line ?? null,
              overPrice: threesMarketLine?.overPrice ?? null,
              underPrice: threesMarketLine?.underPrice ?? null,
              finalSide: threesSignal?.baselineSide ?? modelLines.THREES.modelSide,
              lineupTimingConfidence: threesSignal?.lineupTimingConfidence ?? null,
              ...threesCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "PRA",
            buildPrecision80Pick({
              market: "PRA",
              projectedValue: projectedTonight.PRA,
              line: praMarketLine?.line ?? null,
              overPrice: praMarketLine?.overPrice ?? null,
              underPrice: praMarketLine?.underPrice ?? null,
              finalSide:
                resolveBinarySide(promotedPraFinalSide) ??
                praSignal?.baselineSide ??
                modelLines.PRA.modelSide,
              lineupTimingConfidence: praSignal?.lineupTimingConfidence ?? null,
              ...praCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "PA",
            buildPrecision80Pick({
              market: "PA",
              projectedValue: projectedTonight.PA,
              line: paMarketLine?.line ?? null,
              overPrice: paMarketLine?.overPrice ?? null,
              underPrice: paMarketLine?.underPrice ?? null,
              finalSide: paSignal?.baselineSide ?? modelLines.PA.modelSide,
              lineupTimingConfidence: paSignal?.lineupTimingConfidence ?? null,
              ...paCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "PR",
            buildPrecision80Pick({
              market: "PR",
              projectedValue: projectedTonight.PR,
              line: prMarketLine?.line ?? null,
              overPrice: prMarketLine?.overPrice ?? null,
              underPrice: prMarketLine?.underPrice ?? null,
              finalSide: prSignal?.baselineSide ?? modelLines.PR.modelSide,
              lineupTimingConfidence: prSignal?.lineupTimingConfidence ?? null,
              ...prCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
          [
            "RA",
            buildPrecision80Pick({
              market: "RA",
              projectedValue: projectedTonight.RA,
              line: raMarketLine?.line ?? null,
              overPrice: raMarketLine?.overPrice ?? null,
              underPrice: raMarketLine?.underPrice ?? null,
              finalSide: raSignal?.baselineSide ?? modelLines.RA.modelSide,
              lineupTimingConfidence: raSignal?.lineupTimingConfidence ?? null,
              ...raCurrentLineRecency,
              ...precisionCommonInput,
            }),
          ],
        ] as const
      ).filter((entry) => entry[1] != null),
    );

    const gameIntel = buildGameIntel({
      dateEt,
      teamCode: matchup.teamCode,
      opponentCode: matchup.opponentCode,
      isHome: matchup.isHome,
      openingTeamSpread,
      openingTotal,
      playerProfile,
      teamProfiles,
      opponentProfiles,
      primaryDefender,
      teammateCore,
      last10Logs,
      last5Logs,
      statusLast10,
      playerLineupSignal: lineupSignal,
      liveTaggedCoreTeammates,
      liveUnavailableCoreCount,
      teammateUnavailableLastGame,
      teammateUnknownStatusLastGame,
      opponentStarterShareTop5,
      seasonAverage,
      last10Average,
      last3Average,
      opponentAllowance,
      opponentAllowanceDelta,
      teamSummary,
      opponentSummary,
    });
    gameIntel.modules.push({
      id: "projection-diagnostics",
      title: "Projection Diagnostics",
      description: "Same-opponent nudges, empirical hit rates, and volatility context for the projection engine.",
      status: "DERIVED",
      items: [
        {
          label: "Volatility P/R/A/3",
          value: `${formatNumber(modelLines.PTS.volatility)} / ${formatNumber(modelLines.REB.volatility)} / ${formatNumber(modelLines.AST.volatility)} / ${formatNumber(modelLines.THREES.volatility)}`,
        },
        { label: "PTS Same Opp", value: formatSameOpponentSummary(ptsSameOpponentSignal) },
        { label: "REB Same Opp", value: formatSameOpponentSummary(rebSameOpponentSignal) },
        { label: "AST Same Opp", value: formatSameOpponentSummary(astSameOpponentSignal) },
        { label: "3PM Same Opp", value: formatSameOpponentSummary(threesSameOpponentSignal) },
      ],
    });
    const livePtsItems: SnapshotIntelItem[] = [];
    addIntelItem(livePtsItems, "Consensus PTS Line", ptsMarketLine == null ? "-" : formatNumber(ptsMarketLine.line));
    addIntelItem(
      livePtsItems,
      "Market Books",
      ptsMarketLine == null ? "-" : String(ptsMarketLine.sportsbookCount),
    );
    addIntelItem(livePtsItems, "PTS Side", ptsSignal == null ? "-" : ptsSignal.side);
    addIntelItem(
      livePtsItems,
      "PTS Signal Score",
      ptsSignal?.confidence == null ? "-" : `${formatNumber(ptsSignal.confidence)} (${ptsSignal.confidenceTier ?? "LOW"})`,
    );
    addIntelItem(
      livePtsItems,
      "PTS Card Status",
      ptsSignal == null ? "-" : ptsSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(
      livePtsItems,
      "PTS Gap / Risk",
      ptsSignal == null ? "-" : `${formatSigned(ptsSignal.projectionGap)} / ${formatNumber(ptsSignal.minutesRisk)}`,
    );
    addIntelItem(livePtsItems, "Empirical O Rate", formatEmpiricalHitRateSummary(ptsCurrentLineRecency));
    addIntelItem(
      livePtsItems,
      "FGA / Min (L10)",
      playerShotPressure?.fgaRate == null ? "-" : playerShotPressure.fgaRate.toFixed(3),
    );
    addIntelItem(
      livePtsItems,
      "FTA / Min (L10)",
      playerShotPressure?.ftaRate == null ? "-" : playerShotPressure.ftaRate.toFixed(3),
    );
    addIntelItem(
      livePtsItems,
      "Opp FGA Allowed / Min",
      opponentShotVolume?.fgaPerMinute == null ? "-" : opponentShotVolume.fgaPerMinute.toFixed(3),
    );
    addIntelItem(
      livePtsItems,
      "Opp FT Pressure",
      opponentShotVolume?.freeThrowPressure == null ? "-" : opponentShotVolume.freeThrowPressure.toFixed(3),
    );
    if (livePtsItems.some((item) => item.value !== "-")) {
      gameIntel.modules.splice(2, 0, {
        id: "live-points-context",
        title: "2B. Live PTS Context",
        description: "Live sportsbook anchor plus player and opponent shot-volume inputs.",
        status: "LIVE",
        items: livePtsItems,
      });
    }
    const liveRebItems: SnapshotIntelItem[] = [];
    addIntelItem(liveRebItems, "Consensus REB Line", rebMarketLine == null ? "-" : formatNumber(rebMarketLine.line));
    addIntelItem(
      liveRebItems,
      "Market Books",
      rebMarketLine == null ? "-" : String(rebMarketLine.sportsbookCount),
    );
    addIntelItem(liveRebItems, "REB Side", rebSignal == null ? "-" : rebSignal.side);
    addIntelItem(
      liveRebItems,
      "REB Signal Score",
      rebSignal?.confidence == null ? "-" : `${formatNumber(rebSignal.confidence)} (${rebSignal.confidenceTier ?? "LOW"})`,
    );
    addIntelItem(
      liveRebItems,
      "REB Card Status",
      rebSignal == null ? "-" : rebSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(
      liveRebItems,
      "REB Gap / Risk",
      rebSignal == null ? "-" : `${formatSigned(rebSignal.projectionGap)} / ${formatNumber(rebSignal.minutesRisk)}`,
    );
    addIntelItem(liveRebItems, "Empirical O Rate", formatEmpiricalHitRateSummary(rebCurrentLineRecency));
    if (liveRebItems.some((item) => item.value !== "-")) {
      gameIntel.modules.splice(3, 0, {
        id: "live-rebounds-context",
        title: "2C. Live REB Context",
        description: "Live sportsbook rebound line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: liveRebItems,
      });
    }
    const liveAstItems: SnapshotIntelItem[] = [];
    addIntelItem(liveAstItems, "Consensus AST Line", astMarketLine == null ? "-" : formatNumber(astMarketLine.line));
    addIntelItem(
      liveAstItems,
      "Market Books",
      astMarketLine == null ? "-" : String(astMarketLine.sportsbookCount),
    );
    addIntelItem(liveAstItems, "AST Side", astSignal == null ? "-" : astSignal.side);
    addIntelItem(
      liveAstItems,
      "AST Signal Score",
      astSignal?.confidence == null ? "-" : `${formatNumber(astSignal.confidence)} (${astSignal.confidenceTier ?? "LOW"})`,
    );
    addIntelItem(
      liveAstItems,
      "AST Card Status",
      astSignal == null ? "-" : astSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(
      liveAstItems,
      "AST Gap / Risk",
      astSignal == null ? "-" : `${formatSigned(astSignal.projectionGap)} / ${formatNumber(astSignal.minutesRisk)}`,
    );
    addIntelItem(liveAstItems, "Empirical O Rate", formatEmpiricalHitRateSummary(astCurrentLineRecency));
    if (liveAstItems.some((item) => item.value !== "-")) {
      gameIntel.modules.splice(4, 0, {
        id: "live-assists-context",
        title: "2D. Live AST Context",
        description: "Live sportsbook assist line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: liveAstItems,
      });
    }
    const liveThreesItems: SnapshotIntelItem[] = [];
    addIntelItem(liveThreesItems, "Consensus 3PM Line", threesMarketLine == null ? "-" : formatNumber(threesMarketLine.line));
    addIntelItem(
      liveThreesItems,
      "Market Books",
      threesMarketLine == null ? "-" : String(threesMarketLine.sportsbookCount),
    );
    addIntelItem(liveThreesItems, "3PM Side", threesSignal == null ? "-" : threesSignal.side);
    addIntelItem(
      liveThreesItems,
      "3PM Signal Score",
      threesSignal?.confidence == null ? "-" : `${formatNumber(threesSignal.confidence)} (${threesSignal.confidenceTier ?? "LOW"})`,
    );
    addIntelItem(
      liveThreesItems,
      "3PM Card Status",
      threesSignal == null ? "-" : threesSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(
      liveThreesItems,
      "3PM Gap / Risk",
      threesSignal == null ? "-" : `${formatSigned(threesSignal.projectionGap)} / ${formatNumber(threesSignal.minutesRisk)}`,
    );
    addIntelItem(liveThreesItems, "Empirical O Rate", formatEmpiricalHitRateSummary(threesCurrentLineRecency));
    if (liveThreesItems.some((item) => item.value !== "-")) {
      gameIntel.modules.splice(5, 0, {
        id: "live-threes-context",
        title: "2E. Live 3PM Context",
        description: "Live sportsbook 3PM line plus minutes-risk and market-lean screen.",
        status: "LIVE",
        items: liveThreesItems,
      });
    }
    const liveComboItems: SnapshotIntelItem[] = [];
    addIntelItem(liveComboItems, "Consensus PRA Line", praMarketLine == null ? "-" : formatNumber(praMarketLine.line));
    addIntelItem(liveComboItems, "PRA Side", praSignal == null ? "-" : praSignal.side);
    addIntelItem(
      liveComboItems,
      "PRA Card Status",
      praSignal == null ? "-" : praSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(liveComboItems, "Consensus PA Line", paMarketLine == null ? "-" : formatNumber(paMarketLine.line));
    addIntelItem(liveComboItems, "PA Side", paSignal == null ? "-" : paSignal.side);
    addIntelItem(
      liveComboItems,
      "PA Card Status",
      paSignal == null ? "-" : paSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(liveComboItems, "Consensus PR Line", prMarketLine == null ? "-" : formatNumber(prMarketLine.line));
    addIntelItem(liveComboItems, "PR Side", prSignal == null ? "-" : prSignal.side);
    addIntelItem(
      liveComboItems,
      "PR Card Status",
      prSignal == null ? "-" : prSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    addIntelItem(liveComboItems, "Consensus RA Line", raMarketLine == null ? "-" : formatNumber(raMarketLine.line));
    addIntelItem(liveComboItems, "RA Side", raSignal == null ? "-" : raSignal.side);
    addIntelItem(
      liveComboItems,
      "RA Card Status",
      raSignal == null ? "-" : raSignal.qualified ? "PRECISION READY" : "RAW ONLY",
    );
    if (liveComboItems.some((item) => item.value !== "-")) {
      gameIntel.modules.splice(6, 0, {
        id: "live-combo-context",
        title: "2F. Live Combo Context",
        description: "Live combo lines plus projection-gap and minutes-risk screens for PRA, PA, PR, and RA.",
        status: "LIVE",
        items: liveComboItems,
      });
    }

    const computedRow = toBoardSnapshotRow({
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
      precisionSignals,
      recentLogs: last10Logs,
      analysisLogs: logsForPlayer,
      dataCompleteness,
      playerContext: {
        archetype: playerProfile?.archetype ?? determineArchetype(last10Average, average(last10Logs.map((log) => log.minutes))),
        projectedStarter: applyLineupStarterLabel(
          starterStatusLabel({
            startedLastGame: playerProfile?.startedLastGame ?? computedStartedLastGame,
            starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
            rotationRank,
            minutesLast10Avg,
          }),
          lineupSignal,
        ),
        lineupStatus: lineupSignal?.status ?? null,
        lineupStarter: lineupSignal?.lineupStarter ?? null,
        availabilityStatus: lineupSignal?.availabilityStatus ?? null,
        availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
        startedLastGame: playerProfile?.startedLastGame ?? computedStartedLastGame,
        startsLast10: playerProfile?.startsLast10 ?? computedStartsLast10,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
        rotationRank,
        minutesLast3Avg: playerProfile?.minutesLast3Avg ?? average(last3Logs.map((log) => log.minutes)),
        minutesLast10Avg,
        minutesCurrentTeamAvg: minutesCurrentTeamLast5Avg,
        minutesCurrentTeamGames: sameTeamLogs.length,
        minutesTrend: playerProfile?.minutesTrend ?? null,
        minutesVolatility,
        projectedMinutes: minutesProfile.expected,
        projectedMinutesFloor: minutesProfile.floor,
        projectedMinutesCeiling: minutesProfile.ceiling,
        primaryDefender,
        teammateCore,
      },
      gameIntel,
    });
    const rowKey = getSnapshotBoardRowKey(computedRow);
    const frozenRow =
      isTodayEt && hasGameStarted(matchup.gameTimeUtc, nowMs) ? persistedRowMap.get(rowKey) ?? null : null;
    builtRowKeys.add(rowKey);
    rowsWithSortKeys.push({
      sortTime: matchup.gameTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER,
      row: frozenRow ? toBoardSnapshotRow(frozenRow) : computedRow,
    });
  }

  if (isTodayEt && persistedRowMap.size > 0) {
    persistedRowMap.forEach((row, rowKey) => {
      if (builtRowKeys.has(rowKey)) return;
      const sortTime = startedMatchupTimesByKey.get(row.matchupKey);
      if (sortTime == null) return;
      rowsWithSortKeys.push({
        sortTime,
        row: toBoardSnapshotRow(row),
      });
    });
  }

  rowsWithSortKeys.sort((a, b) => {
    if (a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    if (a.row.matchupKey !== b.row.matchupKey) {
      return a.row.matchupKey.localeCompare(b.row.matchupKey);
    }
    return a.row.playerName.localeCompare(b.row.playerName);
  });

  const result = toBoardSnapshotData({
    dateEt,
    lastUpdatedAt: sourceUpdatedAtIso,
    matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
    teamMatchups,
    rows: rowsWithSortKeys.map((item) => item.row),
    precisionSystem: PRECISION_80_SYSTEM_SUMMARY,
    universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
  });
  snapshotBoardCache.set(cacheKey, {
    data: result,
    sourceSignal,
    expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
  });
  await prisma.systemSetting.upsert({
    where: { key: getSnapshotBoardSettingKey(dateEt) },
    update: {
      value: {
        sourceSignal,
        data: result,
      },
    },
    create: {
      key: getSnapshotBoardSettingKey(dateEt),
      value: {
        sourceSignal,
        data: result,
      },
    },
  });
  return result;
}
