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
  buildAdaptivePrecisionFloorPick,
  buildShortfallPrecisionRescuePick,
  buildPrecision80Pick,
  comparePrecisionSignals,
  isPromotedPrecisionCandidate,
  PROMOTED_PRECISION_MIN_SPORTSBOOK_COUNT,
  PRECISION_80_SYSTEM_SUMMARY_VERSION,
  PRECISION_80_SYSTEM_SUMMARY,
  selectPrecisionCardWithTopOff,
  type PrecisionSlateCandidate,
} from "@/lib/snapshot/precisionPickSystem";
import {
  buildPrecisionUpstreamPriorityCandidate,
  rerankPrecisionUpstreamCandidates,
} from "@/lib/snapshot/precisionUpstreamReranker";
import {
  buildPrecisionPregameLock,
  getPrecisionPregameLockSettingKey,
  readPrecisionPregameLock,
  shouldCreatePrecisionPregameLock,
  summarizePrecisionPregameCard,
  type SnapshotPrecisionPregameLock,
} from "@/lib/snapshot/precisionPregameLock";
import { computeCurrentLineRecencyMetrics } from "@/lib/snapshot/currentLineRecency";
import {
  evaluateLiveUniversalModelSide,
  inspectLiveUniversalModelSide,
  type PredictLiveUniversalSideInput,
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
  type OpponentAvailabilityInput,
  type SameOpponentProjectionSignal,
  type TeamSynergyInput,
} from "@/lib/snapshot/projection";
import { computeBenchBigRoleStability, computeMissingFrontcourtLoad } from "@/lib/snapshot/benchBigRoleStability";
import { buildModelLineRecord } from "@/lib/snapshot/modelLines";
import { maybeRefreshTodayLineupSnapshot } from "@/lib/snapshot/liveLineups";
import { buildPropSignalGrade } from "@/lib/snapshot/propSignalGrade";
import {
  applyRecentWeaknessRouter,
  getRecentWeaknessRouterRuntimeMeta,
} from "@/lib/snapshot/recentWeaknessRouter";
import { formatUtcToEt, getSnapshotBoardDateString } from "@/lib/snapshot/time";
import {
  isSnapshotBoardDatabaseUnavailableError,
  loadBundledSnapshotBoardViewFallback,
} from "@/lib/snapshot/boardFallback";
import type {
  SnapshotBoardData,
  SnapshotBoardFeed,
  SnapshotBoardFeedEventType,
  SnapshotBoardFeedItem,
  SnapshotBoardMarketSource,
  SnapshotBoardFeedStatus,
  SnapshotBoardViewData,
  SnapshotDataCompleteness,
  SnapshotPrecisionDashboard,
  SnapshotPrecisionAuditEntry,
  SnapshotPrecisionAuditOutcome,
  SnapshotDashboardDataCompleteness,
  SnapshotDashboardGameIntel,
  SnapshotDashboardModelLine,
  SnapshotDashboardModelLineRecord,
  SnapshotDashboardPlayerContext,
  SnapshotDashboardPrecisionSignal,
  SnapshotDashboardRow,
  SnapshotDashboardSignal,
  SnapshotGameIntel,
  SnapshotIntelItem,
  SnapshotIntelModule,
  SnapshotMarket,
  SnapshotMarketRuntime,
  SnapshotMatchupOption,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionCardSummary,
  SnapshotModelSide,
  SnapshotMetricRecord,
  SnapshotPropSignalGrade,
  SnapshotPlayerLookupData,
  SnapshotPrecisionPickSignal,
  SnapshotPrimaryDefender,
  SnapshotPtsSignal,
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

type PrecisionCardCandidateRecord = PrecisionSlateCandidate;

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
  stealsPer36Last10: number | null;
  blocksPer36Last10: number | null;
  stocksPer36Last10: number | null;
  startsLast10: number;
  starterRateLast10: number | null;
  startedLastGame: boolean | null;
  archetype: string;
  positionTokens: Set<PositionToken>;
};

type CachedPlayerPosition = {
  externalId: string | null;
  position: string | null;
};

const LIVE_FEED_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.SNAPSHOT_LIVE_FEED_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20_000;
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
const MARKET_LABELS: Record<SnapshotMarket, string> = {
  PTS: "PTS",
  REB: "REB",
  AST: "AST",
  THREES: "3PM",
  PRA: "PRA",
  PA: "PA",
  PR: "PR",
  RA: "RA",
};
const SNAPSHOT_BOARD_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.SNAPSHOT_BOARD_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300_000;
  return Math.min(Math.max(5_000, Math.floor(parsed)), 10 * 60_000);
})();
const PLAYER_POSITION_CACHE_TTL_MS = 30 * 60_000;
const SNAPSHOT_BOARD_FEED_SEED_LIMIT = 8;
const SNAPSHOT_BOARD_FEED_EVENT_LIMIT = 180;
const SNAPSHOT_BOARD_FEED_LINE_THRESHOLD = 0.5;
const SNAPSHOT_BOARD_FEED_GAP_THRESHOLD = 0.5;
const SNAPSHOT_BOARD_FEED_CONFIDENCE_THRESHOLD = 4;

type SnapshotBoardCacheEntry = {
  data: SnapshotBoardData;
  sourceSignal: string;
  expiresAt: number;
};

const snapshotBoardCache = new Map<string, SnapshotBoardCacheEntry>();
let cachedPlayerPositions: { data: CachedPlayerPosition[]; expiresAt: number } | null = null;
const SNAPSHOT_BOARD_SETTING_KEY_PREFIX = "snapshot_board:";
const SNAPSHOT_BOARD_PAYLOAD_VERSION = "full-board-primary-v1";

type PersistedSnapshotBoardSetting = {
  sourceSignal: string;
  data: SnapshotBoardData;
};

type BoardFeedMarketSnapshot = {
  key: string;
  playerId: string;
  playerName: string;
  matchupKey: string;
  gameTimeEt: string;
  market: SnapshotMarket;
  side: SnapshotModelSide;
  line: number | null;
  fairLine: number | null;
  projection: number | null;
  gap: number | null;
  confidence: number | null;
  booksLive: number | null;
  rank: number | null;
  precisionQualified: boolean;
  selectorFamily: string | null;
  reasons: string[];
  score: number;
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

async function getCachedPlayerPositions(): Promise<CachedPlayerPosition[]> {
  if (cachedPlayerPositions && cachedPlayerPositions.expiresAt > Date.now()) {
    return cachedPlayerPositions.data;
  }

  const data = await prisma.player.findMany({
    where: { externalId: { not: null } },
    select: { externalId: true, position: true },
  });
  cachedPlayerPositions = {
    data,
    expiresAt: Date.now() + PLAYER_POSITION_CACHE_TTL_MS,
  };
  return data;
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

function getSnapshotBoardViewFallbackOrThrow(dateEt: string, error: unknown): SnapshotBoardViewData {
  if (isSnapshotBoardDatabaseUnavailableError(error)) {
    const fallback = loadBundledSnapshotBoardViewFallback(dateEt);
    if (fallback) {
      return fallback;
    }
  }
  throw error;
}

function preferBundledSnapshotBoardViewFallbackWhenBroken(
  dateEt: string,
  data: SnapshotBoardViewData,
): SnapshotBoardViewData {
  const isTodayEt = dateEt === getSnapshotBoardDateString();
  const hasSlateGames = data.matchups.length > 0 || data.teamMatchups.length > 0;
  if (!isTodayEt || !hasSlateGames || data.rows.length > 0) {
    return data;
  }

  const fallback = loadBundledSnapshotBoardViewFallback(dateEt);
  if (!fallback || fallback.rows.length === 0) {
    return data;
  }

  return fallback;
}

function recoverStartedSlatePrecisionCard(
  dateEt: string,
  precisionCard: SnapshotPrecisionCardEntry[],
  startedMatchupCount: number,
): SnapshotPrecisionCardEntry[] {
  if (dateEt !== getSnapshotBoardDateString() || startedMatchupCount === 0 || precisionCard.length > 0) {
    return precisionCard;
  }

  const fallback = loadBundledSnapshotBoardViewFallback(dateEt);
  if (!fallback || fallback.dateEt !== dateEt || !Array.isArray(fallback.precisionCard) || fallback.precisionCard.length === 0) {
    return precisionCard;
  }

  return structuredClone(fallback.precisionCard);
}

function isUnderfilledPrecisionBoard(dateEt: string, data: SnapshotBoardData): boolean {
  if (dateEt !== getSnapshotBoardDateString()) return false;
  const hasSlateGames = data.matchups.length > 0 || data.teamMatchups.length > 0 || data.rows.length > 0;
  if (!hasSlateGames) return false;
  const targetCardCount = PRECISION_80_SYSTEM_SUMMARY.targetCardCount ?? 6;
  if (targetCardCount <= 0) return false;
  const selectedCount = data.precisionCardSummary?.selectedCount ?? data.precisionCard?.length ?? 0;
  return selectedCount < targetCardCount;
}

function getSnapshotBoardRowKey(row: Pick<SnapshotRow, "matchupKey" | "playerId">): string {
  return `${row.matchupKey}|${row.playerId}`;
}

function getSnapshotPrecisionCardEntryKey(entry: Pick<SnapshotPrecisionCardEntry, "playerId" | "market">): string {
  return `${entry.playerId}|${entry.market}`;
}

async function loadPrecisionPregameLock(dateEt: string): Promise<SnapshotPrecisionPregameLock | null> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: getPrecisionPregameLockSettingKey(dateEt) },
    select: { value: true },
  });
  return readPrecisionPregameLock(setting?.value ?? null);
}

function getFirstGameStartMs(matchupStartMsByKey: Map<string, number | null>): number | null {
  const starts = Array.from(matchupStartMsByKey.values())
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
  return starts[0] ?? null;
}

