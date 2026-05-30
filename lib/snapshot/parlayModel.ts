import type {
  SnapshotBoardData,
  SnapshotFinalModelBoardRow,
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionPickSignal,
  SnapshotPtsSignal,
  SnapshotRow,
} from "@/lib/types/snapshot";
import { clamp, round } from "@/lib/utils";

export const SNAPSHOT_PARLAY_MODEL_VERSION = "snapshot-parlay-final-v1-v2";

type Side = Extract<SnapshotModelSide, "OVER" | "UNDER">;
type Status = "READY" | "UNDERFILLED" | "NO_SLATE";

export type SnapshotParlayModelConfig = {
  targetLegs: number;
  minLegs: number;
  maxLegs: number;
  minSportsbookCount: number;
  minLegProbability: number;
  extraLegMinProbability: number;
  maxPerPlayer: number;
  maxPerGame: number;
  maxPerTeam: number;
  maxPerMarket: number;
  maxSameTeamCountingOvers: number;
  minPrimaryLegProbability: number;
  minPrimarySelectionScore: number;
  defaultAmericanOdds: number;
  seedPromotedCard: boolean;
};

export type SnapshotParlayLeg = {
  rank: number;
  playerId: string;
  playerName: string;
  teamCode: string;
  opponentCode: string;
  matchupKey: string;
  gameTimeEt: string;
  market: SnapshotMarket;
  side: Side;
  line: number;
  projectedValue: number | null;
  projectionGap: number | null;
  confidence: number | null;
  sportsbookCount: number;
  legProbability: number;
  selectionScore: number;
  modelScore: number;
  selectorFamily: string | null;
  selectorTier: string | null;
  promotedRank: number | null;
  reasons: string[];
  riskFlags: string[];
};

export type SnapshotParlaySummary = {
  status: Status;
  legCount: number;
  targetLegs: number;
  minLegs: number;
  maxLegs: number;
  candidateCount: number;
  independentHitProbability: number;
  correlationMultiplier: number;
  adjustedHitProbability: number;
  assumedDecimalOdds: number;
  assumedAmericanOdds: number;
  expectedValuePerUnit: number;
  averageLegProbability: number | null;
  averageSelectionScore: number | null;
  averageSportsbookCount: number | null;
  marketMix: Partial<Record<SnapshotMarket, number>>;
  gameMix: Record<string, number>;
  teamMix: Record<string, number>;
};

export type SnapshotParlayCard = {
  version: typeof SNAPSHOT_PARLAY_MODEL_VERSION;
  generatedAt: string;
  dateEt: string;
  status: Status;
  label: string;
  note: string;
  warnings: string[];
  config: SnapshotParlayModelConfig;
  summary: SnapshotParlaySummary;
  legs: SnapshotParlayLeg[];
  nextBest: SnapshotParlayLeg[];
};

export type SnapshotParlayHistorySummary = {
  range: {
    from: string | null;
    to: string | null;
    days: number;
  };
  minLegs: number;
  daysWithMinLegs: number;
  allLegHitDays: number;
  allLegHitRatePct: number | null;
  fivePlusHitDays: number;
  fivePlusHitRatePct: number | null;
  averageWinsPerCard: number | null;
  worstWins: number | null;
  bestWins: number | null;
  legAccuracyPct: number | null;
  winDistribution: Record<string, number>;
  byMarket: Partial<Record<SnapshotMarket, { picks: number; wins: number; accuracyPct: number | null }>>;
};

type LockedDailyResult = {
  date: string;
  picks: number;
  wins: number;
  losses: number;
  pushes?: number;
  pending?: number;
};

type LockedPickResult = {
  market?: string;
  outcome?: string;
};

type LockedParlayHistoryInput = {
  summary?: {
    range?: {
      from?: string | null;
      to?: string | null;
    };
    overall?: {
      picks?: number;
      correct?: number;
      accuracy?: number;
    };
  };
  daily?: LockedDailyResult[];
  picks?: LockedPickResult[];
};

type Candidate = Omit<SnapshotParlayLeg, "rank"> & {
  rank: number;
};

const PARLAY_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const COUNTING_OVER_MARKETS = new Set<SnapshotMarket>(["PTS", "AST", "PRA", "PA", "PR", "RA"]);
const FINAL_MODEL_PARLAY_ACTIONS = new Set(["SELECTED", "CANDIDATE"]);

export const DEFAULT_SNAPSHOT_PARLAY_CONFIG: SnapshotParlayModelConfig = {
  targetLegs: 6,
  minLegs: 6,
  maxLegs: 6,
  minSportsbookCount: 3,
  minLegProbability: 0.62,
  extraLegMinProbability: 0.7,
  maxPerPlayer: 1,
  maxPerGame: 2,
  maxPerTeam: 2,
  maxPerMarket: 2,
  maxSameTeamCountingOvers: 1,
  minPrimaryLegProbability: 0.68,
  minPrimarySelectionScore: 0.62,
  defaultAmericanOdds: -110,
  seedPromotedCard: true,
};

