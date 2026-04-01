import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ALL_DAILY_6_RULES,
  CORE_THREE_EXPANSION_V1,
  DEFAULT_DAILY_6_RULES,
  LOOSE_RULES,
  TIER_2_HIGH_CONFIDENCE_RULES,
  buildPrecisionPick,
  buildShadowPrecisionRuleSet,
  comparePrecisionSignals,
  type PrecisionRankingMode,
  type PrecisionRuleSet,
} from "../lib/snapshot/precisionPickSystem";
import { attachCurrentLineRecencyMetrics, type CurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type FamilyName = "default" | "expanded" | "tier2" | "shadow" | "loose";
type MarketPackName = "conservative" | "core" | "wide" | "fill";

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: Side;
  actualSide: Side;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  actualMinutes: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
};

type EnrichedRow = TrainingRow & CurrentLineRecencyMetrics;

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type PlayerMeta = {
  id: string;
  position: string | null;
};

type PlayerSummary = {
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
};

type SignalEval = NonNullable<ReturnType<typeof buildPrecisionPick>>;

type CandidateVariant = {
  family: FamilyName;
  signal: SignalEval;
};

type PreparedRow = {
  row: EnrichedRow;
  playerPosition: string | null;
  variants: CandidateVariant[];
};

type SelectedCandidate = {
  row: EnrichedRow;
  signal: SignalEval;
  family: FamilyName;
  score: number;
};

type EvalSummary = {
  picks: number;
  correct: number;
  accuracyPct: number;
  picksPerDay: number;
  coveragePct: number;
  daysEvaluated: number;
  daysBelowFloor: number;
  minSelectedPerDay: number;
  medianSelectedPerDay: number;
  avgSelectedScore: number;
  byMarket: Partial<Record<Market, { picks: number; correct: number; accuracyPct: number | null }>>;
};

type SelectorProfile = {
  name: string;
  rankingMode: PrecisionRankingMode;
  minScore: number;
  dailyTargetPicks: number;
  weights: {
    historicalAccuracy: number;
    bucketRecentAccuracy: number;
    leafAccuracy: number;
    absLineGap: number;
    projectionWinProbability: number;
    projectionPriceEdge: number;
    recency: number;
    minutes: number;
    positionFit: number;
    lineupTimingConfidence: number;
    completenessScore: number;
    familyBias: number;
  };
  marketBoosts: Partial<Record<Market, number>>;
  marketCaps: Record<Market, number>;
};

type SelectorRun = {
  profileName: string;
  familyPackName: MarketPackName;
  profile: SelectorProfile;
  walkForward: EvalSummary;
  last14: EvalSummary;
  last30: EvalSummary;
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  minPicksPerDay: number;
  targetAccuracy: number;
};

const prisma = new PrismaClient();

const FAMILY_RULE_SETS: Record<FamilyName, PrecisionRuleSet> = {
  default: DEFAULT_DAILY_6_RULES,
  expanded: ALL_DAILY_6_RULES,
  tier2: TIER_2_HIGH_CONFIDENCE_RULES,
  shadow: buildShadowPrecisionRuleSet(CORE_THREE_EXPANSION_V1),
  loose: LOOSE_RULES,
};

const MARKET_PACKS: Record<MarketPackName, FamilyName[]> = {
  conservative: ["tier2", "shadow"],
  core: ["default", "tier2", "shadow"],
  wide: ["default", "expanded", "tier2", "shadow"],
  fill: ["default", "expanded", "tier2", "shadow", "loose"],
};

const MARKET_CAP_PROFILES: Record<string, Record<Market, number>> = {
  precision: {
    PTS: 1,
    REB: 2,
    AST: 1,
    THREES: 2,
    PRA: 2,
    PA: 2,
    PR: 1,
    RA: 1,
  },
  balanced: {
    PTS: 2,
    REB: 2,
    AST: 1,
    THREES: 1,
    PRA: 2,
    PA: 1,
    PR: 1,
    RA: 1,
  },
  broad: {
    PTS: 2,
    REB: 2,
    AST: 2,
    THREES: 2,
    PRA: 2,
    PA: 2,
    PR: 2,
    RA: 2,
  },
};

function resolveDefaultInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "precision-selector-prototype-search.json");
  let minActualMinutes = 15;
  let minPicksPerDay = 6;
  let targetAccuracy = 70;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
    if (token === "--min-picks-per-day" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minPicksPerDay = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-picks-per-day=")) {
      const parsed = Number(token.slice("--min-picks-per-day=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minPicksPerDay = parsed;
      continue;
    }
    if (token === "--target-accuracy" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) targetAccuracy = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--target-accuracy=")) {
      const parsed = Number(token.slice("--target-accuracy=".length));
      if (Number.isFinite(parsed) && parsed >= 0) targetAccuracy = parsed;
      continue;
    }
  }

  return {
    input,
    out: path.resolve(out),
    minActualMinutes,
    minPicksPerDay,
    targetAccuracy,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: playerIds.map((playerId) => ({ playerId })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            position: true,
          },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });

  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

function summarizeRows(rows: EnrichedRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, EnrichedRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    summaries.set(playerId, {
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      pointsProjection: mean(playerRows.map((row) => row.pointsProjection)),
      reboundsProjection: mean(playerRows.map((row) => row.reboundsProjection)),
      assistProjection: mean(playerRows.map((row) => row.assistProjection)),
      threesProjection: mean(playerRows.map((row) => row.threesProjection)),
    });
  });

  return summaries;
}

function buildWalkForwardDateSet(dates: string[]): Set<string> {
  const selected = new Set<string>();
  for (let trainDateCount = 56; trainDateCount < dates.length; trainDateCount += 14) {
    dates.slice(trainDateCount, trainDateCount + 14).forEach((date) => selected.add(date));
  }
  return selected;
}

function getPositionAffinity(position: string | null, market: Market): number {
  if (!position) return 0.5;
  const normalized = position.toUpperCase();
  const isGuard = normalized.includes("G");
  const isForward = normalized.includes("F");
  const isCenter = normalized.includes("C");
  const guardMarkets = new Set<Market>(["PTS", "AST", "THREES", "PA", "PR"]);
  const wingMarkets = new Set<Market>(["PTS", "PRA", "PR", "RA"]);
  const bigMarkets = new Set<Market>(["REB", "PRA", "RA", "PR"]);

  if (isCenter && bigMarkets.has(market)) return 0.92;
  if (isGuard && guardMarkets.has(market)) return 0.88;
  if (isForward && wingMarkets.has(market)) return 0.84;
  if (isGuard || isForward || isCenter) return 0.6;
  return 0.5;
}

function getRecencyFit(row: EnrichedRow, side: Side): number {
  const overRate =
    row.weightedCurrentLineOverRate ??
    row.emaCurrentLineOverRate ??
    row.l5CurrentLineOverRate ??
    row.l10CurrentLineOverRate ??
    row.l15CurrentLineOverRate ??
    0.5;
  const delta = row.emaCurrentLineDelta ?? row.l5CurrentLineDeltaAvg ?? 0;
  const overRateFit = side === "OVER" ? overRate : 1 - overRate;
  const deltaFit = side === "OVER" ? clamp01((delta + 4) / 8) : clamp01((4 - delta) / 8);
  return round(0.7 * overRateFit + 0.3 * deltaFit, 4);
}

function getMinutesFit(row: EnrichedRow, side: Side): number {
  const expectedMinutes = row.expectedMinutes ?? row.emaMinutesAvg ?? row.l5MinutesAvg ?? 0;
  const volatility = row.minutesVolatility ?? 0;
  const starterRate = row.starterRateLast10 ?? 0.5;
  const stability = row.benchBigRoleStability ?? 0.5;
  const minutesComponent = clamp01(expectedMinutes / 38);
  const volatilityComponent = clamp01(volatility / 10);
  const stabilityComponent = clamp01(stability);
  const starterComponent = clamp01(starterRate);

  if (side === "OVER") {
    return round(
      0.42 * minutesComponent +
        0.22 * starterComponent +
        0.14 * (1 - volatilityComponent) +
        0.12 * stabilityComponent +
        0.1 * clamp01((row.l5MinutesAvg ?? expectedMinutes) / 36),
      4,
    );
  }

  return round(
    0.42 * (1 - minutesComponent) +
      0.22 * (1 - starterComponent) +
      0.14 * volatilityComponent +
      0.12 * (1 - stabilityComponent) +
      0.1 * (1 - clamp01((row.l5MinutesAvg ?? expectedMinutes) / 36)),
    4,
  );
}