async function maybeCreatePrecisionPregameLock(input: {
  dateEt: string;
  isTodayEt: boolean;
  nowMs: number;
  firstGameStartMs: number | null;
  sourceUpdatedAt: string | null;
  targetCardCount: number;
  data: Pick<SnapshotBoardData, "rows" | "precisionCard" | "precisionCardSummary">;
}): Promise<SnapshotPrecisionPregameLock | null> {
  const existingLock = await loadPrecisionPregameLock(input.dateEt);
  if (existingLock) return existingLock;

  const precisionCard = input.data.precisionCard ?? [];
  const decision = shouldCreatePrecisionPregameLock({
    isTodayEt: input.isTodayEt,
    nowMs: input.nowMs,
    firstGameStartMs: input.firstGameStartMs,
    precisionCardCount: precisionCard.length,
    targetCardCount: input.targetCardCount,
  });
  if (!decision.eligible || input.firstGameStartMs == null) {
    return null;
  }

  const lock = buildPrecisionPregameLock({
    dateEt: input.dateEt,
    lockedAt: new Date(input.nowMs).toISOString(),
    firstGameTimeUtc: new Date(input.firstGameStartMs).toISOString(),
    sourceUpdatedAt: input.sourceUpdatedAt,
    targetCardCount: input.targetCardCount,
    data: input.data,
  });

  try {
    await prisma.systemSetting.create({
      data: {
        key: getPrecisionPregameLockSettingKey(input.dateEt),
        value: lock,
      },
    });
    return lock;
  } catch {
    return loadPrecisionPregameLock(input.dateEt);
  }
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

function isPrecisionCardRowStillEligible(row: SnapshotRow | null | undefined): boolean {
  if (!row) return false;
  const availabilityStatus = row.playerContext.availabilityStatus;
  if (availabilityStatus === "OUT" || availabilityStatus === "DOUBTFUL") return false;
  if (availabilityStatus === "QUESTIONABLE" && (row.playerContext.availabilityPercentPlay ?? 100) <= 55) return false;
  return true;
}

function compareStabilizedPrecisionEntries(
  left: SnapshotPrecisionCardEntry,
  right: SnapshotPrecisionCardEntry,
): number {
  const leftSignal = left.precisionSignal;
  const rightSignal = right.precisionSignal;
  if (leftSignal && rightSignal) {
    const signalComparison = comparePrecisionSignals(leftSignal, rightSignal, "dynamic-edge-first");
    if (signalComparison !== 0) return signalComparison;
  }

  const leftScore = left.selectionScore ?? leftSignal?.selectionScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.selectionScore ?? rightSignal?.selectionScore ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;

  return getSnapshotPrecisionCardEntryKey(left).localeCompare(getSnapshotPrecisionCardEntryKey(right));
}

function stabilizePrecisionCardForToday(
  persistedBoard: PersistedSnapshotBoardSetting | null,
  currentRows: SnapshotRow[],
  nextPrecisionCard: SnapshotPrecisionCardEntry[],
  targetCardCount: number,
  options: {
    matchupStartMsByKey: Map<string, number | null>;
    nowMs: number;
  },
): SnapshotPrecisionCardEntry[] {
  const persistedPrecisionCard = persistedBoard?.data.precisionCard ?? [];
  if (persistedPrecisionCard.length === 0 || targetCardCount <= 0) {
    return nextPrecisionCard;
  }

  const rowByPlayerId = new Map(currentRows.map((row) => [row.playerId, row] as const));
  const lockedStartedEntries = persistedPrecisionCard
    .flatMap((entry) => {
      const currentRow = rowByPlayerId.get(entry.playerId);
      const matchupStartMs = currentRow ? options.matchupStartMsByKey.get(currentRow.matchupKey) ?? null : null;
      if (matchupStartMs == null || matchupStartMs > options.nowMs) {
        return [];
      }
      const currentSignal = currentRow?.precisionSignals?.[entry.market] ?? null;
      return [
        {
          ...entry,
          selectionScore: currentSignal?.selectionScore ?? entry.selectionScore ?? null,
          precisionSignal: currentSignal ?? entry.precisionSignal ?? null,
        } satisfies SnapshotPrecisionCardEntry,
      ];
    })
    .slice(0, targetCardCount);
  const lockedEntryKeys = new Set(lockedStartedEntries.map((entry) => getSnapshotPrecisionCardEntryKey(entry)));
  const lockedPlayers = new Set(lockedStartedEntries.map((entry) => entry.playerId));
  const mergedEntries = new Map<string, SnapshotPrecisionCardEntry>();

  const mergeEntry = (entry: SnapshotPrecisionCardEntry): void => {
    const selectorFamily = entry.precisionSignal?.selectorFamily;
    if (
      !PRECISION_80_SYSTEM_SUMMARY.allowFill &&
      (selectorFamily === "qualified_fill" || selectorFamily === "model_fill")
    ) {
      return;
    }

    const entryKey = getSnapshotPrecisionCardEntryKey(entry);
    if (lockedEntryKeys.has(entryKey) || lockedPlayers.has(entry.playerId)) return;
    const currentRow = rowByPlayerId.get(entry.playerId);
    if (!isPrecisionCardRowStillEligible(currentRow)) return;
    const currentSignal = currentRow?.precisionSignals?.[entry.market] ?? null;
    const rebuiltFillCandidate = currentRow ? buildPrecisionFillCandidateFromEntry(currentRow, entry) : null;
    const resolvedSignal = rebuiltFillCandidate?.signal ?? currentSignal ?? null;
    const sportsbookCount = currentRow ? getRowMarketSportsbookCount(currentRow, entry.market) : 0;
    if (
      !isPromotedPrecisionCandidate({
        market: entry.market,
        signal: resolvedSignal,
        sportsbookCount,
      })
    ) {
      return;
    }
    const normalizedEntry: SnapshotPrecisionCardEntry = {
      ...entry,
      selectionScore: rebuiltFillCandidate?.selectionScore ?? currentSignal?.selectionScore ?? entry.selectionScore ?? null,
      precisionSignal: resolvedSignal,
    };
    const existing = mergedEntries.get(entryKey);
    if (!existing || compareStabilizedPrecisionEntries(normalizedEntry, existing) < 0) {
      mergedEntries.set(entryKey, normalizedEntry);
    }
  };

  persistedPrecisionCard.forEach((entry) => {
    mergeEntry(entry);
  });

  nextPrecisionCard.forEach((entry) => {
    mergeEntry(entry);
  });

  const remainingSlots = Math.max(0, targetCardCount - lockedStartedEntries.length);
  const stabilizedEntries = Array.from(mergedEntries.values())
    .sort(compareStabilizedPrecisionEntries)
    .slice(0, remainingSlots)
    .map((entry) => ({
      ...entry,
    }));

  const finalEntries = [...lockedStartedEntries, ...stabilizedEntries]
    .slice(0, targetCardCount)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return finalEntries.length > 0 ? finalEntries : nextPrecisionCard;
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

type SnapshotMarketRuntimeBuildInput = {
  market: SnapshotMarket;
  playerName: string;
  signal: SnapshotPtsSignal | null;
  modelSide: SnapshotModelSide;
  universalInput: PredictLiveUniversalSideInput;
  expectedMinutes: number | null;
  l5MinutesAvg: number | null;
  l5MarketDeltaAvg: number | null;
  trendVsSeason: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  opponentPositionAllowance: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  praPromotionContext?: {
    projectionSide: "OVER" | "UNDER" | null;
    favoredSide: "OVER" | "UNDER" | "NEUTRAL";
    openingTeamSpread: number | null;
    openingTotal: number | null;
    lineupTimingConfidence: number | null;
    completenessScore: number | null;
    pointsProjection: number | null;
    reboundsProjection: number | null;
    assistProjection: number | null;
    threesProjection: number | null;
    lineGap: number | null;
    absLineGap: number | null;
  } | null;
};

type SnapshotMarketDecisionMeta = {
  baselineSide: SnapshotModelSide;
  rawDecision: ReturnType<typeof inspectLiveUniversalModelSide>;
  liveDecision: ReturnType<typeof evaluateLiveUniversalModelSide>;
  playerOverrideSide: SnapshotModelSide;
  rawSide: SnapshotModelSide;
  strictRawSide: SnapshotModelSide;
  finalSide: SnapshotModelSide;
  rawSource: "player_override" | "universal_raw" | "baseline";
  strictRawSource: "player_override" | "universal_raw" | "none";
  finalSource: SnapshotBoardMarketSource;
  playerOverrideEngaged: boolean;
  universalQualifiedEngaged: boolean;
};

function buildSnapshotMarketDecisionMeta(input: SnapshotMarketRuntimeBuildInput): SnapshotMarketDecisionMeta {
  const baselineSide = resolveBinarySide(input.signal?.baselineSide ?? input.modelSide) ?? "NEUTRAL";
  let finalSide: SnapshotModelSide = baselineSide;
  let finalSource: SnapshotBoardMarketSource = "baseline";
  let playerOverrideEngaged = false;
  let universalQualifiedEngaged = false;
  const rawDecision = inspectLiveUniversalModelSide(input.universalInput);
  const liveDecision = evaluateLiveUniversalModelSide(input.universalInput);
  const resolvedLiveSide = resolveBinarySide(liveDecision.side) ?? baselineSide;
  const playerOverrideSide = predictLivePlayerModelSide({
    playerName: input.playerName,
    market: input.market,
    projectedValue: input.universalInput.projectedValue,
    line: input.universalInput.line,
    overPrice: input.universalInput.overPrice,
    underPrice: input.universalInput.underPrice,
    rawSide: resolveBinarySide(rawDecision.rawSide) ?? baselineSide,
    finalSide: resolvedLiveSide,
    baselineSide,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });

  const strictRawSide: SnapshotModelSide =
    playerOverrideSide !== "NEUTRAL" ? playerOverrideSide : rawDecision.rawSide;
  const rawSide: SnapshotModelSide =
    strictRawSide === "OVER" || strictRawSide === "UNDER" ? strictRawSide : baselineSide;

  const rawSource: SnapshotMarketDecisionMeta["rawSource"] =
    playerOverrideSide !== "NEUTRAL"
      ? "player_override"
      : rawDecision.rawSide === "NEUTRAL"
        ? "baseline"
        : "universal_raw";
  const strictRawSource: SnapshotMarketDecisionMeta["strictRawSource"] =
    playerOverrideSide !== "NEUTRAL"
      ? "player_override"
      : rawDecision.rawSide === "NEUTRAL"
        ? "none"
        : "universal_raw";

  if (playerOverrideSide === "OVER" || playerOverrideSide === "UNDER") {
    finalSide = playerOverrideSide;
    finalSource = "player_override";
    playerOverrideEngaged = true;
  } else if (liveDecision.side === "OVER" || liveDecision.side === "UNDER") {
    finalSide = liveDecision.side;
    finalSource = "universal_qualified";
    universalQualifiedEngaged = true;
  }

  const praControlSide = resolveBinarySide(rawDecision.rawSide) ?? baselineSide;
  if (
    input.market === "PRA" &&
    !playerOverrideEngaged &&
    input.praPromotionContext &&
    input.praPromotionContext.projectionSide != null &&
    baselineSide !== "NEUTRAL" &&
    praControlSide !== "NEUTRAL" &&
    input.praPromotionContext.lineGap != null &&
    input.praPromotionContext.absLineGap != null
  ) {
    const promotedPra = predictLivePraRawFeatureSide({
      market: "PRA",
      projectedValue: input.universalInput.projectedValue,
      line: input.universalInput.line,
      overPrice: input.universalInput.overPrice,
      underPrice: input.universalInput.underPrice,
      projectionSide: input.praPromotionContext.projectionSide,
      baselineSide,
      controlSide: praControlSide,
      universalSide: resolveBinarySide(rawDecision.rawSide),
      playerSide: null,
      favoredSide: input.praPromotionContext.favoredSide,
      archetype: rawDecision.archetype?.trim() || "UNKNOWN",
      modelKind: rawDecision.modelKind?.trim() || "UNKNOWN",
      expectedMinutes: input.expectedMinutes,
      minutesVolatility: input.minutesVolatility,
      starterRateLast10: input.starterRateLast10,
      openingTeamSpread: input.praPromotionContext.openingTeamSpread,
      openingTotal: input.praPromotionContext.openingTotal,
      lineupTimingConfidence: input.praPromotionContext.lineupTimingConfidence,
      completenessScore: input.praPromotionContext.completenessScore,
      pointsProjection: input.praPromotionContext.pointsProjection,
      reboundsProjection: input.praPromotionContext.reboundsProjection,
      assistProjection: input.praPromotionContext.assistProjection,
      threesProjection: input.praPromotionContext.threesProjection,
      lineGap: input.praPromotionContext.lineGap,
      absLineGap: input.praPromotionContext.absLineGap,
    });
    if (promotedPra && promotedPra.changedFromControl) {
      finalSide = promotedPra.selectedSide;
      finalSource = promotedPra.selectedSide === baselineSide ? "baseline" : "universal_qualified";
      universalQualifiedEngaged = finalSource === "universal_qualified";
    }
  }

  const recentWeaknessRoute = applyRecentWeaknessRouter({
    gameDateEt: input.universalInput.gameDateEt,
    playerName: input.playerName,
    market: input.market,
    finalSource,
    favoredSide: rawDecision.favoredSide,
    finalSide,
    baselineSide,
    rawSide,
    rawDecisionSide: rawDecision.rawSide,
    overProbability: rawDecision.overProbability,
    underProbability: rawDecision.underProbability,
    projectedValue: input.universalInput.projectedValue,
    line: input.universalInput.line,
    projectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    archetype: rawDecision.archetype,
    modelKind: rawDecision.modelKind,
    minutesBucket: rawDecision.minutesBucket,
    projectionMarketAgreement: rawDecision.projectionMarketAgreement,
    leafAccuracy: rawDecision.leafAccuracy,
    bucketLateAccuracy: rawDecision.bucketLateAccuracy,
    bucketModelAccuracy: rawDecision.bucketModelAccuracy,
    leafCount: rawDecision.leafCount,
    priceStrength: rawDecision.priceStrength,
    projectionWinProbability: rawDecision.projectionWinProbability,
    projectionPriceEdge: rawDecision.projectionPriceEdge,
  });
  if (recentWeaknessRoute) {
    finalSide = recentWeaknessRoute.side;
    finalSource = recentWeaknessRoute.source;
    playerOverrideEngaged = finalSource === "player_override";
    universalQualifiedEngaged = finalSource === "universal_qualified";
  }

  return {
    baselineSide,
    rawDecision,
    liveDecision,
    playerOverrideSide,
    rawSide,
    strictRawSide,
    finalSide,
    rawSource,
    strictRawSource,
    finalSource,
    playerOverrideEngaged,
    universalQualifiedEngaged,
  };
}

function buildSnapshotMarketRuntime(
  input: SnapshotMarketRuntimeBuildInput & {
    decisionMeta?: SnapshotMarketDecisionMeta | null;
  },
): SnapshotMarketRuntime {
  const decisionMeta = input.decisionMeta ?? buildSnapshotMarketDecisionMeta(input);
  const trackedSignalSide =
    resolveBinarySide(decisionMeta.finalSide) ??
    resolveBinarySide(input.signal?.side ?? input.signal?.baselineSide ?? input.modelSide) ??
    "NEUTRAL";

  const signalGrade: SnapshotPropSignalGrade | null = buildPropSignalGrade({
    market: input.market,
    side: trackedSignalSide,
    projectedValue: input.universalInput.projectedValue,
    line: input.universalInput.line,
    confidence: input.signal?.confidence ?? null,
    expectedMinutes: input.expectedMinutes,
    l5MinutesAvg: input.l5MinutesAvg,
    minutesVolatility: input.minutesVolatility,
    trendVsSeason: input.trendVsSeason,
    l5CurrentLineDeltaAvg: input.universalInput.l5CurrentLineDeltaAvg ?? null,
    weightedCurrentLineOverRate: input.universalInput.weightedCurrentLineOverRate ?? null,
    opponentAllowance: input.opponentAllowance,
    opponentAllowanceDelta: input.opponentAllowanceDelta,
    completenessScore: input.universalInput.completenessScore ?? null,
  });

  return {
    baselineSide: decisionMeta.baselineSide,
    finalSide: decisionMeta.finalSide,
    source: decisionMeta.finalSource,
    playerOverrideEngaged: decisionMeta.playerOverrideEngaged,
    universalQualifiedEngaged: decisionMeta.universalQualifiedEngaged,
    signalGrade,
  };
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
    selectionScore: signal.selectionScore ?? null,
    selectorFamily: signal.selectorFamily ?? null,
    selectorTier: signal.selectorTier ?? null,
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
    // Keep the board fast by lazy-loading deeper player detail only when a card is opened.
    analysisLogs: [],
    gameIntel: {
      generatedAt: row.gameIntel.generatedAt,
      modules: [],
    },
  };
}

function toBoardSnapshotData(
  data: SnapshotBoardData,
  lineupMap?: Map<string, LineupTeamSignal> | null,
): SnapshotBoardData {
  const sanitizedData = removeConfirmedOutPlayersFromBoardData(data, lineupMap);
  return {
    ...sanitizedData,
    universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
    rows: sanitizedData.rows.map((row) => toBoardSnapshotRow(row)),
  };
}

function hasPersistedBoardFeedData(data: SnapshotBoardData): boolean {
  return Boolean(data.boardFeed && Array.isArray(data.boardFeed.events));
}

function toDashboardSignal(signal: SnapshotPtsSignal | null | undefined): SnapshotDashboardSignal | null {
  if (!signal) return null;
  return {
    marketLine: signal.marketLine,
    sportsbookCount: signal.sportsbookCount,
    side: signal.side,
    confidence: signal.confidence,
    passReasons: signal.passReasons.slice(0, 2),
  };
}

function getMeaningfulPrecisionHistoricalAccuracy(
  signal: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy"> | null | undefined,
): number | null {
  if (!signal) return null;
  return signal.historicalAccuracy > 0 ? signal.historicalAccuracy : null;
}

function resolveSnapshotDisplayConfidence(input: {
  precisionSignal?: Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "historicalAccuracy"> | null;
  liveSignal?: Pick<SnapshotPtsSignal, "confidence"> | null;
}): number | null {
  const precisionSignal = input.precisionSignal ?? null;
  if (precisionSignal?.projectionWinProbability != null) {
    return precisionSignal.projectionWinProbability * 100;
  }

  return getMeaningfulPrecisionHistoricalAccuracy(precisionSignal) ?? input.liveSignal?.confidence ?? null;
}

function toDashboardPrecisionSignal(
  signal: SnapshotPrecisionPickSignal | null | undefined,
): SnapshotDashboardPrecisionSignal | null {
  if (!signal) return null;
  return {
    side: signal.side,
    qualified: signal.qualified,
    historicalAccuracy: getMeaningfulPrecisionHistoricalAccuracy(signal),
    projectionWinProbability: signal.projectionWinProbability,
    projectionPriceEdge: signal.projectionPriceEdge ?? null,
    selectionScore: signal.selectionScore ?? null,
    selectorFamily: signal.selectorFamily ?? null,
    selectorTier: signal.selectorTier ?? null,
    reasons: signal.reasons?.slice(0, 4),
  };
}

function toDashboardPrecisionSignals(
  signals: Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>> | undefined,
): Partial<Record<SnapshotMarket, SnapshotDashboardPrecisionSignal>> | undefined {
  if (!signals) return undefined;

  const entries = Object.entries(signals)
    .map(([market, signal]) => {
      const dashboardSignal = toDashboardPrecisionSignal(signal);
      return dashboardSignal ? ([market, dashboardSignal] as const) : null;
    })
    .filter((entry): entry is readonly [string, SnapshotDashboardPrecisionSignal] => entry !== null);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Partial<Record<SnapshotMarket, SnapshotDashboardPrecisionSignal>>;
}

function toDashboardModelLines(modelLines: SnapshotRow["modelLines"]): SnapshotDashboardModelLineRecord {
  return Object.fromEntries(
    MARKETS.map((market) => [
      market,
      {
        fairLine: modelLines[market].fairLine,
        modelSide: modelLines[market].modelSide,
      } satisfies SnapshotDashboardModelLine,
    ]),
  ) as SnapshotDashboardModelLineRecord;
}

function toDashboardDataCompleteness(dataCompleteness: SnapshotDataCompleteness): SnapshotDashboardDataCompleteness {
  return {
    score: dataCompleteness.score,
    tier: dataCompleteness.tier,
  };
}

function toDashboardPlayerContext(playerContext: SnapshotRow["playerContext"]): SnapshotDashboardPlayerContext {
  return {
    projectedStarter: playerContext.projectedStarter,
    lineupStatus: playerContext.lineupStatus,
    rotationRank: playerContext.rotationRank,
    minutesTrend: playerContext.minutesTrend,
    minutesVolatility: playerContext.minutesVolatility,
    projectedMinutes: playerContext.projectedMinutes,
    projectedMinutesFloor: playerContext.projectedMinutesFloor,
    projectedMinutesCeiling: playerContext.projectedMinutesCeiling,
    primaryDefender: playerContext.primaryDefender
      ? {
          playerName: playerContext.primaryDefender.playerName,
          matchupReason: playerContext.primaryDefender.matchupReason,
        }
      : null,
    teammateCore: playerContext.teammateCore.slice(0, 3).map((teammate) => ({
      playerId: teammate.playerId,
      playerName: teammate.playerName,
      avgMinutesLast10: teammate.avgMinutesLast10,
    })),
  };
}

function toDashboardGameIntel(gameIntel: SnapshotGameIntel): SnapshotDashboardGameIntel {
  return {
    generatedAt: gameIntel.generatedAt,
  };
}

function toDashboardSnapshotRow(row: SnapshotRow): SnapshotDashboardRow {
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    position: row.position,
    teamCode: row.teamCode,
    opponentCode: row.opponentCode,
    matchupKey: row.matchupKey,
    gameTimeEt: row.gameTimeEt,
    last5: row.last5,
    last10Average: row.last10Average,
    seasonAverage: row.seasonAverage,
    trendVsSeason: row.trendVsSeason,
    opponentAllowanceDelta: row.opponentAllowanceDelta,
    projectedTonight: row.projectedTonight,
    modelLines: toDashboardModelLines(row.modelLines),
    ptsSignal: toDashboardSignal(row.ptsSignal),
    rebSignal: toDashboardSignal(row.rebSignal),
    astSignal: toDashboardSignal(row.astSignal),
    threesSignal: toDashboardSignal(row.threesSignal),
    praSignal: toDashboardSignal(row.praSignal),
    paSignal: toDashboardSignal(row.paSignal),
    prSignal: toDashboardSignal(row.prSignal),
    raSignal: toDashboardSignal(row.raSignal),
    marketRuntime: row.marketRuntime,
    precisionSignals: toDashboardPrecisionSignals(row.precisionSignals),
    dataCompleteness: toDashboardDataCompleteness(row.dataCompleteness),
    playerContext: toDashboardPlayerContext(row.playerContext),
    gameIntel: toDashboardGameIntel(row.gameIntel),
  };
}