export function resolveSnapshotParlayConfig(
  input?: Partial<SnapshotParlayModelConfig>,
): SnapshotParlayModelConfig {
  const targetLegs = boundedInteger(input?.targetLegs, DEFAULT_SNAPSHOT_PARLAY_CONFIG.targetLegs, 2, 12);
  const minLegs = boundedInteger(input?.minLegs, Math.min(targetLegs, DEFAULT_SNAPSHOT_PARLAY_CONFIG.minLegs), 2, 12);
  const maxLegs = boundedInteger(input?.maxLegs, Math.max(targetLegs, DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxLegs), minLegs, 12);
  return {
    ...DEFAULT_SNAPSHOT_PARLAY_CONFIG,
    ...(input ?? {}),
    targetLegs,
    minLegs,
    maxLegs,
    minSportsbookCount: boundedInteger(
      input?.minSportsbookCount,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.minSportsbookCount,
      1,
      12,
    ),
    minLegProbability: clampNumber(
      input?.minLegProbability,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.minLegProbability,
      0.5,
      0.9,
    ),
    extraLegMinProbability: clampNumber(
      input?.extraLegMinProbability,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.extraLegMinProbability,
      0.5,
      0.95,
    ),
    maxPerPlayer: boundedInteger(input?.maxPerPlayer, DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxPerPlayer, 1, 3),
    maxPerGame: boundedInteger(input?.maxPerGame, DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxPerGame, 1, 8),
    maxPerTeam: boundedInteger(input?.maxPerTeam, DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxPerTeam, 1, 6),
    maxPerMarket: boundedInteger(input?.maxPerMarket, DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxPerMarket, 1, 6),
    maxSameTeamCountingOvers: boundedInteger(
      input?.maxSameTeamCountingOvers,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.maxSameTeamCountingOvers,
      0,
      4,
    ),
    minPrimaryLegProbability: clampNumber(
      input?.minPrimaryLegProbability,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.minPrimaryLegProbability,
      0.5,
      0.9,
    ),
    minPrimarySelectionScore: clampNumber(
      input?.minPrimarySelectionScore,
      DEFAULT_SNAPSHOT_PARLAY_CONFIG.minPrimarySelectionScore,
      0,
      1,
    ),
    defaultAmericanOdds:
      input?.defaultAmericanOdds != null && Number.isFinite(input.defaultAmericanOdds)
        ? Math.trunc(input.defaultAmericanOdds)
        : DEFAULT_SNAPSHOT_PARLAY_CONFIG.defaultAmericanOdds,
    seedPromotedCard: input?.seedPromotedCard ?? DEFAULT_SNAPSHOT_PARLAY_CONFIG.seedPromotedCard,
  };
}

function boundedInteger(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function isSide(value: SnapshotModelSide | null | undefined): value is Side {
  return value === "OVER" || value === "UNDER";
}

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

function precisionCardKey(entry: Pick<SnapshotPrecisionCardEntry, "playerId" | "market">): string {
  return `${entry.playerId}|${entry.market}`;
}

function probabilityFromPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return clamp(value / 100, 0.3, 0.97);
}

function estimateLegProbability(signal: SnapshotPrecisionPickSignal): number {
  const pieces: Array<{ value: number; weight: number }> = [];
  if (signal.projectionWinProbability != null && Number.isFinite(signal.projectionWinProbability) && signal.projectionWinProbability > 0) {
    pieces.push({ value: clamp(signal.projectionWinProbability, 0.45, 0.95), weight: 0.42 });
  }
  const historical = probabilityFromPercent(signal.historicalAccuracy);
  if (historical != null) pieces.push({ value: historical, weight: 0.26 });
  const bucket = probabilityFromPercent(signal.bucketRecentAccuracy);
  if (bucket != null) pieces.push({ value: bucket, weight: 0.16 });
  const leaf = probabilityFromPercent(signal.leafAccuracy);
  if (leaf != null) pieces.push({ value: leaf, weight: 0.1 });

  const selectionScore = signal.selectionScore == null ? null : clamp(signal.selectionScore, 0, 1);
  if (selectionScore != null) pieces.push({ value: selectionScore, weight: 0.06 });

  if (pieces.length === 0) return 0.5;

  const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
  const weighted = pieces.reduce((sum, piece) => sum + piece.value * piece.weight, 0) / totalWeight;
  const samplePenalty = signal.historicalPicks < 30 ? 0.018 : signal.historicalPicks < 80 ? 0.008 : 0;
  const familyPenalty =
    signal.selectorFamily === "qualified_fill" || signal.selectorFamily === "model_fill"
      ? 0.025
      : signal.selectorFamily === "precision_recovery"
        ? 0.015
        : 0;

  return round(clamp(weighted - samplePenalty - familyPenalty, 0.5, 0.93), 4);
}