function familyBias(family: FamilyName): number {
  switch (family) {
    case "tier2":
      return 0.018;
    case "shadow":
      return 0.015;
    case "default":
      return 0.012;
    case "expanded":
      return 0.009;
    case "loose":
      return 0.004;
    default:
      return 0;
  }
}

function getSignalFeature(signal: SignalEval): {
  historicalAccuracy: number;
  bucketRecentAccuracy: number;
  leafAccuracy: number;
  absLineGap: number;
  projectionWinProbability: number;
  projectionPriceEdge: number;
} {
  return {
    historicalAccuracy: signal.historicalAccuracy / 100,
    bucketRecentAccuracy: (signal.bucketRecentAccuracy ?? signal.historicalAccuracy) / 100,
    leafAccuracy: (signal.leafAccuracy ?? signal.historicalAccuracy) / 100,
    absLineGap: clamp01((signal.absLineGap ?? 0) / 12),
    projectionWinProbability: signal.projectionWinProbability ?? 0.5,
    projectionPriceEdge: clamp01(((signal.projectionPriceEdge ?? 0) + 0.02) / 0.08),
  };
}

function scoreCandidate(
  row: PreparedRow["row"],
  playerPosition: string | null,
  signal: SignalEval,
  family: FamilyName,
  profile: SelectorProfile,
): number {
  const features = getSignalFeature(signal);
  const selectionSide: Side = signal.side === "UNDER" ? "UNDER" : "OVER";
  const recencyFit = getRecencyFit(row, selectionSide);
  const minutesFit = getMinutesFit(row, selectionSide);
  const positionFit = getPositionAffinity(playerPosition, row.market);
  const lineupConfidence = clamp01((row.lineupTimingConfidence ?? 50) / 100);
  const completeness = clamp01((row.completenessScore ?? 50) / 100);
  const marketBoost = profile.marketBoosts[row.market] ?? 0;

  return round(
    profile.weights.historicalAccuracy * features.historicalAccuracy +
      profile.weights.bucketRecentAccuracy * features.bucketRecentAccuracy +
      profile.weights.leafAccuracy * features.leafAccuracy +
      profile.weights.absLineGap * features.absLineGap +
      profile.weights.projectionWinProbability * features.projectionWinProbability +
      profile.weights.projectionPriceEdge * features.projectionPriceEdge +
      profile.weights.recency * recencyFit +
      profile.weights.minutes * minutesFit +
      profile.weights.positionFit * positionFit +
      profile.weights.lineupTimingConfidence * lineupConfidence +
      profile.weights.completenessScore * completeness +
      profile.weights.familyBias * familyBias(family) +
      marketBoost,
    6,
  );
}

function buildPreparedRows(rows: EnrichedRow[], summaries: Map<string, PlayerSummary>): PreparedRow[] {
  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const playerPosition = summary?.position ?? null;
    const variants: CandidateVariant[] = [];

    (Object.keys(FAMILY_RULE_SETS) as FamilyName[]).forEach((family) => {
      const signal = buildPrecisionPick(
        {
          market: row.market,
          projectedValue: row.projectedValue,
          line: row.line,
          overPrice: row.overPrice,
          underPrice: row.underPrice,
          finalSide: row.finalSide,
          l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
          l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
          l5MinutesAvg: row.l5MinutesAvg ?? null,
          expectedMinutes: row.expectedMinutes,
          minutesVolatility: row.minutesVolatility,
          benchBigRoleStability: row.benchBigRoleStability ?? null,
          starterRateLast10: row.starterRateLast10,
          archetypeExpectedMinutes: summary?.avgExpectedMinutes ?? null,
          archetypeStarterRateLast10: summary?.avgStarterRate ?? null,
          openingTeamSpread: row.openingTeamSpread,
          openingTotal: row.openingTotal,
          lineupTimingConfidence: row.lineupTimingConfidence,
          completenessScore: row.completenessScore,
          playerPosition,
          pointsProjection: row.pointsProjection ?? summary?.pointsProjection ?? null,
          reboundsProjection: row.reboundsProjection ?? summary?.reboundsProjection ?? null,
          assistProjection: row.assistProjection ?? summary?.assistProjection ?? null,
          threesProjection: row.threesProjection ?? summary?.threesProjection ?? null,
        },
        FAMILY_RULE_SETS[family],
      );

      if (signal?.qualified && signal.side !== "NEUTRAL") {
        variants.push({ family, signal });
      }
    });

    return {
      row,
      playerPosition,
      variants,
    };
  });
}