export function toSnapshotBoardViewData(data: SnapshotBoardData): SnapshotBoardViewData {
  return {
    ...data,
    rows: data.rows.map((row) => toDashboardSnapshotRow(row)),
  };
}

function buildPrecisionRecoveryCandidatesFromRows(rows: SnapshotRow[]): PrecisionSlateCandidate[] {
  return rows.flatMap((row) =>
    MARKETS.flatMap((market) => {
      const signal = row.precisionSignals?.[market] ?? null;
      const qualified = signal?.qualified ?? signal?.side !== "NEUTRAL";
      if (!signal || !qualified || signal.side === "NEUTRAL") return [];
      if (
        !isPromotedPrecisionCandidate({
          market,
          signal,
          sportsbookCount: getRowMarketSportsbookCount(row, market),
        })
      ) {
        return [];
      }
      return [
        {
          playerId: row.playerId,
          playerName: row.playerName,
          matchupKey: row.matchupKey,
          market,
          signal,
          selectionScore: signal.selectionScore ?? 0,
          source: "PRECISION" as const,
        } satisfies PrecisionSlateCandidate,
      ];
    }),
  );
}

const PRIMARY_PRECISION_CARD_MARKETS = new Set<SnapshotMarket>(["PTS", "REB", "PRA", "PR", "RA"]);
const CONTROLLED_PRECISION_RECOVERY_EXCLUDED_MARKETS = new Set<SnapshotMarket>(["THREES"]);
const CONTROLLED_PRECISION_PRIOR_RECOVERY_MIN_HISTORICAL_ACCURACY = 70;
const CONTROLLED_PRECISION_PRIOR_RECOVERY_MIN_WIN_PROBABILITY = 0.62;

function buildPrecisionPriorRecoveryCandidatesFromRows(rows: SnapshotRow[]): PrecisionSlateCandidate[] {
  return rows.flatMap((row) =>
    MARKETS.flatMap((market) => {
      if (CONTROLLED_PRECISION_RECOVERY_EXCLUDED_MARKETS.has(market)) return [];

      const liveSignal = getRowMarketSignal(row, market);
      const runtime = getRowMarketRuntime(row, market);
      const existingSignal = row.precisionSignals?.[market] ?? null;
      if (!existingSignal || !liveSignal || liveSignal.marketLine == null) return [];

      const sportsbookCount = liveSignal.sportsbookCount ?? 0;
      if (sportsbookCount < PROMOTED_PRECISION_MIN_SPORTSBOOK_COUNT) return [];

      if ((existingSignal.historicalAccuracy ?? 0) < CONTROLLED_PRECISION_PRIOR_RECOVERY_MIN_HISTORICAL_ACCURACY) {
        return [];
      }
      if ((existingSignal.projectionWinProbability ?? 0) < CONTROLLED_PRECISION_PRIOR_RECOVERY_MIN_WIN_PROBABILITY) {
        return [];
      }
      if (
        isPromotedPrecisionCandidate({
          market,
          signal: existingSignal,
          sportsbookCount,
        })
      ) {
        return [];
      }

      const side =
        runtime?.finalSide && runtime.finalSide !== "NEUTRAL"
          ? runtime.finalSide
          : liveSignal.side;
      if (side === "NEUTRAL") return [];

      const projection = row.projectedTonight[market];
      const basis = liveSignal.marketLine ?? row.modelLines[market].fairLine ?? null;
      const absLineGap =
        existingSignal.absLineGap ??
        (projection != null && basis != null ? round(Math.abs(projection - basis), 2) : null);
      const confidenceScore = round(Math.max(0, Math.min(1, (liveSignal.confidence ?? 0) / 100)), 4);
      const selectionScore = round(
        Math.max(existingSignal.projectionWinProbability ?? 0, confidenceScore) +
          Math.min(sportsbookCount, 10) * 0.01 +
          Math.min(absLineGap ?? 0, 5) * 0.01,
        6,
      );

      return [
        {
          playerId: row.playerId,
          playerName: row.playerName,
          matchupKey: row.matchupKey,
          market,
          signal: {
            ...existingSignal,
            side,
            qualified: false,
            absLineGap,
            selectionScore,
            selectorFamily: "precision_recovery",
            selectorTier: "precision_recovery",
            reasons: [
              "The core precision pool ran short, so this pick was promoted from the broader precision-prior recovery layer.",
              `${sportsbookCount} live books are pricing this market.`,
              "The precision prior stayed above the controlled recovery threshold.",
            ],
          },
          selectionScore,
          source: "PRECISION" as const,
        } satisfies PrecisionSlateCandidate,
      ];
    }),
  );
}

function buildControlledPrecisionRecoveryCandidatesFromRows(rows: SnapshotRow[]): PrecisionSlateCandidate[] {
  return [
    ...buildPrecisionRecoveryCandidatesFromRows(rows).filter(
      (candidate) => !CONTROLLED_PRECISION_RECOVERY_EXCLUDED_MARKETS.has(candidate.market),
    ),
    ...buildPrecisionPriorRecoveryCandidatesFromRows(rows),
  ]
    .sort(sortPrecisionTopOffCandidates);
}

type PrecisionFillStage = "qualified_fill" | "model_fill";

function getRowMarketSignal(row: SnapshotRow, market: SnapshotMarket): SnapshotPtsSignal | null {
  switch (market) {
    case "PTS":
      return row.ptsSignal;
    case "REB":
      return row.rebSignal;
    case "AST":
      return row.astSignal;
    case "THREES":
      return row.threesSignal;
    case "PRA":
      return row.praSignal;
    case "PA":
      return row.paSignal;
    case "PR":
      return row.prSignal;
    case "RA":
      return row.raSignal;
  }
}

function getRowMarketRuntime(row: SnapshotRow, market: SnapshotMarket): SnapshotMarketRuntime | null {
  return row.marketRuntime?.[market] ?? null;
}

function buildPrecisionFillSignal(
  row: SnapshotRow,
  market: SnapshotMarket,
  stage: PrecisionFillStage,
): SnapshotPrecisionPickSignal | null {
  const liveSignal = getRowMarketSignal(row, market);
  const runtime = getRowMarketRuntime(row, market);
  if (!liveSignal || liveSignal.marketLine == null) return null;
  if ((liveSignal.sportsbookCount ?? 0) < PROMOTED_PRECISION_MIN_SPORTSBOOK_COUNT) return null;

  const runtimeSource = runtime?.source ?? "baseline";
  if (stage === "qualified_fill" && runtimeSource !== "universal_qualified") return null;
  if (stage === "model_fill" && runtimeSource === "universal_qualified") return null;

  const side =
    runtime?.finalSide && runtime.finalSide !== "NEUTRAL"
      ? runtime.finalSide
      : liveSignal.side;
  if (side === "NEUTRAL") return null;

  const existingSignal = row.precisionSignals?.[market] ?? null;
  const projection = row.projectedTonight[market];
  const basis = liveSignal.marketLine ?? row.modelLines[market].fairLine ?? null;
  const absLineGap =
    existingSignal?.absLineGap ??
    (projection != null && basis != null ? round(Math.abs(projection - basis), 2) : null);
  const confidenceScore = round(Math.max(0, Math.min(1, (liveSignal.confidence ?? 0) / 100)), 4);
  const baselineSelectionScore = Math.max(
    existingSignal?.selectionScore ?? 0,
    existingSignal?.projectionWinProbability ?? 0,
    confidenceScore,
  );
  const selectionScore = round(
    baselineSelectionScore +
      (stage === "qualified_fill" ? 0.04 : 0.015) +
      Math.min(liveSignal.sportsbookCount, 10) * 0.01 +
      Math.min(absLineGap ?? 0, 5) * 0.01,
    6,
  );
  const reasons =
    stage === "qualified_fill"
      ? [
          "True precision picks came in under the six-pick target, so this board-qualified live spot was used as a fill.",
          `${liveSignal.sportsbookCount} live books are pricing this market.`,
          "This pick came from the qualified live board layer.",
        ]
      : [
          "True precision and qualified fill pools came in under the six-pick target, so this broader board model spot was used as a fill.",
          `${liveSignal.sportsbookCount} live books are pricing this market.`,
          runtimeSource === "player_override"
            ? "This pick came from the player-override board layer."
            : "This pick came from the baseline board layer.",
        ];

  return {
    side,
    qualified: false,
    historicalAccuracy: existingSignal?.historicalAccuracy ?? 0,
    historicalPicks: existingSignal?.historicalPicks ?? 0,
    historicalCoveragePct: existingSignal?.historicalCoveragePct,
    bucketRecentAccuracy: existingSignal?.bucketRecentAccuracy ?? null,
    leafAccuracy: existingSignal?.leafAccuracy ?? null,
    absLineGap,
    projectionWinProbability: existingSignal?.projectionWinProbability ?? confidenceScore,
    projectionPriceEdge: existingSignal?.projectionPriceEdge ?? null,
    selectionScore,
    selectorFamily: stage,
    selectorTier: stage,
    reasons,
  };
}

function buildPrecisionFillCandidateFromEntry(
  row: SnapshotRow,
  entry: SnapshotPrecisionCardEntry,
): PrecisionSlateCandidate | null {
  const stage = entry.precisionSignal?.selectorFamily;
  if (stage !== "qualified_fill" && stage !== "model_fill") return null;
  const signal = buildPrecisionFillSignal(row, entry.market, stage);
  if (!signal) return null;
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    matchupKey: row.matchupKey,
    market: entry.market,
    signal,
    selectionScore: signal.selectionScore ?? entry.selectionScore ?? 0,
    source: "PRECISION",
  } satisfies PrecisionSlateCandidate;
}

function sortPrecisionTopOffCandidates(left: PrecisionSlateCandidate, right: PrecisionSlateCandidate): number {
  return (
    right.selectionScore - left.selectionScore ||
    comparePrecisionSignals(left.signal, right.signal, "dynamic-edge-first") ||
    (left.playerName ?? left.playerId).localeCompare(right.playerName ?? right.playerId)
  );
}