function estimateFinalModelLegProbability(row: SnapshotFinalModelBoardRow): number {
  const pieces: Array<{ value: number; weight: number }> = [];
  const prior = probabilityFromPercent(row.estimatedAccuracyPriorPct);
  if (prior != null) pieces.push({ value: prior, weight: 0.38 });
  if (row.metaProbCorrect != null && Number.isFinite(row.metaProbCorrect)) {
    pieces.push({
      value: clamp(row.metaProbCorrect > 1 ? row.metaProbCorrect / 100 : row.metaProbCorrect, 0.45, 0.95),
      weight: 0.18,
    });
  }
  if (row.wfConfidence != null && Number.isFinite(row.wfConfidence)) {
    pieces.push({ value: clamp(row.wfConfidence, 0.45, 0.95), weight: 0.16 });
  }
  if (row.finalScore != null && Number.isFinite(row.finalScore)) {
    pieces.push({ value: clamp(row.finalScore, 0.45, 0.95), weight: 0.22 });
  }
  const tierPrior = row.tier === "S" ? 0.9 : row.tier === "A" ? 0.86 : row.tier === "B" ? 0.82 : row.tier === "C" ? 0.76 : 0.62;
  pieces.push({ value: tierPrior, weight: 0.06 });

  const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
  const weighted = pieces.reduce((sum, piece) => sum + piece.value * piece.weight, 0) / totalWeight;
  const riskFlags = new Set([...row.riskFlags, ...row.contextFlags]);
  const riskPenalty =
    (riskFlags.has("low_projected_minutes") ? 0.018 : 0) +
    (riskFlags.has("volatile_minutes") ? 0.018 : 0) +
    (riskFlags.has("blowout_spread_risk") ? 0.012 : 0) +
    (riskFlags.has("minutes_lift_against_side") ? 0.014 : 0) +
    (row.modelAction === "CANDIDATE" ? 0.012 : 0);

  return round(clamp(weighted - riskPenalty, 0.5, 0.93), 4);
}

function availabilityRiskFlags(row: SnapshotRow): string[] {
  const flags: string[] = [];
  const status = row.playerContext.availabilityStatus;
  const percentPlay = row.playerContext.availabilityPercentPlay;

  if (status === "QUESTIONABLE") flags.push("questionable_availability");
  if (status === "PROBABLE") flags.push("probable_availability");
  if (percentPlay != null && percentPlay < 75) flags.push("availability_below_75");
  return flags;
}

function isAvailabilityPlayable(row: SnapshotRow): boolean {
  const status = row.playerContext.availabilityStatus;
  const percentPlay = row.playerContext.availabilityPercentPlay;
  if (status === "OUT" || percentPlay === 0) return false;
  if (status === "DOUBTFUL") return false;
  if (percentPlay != null && percentPlay < 50) return false;
  return true;
}