function selectBestVariant(
  row: PreparedRow,
  profile: SelectorProfile,
  allowedFamilies: Set<FamilyName>,
): SelectedCandidate | null {
  let best: SelectedCandidate | null = null;

  row.variants.forEach(({ family, signal }) => {
    if (!allowedFamilies.has(family)) return;
    const score = scoreCandidate(row.row, row.playerPosition, signal, family, profile);
    if (score < profile.minScore) return;

    if (!best) {
      best = { row: row.row, signal, family, score };
      return;
    }

    if (score > best.score) {
      best = { row: row.row, signal, family, score };
      return;
    }

    if (score === best.score) {
      const comparison = comparePrecisionSignals(best.signal, signal, profile.rankingMode);
      if (comparison > 0) {
        best = { row: row.row, signal, family, score };
      }
    }
  });

  return best;
}

function evaluateSelector(
  rows: PreparedRow[],
  dateSet: Set<string>,
  profile: SelectorProfile,
  familyPack: MarketPackName,
): EvalSummary {
  const allowedFamilies = new Set(MARKET_PACKS[familyPack]);
  const selectedByDay = new Map<string, SelectedCandidate[]>();

  rows.forEach((row) => {
    if (!dateSet.has(row.row.gameDateEt)) return;
    const candidate = selectBestVariant(row, profile, allowedFamilies);
    if (!candidate) return;
    const bucket = selectedByDay.get(row.row.gameDateEt) ?? [];
    bucket.push(candidate);
    selectedByDay.set(row.row.gameDateEt, bucket);
  });

  const byMarket = new Map<Market, { picks: number; correct: number }>();
  const selectedPerDay: number[] = [];
  let picks = 0;
  let correct = 0;
  const selectedScores: number[] = [];

  [...dateSet].forEach((date) => {
    const candidates = selectedByDay.get(date) ?? [];
    const ordered = candidates.slice().sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const comparison = comparePrecisionSignals(left.signal, right.signal, profile.rankingMode);
      if (comparison !== 0) return comparison;
      if (left.row.playerName !== right.row.playerName) return left.row.playerName.localeCompare(right.row.playerName);
      return left.row.market.localeCompare(right.row.market);
    });

    const selectedPlayers = new Set<string>();
    const marketCounts = new Map<Market, number>();
    let selectedCount = 0;

    for (const candidate of ordered) {
      if (selectedCount >= profile.dailyTargetPicks) break;
      if (selectedPlayers.has(candidate.row.playerId)) continue;

      const cap = profile.marketCaps[candidate.row.market] ?? 0;
      if (cap <= 0) continue;
      const currentMarketCount = marketCounts.get(candidate.row.market) ?? 0;
      if (currentMarketCount >= cap) continue;

      selectedPlayers.add(candidate.row.playerId);
      marketCounts.set(candidate.row.market, currentMarketCount + 1);
      selectedCount += 1;
      selectedScores.push(candidate.score);
      picks += 1;
      const bucket = byMarket.get(candidate.row.market) ?? { picks: 0, correct: 0 };
      bucket.picks += 1;
      if (candidate.signal.side === candidate.row.actualSide) {
        correct += 1;
        bucket.correct += 1;
      }
      byMarket.set(candidate.row.market, bucket);
    }

    selectedPerDay.push(selectedCount);
  });

  const daysEvaluated = dateSet.size;
  return {
    picks,
    correct,
    accuracyPct: picks > 0 ? round((correct / picks) * 100, 2) : 0,
    picksPerDay: daysEvaluated > 0 ? round(picks / daysEvaluated, 2) : 0,
    coveragePct: rows.length > 0 ? round((picks / rows.length) * 100, 2) : 0,
    daysEvaluated,
    daysBelowFloor: selectedPerDay.filter((count) => count < 6).length,
    minSelectedPerDay: selectedPerDay.length > 0 ? Math.min(...selectedPerDay) : 0,
    medianSelectedPerDay: selectedPerDay.length > 0 ? (median(selectedPerDay) ?? 0) : 0,
    avgSelectedScore: selectedScores.length > 0 ? round(selectedScores.reduce((sum, value) => sum + value, 0) / selectedScores.length, 4) : 0,
    byMarket: Object.fromEntries(
      [...byMarket.entries()].map(([market, stats]) => [
        market,
        {
          picks: stats.picks,
          correct: stats.correct,
          accuracyPct: stats.picks > 0 ? round((stats.correct / stats.picks) * 100, 2) : null,
        },
      ]),
    ),
  };
}