function normalizePrecisionCardRanks(card: SnapshotPrecisionCardEntry[]): SnapshotPrecisionCardEntry[] {
  return card.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

function dedupePrecisionCardByPlayer(card: SnapshotPrecisionCardEntry[]): SnapshotPrecisionCardEntry[] {
  const bestEntryByPlayer = new Map<string, SnapshotPrecisionCardEntry>();

  card.forEach((entry) => {
    const existing = bestEntryByPlayer.get(entry.playerId);
    if (!existing || compareStabilizedPrecisionEntries(entry, existing) < 0) {
      bestEntryByPlayer.set(entry.playerId, entry);
    }
  });

  return Array.from(bestEntryByPlayer.values()).sort(compareStabilizedPrecisionEntries);
}

function enforcePrecisionCardTargetCount(
  currentCard: SnapshotPrecisionCardEntry[],
  rows: SnapshotRow[],
  targetCardCount: number,
): SnapshotPrecisionCardEntry[] {
  if (targetCardCount <= 0) {
    return [];
  }

  const next = dedupePrecisionCardByPlayer(currentCard).slice(0, targetCardCount);
  if (next.length >= targetCardCount) {
    return normalizePrecisionCardRanks(next);
  }

  const rowByPlayerId = new Map(rows.map((row) => [row.playerId, row] as const));
  const selectedPairs = new Set(next.map((entry) => getSnapshotPrecisionCardEntryKey(entry)));
  const selectedPlayers = new Set(next.map((entry) => entry.playerId));
  const recoveryCandidates = buildControlledPrecisionRecoveryCandidatesFromRows(rows);

  const candidateStages: Array<{
    candidates: PrecisionSlateCandidate[];
  }> = [
    { candidates: recoveryCandidates },
  ];

  const appendCandidate = (candidate: PrecisionSlateCandidate): void => {
    if (next.length >= targetCardCount) return;

    const candidateKey = getSnapshotPrecisionCardEntryKey(candidate);
    if (selectedPairs.has(candidateKey)) return;
    if (selectedPlayers.has(candidate.playerId)) return;

    const row = rowByPlayerId.get(candidate.playerId);
    if (!isPrecisionCardRowStillEligible(row)) return;

    const sportsbookCount = row ? getRowMarketSportsbookCount(row, candidate.market) : 0;
    if (
      !isPromotedPrecisionCandidate({
        market: candidate.market,
        signal: candidate.signal,
        sportsbookCount,
      })
    ) {
      return;
    }

    next.push({
      playerId: candidate.playerId,
      market: candidate.market,
      source: candidate.source,
      rank: next.length + 1,
      selectionScore: candidate.selectionScore,
      precisionSignal: candidate.signal,
    });
    selectedPairs.add(candidateKey);
    selectedPlayers.add(candidate.playerId);
  };

  candidateStages.forEach((stage) => {
    if (next.length >= targetCardCount) return;
    stage.candidates.forEach((candidate) => appendCandidate(candidate));
  });

  return normalizePrecisionCardRanks(next);
}

function getRowMarketSportsbookCount(row: SnapshotRow, market: SnapshotMarket): number {
  return getRowMarketSignal(row, market)?.sportsbookCount ?? 0;
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

async function resolveLineupSnapshotForDate(
  dateEt: string,
  setting: { value: unknown; updatedAt: Date } | null | undefined,
): Promise<{ snapshot: RotowireLineupSnapshot | null; updatedAt: Date | null }> {
  const fallback = {
    snapshot: parseLineupSnapshot(setting?.value ?? null, dateEt),
    updatedAt: setting?.updatedAt ?? null,
  };
  if (dateEt !== getSnapshotBoardDateString()) return fallback;

  return withTimeoutFallback(
    maybeRefreshTodayLineupSnapshot({
      dateEt,
      currentValue: setting?.value ?? null,
      currentUpdatedAt: setting?.updatedAt ?? null,
    }),
    fallback,
  );
}

function isConfirmedOutSignal(
  signal: Pick<LineupPlayerSignal, "availabilityStatus" | "availabilityPercentPlay"> | null | undefined,
): boolean {
  return signal?.availabilityStatus === "OUT" || signal?.availabilityPercentPlay === 0;
}

function isConfirmedOutSnapshotRow(row: SnapshotRow, lineupMap?: Map<string, LineupTeamSignal> | null): boolean {
  if (isConfirmedOutSignal(row.playerContext)) return true;
  if (!lineupMap) return false;
  return isConfirmedOutSignal(readLineupSignal(lineupMap, row.teamCode, row.playerName));
}

function summarizeFilteredPrecisionCard(
  card: SnapshotPrecisionCardEntry[],
  previousSummary: SnapshotPrecisionCardSummary | null | undefined,
): SnapshotPrecisionCardSummary | null {
  if (!previousSummary && card.length === 0) return previousSummary ?? null;
  const fillCount = card.filter((entry) => {
    const selectorFamily = entry.precisionSignal?.selectorFamily;
    return selectorFamily === "qualified_fill" || selectorFamily === "model_fill";
  }).length;
  return {
    targetCardCount: previousSummary?.targetCardCount ?? PRECISION_80_SYSTEM_SUMMARY.targetCardCount ?? card.length,
    truePickCount: Math.max(0, card.length - fillCount),
    fillCount,
    selectedCount: card.length,
  };
}

function removeConfirmedOutPlayersFromBoardData(
  data: SnapshotBoardData,
  lineupMap?: Map<string, LineupTeamSignal> | null,
): SnapshotBoardData {
  if (data.dateEt !== getSnapshotBoardDateString()) return data;

  const removedPlayerIds = new Set<string>();
  const rows = data.rows.filter((row) => {
    if (!isConfirmedOutSnapshotRow(row, lineupMap)) return true;
    removedPlayerIds.add(row.playerId);
    return false;
  });
  const rowPlayerIds = new Set(rows.map((row) => row.playerId));
  const precisionCard = normalizePrecisionCardRanks(
    (data.precisionCard ?? []).filter((entry) => rowPlayerIds.has(entry.playerId)),
  );
  const precisionCardChanged = precisionCard.length !== (data.precisionCard ?? []).length;
  if (removedPlayerIds.size === 0 && !precisionCardChanged) return data;

  const boardFeed = data.boardFeed
    ? {
        ...data.boardFeed,
        events: data.boardFeed.events.filter(
          (event) => !removedPlayerIds.has(event.playerId) && rowPlayerIds.has(event.playerId),
        ),
      }
    : data.boardFeed;

  return {
    ...data,
    rows,
    precisionCard,
    precisionCardSummary: summarizeFilteredPrecisionCard(precisionCard, data.precisionCardSummary),
    precisionDashboard: null,
    boardFeed,
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
    if (market === "PTS") {
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

function averageStocksPer36FromProfiles(profiles: PlayerProfile[]): number | null {
  return average(
    profiles
      .map((profile) => profile.stocksPer36Last10)
      .filter((value): value is number => value != null && Number.isFinite(value)),
  );
}

function roleAvailabilityWeight(profile: Pick<PlayerProfile, "minutesLast10Avg" | "starterRateLast10">): number {
  const minutesFactor = clamp((profile.minutesLast10Avg ?? 0) / 24, 0.35, 1.35);
  const starterFactor = clamp(0.68 + (profile.starterRateLast10 ?? 0.4) * 0.52, 0.68, 1.22);
  return round(minutesFactor * starterFactor, 3);
}

function isFrontcourtProfile(profile: Pick<PlayerProfile, "positionTokens">): boolean {
  return profile.positionTokens.has("F") || profile.positionTokens.has("C");
}

function isGuardWingProfile(profile: Pick<PlayerProfile, "positionTokens">): boolean {
  return profile.positionTokens.has("G") || (profile.positionTokens.has("F") && !profile.positionTokens.has("C"));
}

function isBigRimProfile(
  profile: Pick<PlayerProfile, "positionTokens" | "last10Average" | "blocksPer36Last10" | "stocksPer36Last10">,
): boolean {
  if (!isFrontcourtProfile(profile)) return false;
  return (
    profile.positionTokens.has("C") ||
    (profile.last10Average.REB ?? 0) >= 6.2 ||
    (profile.blocksPer36Last10 ?? 0) >= 0.9 ||
    (profile.stocksPer36Last10 ?? 0) >= 2.8
  );
}

function sumWeightedProfileLoad(
  profiles: PlayerProfile[],
  selector: (profile: PlayerProfile) => number | null,
): number | null {
  let total = 0;
  let seen = 0;
  profiles.forEach((profile) => {
    const value = selector(profile);
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    total += value * roleAvailabilityWeight(profile);
    seen += 1;
  });
  return seen > 0 ? round(total, 2) : null;
}

function loadShare(missingLoad: number | null, activeLoad: number | null): number | null {
  const total = (missingLoad ?? 0) + (activeLoad ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return round(Math.max(0, Math.min(1, (missingLoad ?? 0) / total)), 4);
}

function sumProjectedRotationPoints(profiles: PlayerProfile[], take = 8): number | null {
  const values = profiles
    .slice(0, take)
    .map((profile) => profile.last10Average.PTS)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0), 2);
}

function isLikelyMissingCorePlayer(input: {
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

type CoreAvailabilityContext = {
  activeProfiles: PlayerProfile[];
  missingProfiles: PlayerProfile[];
};

function buildCoreAvailabilityContext(input: {
  excludedPlayerId?: string | null;
  teamCode: string;
  teamProfiles: PlayerProfile[];
  lineupMap: Map<string, LineupTeamSignal>;
  statusLogsByPlayerId: Map<string, PlayerStatusLog[]>;
  take?: number;
}): CoreAvailabilityContext | null {
  const coreProfiles = input.teamProfiles
    .filter((profile) => profile.playerId !== input.excludedPlayerId)
    .slice(0, input.take ?? 4);
  if (coreProfiles.length === 0) return null;

  const missingCoreIds = new Set(
    coreProfiles
      .filter((profile) =>
        isLikelyMissingCorePlayer({
          profile,
          teamCode: input.teamCode,
          lineupMap: input.lineupMap,
          statusLogsByPlayerId: input.statusLogsByPlayerId,
        }),
      )
      .map((profile) => profile.playerId),
  );

  return {
    activeProfiles: coreProfiles.filter((profile) => !missingCoreIds.has(profile.playerId)),
    missingProfiles: coreProfiles.filter((profile) => missingCoreIds.has(profile.playerId)),
  };
}

function toOpponentAvailabilityInput(context: CoreAvailabilityContext): OpponentAvailabilityInput {
  const activeFrontcourtRebLoad = sumWeightedProfileLoad(
    context.activeProfiles.filter((profile) => isFrontcourtProfile(profile)),
    (profile) => profile.last10Average.REB,
  );
  const missingFrontcourtRebLoad = sumWeightedProfileLoad(
    context.missingProfiles.filter((profile) => isFrontcourtProfile(profile)),
    (profile) => profile.last10Average.REB,
  );
  const activeGuardWingAstLoad = sumWeightedProfileLoad(
    context.activeProfiles.filter((profile) => isGuardWingProfile(profile)),
    (profile) => profile.last10Average.AST,
  );
  const missingGuardWingAstLoad = sumWeightedProfileLoad(
    context.missingProfiles.filter((profile) => isGuardWingProfile(profile)),
    (profile) => profile.last10Average.AST,
  );
  const activeGuardWingDisruptionLoad = sumWeightedProfileLoad(
    context.activeProfiles.filter((profile) => isGuardWingProfile(profile)),
    (profile) => profile.stealsPer36Last10 ?? profile.stocksPer36Last10,
  );
  const missingGuardWingDisruptionLoad = sumWeightedProfileLoad(
    context.missingProfiles.filter((profile) => isGuardWingProfile(profile)),
    (profile) => profile.stealsPer36Last10 ?? profile.stocksPer36Last10,
  );
  const activeBigBlocksPer36Load = sumWeightedProfileLoad(
    context.activeProfiles.filter((profile) => isBigRimProfile(profile)),
    (profile) => profile.blocksPer36Last10,
  );
  const missingBigBlocksPer36Load = sumWeightedProfileLoad(
    context.missingProfiles.filter((profile) => isBigRimProfile(profile)),
    (profile) => profile.blocksPer36Last10,
  );
  const activeBigStocksPer36Load = sumWeightedProfileLoad(
    context.activeProfiles.filter((profile) => isBigRimProfile(profile)),
    (profile) => profile.stocksPer36Last10,
  );
  const missingBigStocksPer36Load = sumWeightedProfileLoad(
    context.missingProfiles.filter((profile) => isBigRimProfile(profile)),
    (profile) => profile.stocksPer36Last10,
  );
  const activeGuardWingReliefLoad =
    (activeGuardWingAstLoad ?? 0) * 0.62 + (activeGuardWingDisruptionLoad ?? 0) * 0.38;
  const missingGuardWingReliefLoad =
    (missingGuardWingAstLoad ?? 0) * 0.62 + (missingGuardWingDisruptionLoad ?? 0) * 0.38;
  const activeRimProtectionLoad = (activeBigBlocksPer36Load ?? 0) * 0.72 + (activeBigStocksPer36Load ?? 0) * 0.28;
  const missingRimProtectionLoad =
    (missingBigBlocksPer36Load ?? 0) * 0.72 + (missingBigStocksPer36Load ?? 0) * 0.28;
  return {
    activeCoreAverage: averageMetricRecordFromProfiles(context.activeProfiles),
    missingCoreAverage: averageMetricRecordFromProfiles(context.missingProfiles),
    activeCoreCount: context.activeProfiles.length,
    missingCoreCount: context.missingProfiles.length,
    activeCoreStocksPer36: averageStocksPer36FromProfiles(context.activeProfiles),
    missingCoreStocksPer36: averageStocksPer36FromProfiles(context.missingProfiles),
    missingFrontcourtRebLoad,
    missingFrontcourtRebShare: loadShare(missingFrontcourtRebLoad, activeFrontcourtRebLoad),
    missingGuardWingAstLoad,
    missingGuardWingDisruptionLoad,
    missingGuardWingDisruptionShare: loadShare(missingGuardWingReliefLoad, activeGuardWingReliefLoad),
    missingBigBlocksPer36Load,
    missingBigStocksPer36Load,
    missingRimProtectionShare: loadShare(missingRimProtectionLoad, activeRimProtectionLoad),
  };
}

function buildTeammateSynergyInput(input: {
  playerId: string;
  teamCode: string;
  teamProfiles: PlayerProfile[];
  lineupMap: Map<string, LineupTeamSignal>;
  statusLogsByPlayerId: Map<string, PlayerStatusLog[]>;
}): TeamSynergyInput | null {
  const context = buildCoreAvailabilityContext({
    excludedPlayerId: input.playerId,
    teamCode: input.teamCode,
    teamProfiles: input.teamProfiles,
    lineupMap: input.lineupMap,
    statusLogsByPlayerId: input.statusLogsByPlayerId,
  });
  if (!context) return null;

  return {
    activeCoreAverage: averageMetricRecordFromProfiles(context.activeProfiles),
    missingCoreAverage: averageMetricRecordFromProfiles(context.missingProfiles),
    activeCoreCount: context.activeProfiles.length,
    missingCoreCount: context.missingProfiles.length,
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

function formatPercentPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}%`;
}

function formatGapRead(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "on the line";
  if (Math.abs(value) < 0.05) return "on the line";
  return `${formatNumber(Math.abs(value))} ${value > 0 ? "above" : "below"}`;
}

function getBoardFeedKey(input: Pick<BoardFeedMarketSnapshot, "matchupKey" | "playerId" | "market">): string {
  return `${input.matchupKey}|${input.playerId}|${input.market}`;
}

function buildBoardFeedTitle(eventType: SnapshotBoardFeedEventType): string {
  if (eventType === "SURFACED") return "Surfaced";
  if (eventType === "MOVED") return "Moved";
  if (eventType === "STRENGTHENED") return "Strengthened";
  if (eventType === "WEAKENED") return "Weakened";
  if (eventType === "DROPPED") return "Dropped";
  return "Locked";
}

function buildBoardFeedRecommendation(snapshot: Pick<BoardFeedMarketSnapshot, "side" | "line" | "fairLine" | "market">): string {
  const line = snapshot.line ?? snapshot.fairLine;
  const label = MARKET_LABELS[snapshot.market];
  if (snapshot.side === "NEUTRAL") {
    return line == null ? `${label} waiting for line` : `${label} ${formatNumber(line)}`;
  }
  return line == null ? `${snapshot.side} ${label}` : `${snapshot.side} ${formatNumber(line)} ${label}`;
}

function buildBoardFeedBooksPhrase(booksLive: number | null | undefined): string {
  if (booksLive == null || !Number.isFinite(booksLive) || booksLive <= 0) return "";
  const rounded = Math.max(0, Math.round(booksLive));
  return ` across ${rounded} ${rounded === 1 ? "book" : "books"}`;
}

function buildBoardFeedReason(snapshot: Pick<BoardFeedMarketSnapshot, "gap" | "booksLive" | "reasons" | "selectorFamily">): string {
  if (snapshot.gap != null) {
    return `Projection is ${formatGapRead(snapshot.gap)} the live line${buildBoardFeedBooksPhrase(snapshot.booksLive)}.`;
  }
  const surfacedReason = snapshot.reasons[0]?.trim();
  if (surfacedReason) return surfacedReason;
  if (snapshot.selectorFamily) {
    return `${snapshot.selectorFamily} surfaced this pregame number.`;
  }
  return `Pregame books posted a trackable number${buildBoardFeedBooksPhrase(snapshot.booksLive)}.`;
}

function getBoardFeedSignal(row: SnapshotRow, market: SnapshotMarket): SnapshotPtsSignal | null {
  if (market === "PTS") return row.ptsSignal;
  if (market === "REB") return row.rebSignal;
  if (market === "AST") return row.astSignal;
  if (market === "THREES") return row.threesSignal;
  if (market === "PRA") return row.praSignal;
  if (market === "PA") return row.paSignal;
  if (market === "PR") return row.prSignal;
  if (market === "RA") return row.raSignal;
  return null;
}

function buildPrecisionEntryMap(data: Pick<SnapshotBoardData, "precisionCard">): Map<string, SnapshotPrecisionCardEntry> {
  return new Map(
    (data.precisionCard ?? []).map((entry) => [
      `${entry.playerId}|${entry.market}`,
      entry,
    ] as const),
  );
}

function buildBoardFeedSnapshot(
  row: SnapshotRow,
  market: SnapshotMarket,
  entry: SnapshotPrecisionCardEntry | null = null,
): BoardFeedMarketSnapshot {
  const liveSignal = getBoardFeedSignal(row, market);
  const precision = entry?.precisionSignal ?? row.precisionSignals?.[market] ?? null;
  const fairLine = row.modelLines[market].fairLine;
  const line = liveSignal?.marketLine ?? null;
  const projection = row.projectedTonight[market];
  const basis = line ?? fairLine;
  const usesComputedSide = !(precision?.qualified && precision.side !== "NEUTRAL") && basis != null && projection != null;
  const side: SnapshotModelSide =
    precision?.qualified && precision.side !== "NEUTRAL"
      ? precision.side
      : usesComputedSide
        ? projection > basis
          ? "OVER"
          : projection < basis
            ? "UNDER"
            : "NEUTRAL"
        : liveSignal?.side ?? row.modelLines[market].modelSide;
  const confidence = resolveSnapshotDisplayConfidence({ precisionSignal: precision, liveSignal });
  const gap = projection != null && basis != null ? round(projection - basis, 1) : precision?.projectionPriceEdge ?? null;
  const booksLive = line != null && (liveSignal?.sportsbookCount ?? 0) > 0 ? liveSignal?.sportsbookCount ?? null : null;
  const reasons = [...(precision?.reasons ?? []).slice(0, 2), ...(liveSignal?.passReasons ?? []).slice(0, 2)].filter(Boolean);
  const score =
    (entry?.selectionScore ?? precision?.selectionScore ?? 0) +
    (confidence ?? 0) * 0.35 +
    (gap != null ? Math.abs(gap) * 12 : 0) +
    (line != null ? 10 : 0) +
    (precision?.qualified ? 18 : 0) +
    Math.min(liveSignal?.sportsbookCount ?? 0, 6) +
    row.dataCompleteness.score * 0.08;

  return {
    key: getBoardFeedKey({ matchupKey: row.matchupKey, playerId: row.playerId, market }),
    playerId: row.playerId,
    playerName: row.playerName,
    matchupKey: row.matchupKey,
    gameTimeEt: row.gameTimeEt,
    market,
    side,
    line,
    fairLine,
    projection,
    gap,
    confidence,
    booksLive,
    rank: entry?.rank ?? null,
    precisionQualified: Boolean(precision?.qualified || (precision?.side && precision.side !== "NEUTRAL")),
    selectorFamily: precision?.selectorFamily ?? null,
    reasons,
    score,
  };
}

function buildBoardFeedSnapshotMap(data: SnapshotBoardData): Map<string, BoardFeedMarketSnapshot> {
  const entryByKey = buildPrecisionEntryMap(data);
  const snapshots = new Map<string, BoardFeedMarketSnapshot>();

  data.rows.forEach((row) => {
    MARKETS.forEach((market) => {
      const snapshot = buildBoardFeedSnapshot(row, market, entryByKey.get(`${row.playerId}|${market}`) ?? null);
      snapshots.set(snapshot.key, snapshot);
    });
  });

  return snapshots;
}

function isBoardFeedCandidate(snapshot: BoardFeedMarketSnapshot | null | undefined): snapshot is BoardFeedMarketSnapshot {
  if (!snapshot || snapshot.line == null) return false;
  const absGap = Math.abs(snapshot.gap ?? 0);
  const confidence = snapshot.confidence ?? 0;
  return snapshot.precisionQualified || absGap >= 0.5 || confidence >= 58 || snapshot.score >= 55;
}

function buildBoardFeedLatestEventMap(events: SnapshotBoardFeedItem[]): Map<string, SnapshotBoardFeedItem> {
  const map = new Map<string, SnapshotBoardFeedItem>();
  events.forEach((event) => {
    const key = `${event.matchupKey}|${event.playerId}|${event.market}`;
    const existing = map.get(key);
    if (!existing || existing.createdAt < event.createdAt) {
      map.set(key, event);
    }
  });
  return map;
}

function createBoardFeedItem(input: {
  eventType: SnapshotBoardFeedEventType;
  status: SnapshotBoardFeedStatus;
  createdAt: string;
  snapshot: BoardFeedMarketSnapshot;
  detail: string;
}): SnapshotBoardFeedItem {
  return {
    id: `${input.createdAt}:${input.eventType}:${input.snapshot.key}`,
    createdAt: input.createdAt,
    eventType: input.eventType,
    status: input.status,
    title: buildBoardFeedTitle(input.eventType),
    detail: input.detail,
    playerId: input.snapshot.playerId,
    playerName: input.snapshot.playerName,
    matchupKey: input.snapshot.matchupKey,
    gameTimeEt: input.snapshot.gameTimeEt,
    market: input.snapshot.market,
    recommendation: buildBoardFeedRecommendation(input.snapshot),
    side: input.snapshot.side,
    line: input.snapshot.line,
    fairLine: input.snapshot.fairLine,
    projection: input.snapshot.projection,
    gap: input.snapshot.gap,
    confidence: input.snapshot.confidence,
    booksLive: input.snapshot.booksLive,
    rank: input.snapshot.rank,
  };
}

function buildBoardFeedTransitionEvent(
  previous: BoardFeedMarketSnapshot,
  current: BoardFeedMarketSnapshot,
  createdAt: string,
): SnapshotBoardFeedItem | null {
  const lineChanged =
    previous.line != null &&
    current.line != null &&
    Math.abs(current.line - previous.line) >= SNAPSHOT_BOARD_FEED_LINE_THRESHOLD;
  const sideChanged = previous.side !== current.side && current.side !== "NEUTRAL";

  if (lineChanged || sideChanged) {
    const detail = lineChanged
      ? `Line moved from ${formatNumber(previous.line)} to ${formatNumber(current.line)}. ${buildBoardFeedReason(current)}`
      : `Recommendation flipped from ${previous.side} to ${current.side}. ${buildBoardFeedReason(current)}`;
    return createBoardFeedItem({
      eventType: "MOVED",
      status: "PREGAME",
      createdAt,
      snapshot: current,
      detail,
    });
  }

  const gapDelta = Math.abs(current.gap ?? 0) - Math.abs(previous.gap ?? 0);
  const confidenceDelta = (current.confidence ?? 0) - (previous.confidence ?? 0);
  if (gapDelta >= SNAPSHOT_BOARD_FEED_GAP_THRESHOLD || confidenceDelta >= SNAPSHOT_BOARD_FEED_CONFIDENCE_THRESHOLD) {
    const detail =
      gapDelta >= SNAPSHOT_BOARD_FEED_GAP_THRESHOLD
        ? `Model gap widened to ${formatGapRead(current.gap)} before tipoff. Confidence now sits ${formatPercentPoints(current.confidence)}.`
        : `Confidence climbed to ${formatPercentPoints(current.confidence)} while the pregame number stayed in range.`;
    return createBoardFeedItem({
      eventType: "STRENGTHENED",
      status: "PREGAME",
      createdAt,
      snapshot: current,
      detail,
    });
  }

  if (gapDelta <= -SNAPSHOT_BOARD_FEED_GAP_THRESHOLD || confidenceDelta <= -SNAPSHOT_BOARD_FEED_CONFIDENCE_THRESHOLD) {
    const detail =
      gapDelta <= -SNAPSHOT_BOARD_FEED_GAP_THRESHOLD
        ? `Model gap narrowed to ${formatGapRead(current.gap)} before tipoff. Confidence now sits ${formatPercentPoints(current.confidence)}.`
        : `Confidence eased to ${formatPercentPoints(current.confidence)} while the pregame line stayed posted.`;
    return createBoardFeedItem({
      eventType: "WEAKENED",
      status: "PREGAME",
      createdAt,
      snapshot: current,
      detail,
    });
  }

  return null;
}

function buildSnapshotBoardFeed(input: {
  dateEt: string;
  current: SnapshotBoardData;
  previous: SnapshotBoardData | null;
  matchupStartMsByKey: Map<string, number | null>;
  nowMs: number;
  isTodayEt: boolean;
  eventTime: string;
}): SnapshotBoardFeed {
  const label = "Board feed";
  const note = "Pregame changes captured throughout the day. Markets freeze at tipoff.";
  const previousEvents = input.previous?.boardFeed?.events ?? [];
  if (!input.isTodayEt) {
    return {
      label,
      note,
      events: previousEvents,
    };
  }

  const previousSnapshots = input.previous ? buildBoardFeedSnapshotMap(input.previous) : new Map<string, BoardFeedMarketSnapshot>();
  const currentSnapshots = buildBoardFeedSnapshotMap(input.current);
  const latestEventByKey = buildBoardFeedLatestEventMap(previousEvents);
  const candidateKeys = new Set<string>([
    ...previousSnapshots.keys(),
    ...currentSnapshots.keys(),
  ]);

  const orderedKeys = Array.from(candidateKeys).sort((left, right) => {
    const leftSnapshot = currentSnapshots.get(left) ?? previousSnapshots.get(left);
    const rightSnapshot = currentSnapshots.get(right) ?? previousSnapshots.get(right);
    return (rightSnapshot?.score ?? 0) - (leftSnapshot?.score ?? 0);
  });

  const nextEvents: SnapshotBoardFeedItem[] = [];
  orderedKeys.forEach((key) => {
    const previous = previousSnapshots.get(key) ?? null;
    const current = currentSnapshots.get(key) ?? null;
    const latestEvent = latestEventByKey.get(key) ?? null;
    if (latestEvent?.eventType === "LOCKED" || latestEvent?.status === "FINAL") {
      return;
    }

    const matchupKey = current?.matchupKey ?? previous?.matchupKey;
    const matchupStartMs = matchupKey != null ? input.matchupStartMsByKey.get(matchupKey) ?? null : null;
    const started = matchupStartMs != null && matchupStartMs <= input.nowMs;
    const previousTracked = isBoardFeedCandidate(previous);
    const currentTracked = !started && isBoardFeedCandidate(current);

    if (started) {
      if (previousTracked) {
        nextEvents.push(
          createBoardFeedItem({
            eventType: "LOCKED",
            status: input.dateEt === getSnapshotBoardDateString() ? "LOCKED" : "FINAL",
            createdAt: input.eventTime,
            snapshot: previous,
            detail: "Pregame tracking stopped at tipoff. Final pregame snapshot kept.",
          }),
        );
      }
      return;
    }

    if (!previousTracked && currentTracked) {
      nextEvents.push(
        createBoardFeedItem({
          eventType: "SURFACED",
          status: "PREGAME",
          createdAt: input.eventTime,
          snapshot: current,
          detail: buildBoardFeedReason(current),
        }),
      );
      return;
    }

    if (previousTracked && !currentTracked) {
      nextEvents.push(
        createBoardFeedItem({
          eventType: "DROPPED",
          status: "PREGAME",
          createdAt: input.eventTime,
          snapshot: previous,
          detail: "Pregame number disappeared before tipoff, so the play fell off the board.",
        }),
      );
      return;
    }

    if (previousTracked && currentTracked) {
      const transitionEvent = buildBoardFeedTransitionEvent(previous, current, input.eventTime);
      if (transitionEvent) {
        nextEvents.push(transitionEvent);
      }
    }
  });

  const mergedEvents =
    previousEvents.length === 0 && nextEvents.length === 0
      ? Array.from(currentSnapshots.values())
          .filter((snapshot) => {
            const matchupStartMs = input.matchupStartMsByKey.get(snapshot.matchupKey) ?? null;
            return !((matchupStartMs ?? Number.MAX_SAFE_INTEGER) <= input.nowMs) && isBoardFeedCandidate(snapshot);
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, SNAPSHOT_BOARD_FEED_SEED_LIMIT)
          .map((snapshot) =>
            createBoardFeedItem({
              eventType: "SURFACED",
              status: "PREGAME",
              createdAt: input.eventTime,
              snapshot,
              detail: buildBoardFeedReason(snapshot),
            }),
          )
      : [...nextEvents, ...previousEvents];

  return {
    label,
    note,
    events: mergedEvents
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.playerName.localeCompare(b.playerName);
      })
      .slice(0, SNAPSHOT_BOARD_FEED_EVENT_LIMIT),
  };
}

function actualValueFromGameLog(
  log: {
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    threes: number | null;
  },
  market: SnapshotMarket,
): number | null {
  const points = toStat(log.points);
  const rebounds = toStat(log.rebounds);
  const assists = toStat(log.assists);
  const threes = toStat(log.threes);
  const sumValues = (...values: Array<number | null>) =>
    values.every((value) => value != null) ? round(values.reduce((sum, value) => sum + (value ?? 0), 0), 2) : null;

  if (market === "PTS") return points;
  if (market === "REB") return rebounds;
  if (market === "AST") return assists;
  if (market === "THREES") return threes;
  if (market === "PRA") return sumValues(points, rebounds, assists);
  if (market === "PA") return sumValues(points, assists);
  if (market === "PR") return sumValues(points, rebounds);
  if (market === "RA") return sumValues(rebounds, assists);
  return null;
}

function resolvePrecisionOutcome(
  side: SnapshotModelSide,
  line: number | null,
  actualValue: number | null,
): SnapshotPrecisionAuditOutcome | null {
  if (side === "NEUTRAL" || line == null || actualValue == null) return null;
  if (actualValue === line) return "PUSH";
  if (side === "OVER") return actualValue > line ? "WIN" : "LOSS";
  return actualValue < line ? "WIN" : "LOSS";
}

async function buildSnapshotPrecisionDashboard(input: {
  dateEt: string;
  data: SnapshotBoardData;
  matchupStartMsByKey: Map<string, number | null>;
  matchupFinalByKey: Map<string, boolean>;
  nowMs: number;
}): Promise<SnapshotPrecisionDashboard> {
  const label = "Precision Picks";
  const note =
    "Only picks that passed the precision selection rules. No general board reads, no fallback picks, and no non-qualified players.";
  const auditNote = "Promoted picks come only from the precision selection pipeline and freeze at tipoff.";
  const rowByPlayerId = new Map(input.data.rows.map((row) => [row.playerId, row] as const));
  const precisionEntries = (input.data.precisionCard ?? [])
    .map((entry) => {
      const row = rowByPlayerId.get(entry.playerId);
      if (!row) return null;
      return {
        entry,
        row,
        snapshot: buildBoardFeedSnapshot(row, entry.market, entry),
      };
    })
    .filter(
      (
        value,
      ): value is {
        entry: SnapshotPrecisionCardEntry;
        row: SnapshotRow;
        snapshot: BoardFeedMarketSnapshot;
      } => value != null,
    )
    .sort((left, right) => left.entry.rank - right.entry.rank);

  if (precisionEntries.length === 0) {
    return {
      label,
      note,
      auditNote,
      promotedCount: 0,
      qualifiedCount: 0,
      activeCount: 0,
      lockedCount: 0,
      pendingCount: 0,
      settledCount: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      hitRate: null,
      units: null,
      roiPct: null,
      averageConfidence: null,
      averageBooksLive: null,
      entries: [],
    };
  }

  const playerIds = Array.from(new Set(precisionEntries.map(({ entry }) => entry.playerId)));
  const actualLogs =
    playerIds.length > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            gameDateEt: input.dateEt,
            playerId: { in: playerIds },
          },
          select: {
            playerId: true,
            played: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];
  const actualLogByPlayerId = new Map(actualLogs.map((log) => [log.playerId, log] as const));

  const audits: SnapshotPrecisionAuditEntry[] = precisionEntries.map(({ entry, row, snapshot }) => {
    const actualLog = actualLogByPlayerId.get(entry.playerId) ?? null;
    const actualValue =
      actualLog && actualLog.played !== false ? actualValueFromGameLog(actualLog, entry.market) : null;
    const matchupStartMs = input.matchupStartMsByKey.get(row.matchupKey) ?? null;
    const matchupFinal = input.matchupFinalByKey.get(row.matchupKey) ?? false;
    const started = matchupStartMs != null && matchupStartMs <= input.nowMs;
    const line = entry.lockedLine ?? snapshot.line ?? snapshot.fairLine ?? null;
    const outcome = matchupFinal ? resolvePrecisionOutcome(snapshot.side, line, actualValue) : null;
    const status =
      (actualValue != null || actualLog?.played === false) && matchupFinal
        ? "SETTLED"
        : started
          ? "LOCKED"
          : "ACTIVE";

    return {
      playerId: entry.playerId,
      market: entry.market,
      line,
      actualValue,
      status,
      outcome,
    };
  });

  const settledEntries = audits.filter((entry) => entry.status === "SETTLED");
  const wins = settledEntries.filter((entry) => entry.outcome === "WIN").length;
  const losses = settledEntries.filter((entry) => entry.outcome === "LOSS").length;
  const pushes = settledEntries.filter((entry) => entry.outcome === "PUSH").length;
  const gradedCount = wins + losses + pushes;
  const averageConfidenceValues = precisionEntries
    .map(({ snapshot }) => snapshot.confidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const averageBooksLiveValues = precisionEntries
    .map(({ snapshot }) => snapshot.booksLive)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const units = gradedCount > 0 ? round(wins * 0.91 - losses, 2) : null;

  return {
    label,
    note,
    auditNote,
    promotedCount: precisionEntries.length,
    qualifiedCount: precisionEntries.length,
    activeCount: audits.filter((entry) => entry.status === "ACTIVE").length,
    lockedCount: audits.filter((entry) => entry.status === "LOCKED").length,
    pendingCount: audits.filter((entry) => entry.status !== "SETTLED").length,
    settledCount: settledEntries.length,
    wins,
    losses,
    pushes,
    hitRate: wins + losses > 0 ? round((wins / (wins + losses)) * 100, 1) : null,
    units,
    roiPct: units != null && gradedCount > 0 ? round((units / gradedCount) * 100, 1) : null,
    averageConfidence:
      averageConfidenceValues.length > 0
        ? round(
            averageConfidenceValues.reduce((sum, value) => sum + value, 0) / averageConfidenceValues.length,
            1,
          )
        : null,
    averageBooksLive:
      averageBooksLiveValues.length > 0
        ? round(averageBooksLiveValues.reduce((sum, value) => sum + value, 0) / averageBooksLiveValues.length, 1)
        : null,
    entries: audits,
  };
}

async function withSnapshotPrecisionDashboard(
  data: SnapshotBoardData,
  input: {
    dateEt: string;
    matchupStartMsByKey?: Map<string, number | null>;
    matchupFinalByKey?: Map<string, boolean>;
    nowMs?: number;
  },
): Promise<SnapshotBoardData> {
  const nowMs = input.nowMs ?? Date.now();
  let matchupStartMsByKey = input.matchupStartMsByKey ?? null;
  let matchupFinalByKey = input.matchupFinalByKey ?? null;

  if (!matchupStartMsByKey || !matchupFinalByKey) {
    const games = await prisma.game.findMany({
      where: { gameDateEt: input.dateEt },
      select: {
        status: true,
        commenceTimeUtc: true,
        awayTeam: { select: { abbreviation: true } },
        homeTeam: { select: { abbreviation: true } },
      },
    });
    if (!matchupStartMsByKey) {
      matchupStartMsByKey = new Map(
        games.map((game) => [
          `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
          game.commenceTimeUtc?.getTime() ?? null,
        ] as const),
      );
    }
    if (!matchupFinalByKey) {
      matchupFinalByKey = new Map(
        games.map((game) => [
          `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
          Boolean(game.status && /final/i.test(game.status)),
        ] as const),
      );
    }
  }

  return {
    ...data,
    precisionDashboard: await buildSnapshotPrecisionDashboard({
      dateEt: input.dateEt,
      data,
      matchupStartMsByKey,
      matchupFinalByKey: matchupFinalByKey ?? new Map(),
      nowMs,
    }),
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const isTodayEt = dateEt === getSnapshotBoardDateString();
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
  const stealsPer36Last10 =
    minutesLast10Avg == null || minutesLast10Avg <= 0 || stealsLast10Avg == null
      ? null
      : round((stealsLast10Avg / minutesLast10Avg) * 36, 2);
  const blocksPer36Last10 =
    minutesLast10Avg == null || minutesLast10Avg <= 0 || blocksLast10Avg == null
      ? null
      : round((blocksLast10Avg / minutesLast10Avg) * 36, 2);
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
    stealsPer36Last10,
    blocksPer36Last10,
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

export async function getInitialSnapshotBoardViewData(dateEt: string): Promise<SnapshotBoardViewData> {
  try {
    if (dateEt === getSnapshotBoardDateString()) {
      return preferBundledSnapshotBoardViewFallbackWhenBroken(
        dateEt,
        toSnapshotBoardViewData(
          await withSnapshotPrecisionDashboard(await getSnapshotBoardData(dateEt, false), { dateEt }),
        ),
      );
    }

    const [persistedBoardSetting, lineupSetting] = await Promise.all([
      prisma.systemSetting.findUnique({
        where: { key: getSnapshotBoardSettingKey(dateEt) },
        select: { value: true },
      }),
      dateEt === getSnapshotBoardDateString()
        ? prisma.systemSetting.findUnique({
            where: { key: "snapshot_lineups_today" },
            select: { value: true, updatedAt: true },
          })
        : Promise.resolve(null),
    ]);
    const lineupSnapshotResult = await resolveLineupSnapshotForDate(dateEt, lineupSetting);
    const lineupMap = buildLineupSignalMap(lineupSnapshotResult.snapshot);
    const persistedBoard = readPersistedSnapshotBoardSetting(persistedBoardSetting?.value ?? null);
    if (persistedBoard && hasPersistedBoardFeedData(persistedBoard.data)) {
      return preferBundledSnapshotBoardViewFallbackWhenBroken(
        dateEt,
        toSnapshotBoardViewData(
          await withSnapshotPrecisionDashboard(toBoardSnapshotData(persistedBoard.data, lineupMap), { dateEt }),
        ),
      );
    }
    return preferBundledSnapshotBoardViewFallbackWhenBroken(
      dateEt,
      toSnapshotBoardViewData(await withSnapshotPrecisionDashboard(await getSnapshotBoardData(dateEt, true), { dateEt })),
    );
  } catch (error) {
    return getSnapshotBoardViewFallbackOrThrow(dateEt, error);
  }
}

export async function getSnapshotBoardViewData(dateEt: string, bustCache = false): Promise<SnapshotBoardViewData> {
  try {
    return preferBundledSnapshotBoardViewFallbackWhenBroken(
      dateEt,
      toSnapshotBoardViewData(
        await withSnapshotPrecisionDashboard(await getSnapshotBoardData(dateEt, bustCache), { dateEt }),
      ),
    );
  } catch (error) {
    return getSnapshotBoardViewFallbackOrThrow(dateEt, error);
  }
}

export async function getSnapshotBoardData(dateEt: string, bustCache = false): Promise<SnapshotBoardData> {
  const isTodayEt = dateEt === getSnapshotBoardDateString();
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
  const lineupSnapshotResult = await resolveLineupSnapshotForDate(dateEt, lineupSetting);
  const lineupUpdatedAt = lineupSnapshotResult.updatedAt ?? lineupSetting?.updatedAt ?? null;
  const lineupMap = buildLineupSignalMap(lineupSnapshotResult.snapshot);
  const sourceUpdatedAtIso = latestUpdatedAtIso(
    latestGameWrite._max.updatedAt,
    latestDataWrite._max.updatedAt,
    lineupUpdatedAt,
    latestRefreshUpdatedAt,
  );
  const lineupUpdatedAtIso = lineupUpdatedAt?.toISOString() ?? null;
  const gameUpdatedAtIso = latestGameWrite._max.updatedAt?.toISOString() ?? null;
  const promotedPraRuntime = getLivePraRawFeatureRuntimeMeta();
  const playerOverrideRuntime = getLivePlayerOverrideRuntimeMeta();
  const recentWeaknessRouterRuntime = getRecentWeaknessRouterRuntimeMeta();
  const sourceSignal = [
    sourceUpdatedAtIso ?? "none",
    gameUpdatedAtIso ?? "none",
    latestDataWrite._max.updatedAt?.toISOString() ?? "none",
    lineupUpdatedAtIso ?? "none",
    SNAPSHOT_BOARD_PAYLOAD_VERSION,
    UNIVERSAL_SYSTEM_SUMMARY_VERSION,
    PRECISION_80_SYSTEM_SUMMARY_VERSION,
    promotedPraRuntime.enabled
      ? `${promotedPraRuntime.version ?? "unknown"}:${promotedPraRuntime.label ?? "pra-live"}`
      : `pra-raw-feature:${promotedPraRuntime.mode}`,
    `player-overrides:${playerOverrideRuntime.mode}:${playerOverrideRuntime.joelMode}:${playerOverrideRuntime.javonMode}:${playerOverrideRuntime.jaMode}:${playerOverrideRuntime.naeMode}:${playerOverrideRuntime.coleMode}:${playerOverrideRuntime.dejounteMode}:${playerOverrideRuntime.devinMode}:${playerOverrideRuntime.aaronMode}:${playerOverrideRuntime.sabonisMode}:${playerOverrideRuntime.taureanMode}:${playerOverrideRuntime.tristanMode}:${playerOverrideRuntime.marcusMode}:${playerOverrideRuntime.kyleMode}`,
    `player-local-manifest:${playerOverrideRuntime.playerLocalRecoveryManifestMode}:${playerOverrideRuntime.playerLocalRecoveryManifestSignature ?? "none"}`,
    `player-market-drag-memory:${playerOverrideRuntime.playerMarketResidualDragMemoryMode}:${playerOverrideRuntime.playerMarketResidualDragMemorySignature ?? "none"}`,
    `recent-weakness-router:${recentWeaknessRouterRuntime.mode}:${recentWeaknessRouterRuntime.version ?? "none"}:${recentWeaknessRouterRuntime.startDateEt ?? "none"}`,
  ].join("|");
  const cacheKey = dateEt;
  const cached = snapshotBoardCache.get(cacheKey);
  if (
    !bustCache &&
    cached &&
    cached.sourceSignal === sourceSignal &&
    cached.expiresAt > Date.now() &&
    !isUnderfilledPrecisionBoard(dateEt, cached.data) &&
    hasPersistedBoardFeedData(cached.data)
  ) {
    return toBoardSnapshotData(cached.data, lineupMap);
  }

  const persistedBoardSetting = await prisma.systemSetting.findUnique({
    where: { key: getSnapshotBoardSettingKey(dateEt) },
    select: { value: true },
  });
  const persistedBoard = readPersistedSnapshotBoardSetting(persistedBoardSetting?.value ?? null);
  const persistedRowMap = buildPersistedSnapshotRowMap(persistedBoard);
  if (
    !bustCache &&
    persistedBoard &&
    persistedBoard.sourceSignal === sourceSignal &&
    !isUnderfilledPrecisionBoard(dateEt, persistedBoard.data) &&
    hasPersistedBoardFeedData(persistedBoard.data)
  ) {
    const normalizedPersistedBoard = {
      ...toBoardSnapshotData(persistedBoard.data, lineupMap),
      universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
    };
    snapshotBoardCache.set(cacheKey, {
      data: normalizedPersistedBoard,
      sourceSignal,
      expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
    });
    return normalizedPersistedBoard;
  }
  if (games.length === 0) {
    const emptyData = {
      dateEt,
      lastUpdatedAt: sourceUpdatedAtIso,
      matchups: [],
      teamMatchups: [],
      rows: [],
      precisionCard: [],
      precisionCardSummary: null,
      precisionSystem: PRECISION_80_SYSTEM_SUMMARY,
      universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
      boardFeed: {
        label: "Board feed",
        note: "Pregame changes captured throughout the day. Markets freeze at tipoff.",
        events: persistedBoard?.data.boardFeed?.events ?? [],
      },
    };
    snapshotBoardCache.set(cacheKey, {
      data: emptyData,
      sourceSignal,
      expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
    });
    if (isTodayEt) {
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
    }
    return emptyData;
  }

  const dailyOddsMap = await withTimeoutFallback(fetchDailyGameOddsMap(dateEt), new Map());

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const matchupOptionsByKey = new Map<string, SnapshotMatchupOption>();
  const matchupMetaByKey = new Map<string, MatchupMeta>();
  const matchupStartTimesByKey = new Map<string, number | null>();
  const startedMatchupTimesByKey = new Map<string, number>();

  for (const game of games) {
    const homeCode = game.homeTeam.abbreviation;
    const awayCode = game.awayTeam.abbreviation;
    const gameTimeEt = formatUtcToEt(game.commenceTimeUtc);
    const matchupKey = `${awayCode}@${homeCode}`;
    matchupStartTimesByKey.set(matchupKey, game.commenceTimeUtc?.getTime() ?? null);

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
      boardFeed: {
        label: "Board feed",
        note: "Pregame changes captured throughout the day. Markets freeze at tipoff.",
        events: persistedBoard?.data.boardFeed?.events ?? [],
      },
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
      getCachedPlayerPositions(),
      withTimeoutFallback(fetchSeasonVolumeLogs(dateEt), []),
      withTimeoutFallback(fetchDailyPtsLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyRebLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyAstLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyThreesLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyPraLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyPaLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyPrLineMap(dateEt, dailyMatchupHints), new Map()),
      withTimeoutFallback(fetchDailyRaLineMap(dateEt, dailyMatchupHints), new Map()),
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
    const stealsPer36Last10 =
      minutesLast10Avg == null || minutesLast10Avg <= 0 || stealsLast10Avg == null
        ? null
        : round((stealsLast10Avg / minutesLast10Avg) * 36, 2);
    const blocksPer36Last10 =
      minutesLast10Avg == null || minutesLast10Avg <= 0 || blocksLast10Avg == null
        ? null
        : round((blocksLast10Avg / minutesLast10Avg) * 36, 2);

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
      stealsPer36Last10,
      blocksPer36Last10,
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
  const precisionCardCandidates: PrecisionCardCandidateRecord[] = [];
  const builtRowKeys = new Set<string>();

  for (const player of players) {
    if (!player.teamId) {
      continue;
    }
    const matchup = matchupByTeamId.get(player.teamId);
    if (!matchup) {
      continue;
    }
    const rowKey = getSnapshotBoardRowKey({
      matchupKey: matchup.matchupKey,
      playerId: player.id,
    });
    const persistedRow = persistedRowMap.get(rowKey) ?? null;
    const startedMatchupTime = startedMatchupTimesByKey.get(matchup.matchupKey) ?? null;
    if (isTodayEt && startedMatchupTime != null) {
      if (persistedRow) {
        builtRowKeys.add(rowKey);
        rowsWithSortKeys.push({
          sortTime: startedMatchupTime,
          row: toBoardSnapshotRow(persistedRow),
        });
        continue;
      }
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
    const opponentAvailabilityContext = buildCoreAvailabilityContext({
      teamCode: matchup.opponentCode,
      teamProfiles: opponentProfiles,
      lineupMap,
      statusLogsByPlayerId,
    });
    const opponentAvailability = opponentAvailabilityContext
      ? toOpponentAvailabilityInput(opponentAvailabilityContext)
      : null;
    const missingOpponentIds = new Set(opponentAvailabilityContext?.missingProfiles.map((profile) => profile.playerId) ?? []);
    const activeOpponentProfiles = opponentProfiles.filter((profile) => !missingOpponentIds.has(profile.playerId));
    const availableOpponentProfiles = activeOpponentProfiles.length > 0 ? activeOpponentProfiles : opponentProfiles;
    const teamSummary = teamSummaryByTeamId.get(player.teamId) ?? emptyTeamSummary();
    const opponentSummary = teamSummaryByTeamId.get(matchup.opponentTeamId) ?? emptyTeamSummary();
    const rotationRankIndex = teamProfiles.findIndex((profile) => profile.playerId === player.id);
    const rotationRank = rotationRankIndex >= 0 ? rotationRankIndex + 1 : null;
    const primaryDefender = playerProfile ? choosePrimaryDefender(playerProfile, availableOpponentProfiles) : null;
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
    const opponentTop5 = availableOpponentProfiles.slice(0, 5);
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
    const minutesLast5Avg = average(last5Logs.map((log) => log.minutes));
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
        opponentAvailability,
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
    const opponentMissingCorePts =
      opponentAvailability == null
        ? null
        : round((opponentAvailability.missingCoreAverage.PTS ?? 0) * opponentAvailability.missingCoreCount, 2);
    const opponentMissingCoreAst =
      opponentAvailability == null
        ? null
        : round((opponentAvailability.missingCoreAverage.AST ?? 0) * opponentAvailability.missingCoreCount, 2);
    const opponentMissingCoreReb =
      opponentAvailability == null
        ? null
        : round((opponentAvailability.missingCoreAverage.REB ?? 0) * opponentAvailability.missingCoreCount, 2);
    const opponentMissingCoreStocks =
      opponentAvailability == null || opponentAvailability.missingCoreStocksPer36 == null
        ? null
        : round(opponentAvailability.missingCoreStocksPer36 * opponentAvailability.missingCoreCount, 2);
    const teamRotationProjectedPts = sumProjectedRotationPoints(teamProfiles);
    const missingCoreShare =
      missingCorePts == null || teamRotationProjectedPts == null || teamRotationProjectedPts <= 0
        ? null
        : round(Math.max(0, Math.min(1, missingCorePts / teamRotationProjectedPts)), 4);
    const opponentMissingCoreShare =
      opponentAvailability == null
        ? null
        : round(Math.max(0, Math.min(1, opponentAvailability.missingCoreCount / 4)), 4);
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
      opponentMissingCorePts,
      opponentMissingCoreAst,
      opponentMissingCoreReb,
      opponentMissingCoreStocks,
      opponentMissingCoreShare,
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
        opponentMissingCorePts: universalUsageContext.opponentMissingCorePts ?? null,
        opponentMissingCoreAst: universalUsageContext.opponentMissingCoreAst ?? null,
        opponentMissingCoreReb: universalUsageContext.opponentMissingCoreReb ?? null,
        opponentMissingCoreStocks: universalUsageContext.opponentMissingCoreStocks ?? null,
        opponentMissingCoreShare: universalUsageContext.opponentMissingCoreShare ?? null,
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
      playerName: player.fullName,
      matchupKey: matchup.matchupKey,
      minutesLast10Avg,
      expectedMinutes: minutesProfile.expected,
      minutesVolatility,
      benchBigRoleStability,
      starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      archetypeExpectedMinutes: minutesLast10Avg,
      archetypeStarterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
      openingTeamSpread,
      openingTotal,
      competitivePaceFactor,
      blowoutRisk,
      seasonMinutesAvg,
      minutesLiftPct: universalUsageContext.minutesLiftPct ?? null,
      activeCorePts: universalUsageContext.activeCorePts ?? null,
      activeCoreAst: universalUsageContext.activeCoreAst ?? null,
      missingCorePts: universalUsageContext.missingCorePts ?? null,
      missingCoreAst: universalUsageContext.missingCoreAst ?? null,
      missingCoreShare: universalUsageContext.missingCoreShare ?? null,
      stepUpRoleFlag: universalUsageContext.stepUpRoleFlag ?? null,
      opponentMissingCorePts: universalUsageContext.opponentMissingCorePts ?? null,
      opponentMissingCoreAst: universalUsageContext.opponentMissingCoreAst ?? null,
      opponentMissingCoreReb: universalUsageContext.opponentMissingCoreReb ?? null,
      opponentMissingCoreStocks: universalUsageContext.opponentMissingCoreStocks ?? null,
      opponentMissingCoreShare: universalUsageContext.opponentMissingCoreShare ?? null,
      completenessScore: dataCompleteness.score,
      playerPosition: player.position,
      pointsProjection: projectedTonight.PTS,
      reboundsProjection: projectedTonight.REB,
      assistProjection: projectedTonight.AST,
      threesProjection: projectedTonight.THREES,
      availabilityStatus: lineupSignal?.availabilityStatus ?? null,
      availabilityPercentPlay: lineupSignal?.availabilityPercentPlay ?? null,
    };
    const precisionSportsbookCounts: Record<SnapshotMarket, number> = {
      PTS: ptsSignal?.sportsbookCount ?? 0,
      REB: rebSignal?.sportsbookCount ?? 0,
      AST: astSignal?.sportsbookCount ?? 0,
      THREES: threesSignal?.sportsbookCount ?? 0,
      PRA: praSignal?.sportsbookCount ?? 0,
      PA: paSignal?.sportsbookCount ?? 0,
      PR: prSignal?.sportsbookCount ?? 0,
      RA: raSignal?.sportsbookCount ?? 0,
    };
    const marketSignals: Record<SnapshotMarket, SnapshotPtsSignal | null> = {
      PTS: ptsSignal,
      REB: rebSignal,
      AST: astSignal,
      THREES: threesSignal,
      PRA: praSignal,
      PA: paSignal,
      PR: prSignal,
      RA: raSignal,
    };
    const buildPrecisionCardInputForMarket = (market: SnapshotMarket) => {
      switch (market) {
        case "PTS":
          return {
            market: "PTS" as const,
            projectedValue: projectedTonight.PTS,
            line: ptsMarketLine?.line ?? null,
            overPrice: ptsMarketLine?.overPrice ?? null,
            underPrice: ptsMarketLine?.underPrice ?? null,
            finalSide: ptsSignal?.baselineSide ?? modelLines.PTS.modelSide,
            lineupTimingConfidence: ptsSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: ptsSameOpponentSignal?.deltaVsAnchor ?? null,
            sameOpponentSample: ptsSameOpponentSignal?.sample ?? null,
            sameOpponentMinutesSimilarity: ptsSameOpponentSignal?.minutesSimilarity ?? null,
            ...ptsCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "REB":
          return {
            market: "REB" as const,
            projectedValue: projectedTonight.REB,
            line: rebMarketLine?.line ?? null,
            overPrice: rebMarketLine?.overPrice ?? null,
            underPrice: rebMarketLine?.underPrice ?? null,
            finalSide: rebSignal?.baselineSide ?? modelLines.REB.modelSide,
            lineupTimingConfidence: rebSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: rebSameOpponentSignal?.deltaVsAnchor ?? null,
            sameOpponentSample: rebSameOpponentSignal?.sample ?? null,
            sameOpponentMinutesSimilarity: rebSameOpponentSignal?.minutesSimilarity ?? null,
            ...rebCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "AST":
          return {
            market: "AST" as const,
            projectedValue: projectedTonight.AST,
            line: astMarketLine?.line ?? null,
            overPrice: astMarketLine?.overPrice ?? null,
            underPrice: astMarketLine?.underPrice ?? null,
            finalSide: astSignal?.baselineSide ?? modelLines.AST.modelSide,
            lineupTimingConfidence: astSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: astSameOpponentSignal?.deltaVsAnchor ?? null,
            sameOpponentSample: astSameOpponentSignal?.sample ?? null,
            sameOpponentMinutesSimilarity: astSameOpponentSignal?.minutesSimilarity ?? null,
            ...astCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "THREES":
          return {
            market: "THREES" as const,
            projectedValue: projectedTonight.THREES,
            line: threesMarketLine?.line ?? null,
            overPrice: threesMarketLine?.overPrice ?? null,
            underPrice: threesMarketLine?.underPrice ?? null,
            finalSide: threesSignal?.baselineSide ?? modelLines.THREES.modelSide,
            lineupTimingConfidence: threesSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: threesSameOpponentSignal?.deltaVsAnchor ?? null,
            sameOpponentSample: threesSameOpponentSignal?.sample ?? null,
            sameOpponentMinutesSimilarity: threesSameOpponentSignal?.minutesSimilarity ?? null,
            ...threesCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "PRA":
          return {
            market: "PRA" as const,
            projectedValue: projectedTonight.PRA,
            line: praMarketLine?.line ?? null,
            overPrice: praMarketLine?.overPrice ?? null,
            underPrice: praMarketLine?.underPrice ?? null,
            finalSide:
              resolveBinarySide(promotedPraFinalSide) ??
              praSignal?.baselineSide ??
              modelLines.PRA.modelSide,
            lineupTimingConfidence: praSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: null,
            sameOpponentSample: null,
            sameOpponentMinutesSimilarity: null,
            ...praCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "PA":
          return {
            market: "PA" as const,
            projectedValue: projectedTonight.PA,
            line: paMarketLine?.line ?? null,
            overPrice: paMarketLine?.overPrice ?? null,
            underPrice: paMarketLine?.underPrice ?? null,
            finalSide: paSignal?.baselineSide ?? modelLines.PA.modelSide,
            lineupTimingConfidence: paSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: null,
            sameOpponentSample: null,
            sameOpponentMinutesSimilarity: null,
            ...paCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "PR":
          return {
            market: "PR" as const,
            projectedValue: projectedTonight.PR,
            line: prMarketLine?.line ?? null,
            overPrice: prMarketLine?.overPrice ?? null,
            underPrice: prMarketLine?.underPrice ?? null,
            finalSide: prSignal?.baselineSide ?? modelLines.PR.modelSide,
            lineupTimingConfidence: prSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: null,
            sameOpponentSample: null,
            sameOpponentMinutesSimilarity: null,
            ...prCurrentLineRecency,
            ...precisionCommonInput,
          };
        case "RA":
          return {
            market: "RA" as const,
            projectedValue: projectedTonight.RA,
            line: raMarketLine?.line ?? null,
            overPrice: raMarketLine?.overPrice ?? null,
            underPrice: raMarketLine?.underPrice ?? null,
            finalSide: raSignal?.baselineSide ?? modelLines.RA.modelSide,
            lineupTimingConfidence: raSignal?.lineupTimingConfidence ?? null,
            sameOpponentDeltaVsAnchor: null,
            sameOpponentSample: null,
            sameOpponentMinutesSimilarity: null,
            ...raCurrentLineRecency,
            ...precisionCommonInput,
          };
      }
    };
    const precisionSignals: Partial<Record<SnapshotMarket, SnapshotPrecisionPickSignal>> = {};
    const strictPrecisionSignals: Partial<Record<SnapshotMarket, NonNullable<ReturnType<typeof buildPrecision80Pick>>>> = {};
    const precisionDecisionMetaByMarket: Partial<Record<SnapshotMarket, SnapshotMarketDecisionMeta>> = {};
    const adaptivePrecisionSignals: Partial<
      Record<SnapshotMarket, NonNullable<ReturnType<typeof buildAdaptivePrecisionFloorPick>>>
    > = {};
    const shortfallPrecisionSignals: Partial<
      Record<SnapshotMarket, NonNullable<ReturnType<typeof buildShortfallPrecisionRescuePick>>>
    > = {};
    (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as const).forEach((market) => {
      const precisionInput = buildPrecisionCardInputForMarket(market);
      const strictSignal = buildPrecision80Pick(precisionInput);
      if (strictSignal != null) {
        strictPrecisionSignals[market] = strictSignal;
        precisionSignals[market] = strictSignal;
      }
      const adaptiveSignal = buildAdaptivePrecisionFloorPick(precisionInput);
      if (adaptiveSignal != null) {
        adaptivePrecisionSignals[market] = adaptiveSignal;
        const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";
        const adaptiveQualified = adaptiveSignal.qualified ?? adaptiveSignal.side !== "NEUTRAL";
        if (!strictQualified && adaptiveQualified) {
          precisionSignals[market] = adaptiveSignal;
        }
      }
      const shortfallSignal = buildShortfallPrecisionRescuePick(precisionInput);
      if (shortfallSignal != null) {
        shortfallPrecisionSignals[market] = shortfallSignal;
        const strictQualified = strictSignal?.qualified ?? strictSignal?.side !== "NEUTRAL";
        const adaptiveQualified = adaptiveSignal?.qualified ?? adaptiveSignal?.side !== "NEUTRAL";
        const shortfallQualified = shortfallSignal.qualified ?? shortfallSignal.side !== "NEUTRAL";
        if (!strictQualified && !adaptiveQualified && shortfallQualified) {
          precisionSignals[market] = shortfallSignal;
        }
      }
    });
    (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as const).forEach((market) => {
      if (!PRIMARY_PRECISION_CARD_MARKETS.has(market)) {
        return;
      }

      const precisionInput = buildPrecisionCardInputForMarket(market);
      const decisionMeta = buildSnapshotMarketDecisionMeta({
        market,
        playerName: player.fullName,
        signal: marketSignals[market],
        modelSide: modelLines[market].modelSide,
        universalInput: precisionInput,
        expectedMinutes: minutesProfile.expected,
        l5MinutesAvg: minutesLast5Avg,
        l5MarketDeltaAvg: null,
        trendVsSeason: trendVsSeason[market],
        opponentAllowance: opponentAllowance[market],
        opponentAllowanceDelta: opponentAllowanceDelta[market],
        opponentPositionAllowance: null,
        minutesVolatility,
        starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
        praPromotionContext:
          market === "PRA"
            ? {
                projectionSide: deriveProjectionSide(projectedTonight.PRA, praMarketLine?.line ?? null),
                favoredSide: deriveFavoredSide(praMarketLine?.overPrice ?? null, praMarketLine?.underPrice ?? null),
                openingTeamSpread,
                openingTotal,
                lineupTimingConfidence: praSignal?.lineupTimingConfidence ?? null,
                completenessScore: dataCompleteness.score,
                pointsProjection: projectedTonight.PTS,
                reboundsProjection: projectedTonight.REB,
                assistProjection: projectedTonight.AST,
                threesProjection: projectedTonight.THREES,
                lineGap:
                  projectedTonight.PRA == null || praMarketLine?.line == null
                    ? null
                    : round(projectedTonight.PRA - praMarketLine.line, 4),
                absLineGap:
                  projectedTonight.PRA == null || praMarketLine?.line == null
                    ? null
                    : Math.abs(round(projectedTonight.PRA - praMarketLine.line, 4)),
              }
            : null,
      });
      precisionDecisionMetaByMarket[market] = decisionMeta;

      const sportsbookCount = precisionSportsbookCounts[market];
      const priceLean =
        impliedProbabilityFromAmerican(precisionInput.overPrice ?? null) == null ||
        impliedProbabilityFromAmerican(precisionInput.underPrice ?? null) == null
          ? null
          : round(
              (impliedProbabilityFromAmerican(precisionInput.overPrice ?? null) ?? 0) -
                (impliedProbabilityFromAmerican(precisionInput.underPrice ?? null) ?? 0),
              4,
            );
      const upstreamCandidate = buildPrecisionUpstreamPriorityCandidate({
        dateEt,
        playerId: player.id,
        playerName: player.fullName,
        matchupKey: matchup.matchupKey,
        market,
        sportsbookCount,
        projectionSide: deriveProjectionSide(precisionInput.projectedValue ?? null, precisionInput.line ?? null),
        finalSide: decisionMeta.finalSide,
        strictRawSide: decisionMeta.strictRawSide,
        rawSource: decisionMeta.rawSource,
        strictRawSource: decisionMeta.strictRawSource,
        finalSource: decisionMeta.finalSource,
        overrideEngaged: decisionMeta.finalSource !== "baseline",
        playerOverrideEngaged: decisionMeta.playerOverrideEngaged,
        rawQualified: decisionMeta.liveDecision.side === "OVER" || decisionMeta.liveDecision.side === "UNDER",
        rejectionCount: decisionMeta.liveDecision.rejectionReasons.length,
        archetype: decisionMeta.rawDecision.archetype,
        modelKind: decisionMeta.rawDecision.modelKind,
        bucketSamples: decisionMeta.rawDecision.bucketSamples,
        bucketModelAccuracy: decisionMeta.rawDecision.bucketModelAccuracy,
        bucketLateAccuracy: decisionMeta.rawDecision.bucketLateAccuracy,
        leafCount: decisionMeta.rawDecision.leafCount,
        leafAccuracy: decisionMeta.rawDecision.leafAccuracy,
        projectionWinProbability: decisionMeta.rawDecision.projectionWinProbability,
        projectionPriceEdge: decisionMeta.rawDecision.projectionPriceEdge,
        priceStrength: decisionMeta.rawDecision.priceStrength,
        projectionMarketAgreement: decisionMeta.rawDecision.projectionMarketAgreement,
        projectedValue: precisionInput.projectedValue ?? null,
        line: precisionInput.line ?? null,
        overPrice: precisionInput.overPrice ?? null,
        underPrice: precisionInput.underPrice ?? null,
        favoredSide: deriveFavoredSide(precisionInput.overPrice ?? null, precisionInput.underPrice ?? null),
        expectedMinutes: precisionInput.expectedMinutes ?? null,
        minutesVolatility: precisionInput.minutesVolatility ?? null,
        starterRateLast10: precisionInput.starterRateLast10 ?? null,
        priceLean,
        weightedCurrentLineOverRate: precisionInput.weightedCurrentLineOverRate ?? null,
        emaCurrentLineDelta: precisionInput.emaCurrentLineDelta ?? null,
        emaCurrentLineOverRate: precisionInput.emaCurrentLineOverRate ?? null,
        l5CurrentLineOverRate: precisionInput.l5CurrentLineOverRate ?? null,
        strictSignal: strictPrecisionSignals[market] ?? null,
      });

      if (upstreamCandidate) {
        precisionCardCandidates.push({
          ...upstreamCandidate,
        });
      }
    });
    const marketRuntime = Object.fromEntries(
      MARKETS.map((market) => {
        const universalInput = buildPrecisionCardInputForMarket(market);
        const decisionMeta =
          precisionDecisionMetaByMarket[market] ??
          buildSnapshotMarketDecisionMeta({
            market,
            playerName: player.fullName,
            signal: marketSignals[market],
            modelSide: modelLines[market].modelSide,
            universalInput,
            expectedMinutes: minutesProfile.expected,
            l5MinutesAvg: minutesLast5Avg,
            l5MarketDeltaAvg: null,
            trendVsSeason: trendVsSeason[market],
            opponentAllowance: opponentAllowance[market],
            opponentAllowanceDelta: opponentAllowanceDelta[market],
            opponentPositionAllowance: null,
            minutesVolatility,
            starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
            praPromotionContext:
              market === "PRA"
                ? {
                    projectionSide: deriveProjectionSide(projectedTonight.PRA, praMarketLine?.line ?? null),
                    favoredSide: deriveFavoredSide(praMarketLine?.overPrice ?? null, praMarketLine?.underPrice ?? null),
                    openingTeamSpread,
                    openingTotal,
                    lineupTimingConfidence: praSignal?.lineupTimingConfidence ?? null,
                    completenessScore: dataCompleteness.score,
                    pointsProjection: projectedTonight.PTS,
                    reboundsProjection: projectedTonight.REB,
                    assistProjection: projectedTonight.AST,
                    threesProjection: projectedTonight.THREES,
                    lineGap:
                      projectedTonight.PRA == null || praMarketLine?.line == null
                        ? null
                        : round(projectedTonight.PRA - praMarketLine.line, 4),
                    absLineGap:
                      projectedTonight.PRA == null || praMarketLine?.line == null
                        ? null
                        : Math.abs(round(projectedTonight.PRA - praMarketLine.line, 4)),
                  }
                : null,
          });
        return [
          market,
          buildSnapshotMarketRuntime({
            market,
            playerName: player.fullName,
            signal: marketSignals[market],
            modelSide: modelLines[market].modelSide,
            universalInput,
            expectedMinutes: minutesProfile.expected,
            l5MinutesAvg: minutesLast5Avg,
            l5MarketDeltaAvg: null,
            trendVsSeason: trendVsSeason[market],
            opponentAllowance: opponentAllowance[market],
            opponentAllowanceDelta: opponentAllowanceDelta[market],
            opponentPositionAllowance: null,
            minutesVolatility,
            starterRateLast10: playerProfile?.starterRateLast10 ?? computedStarterRateLast10,
            praPromotionContext:
              market === "PRA"
                ? {
                    projectionSide: deriveProjectionSide(projectedTonight.PRA, praMarketLine?.line ?? null),
                    favoredSide: deriveFavoredSide(praMarketLine?.overPrice ?? null, praMarketLine?.underPrice ?? null),
                    openingTeamSpread,
                    openingTotal,
                    lineupTimingConfidence: praSignal?.lineupTimingConfidence ?? null,
                    completenessScore: dataCompleteness.score,
                    pointsProjection: projectedTonight.PTS,
                    reboundsProjection: projectedTonight.REB,
                    assistProjection: projectedTonight.AST,
                    threesProjection: projectedTonight.THREES,
                    lineGap:
                      projectedTonight.PRA == null || praMarketLine?.line == null
                        ? null
                        : round(projectedTonight.PRA - praMarketLine.line, 4),
                    absLineGap:
                    projectedTonight.PRA == null || praMarketLine?.line == null
                      ? null
                      : Math.abs(round(projectedTonight.PRA - praMarketLine.line, 4)),
                  }
                : null,
            decisionMeta,
          }),
        ] as const;
      }),
    ) as Partial<Record<SnapshotMarket, SnapshotMarketRuntime>>;

    const gameIntel = buildGameIntel({
      dateEt,
      teamCode: matchup.teamCode,
      opponentCode: matchup.opponentCode,
      isHome: matchup.isHome,
      openingTeamSpread,
      openingTotal,
      playerProfile,
      teamProfiles,
      opponentProfiles: availableOpponentProfiles,
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
      marketRuntime,
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
    builtRowKeys.add(rowKey);
    rowsWithSortKeys.push({
      sortTime: matchup.gameTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER,
      row: computedRow,
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
  const activeRowsWithSortKeys = isTodayEt
    ? rowsWithSortKeys.filter((item) => !isConfirmedOutSnapshotRow(item.row, lineupMap))
    : rowsWithSortKeys;
  const rowDerivedPrecisionCandidates = buildControlledPrecisionRecoveryCandidatesFromRows(
    activeRowsWithSortKeys.map((item) => item.row),
  );
  const rerankedPrecisionCardCandidates = rerankPrecisionUpstreamCandidates(
    precisionCardCandidates,
    dateEt,
  );
  const computedPrecisionCard = selectPrecisionCardWithTopOff(
    rerankedPrecisionCardCandidates,
    rowDerivedPrecisionCandidates,
  );
  const boardRows = activeRowsWithSortKeys.map((item) => item.row);
  const stabilizedPrecisionCard =
    isTodayEt
      ? stabilizePrecisionCardForToday(
          persistedBoard,
          boardRows,
          computedPrecisionCard,
          PRECISION_80_SYSTEM_SUMMARY.targetCardCount ?? 6,
          {
            matchupStartMsByKey: matchupStartTimesByKey,
            nowMs,
          },
        )
      : computedPrecisionCard;
  const finalPrecisionCard = recoverStartedSlatePrecisionCard(
    dateEt,
    enforcePrecisionCardTargetCount(
      stabilizedPrecisionCard,
      boardRows,
      PRECISION_80_SYSTEM_SUMMARY.targetCardCount ?? 6,
    ),
    startedMatchupTimesByKey.size,
  );
  const targetPrecisionCardCount = PRECISION_80_SYSTEM_SUMMARY.targetCardCount ?? 6;
  const firstGameStartMs = getFirstGameStartMs(matchupStartTimesByKey);
  let displayedPrecisionCard = finalPrecisionCard;
  let precisionCardSummary = summarizePrecisionPregameCard(finalPrecisionCard, targetPrecisionCardCount);
  const precisionPregameLock =
    (await loadPrecisionPregameLock(dateEt)) ??
    (isTodayEt
      ? await maybeCreatePrecisionPregameLock({
          dateEt,
          isTodayEt,
          nowMs,
          firstGameStartMs,
          sourceUpdatedAt: sourceUpdatedAtIso,
          targetCardCount: targetPrecisionCardCount,
          data: {
            rows: boardRows,
            precisionCard: finalPrecisionCard,
            precisionCardSummary,
          },
        })
      : null);
  if (precisionPregameLock) {
    displayedPrecisionCard = precisionPregameLock.precisionCard;
    precisionCardSummary = precisionPregameLock.precisionCardSummary;
  }
  const currentData: SnapshotBoardData = {
    dateEt,
    lastUpdatedAt: sourceUpdatedAtIso,
    matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
    teamMatchups,
    rows: boardRows,
    precisionCard: displayedPrecisionCard,
    precisionCardSummary,
    precisionSystem: PRECISION_80_SYSTEM_SUMMARY,
    universalSystem: UNIVERSAL_SYSTEM_SUMMARY,
  };
  const boardFeed = buildSnapshotBoardFeed({
    dateEt,
    current: currentData,
    previous: persistedBoard?.data ?? null,
    matchupStartMsByKey: matchupStartTimesByKey,
    nowMs,
    isTodayEt,
    eventTime: sourceUpdatedAtIso ?? new Date(nowMs).toISOString(),
  });

  const result = toBoardSnapshotData(
    {
      ...currentData,
      boardFeed,
    },
    lineupMap,
  );
  snapshotBoardCache.set(cacheKey, {
    data: result,
    sourceSignal,
    expiresAt: Date.now() + SNAPSHOT_BOARD_CACHE_TTL_MS,
  });
  if (isTodayEt) {
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
  }
  return result;
}