function buildCandidate(input: {
  row: SnapshotRow;
  market: SnapshotMarket;
  signal: SnapshotPrecisionPickSignal;
  liveSignal: SnapshotPtsSignal;
  promotedEntry: SnapshotPrecisionCardEntry | null;
  config: SnapshotParlayModelConfig;
}): Candidate | null {
  const side = input.signal.side;
  if (!isSide(side)) return null;
  if (!isAvailabilityPlayable(input.row)) return null;

  const line = input.promotedEntry?.lockedLine ?? input.liveSignal.marketLine;
  if (line == null || !Number.isFinite(line)) return null;

  const projectedMinutes = input.row.playerContext.projectedMinutes ?? input.row.playerContext.minutesLast10Avg ?? null;
  if (projectedMinutes != null && projectedMinutes < 15 && !input.promotedEntry) return null;

  const sportsbookCount = input.liveSignal.sportsbookCount ?? 0;
  if (sportsbookCount < input.config.minSportsbookCount) return null;

  const legProbability = estimateLegProbability(input.signal);
  if (!input.promotedEntry && legProbability < input.config.minLegProbability) return null;

  const absGap = input.signal.absLineGap ?? Math.abs(input.liveSignal.projectionGap ?? 0);
  const riskFlags = [
    ...availabilityRiskFlags(input.row),
    ...(projectedMinutes != null && projectedMinutes < 22 ? ["low_projected_minutes"] : []),
    ...(input.row.playerContext.minutesVolatility != null && input.row.playerContext.minutesVolatility > 7
      ? ["high_minutes_volatility"]
      : []),
    ...(input.signal.selectorFamily === "qualified_fill" || input.signal.selectorFamily === "model_fill"
      ? ["fill_leg"]
      : []),
    ...(sportsbookCount === input.config.minSportsbookCount ? ["minimum_book_depth"] : []),
  ];

  const promotedBonus =
    input.config.seedPromotedCard && input.promotedEntry
      ? 0.075 + Math.max(0, 7 - input.promotedEntry.rank) * 0.01
      : 0;
  const minutePenalty =
    projectedMinutes == null
      ? 0.012
      : projectedMinutes < 22
        ? 0.025
        : projectedMinutes < 26
          ? 0.01
          : 0;
  const volatilityPenalty =
    input.row.playerContext.minutesVolatility == null
      ? 0
      : input.row.playerContext.minutesVolatility > 7
        ? 0.02
        : input.row.playerContext.minutesVolatility > 5.5
          ? 0.008
          : 0;
  const selectionScore = input.signal.selectionScore ?? legProbability;
  const modelScore = round(
    legProbability +
      selectionScore * 0.18 +
      Math.min(sportsbookCount, 8) * 0.006 +
      Math.min(absGap ?? 0, 6) * 0.008 +
      promotedBonus -
      minutePenalty -
      volatilityPenalty,
    6,
  );

  return {
    rank: 0,
    playerId: input.row.playerId,
    playerName: input.row.playerName,
    teamCode: input.row.teamCode,
    opponentCode: input.row.opponentCode,
    matchupKey: input.row.matchupKey,
    gameTimeEt: input.row.gameTimeEt,
    market: input.market,
    side,
    line,
    projectedValue: input.row.projectedTonight[input.market],
    projectionGap: input.liveSignal.projectionGap,
    confidence: input.liveSignal.confidence,
    sportsbookCount,
    legProbability,
    selectionScore: round(selectionScore, 6),
    modelScore,
    selectorFamily: input.signal.selectorFamily ?? null,
    selectorTier: input.signal.selectorTier ?? null,
    promotedRank: input.promotedEntry?.rank ?? null,
    reasons: input.signal.reasons ?? [],
    riskFlags,
  };
}

function buildFinalModelCandidate(input: {
  modelRow: SnapshotFinalModelBoardRow;
  row: SnapshotRow | null;
  liveSignal: SnapshotPtsSignal | null;
  config: SnapshotParlayModelConfig;
}): Candidate | null {
  const modelRow = input.modelRow;
  const side = modelRow.side;
  if (!isSide(side)) return null;
  if (!FINAL_MODEL_PARLAY_ACTIONS.has(modelRow.modelAction)) return null;

  const line = modelRow.line ?? input.liveSignal?.marketLine ?? null;
  if (line == null || !Number.isFinite(line)) return null;

  if (input.row && !isAvailabilityPlayable(input.row)) return null;

  const projectedMinutes =
    modelRow.projectedMinutes ??
    input.row?.playerContext.projectedMinutes ??
    input.row?.playerContext.minutesLast10Avg ??
    null;
  if (projectedMinutes != null && projectedMinutes < 18) return null;

  const sportsbookCount = modelRow.sportsbookCount ?? input.liveSignal?.sportsbookCount ?? 0;
  if (sportsbookCount < input.config.minSportsbookCount) return null;

  const legProbability = estimateFinalModelLegProbability(modelRow);
  if (legProbability < input.config.minLegProbability) return null;

  const absGap = modelRow.absLineGap ?? Math.abs(input.liveSignal?.projectionGap ?? 0);
  const baseRiskFlags = new Set([
    ...modelRow.riskFlags,
    ...modelRow.contextFlags,
    ...(input.row ? availabilityRiskFlags(input.row) : []),
  ]);
  if (projectedMinutes != null && projectedMinutes < 22) baseRiskFlags.add("low_projected_minutes");
  if ((modelRow.minutesVolatility ?? input.row?.playerContext.minutesVolatility ?? 0) > 7) {
    baseRiskFlags.add("high_minutes_volatility");
  }
  if (sportsbookCount === input.config.minSportsbookCount) baseRiskFlags.add("minimum_book_depth");
  baseRiskFlags.add(modelRow.modelAction === "SELECTED" ? "final_v1_selected" : "final_v1_candidate");

  const selectionScore = clamp(modelRow.finalScore ?? legProbability, 0, 1);
  const tierBonus = modelRow.tier === "S" ? 0.028 : modelRow.tier === "A" ? 0.018 : modelRow.tier === "B" ? 0.008 : 0;
  const actionBonus = modelRow.modelAction === "SELECTED" ? 0.055 : 0;
  const riskPenalty =
    (baseRiskFlags.has("low_projected_minutes") ? 0.018 : 0) +
    (baseRiskFlags.has("high_minutes_volatility") || baseRiskFlags.has("volatile_minutes") ? 0.014 : 0) +
    (baseRiskFlags.has("blowout_spread_risk") ? 0.01 : 0);
  const modelScore = round(
    legProbability +
      selectionScore * 0.24 +
      Math.min(sportsbookCount, 8) * 0.004 +
      Math.min(absGap ?? 0, 6) * 0.006 +
      tierBonus +
      actionBonus -
      riskPenalty,
    6,
  );

  return {
    rank: 0,
    playerId: modelRow.playerId ?? input.row?.playerId ?? modelRow.playerName,
    playerName: modelRow.playerName,
    teamCode: modelRow.team ?? input.row?.teamCode ?? "",
    opponentCode: modelRow.opponent ?? input.row?.opponentCode ?? "",
    matchupKey: modelRow.matchupKey ?? input.row?.matchupKey ?? `${modelRow.team ?? ""}@${modelRow.opponent ?? ""}`,
    gameTimeEt: modelRow.gameTimeEt ?? input.row?.gameTimeEt ?? "",
    market: modelRow.market,
    side,
    line,
    projectedValue: modelRow.projectedValue ?? input.row?.projectedTonight[modelRow.market] ?? null,
    projectionGap: modelRow.lineGap ?? input.liveSignal?.projectionGap ?? null,
    confidence: modelRow.estimatedAccuracyPriorPct ?? input.liveSignal?.confidence ?? null,
    sportsbookCount,
    legProbability,
    selectionScore: round(selectionScore, 6),
    modelScore,
    selectorFamily: "final_player_prop_model_v1",
    selectorTier: modelRow.tier,
    promotedRank: modelRow.modelAction === "SELECTED" ? modelRow.selectedRank : null,
    reasons: [
      ...modelRow.reasons,
      ...modelRow.sourceComponents.map((component) => component.label),
    ].filter(Boolean).slice(0, 6),
    riskFlags: [...baseRiskFlags],
  };
}