function getScoreProfiles(): SelectorProfile[] {
  const baseProfiles: Omit<SelectorProfile, "marketCaps">[] = [
    {
      name: "balanced_historical",
      rankingMode: "historical-prior-first",
      minScore: 0.56,
      dailyTargetPicks: 6,
      weights: {
        historicalAccuracy: 0.16,
        bucketRecentAccuracy: 0.15,
        leafAccuracy: 0.13,
        absLineGap: 0.1,
        projectionWinProbability: 0.1,
        projectionPriceEdge: 0.06,
        recency: 0.12,
        minutes: 0.1,
        positionFit: 0.04,
        lineupTimingConfidence: 0.03,
        completenessScore: 0.01,
        familyBias: 0.02,
      },
      marketBoosts: {
        PA: 0.03,
        THREES: 0.02,
        REB: 0.02,
        PRA: 0.01,
      },
    },
    {
      name: "precision_edge",
      rankingMode: "dynamic-edge-first",
      minScore: 0.6,
      dailyTargetPicks: 6,
      weights: {
        historicalAccuracy: 0.2,
        bucketRecentAccuracy: 0.18,
        leafAccuracy: 0.16,
        absLineGap: 0.12,
        projectionWinProbability: 0.1,
        projectionPriceEdge: 0.08,
        recency: 0.06,
        minutes: 0.04,
        positionFit: 0.03,
        lineupTimingConfidence: 0.02,
        completenessScore: 0.01,
        familyBias: 0.02,
      },
      marketBoosts: {
        PA: 0.04,
        THREES: 0.03,
        REB: 0.02,
        PR: 0.01,
      },
    },
    {
      name: "recency_minutes",
      rankingMode: "dynamic-edge-first",
      minScore: 0.54,
      dailyTargetPicks: 7,
      weights: {
        historicalAccuracy: 0.12,
        bucketRecentAccuracy: 0.1,
        leafAccuracy: 0.08,
        absLineGap: 0.08,
        projectionWinProbability: 0.08,
        projectionPriceEdge: 0.04,
        recency: 0.18,
        minutes: 0.18,
        positionFit: 0.08,
        lineupTimingConfidence: 0.02,
        completenessScore: 0.02,
        familyBias: 0.02,
      },
      marketBoosts: {
        THREES: 0.03,
        AST: 0.03,
        REB: 0.02,
        PRA: 0.01,
      },
    },
    {
      name: "conservative",
      rankingMode: "historical-prior-first",
      minScore: 0.62,
      dailyTargetPicks: 6,
      weights: {
        historicalAccuracy: 0.22,
        bucketRecentAccuracy: 0.2,
        leafAccuracy: 0.18,
        absLineGap: 0.1,
        projectionWinProbability: 0.09,
        projectionPriceEdge: 0.04,
        recency: 0.05,
        minutes: 0.04,
        positionFit: 0.03,
        lineupTimingConfidence: 0.03,
        completenessScore: 0.01,
        familyBias: 0.01,
      },
      marketBoosts: {
        PA: 0.05,
        THREES: 0.03,
        REB: 0.02,
        PR: 0.01,
      },
    },
    {
      name: "ceiling_mix",
      rankingMode: "dynamic-edge-first",
      minScore: 0.57,
      dailyTargetPicks: 8,
      weights: {
        historicalAccuracy: 0.14,
        bucketRecentAccuracy: 0.12,
        leafAccuracy: 0.1,
        absLineGap: 0.08,
        projectionWinProbability: 0.14,
        projectionPriceEdge: 0.1,
        recency: 0.1,
        minutes: 0.1,
        positionFit: 0.06,
        lineupTimingConfidence: 0.04,
        completenessScore: 0.02,
        familyBias: 0.02,
      },
      marketBoosts: {
        PA: 0.03,
        REB: 0.02,
        PRA: 0.02,
        THREES: 0.02,
        PR: 0.01,
      },
    },
  ];

  const capProfiles = Object.entries(MARKET_CAP_PROFILES);
  return baseProfiles.flatMap((profile) =>
    capProfiles.map(([capName, marketCaps]) => ({
      ...profile,
      name: `${profile.name}__${capName}`,
      marketCaps,
    })),
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const enrichedRows = attachCurrentLineRecencyMetrics(filteredRows) as EnrichedRow[];
  const playerMetaMap = await loadPlayerMetaMap([...new Set(enrichedRows.map((row) => row.playerId))]);
  const summaries = summarizeRows(enrichedRows, playerMetaMap);
  const preparedRows = buildPreparedRows(enrichedRows, summaries);
  const dates = [...new Set(enrichedRows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const walkForwardDates = buildWalkForwardDateSet(dates);
  const last14Dates = new Set(dates.slice(-14));
  const last30Dates = new Set(dates.slice(-30));
  const selectorProfiles = getScoreProfiles();
  const results: SelectorRun[] = [];

  selectorProfiles.forEach((profile) => {
    (Object.keys(MARKET_PACKS) as MarketPackName[]).forEach((familyPackName) => {
      const walkForward = evaluateSelector(preparedRows, walkForwardDates, profile, familyPackName);
      const last14 = evaluateSelector(preparedRows, last14Dates, profile, familyPackName);
      const last30 = evaluateSelector(preparedRows, last30Dates, profile, familyPackName);
      results.push({
        profileName: profile.name,
        familyPackName,
        profile,
        walkForward,
        last14,
        last30,
      });
    });
  });

  const scoredResults = results
    .map((result) => {
      const meetsTarget =
        result.walkForward.picksPerDay >= args.minPicksPerDay &&
        result.last14.picksPerDay >= args.minPicksPerDay &&
        result.last30.picksPerDay >= args.minPicksPerDay &&
        result.walkForward.accuracyPct >= args.targetAccuracy &&
        result.last14.accuracyPct >= args.targetAccuracy &&
        result.last30.accuracyPct >= args.targetAccuracy;

      const shortfall =
        Math.max(0, args.targetAccuracy - result.walkForward.accuracyPct) +
        Math.max(0, args.targetAccuracy - result.last14.accuracyPct) +
        Math.max(0, args.targetAccuracy - result.last30.accuracyPct) +
        Math.max(0, args.minPicksPerDay - result.walkForward.picksPerDay) +
        Math.max(0, args.minPicksPerDay - result.last14.picksPerDay) +
        Math.max(0, args.minPicksPerDay - result.last30.picksPerDay);

      return {
        ...result,
        meetsTarget,
        shortfall: round(shortfall, 4),
      };
    })
    .sort((left, right) => {
      if (left.meetsTarget !== right.meetsTarget) return Number(right.meetsTarget) - Number(left.meetsTarget);
      if (right.shortfall !== left.shortfall) return left.shortfall - right.shortfall;
      if (right.walkForward.accuracyPct !== left.walkForward.accuracyPct) {
        return right.walkForward.accuracyPct - left.walkForward.accuracyPct;
      }
      if (right.walkForward.picksPerDay !== left.walkForward.picksPerDay) {
        return right.walkForward.picksPerDay - left.walkForward.picksPerDay;
      }
      return right.last30.accuracyPct - left.last30.accuracyPct;
    });

  const bestOverall = scoredResults.slice(0, 10);
  const bestMeetingFloor = scoredResults.filter((result) => result.meetsTarget).slice(0, 10);

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    filters: {
      minActualMinutes: args.minActualMinutes,
      minPicksPerDay: args.minPicksPerDay,
      targetAccuracy: args.targetAccuracy,
      sampleRows: enrichedRows.length,
      dates: {
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
        uniqueDates: dates.length,
      },
    },
    candidateSpace: {
      families: Object.keys(FAMILY_RULE_SETS),
      familyPacks: Object.keys(MARKET_PACKS),
      scoreProfiles: selectorProfiles.map((profile) => profile.name),
      totalCandidatesTested: results.length,
    },
    bestMeetingFloor,
    bestOverall,
    summary: {
      walkForwardBest: bestOverall[0]?.walkForward ?? null,
      last14Best: bestOverall[0]?.last14 ?? null,
      last30Best: bestOverall[0]?.last30 ?? null,
      bestMeetsTargetCount: bestMeetingFloor.length,
    },
  };

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