function extractFinalModelCandidates(data: SnapshotBoardData, config: SnapshotParlayModelConfig): Candidate[] {
  const finalModel = data.finalModel;
  if (!finalModel || finalModel.artifactStatus !== "LOADED") return [];

  const rowByPlayerId = new Map(data.rows.map((row) => [row.playerId, row] as const));
  const rowByName = new Map(data.rows.map((row) => [row.playerName.toLowerCase(), row] as const));
  const finalRows = [
    ...(finalModel.selectedRows ?? []),
    ...(finalModel.candidateRows ?? []),
  ];
  const bestByPlayerMarket = new Map<string, Candidate>();

  for (const modelRow of finalRows) {
    const sourceRow =
      (modelRow.playerId ? rowByPlayerId.get(modelRow.playerId) : null) ??
      rowByName.get(modelRow.playerName.toLowerCase()) ??
      null;
    const liveSignal = sourceRow ? getRowMarketSignal(sourceRow, modelRow.market) : null;
    const candidate = buildFinalModelCandidate({ modelRow, row: sourceRow, liveSignal, config });
    if (!candidate) continue;
    const key = precisionCardKey(candidate);
    const existing = bestByPlayerMarket.get(key);
    if (!existing || candidate.modelScore > existing.modelScore) {
      bestByPlayerMarket.set(key, candidate);
    }
  }

  return [...bestByPlayerMarket.values()].sort(compareCandidates);
}

function extractPrecisionCandidates(data: SnapshotBoardData, config: SnapshotParlayModelConfig): Candidate[] {
  const promotedEntryByKey = new Map(
    (data.precisionCard ?? []).map((entry) => [precisionCardKey(entry), entry] as const),
  );
  const bestByPlayerMarket = new Map<string, Candidate>();

  for (const row of data.rows) {
    for (const market of PARLAY_MARKETS) {
      const signal = row.precisionSignals?.[market] ?? null;
      if (!signal || !isSide(signal.side)) continue;
      const liveSignal = getRowMarketSignal(row, market);
      if (!liveSignal) continue;
      const key = precisionCardKey({ playerId: row.playerId, market });
      const promotedEntry = promotedEntryByKey.get(key) ?? null;
      const candidate = buildCandidate({ row, market, signal, liveSignal, promotedEntry, config });
      if (!candidate) continue;
      const existing = bestByPlayerMarket.get(key);
      if (!existing || candidate.modelScore > existing.modelScore) {
        bestByPlayerMarket.set(key, candidate);
      }
    }
  }

  return [...bestByPlayerMarket.values()].sort(compareCandidates);
}

function extractCandidates(data: SnapshotBoardData, config: SnapshotParlayModelConfig): Candidate[] {
  const finalModelCandidates = extractFinalModelCandidates(data, config);
  if (finalModelCandidates.length > 0) return finalModelCandidates;
  return extractPrecisionCandidates(data, config);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const leftPromoted = left.promotedRank ?? Number.POSITIVE_INFINITY;
  const rightPromoted = right.promotedRank ?? Number.POSITIVE_INFINITY;
  return (
    Number(Number.isFinite(rightPromoted)) - Number(Number.isFinite(leftPromoted)) ||
    leftPromoted - rightPromoted ||
    right.modelScore - left.modelScore ||
    right.legProbability - left.legProbability ||
    right.selectionScore - left.selectionScore ||
    left.playerName.localeCompare(right.playerName) ||
    left.market.localeCompare(right.market)
  );
}

function countBy<T extends string>(legs: SnapshotParlayLeg[], key: (leg: SnapshotParlayLeg) => T): Record<T, number> {
  return legs.reduce(
    (acc, leg) => {
      const nextKey = key(leg);
      acc[nextKey] = (acc[nextKey] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

function countMarket(legs: SnapshotParlayLeg[]): Partial<Record<SnapshotMarket, number>> {
  return legs.reduce<Partial<Record<SnapshotMarket, number>>>((acc, leg) => {
    acc[leg.market] = (acc[leg.market] ?? 0) + 1;
    return acc;
  }, {});
}

function canAddCandidate(
  candidate: Candidate,
  selected: SnapshotParlayLeg[],
  config: SnapshotParlayModelConfig,
  relaxed: boolean,
  forcePortfolioFill = false,
): boolean {
  if (selected.filter((leg) => leg.playerId === candidate.playerId).length >= config.maxPerPlayer) return false;
  if (forcePortfolioFill) return true;

  const perGameLimit = relaxed ? config.maxPerGame + 1 : config.maxPerGame;
  const perTeamLimit = relaxed ? config.maxPerTeam + 1 : config.maxPerTeam;
  const perMarketLimit = relaxed ? config.maxPerMarket + 1 : config.maxPerMarket;
  const sameTeamOverLimit = relaxed ? config.maxSameTeamCountingOvers + 1 : config.maxSameTeamCountingOvers;

  if (selected.filter((leg) => leg.matchupKey === candidate.matchupKey).length >= perGameLimit) return false;
  if (selected.filter((leg) => leg.teamCode === candidate.teamCode).length >= perTeamLimit) return false;
  if (selected.filter((leg) => leg.market === candidate.market).length >= perMarketLimit) return false;
  if (
    candidate.side === "OVER" &&
    COUNTING_OVER_MARKETS.has(candidate.market) &&
    selected.filter(
      (leg) => leg.teamCode === candidate.teamCode && leg.side === "OVER" && COUNTING_OVER_MARKETS.has(leg.market),
    ).length >= sameTeamOverLimit
  ) {
    return false;
  }

  return true;
}

function isFragileCandidate(candidate: Candidate, config: SnapshotParlayModelConfig): boolean {
  const hasLowMinutes = candidate.riskFlags.includes("low_projected_minutes");
  const hasHighVolatility =
    candidate.riskFlags.includes("high_minutes_volatility") || candidate.riskFlags.includes("volatile_minutes");
  const hasMinimumBookDepth = candidate.riskFlags.includes("minimum_book_depth");
  const thinRole = hasLowMinutes && hasHighVolatility;
  const thinMarket = hasMinimumBookDepth && (hasLowMinutes || hasHighVolatility);
  const weakScore =
    candidate.legProbability < config.minPrimaryLegProbability ||
    candidate.selectionScore < config.minPrimarySelectionScore;
  return (thinRole || thinMarket) && weakScore;
}

function selectLegs(candidates: Candidate[], config: SnapshotParlayModelConfig): SnapshotParlayLeg[] {
  const selected: SnapshotParlayLeg[] = [];
  const selectedKeys = new Set<string>();

  const tryAdd = (
    candidate: Candidate,
    relaxed: boolean,
    forcePortfolioFill = false,
    allowFragile = false,
  ): void => {
    if (selected.length >= config.maxLegs) return;
    const key = precisionCardKey(candidate);
    if (selectedKeys.has(key)) return;
    if (selected.length >= config.targetLegs && candidate.legProbability < config.extraLegMinProbability) return;
    const fragile = isFragileCandidate(candidate, config);
    if (fragile && !allowFragile) return;
    if (!canAddCandidate(candidate, selected, config, relaxed, forcePortfolioFill)) return;

    const riskFlags = [...candidate.riskFlags];
    if (fragile) riskFlags.push("fragile_role_depth");
    if (relaxed) riskFlags.push("relaxed_portfolio_cap");
    if (forcePortfolioFill) riskFlags.push("forced_daily_six_fill");

    selected.push({
      ...candidate,
      rank: selected.length + 1,
      riskFlags,
    });
    selectedKeys.add(key);
  };

  for (const candidate of candidates) {
    tryAdd(candidate, false);
  }

  return selected.map((leg, index) => ({ ...leg, rank: index + 1 }));
}

function correlationMultiplier(legs: SnapshotParlayLeg[]): number {
  let multiplier = 1;

  for (let leftIndex = 0; leftIndex < legs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < legs.length; rightIndex += 1) {
      const left = legs[leftIndex];
      const right = legs[rightIndex];
      if (left.matchupKey === right.matchupKey) multiplier *= 0.975;
      if (left.teamCode === right.teamCode) multiplier *= 0.94;
      if (
        left.teamCode === right.teamCode &&
        left.side === "OVER" &&
        right.side === "OVER" &&
        COUNTING_OVER_MARKETS.has(left.market) &&
        COUNTING_OVER_MARKETS.has(right.market)
      ) {
        multiplier *= 0.86;
      }
      if (left.market === right.market) multiplier *= 0.99;
    }
  }

  return round(clamp(multiplier, 0.2, 1), 4);
}

function americanToDecimal(americanOdds: number): number {
  if (americanOdds < 0) return 1 + 100 / Math.abs(americanOdds);
  return 1 + americanOdds / 100;
}

function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds <= 1) return 0;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return Math.round(-100 / (decimalOdds - 1));
}

function product(values: number[]): number {
  return values.reduce((acc, value) => acc * value, 1);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildWarnings(status: Status, legs: SnapshotParlayLeg[], config: SnapshotParlayModelConfig): string[] {
  const warnings: string[] = [];
  if (status === "NO_SLATE") {
    warnings.push("No NBA slate rows were available for this date.");
  }
  if (status === "UNDERFILLED") {
    warnings.push(
      `Only ${legs.length} unique playable legs cleared the Final V1 parlay gate, below the ${config.minLegs}-leg minimum.`,
    );
  }
  const forcedFillLegs = legs.filter((leg) => leg.riskFlags.includes("forced_daily_six_fill"));
  if (forcedFillLegs.length > 0) {
    warnings.push(
      `${forcedFillLegs.length} leg${forcedFillLegs.length === 1 ? " was" : "s were"} force-filled to satisfy the daily six-leg mandate.`,
    );
  }
  const fragileLegs = legs.filter((leg) => leg.riskFlags.includes("fragile_role_depth"));
  if (fragileLegs.length > 0) {
    warnings.push(
      `${fragileLegs.length} fragile role/depth leg${fragileLegs.length === 1 ? " is" : "s are"} included only because the card needed six unique playable legs.`,
    );
  }
  const games = countBy(legs, (leg) => leg.matchupKey);
  const crowdedGames = Object.entries(games).filter(([, count]) => count >= 3);
  if (crowdedGames.length > 0) {
    warnings.push(`Same-game exposure is concentrated in ${crowdedGames.map(([game]) => game).join(", ")}.`);
  }
  const riskyLegs = legs.filter((leg) => leg.riskFlags.length > 0);
  if (riskyLegs.length > 0) {
    warnings.push(`${riskyLegs.length} leg${riskyLegs.length === 1 ? "" : "s"} carry role, availability, fill, or depth risk flags.`);
  }
  warnings.push("This is a ranking and risk-control model, not a guarantee that a parlay will hit.");
  return warnings;
}

export function buildSnapshotParlayCard(
  data: SnapshotBoardData,
  inputConfig?: Partial<SnapshotParlayModelConfig>,
): SnapshotParlayCard {
  const config = resolveSnapshotParlayConfig(inputConfig);
  const candidates = extractCandidates(data, config);
  const legs = selectLegs(candidates, config);
  const status: Status =
    data.rows.length === 0 ? "NO_SLATE" : legs.length >= config.minLegs ? "READY" : "UNDERFILLED";
  const independentHitProbability = legs.length > 0 ? round(product(legs.map((leg) => leg.legProbability)), 4) : 0;
  const corr = correlationMultiplier(legs);
  const adjustedHitProbability = round(independentHitProbability * corr, 4);
  const legDecimalOdds = americanToDecimal(config.defaultAmericanOdds);
  const assumedDecimalOdds = legs.length > 0 ? round(legDecimalOdds ** legs.length, 4) : 0;
  const assumedAmericanOdds = legs.length > 0 ? decimalToAmerican(assumedDecimalOdds) : 0;
  const expectedValuePerUnit = legs.length > 0 ? round(adjustedHitProbability * assumedDecimalOdds - 1, 4) : 0;
  const marketMix = countMarket(legs);
  const gameMix = countBy(legs, (leg) => leg.matchupKey);
  const teamMix = countBy(legs, (leg) => leg.teamCode);

  const selectedKeys = new Set(legs.map(precisionCardKey));
  const nextBest = candidates
    .filter((candidate) => !selectedKeys.has(precisionCardKey(candidate)))
    .slice(0, 8)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    version: SNAPSHOT_PARLAY_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    dateEt: data.dateEt,
    status,
    label: status === "READY" ? "Final V1 Parlay Card" : "Final V1 Parlay Watchlist",
    note:
      status === "READY"
        ? `Selected ${legs.length} leg${legs.length === 1 ? "" : "s"} from the Final V1 selected/candidate board with player, game, team, market, and counting-over correlation caps.`
        : "The model did not find enough unique Final V1 legs for a full parlay and intentionally refused to force-fill weaker picks.",
    warnings: buildWarnings(status, legs, config),
    config,
    summary: {
      status,
      legCount: legs.length,
      targetLegs: config.targetLegs,
      minLegs: config.minLegs,
      maxLegs: config.maxLegs,
      candidateCount: candidates.length,
      independentHitProbability,
      correlationMultiplier: corr,
      adjustedHitProbability,
      assumedDecimalOdds,
      assumedAmericanOdds,
      expectedValuePerUnit,
      averageLegProbability: average(legs.map((leg) => leg.legProbability)) == null
        ? null
        : round(average(legs.map((leg) => leg.legProbability))!, 4),
      averageSelectionScore: average(legs.map((leg) => leg.selectionScore)) == null
        ? null
        : round(average(legs.map((leg) => leg.selectionScore))!, 6),
      averageSportsbookCount: average(legs.map((leg) => leg.sportsbookCount)) == null
        ? null
        : round(average(legs.map((leg) => leg.sportsbookCount))!, 2),
      marketMix,
      gameMix,
      teamMix,
    },
    legs,
    nextBest,
  };
}

export function summarizeLockedPrecisionParlayHistory(
  input: LockedParlayHistoryInput,
  minLegs = DEFAULT_SNAPSHOT_PARLAY_CONFIG.minLegs,
): SnapshotParlayHistorySummary {
  const daily = input.daily ?? [];
  const daysWithMinLegs = daily.filter((day) => day.picks >= minLegs && (day.pending ?? 0) === 0).length;
  const allLegHitDays = daily.filter(
    (day) => day.picks >= minLegs && (day.pending ?? 0) === 0 && day.losses === 0 && day.wins + (day.pushes ?? 0) >= day.picks,
  ).length;
  const fivePlusHitDays = daily.filter((day) => day.picks >= minLegs && (day.pending ?? 0) === 0 && day.wins >= 5).length;
  const winCounts = daily.filter((day) => day.picks >= minLegs).map((day) => day.wins);
  const winDistribution = winCounts.reduce<Record<string, number>>((acc, wins) => {
    const key = String(wins);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const byMarketAgg = new Map<SnapshotMarket, { picks: number; wins: number }>();
  for (const pick of input.picks ?? []) {
    if (!pick.market || !PARLAY_MARKETS.includes(pick.market as SnapshotMarket)) continue;
    const market = pick.market as SnapshotMarket;
    const bucket = byMarketAgg.get(market) ?? { picks: 0, wins: 0 };
    bucket.picks += 1;
    if (pick.outcome === "WIN") bucket.wins += 1;
    byMarketAgg.set(market, bucket);
  }

  const totalPicks =
    input.summary?.overall?.picks ??
    daily.reduce((sum, day) => sum + day.picks, 0);
  const totalWins =
    input.summary?.overall?.correct ??
    daily.reduce((sum, day) => sum + day.wins, 0);

  return {
    range: {
      from: input.summary?.range?.from ?? daily[0]?.date ?? null,
      to: input.summary?.range?.to ?? daily[daily.length - 1]?.date ?? null,
      days: daily.length,
    },
    minLegs,
    daysWithMinLegs,
    allLegHitDays,
    allLegHitRatePct: daysWithMinLegs > 0 ? round((allLegHitDays / daysWithMinLegs) * 100, 2) : null,
    fivePlusHitDays,
    fivePlusHitRatePct: daysWithMinLegs > 0 ? round((fivePlusHitDays / daysWithMinLegs) * 100, 2) : null,
    averageWinsPerCard: winCounts.length > 0 ? round(winCounts.reduce((sum, wins) => sum + wins, 0) / winCounts.length, 2) : null,
    worstWins: winCounts.length > 0 ? Math.min(...winCounts) : null,
    bestWins: winCounts.length > 0 ? Math.max(...winCounts) : null,
    legAccuracyPct: totalPicks > 0 ? round((totalWins / totalPicks) * 100, 2) : null,
    winDistribution,
    byMarket: Object.fromEntries(
      [...byMarketAgg.entries()].map(([market, stats]) => [
        market,
        {
          picks: stats.picks,
          wins: stats.wins,
          accuracyPct: stats.picks > 0 ? round((stats.wins / stats.picks) * 100, 2) : null,
        },
      ]),
    ),
  };
}
