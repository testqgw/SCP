import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { SNAPSHOT_MARKETS, buildPlayerPersonalModels, projectTonightMetrics } from "../lib/snapshot/projection";
import { round } from "../lib/utils";
import type { SnapshotMarket, SnapshotMetricRecord, SnapshotModelSide } from "../lib/types/snapshot";
import {
  computeLineupTimingConfidence,
  fetchHistoricalPregameOdds,
  fetchHistoricalRotowireSnapshot,
  getHistoricalRotowireTeamSignal,
  mapLimit,
} from "./historical-game-context";

type Args = {
  season: string;
  from: string;
  to: string;
  out: string;
  lineFile: string | null;
  minActualMinutes: number;
  minHistoryMinutesAvg: number;
  mode: "model" | "mean10" | "median10" | "season" | "player_conditional_median" | "player_hybrid";
  opponentWindow: number;
  playerBiasWeight: number;
  playerBiasWindow: number;
  globalBiasWeight: number;
  globalBiasMinSamples: number;
  playerLinearWeight: number;
  playerLinearWindow: number;
  marketBiasWeight: number;
  marketBiasMinSamples: number;
  restWeight: number;
  restMinSamples: number;
  quantileClampWeight: number;
  quantileClampMinSamples: number;
  hybridPlayerMinutesThreshold: number;
  hybridPlayerMinSamples: number;
  hybridLearningRate: number;
  hybridL2: number;
  hybridPlayerBlend: number;
  hybridGlobalBlend: number;
  compositeFromCore: boolean;
  medianBlendWeight: number;
  medianBlendTake: number;
  ptsBadGameWeight: number;
  ptsBadGamePlayerMinSamples: number;
  ptsBadGameGlobalMinSamples: number;
  ptsBadGameCap: number;
  ptsBadGameThresholdPts: number;
  ptsBadGameThresholdPct: number;
  ptsPpmBlendWeight: number;
  ptsPpmBandWidth: number;
  ptsPpmMinSamples: number;
  ptsPpmTake: number;
  ptsMinutesRecoveryWeight: number;
  ptsMinutesRecoveryCap: number;
  ptsMinutesRecoveryMinDeficit: number;
  ptsVolatilityDampenWeight: number;
  ptsVolatilityDampenThreshold: number;
  ptsTrendReversionWeight: number;
  ptsTrendReversionCap: number;
  ptsGlobalLinearWeight: number;
  ptsGlobalLinearWindow: number;
  ptsSideOverrideEnabled: boolean;
  rebSideOverrideEnabled: boolean;
  astSideOverrideEnabled: boolean;
  threesSideOverrideEnabled: boolean;
  praSideOverrideEnabled: boolean;
  paSideOverrideEnabled: boolean;
  prSideOverrideEnabled: boolean;
  raSideOverrideEnabled: boolean;
  emitPlayerRows: boolean;
};

type HistoryLog = {
  gameDateEt: string;
  teamId: string | null;
  isHome: boolean | null;
  starter: boolean | null;
  restDaysBefore: number | null;
  minutes: number;
  metrics: SnapshotMetricRecord;
};

type RollingAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
  window: number | null;
  queue: SnapshotMetricRecord[];
};

type MarketErrorStats = {
  count: number;
  sumAbsError: number;
  sumSquaredError: number;
  sumError: number;
  within1: number;
  within2: number;
  lineCount: number;
  lineResolvedCount: number;
  linePushes: number;
  actualPushes: number;
  correctSide: number;
  wrongSide: number;
  overCalls: number;
  underCalls: number;
};

const MARKETS: SnapshotMarket[] = SNAPSHOT_MARKETS;

type HistoricalLineMaps = {
  byPlayerId: Map<string, HistoricalLineEntry>;
};

type HistoricalLineEntry = {
  line: number;
  overPrice: number | null;
  underPrice: number | null;
};

type ResolvedSide = "OVER" | "UNDER" | "PUSH";

type FinalizedMarketStats = {
  samples: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  within1Pct: number | null;
  within2Pct: number | null;
  lineSamples: number;
  lineResolvedSamples: number;
  predictedPushes: number;
  actualPushes: number;
  correctSide: number;
  wrongSide: number;
  sideAccuracyPct: number | null;
  overCalls: number;
  underCalls: number;
  overCallPct: number | null;
  underCallPct: number | null;
};

type FinalizedPlayerMarketStats = {
  playerId: string;
  playerName: string;
  market: SnapshotMarket;
  samples: number;
  mae: number | null;
  bias: number | null;
  lineSamples: number;
  lineResolvedSamples: number;
  correctSide: number;
  wrongSide: number;
  sideAccuracyPct: number | null;
};

type PlayerMarketTrainingRow = {
  playerId: string;
  playerName: string;
  market: SnapshotMarket;
  gameDateEt: string;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: ResolvedSide;
  finalSide: ResolvedSide | SnapshotModelSide;
  actualSide: ResolvedSide;
  projectionCorrect: boolean;
  finalCorrect: boolean;
  priceLean: number | null;
  favoredSide: SnapshotModelSide;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
};

type BacktestGameContext = {
  externalId: string;
  gameDateEt: string;
  homeTeamId: string;
  awayTeamId: string;
  homeCode: string;
  awayCode: string;
};

function makeLineLookupKey(playerId: string, gameDateEt: string, market: SnapshotMarket): string {
  return `${playerId}|${gameDateEt}|${market}`;
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

function sideFromLine(value: number, line: number): "OVER" | "UNDER" | "PUSH" {
  if (value > line) return "OVER";
  if (value < line) return "UNDER";
  return "PUSH";
}

function computeTrainingRowCompleteness(input: {
  last10Logs: HistoryLog[];
  opponentAllowance: SnapshotMetricRecord;
  minutesVolatility: number | null;
}): number {
  const sampleCoverage = Math.min(100, input.last10Logs.length * 10);
  const statusCoverage = Math.min(
    100,
    input.last10Logs.filter((log) => log.starter != null).length * 10,
  );
  const contextCoverage =
    input.opponentAllowance.PTS != null &&
    input.opponentAllowance.REB != null &&
    input.opponentAllowance.AST != null
      ? 90
      : 55;
  const stabilityCoverage =
    input.minutesVolatility == null ? 45 : Math.max(30, Math.min(100, Math.round(100 - input.minutesVolatility * 8)));

  return Math.round(sampleCoverage * 0.4 + statusCoverage * 0.2 + contextCoverage * 0.2 + stabilityCoverage * 0.2);
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function priceAwarePtsPrediction(
  projectedValue: number,
  lineEntry: HistoricalLineEntry | null,
): number {
  if (!lineEntry) return projectedValue;

  const overProbability = impliedProbability(lineEntry.overPrice);
  const underProbability = impliedProbability(lineEntry.underPrice);
  if (overProbability == null || underProbability == null) return projectedValue;

  const lean = overProbability - underProbability;
  if (Math.abs(lean) < 0.0075) return projectedValue;

  const lineGap = projectedValue - lineEntry.line;
  const targetBuffer = Math.min(1.25, 0.35 + Math.abs(lean) * 22);
  const target =
    lean > 0
      ? Math.max(projectedValue, lineEntry.line + targetBuffer)
      : Math.min(projectedValue, lineEntry.line - targetBuffer);
  const weight =
    Math.abs(lineGap) < 1
      ? 0.42
      : Math.abs(lineGap) < 2
        ? 0.26
        : 0.12;

  return round(projectedValue * (1 - weight) + target * weight, 2);
}

function resolveMarketSignal(lineEntry: HistoricalLineEntry | null): {
  priceLean: number | null;
  favoredSide: SnapshotModelSide;
  marketStrong: boolean;
} {
  if (!lineEntry) {
    return {
      priceLean: null,
      favoredSide: "NEUTRAL",
      marketStrong: false,
    };
  }

  const overProbability = impliedProbability(lineEntry.overPrice);
  const underProbability = impliedProbability(lineEntry.underPrice);
  if (overProbability == null || underProbability == null) {
    return {
      priceLean: null,
      favoredSide: "NEUTRAL",
      marketStrong: false,
    };
  }

  const priceLean = round(overProbability - underProbability, 4);
  return {
    priceLean,
    favoredSide: priceLean > 0 ? "OVER" : priceLean < 0 ? "UNDER" : "NEUTRAL",
    marketStrong: Math.abs(priceLean) >= 0.0075 && priceLean !== 0,
  };
}

function priceAwareRebPrediction(
  projectedValue: number,
  lineEntry: HistoricalLineEntry | null,
): number {
  if (!lineEntry) return projectedValue;

  const signal = resolveMarketSignal(lineEntry);
  if (signal.priceLean == null || !signal.marketStrong) return projectedValue;

  const lineGap = projectedValue - lineEntry.line;
  const targetBuffer = Math.min(0.85, 0.2 + Math.abs(signal.priceLean) * 14);
  const target =
    signal.priceLean > 0
      ? Math.max(projectedValue, lineEntry.line + targetBuffer)
      : Math.min(projectedValue, lineEntry.line - targetBuffer);
  const weight =
    Math.abs(lineGap) < 0.5
      ? 0.34
      : Math.abs(lineGap) < 1
        ? 0.2
        : Math.abs(lineGap) < 1.5
          ? 0.1
          : 0.04;

  return round(projectedValue * (1 - weight) + target * weight, 2);
}

function priceAwareAstPrediction(
  projectedValue: number,
  lineEntry: HistoricalLineEntry | null,
): number {
  if (!lineEntry) return projectedValue;

  const signal = resolveMarketSignal(lineEntry);
  if (signal.priceLean == null || !signal.marketStrong) return projectedValue;

  const lineGap = projectedValue - lineEntry.line;
  const targetBuffer = Math.min(0.95, 0.24 + Math.abs(signal.priceLean) * 16);
  const target =
    signal.priceLean > 0
      ? Math.max(projectedValue, lineEntry.line + targetBuffer)
      : Math.min(projectedValue, lineEntry.line - targetBuffer);
  const weight =
    Math.abs(lineGap) < 0.5
      ? 0.38
      : Math.abs(lineGap) < 1
        ? 0.24
        : Math.abs(lineGap) < 1.5
          ? 0.12
          : 0.05;

  return round(projectedValue * (1 - weight) + target * weight, 2);
}

function priceAwareThreesPrediction(
  projectedValue: number,
  lineEntry: HistoricalLineEntry | null,
): number {
  if (!lineEntry) return projectedValue;

  const signal = resolveMarketSignal(lineEntry);
  if (signal.priceLean == null || !signal.marketStrong) return projectedValue;

  const lineGap = projectedValue - lineEntry.line;
  const targetBuffer = Math.min(0.55, 0.14 + Math.abs(signal.priceLean) * 12);
  const target =
    signal.priceLean > 0
      ? Math.max(projectedValue, lineEntry.line + targetBuffer)
      : Math.min(projectedValue, lineEntry.line - targetBuffer);
  const weight =
    Math.abs(lineGap) < 0.35
      ? 0.34
      : Math.abs(lineGap) < 0.65
        ? 0.2
        : Math.abs(lineGap) < 1
          ? 0.1
          : 0.04;

  return round(projectedValue * (1 - weight) + target * weight, 2);
}

function priceAwareComboPrediction(
  projectedValue: number,
  lineEntry: HistoricalLineEntry | null,
  config: {
    maxBuffer: number;
    baseBuffer: number;
    leanWeight: number;
    lowGap: number;
    midGap: number;
    highGap: number;
    lowWeight: number;
    midWeight: number;
    highWeight: number;
    baseWeight: number;
  },
): number {
  if (!lineEntry) return projectedValue;

  const signal = resolveMarketSignal(lineEntry);
  if (signal.priceLean == null || !signal.marketStrong) return projectedValue;

  const lineGap = projectedValue - lineEntry.line;
  const targetBuffer = Math.min(config.maxBuffer, config.baseBuffer + Math.abs(signal.priceLean) * config.leanWeight);
  const target =
    signal.priceLean > 0
      ? Math.max(projectedValue, lineEntry.line + targetBuffer)
      : Math.min(projectedValue, lineEntry.line - targetBuffer);
  const weight =
    Math.abs(lineGap) < config.lowGap
      ? config.lowWeight
      : Math.abs(lineGap) < config.midGap
        ? config.midWeight
        : Math.abs(lineGap) < config.highGap
          ? config.highWeight
          : config.baseWeight;

  return round(projectedValue * (1 - weight) + target * weight, 2);
}

function priceAwarePraPrediction(projectedValue: number, lineEntry: HistoricalLineEntry | null): number {
  return priceAwareComboPrediction(projectedValue, lineEntry, {
    maxBuffer: 1.6,
    baseBuffer: 0.4,
    leanWeight: 26,
    lowGap: 1.25,
    midGap: 2,
    highGap: 3,
    lowWeight: 0.38,
    midWeight: 0.22,
    highWeight: 0.1,
    baseWeight: 0.04,
  });
}

function priceAwarePaPrediction(projectedValue: number, lineEntry: HistoricalLineEntry | null): number {
  return priceAwareComboPrediction(projectedValue, lineEntry, {
    maxBuffer: 1.35,
    baseBuffer: 0.32,
    leanWeight: 22,
    lowGap: 1,
    midGap: 1.75,
    highGap: 2.5,
    lowWeight: 0.36,
    midWeight: 0.22,
    highWeight: 0.1,
    baseWeight: 0.04,
  });
}

function priceAwarePrPrediction(projectedValue: number, lineEntry: HistoricalLineEntry | null): number {
  return priceAwareComboPrediction(projectedValue, lineEntry, {
    maxBuffer: 1.35,
    baseBuffer: 0.32,
    leanWeight: 22,
    lowGap: 1,
    midGap: 1.75,
    highGap: 2.5,
    lowWeight: 0.36,
    midWeight: 0.22,
    highWeight: 0.1,
    baseWeight: 0.04,
  });
}

function priceAwareRaPrediction(projectedValue: number, lineEntry: HistoricalLineEntry | null): number {
  return priceAwareComboPrediction(projectedValue, lineEntry, {
    maxBuffer: 0.95,
    baseBuffer: 0.22,
    leanWeight: 14,
    lowGap: 0.75,
    midGap: 1.25,
    highGap: 2,
    lowWeight: 0.34,
    midWeight: 0.2,
    highWeight: 0.1,
    baseWeight: 0.04,
  });
}

function computeGlobalMinutesRisk(input: {
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): number {
  const expectedMinutes = input.expectedMinutes ?? 28;
  const lowMinutesRisk = clamp((28 - expectedMinutes) / 18, 0, 0.42);
  const volatilityRisk =
    input.minutesVolatility == null ? 0.08 : clamp((input.minutesVolatility - 3.2) / 7.5, 0, 0.24);
  const starterUncertainty =
    input.starterRateLast10 == null
      ? 0.12
      : Math.abs(0.5 - input.starterRateLast10) < 0.18
        ? 0.18
        : 0.05;

  return round(clamp(lowMinutesRisk + volatilityRisk + starterUncertainty, 0, 1), 3);
}

function applyGlobalPtsSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  if (!input.lineEntry) return null;

  let side: SnapshotModelSide =
    input.projectedValue > input.lineEntry.line
      ? "OVER"
      : input.projectedValue < input.lineEntry.line
        ? "UNDER"
        : "NEUTRAL";
  const marketSignal = resolveMarketSignal(input.lineEntry);
  const minutesRisk = computeGlobalMinutesRisk({
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });

  if (marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL" && marketSignal.favoredSide !== side) {
    side = marketSignal.favoredSide;
  }

  if (minutesRisk <= 0.2) {
    const projectionSide: SnapshotModelSide =
      input.projectedValue > input.lineEntry.line
        ? "OVER"
        : input.projectedValue < input.lineEntry.line
          ? "UNDER"
          : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
    }
  }

  if (
    Math.abs(input.projectedValue - input.lineEntry.line) <= 1 &&
    marketSignal.marketStrong &&
    marketSignal.favoredSide !== "NEUTRAL"
  ) {
    side = marketSignal.favoredSide;
  }

  return side === "NEUTRAL" ? null : side;
}

function applyGlobalRebSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  if (!input.lineEntry) return null;

  let side: SnapshotModelSide =
    input.projectedValue > input.lineEntry.line
      ? "OVER"
      : input.projectedValue < input.lineEntry.line
        ? "UNDER"
        : "NEUTRAL";
  const marketSignal = resolveMarketSignal(input.lineEntry);
  const minutesRisk = computeGlobalMinutesRisk({
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  const lineGap = input.projectedValue - input.lineEntry.line;

  if (Math.abs(lineGap) <= 0.85 && marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk >= 0.48 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk <= 0.16) {
    const projectionSide: SnapshotModelSide =
      input.projectedValue > input.lineEntry.line
        ? "OVER"
        : input.projectedValue < input.lineEntry.line
          ? "UNDER"
          : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
    }
  }

  return side === "NEUTRAL" ? null : side;
}

function applyGlobalAstSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  if (!input.lineEntry) return null;

  let side: SnapshotModelSide =
    input.projectedValue > input.lineEntry.line
      ? "OVER"
      : input.projectedValue < input.lineEntry.line
        ? "UNDER"
        : "NEUTRAL";
  const marketSignal = resolveMarketSignal(input.lineEntry);
  const minutesRisk = computeGlobalMinutesRisk({
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  const lineGap = input.projectedValue - input.lineEntry.line;

  if (Math.abs(lineGap) <= 0.9 && marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk >= 0.42 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk <= 0.18) {
    const projectionSide: SnapshotModelSide =
      input.projectedValue > input.lineEntry.line
        ? "OVER"
        : input.projectedValue < input.lineEntry.line
          ? "UNDER"
          : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
    }
  }

  return side === "NEUTRAL" ? null : side;
}

function applyGlobalThreesSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  if (!input.lineEntry) return null;

  let side: SnapshotModelSide =
    input.projectedValue > input.lineEntry.line
      ? "OVER"
      : input.projectedValue < input.lineEntry.line
        ? "UNDER"
        : "NEUTRAL";
  const marketSignal = resolveMarketSignal(input.lineEntry);
  const minutesRisk = computeGlobalMinutesRisk({
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  const lineGap = input.projectedValue - input.lineEntry.line;

  if (Math.abs(lineGap) <= 0.35 && marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk >= 0.5 && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk <= 0.18) {
    const projectionSide: SnapshotModelSide =
      input.projectedValue > input.lineEntry.line
        ? "OVER"
        : input.projectedValue < input.lineEntry.line
          ? "UNDER"
          : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
    }
  }

  return side === "NEUTRAL" ? null : side;
}

function applyGlobalComboSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  nearLineThreshold: number;
  highRiskThreshold: number;
  lowRiskThreshold: number;
}): SnapshotModelSide | null {
  if (!input.lineEntry) return null;

  let side: SnapshotModelSide =
    input.projectedValue > input.lineEntry.line
      ? "OVER"
      : input.projectedValue < input.lineEntry.line
        ? "UNDER"
        : "NEUTRAL";
  const marketSignal = resolveMarketSignal(input.lineEntry);
  const minutesRisk = computeGlobalMinutesRisk({
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
  });
  const lineGap = input.projectedValue - input.lineEntry.line;

  if (Math.abs(lineGap) <= input.nearLineThreshold && marketSignal.marketStrong && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk >= input.highRiskThreshold && marketSignal.favoredSide !== "NEUTRAL") {
    side = marketSignal.favoredSide;
  } else if (minutesRisk <= input.lowRiskThreshold) {
    const projectionSide: SnapshotModelSide =
      input.projectedValue > input.lineEntry.line
        ? "OVER"
        : input.projectedValue < input.lineEntry.line
          ? "UNDER"
          : "NEUTRAL";
    if (projectionSide !== "NEUTRAL") {
      side = projectionSide;
    }
  }

  return side === "NEUTRAL" ? null : side;
}

function applyGlobalPraSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  return applyGlobalComboSideOverride({
    ...input,
    nearLineThreshold: 1.5,
    highRiskThreshold: 0.5,
    lowRiskThreshold: 0.16,
  });
}

function applyGlobalPaSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  return applyGlobalComboSideOverride({
    ...input,
    nearLineThreshold: 1.2,
    highRiskThreshold: 0.46,
    lowRiskThreshold: 0.18,
  });
}

function applyGlobalPrSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  return applyGlobalComboSideOverride({
    ...input,
    nearLineThreshold: 1.2,
    highRiskThreshold: 0.46,
    lowRiskThreshold: 0.18,
  });
}

function applyGlobalRaSideOverride(input: {
  projectedValue: number;
  lineEntry: HistoricalLineEntry | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
}): SnapshotModelSide | null {
  return applyGlobalComboSideOverride({
    ...input,
    nearLineThreshold: 1,
    highRiskThreshold: 0.46,
    lowRiskThreshold: 0.18,
  });
}

function createEmptyMarketErrorStats(): MarketErrorStats {
  return {
    count: 0,
    sumAbsError: 0,
    sumSquaredError: 0,
    sumError: 0,
    within1: 0,
    within2: 0,
    lineCount: 0,
    lineResolvedCount: 0,
    linePushes: 0,
    actualPushes: 0,
    correctSide: 0,
    wrongSide: 0,
    overCalls: 0,
    underCalls: 0,
  };
}

function applyLineOutcomeStats(
  stats: MarketErrorStats,
  projectedValue: number,
  actualValue: number,
  lineValue: number,
  predictedSideOverride?: SnapshotModelSide | null,
): void {
  const predictedSide =
    predictedSideOverride && predictedSideOverride !== "NEUTRAL"
      ? predictedSideOverride
      : sideFromLine(projectedValue, lineValue);
  const actualSide = sideFromLine(actualValue, lineValue);

  stats.lineCount += 1;
  if (predictedSide === "PUSH") {
    stats.linePushes += 1;
  } else if (predictedSide === "OVER") {
    stats.overCalls += 1;
  } else if (predictedSide === "UNDER") {
    stats.underCalls += 1;
  }

  if (actualSide === "PUSH") {
    stats.actualPushes += 1;
  }

  if (predictedSide === "PUSH" || actualSide === "PUSH") {
    return;
  }

  stats.lineResolvedCount += 1;
  if (predictedSide === actualSide) {
    stats.correctSide += 1;
  } else {
    stats.wrongSide += 1;
  }
}

function applyPredictionStats(
  stats: MarketErrorStats,
  projectedValue: number,
  actualValue: number,
  lineValue?: number | null,
  predictedSideOverride?: SnapshotModelSide | null,
): void {
  const error = projectedValue - actualValue;
  const absError = Math.abs(error);
  stats.count += 1;
  stats.sumError += error;
  stats.sumAbsError += absError;
  stats.sumSquaredError += error * error;
  if (absError <= 1) stats.within1 += 1;
  if (absError <= 2) stats.within2 += 1;

  if (lineValue != null && Number.isFinite(lineValue)) {
    applyLineOutcomeStats(stats, projectedValue, actualValue, lineValue, predictedSideOverride);
  }
}

async function loadHistoricalLineMaps(
  lineFile: string | null,
  playerIdByExternalId: Map<string, string>,
  playerIdByNormalizedName: Map<string, string>,
): Promise<HistoricalLineMaps> {
  const byPlayerId = new Map<string, HistoricalLineEntry>();
  if (!lineFile) {
    return { byPlayerId };
  }

  const raw = await readFile(lineFile, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return { byPlayerId };
  }

  const header = lines[0].split(",").map((token) => token.trim());
  const getIndex = (name: string): number => header.findIndex((column) => column.toLowerCase() === name.toLowerCase());
  const dateIndex = getIndex("gameDateEt");
  const marketIndex = getIndex("market");
  const lineIndex = getIndex("line");
  const playerIdIndex = getIndex("playerId");
  const externalIdIndex = getIndex("externalPlayerId");
  const playerNameIndex = getIndex("playerName");
  const overPriceIndex = getIndex("overPrice");
  const underPriceIndex = getIndex("underPrice");

  if (dateIndex < 0 || marketIndex < 0 || lineIndex < 0) {
    throw new Error("Line file must include gameDateEt, market, and line columns.");
  }

  for (const row of lines.slice(1)) {
    const cells = row.split(",").map((token) => token.trim());
    const gameDateEt = cells[dateIndex] ?? "";
    const market = (cells[marketIndex] ?? "").toUpperCase() as SnapshotMarket;
    const lineValue = Number(cells[lineIndex] ?? "");
    if (!gameDateEt || !MARKETS.includes(market) || !Number.isFinite(lineValue)) continue;

    let resolvedPlayerId = playerIdIndex >= 0 ? cells[playerIdIndex] ?? "" : "";
    if (!resolvedPlayerId && externalIdIndex >= 0) {
      resolvedPlayerId = playerIdByExternalId.get(cells[externalIdIndex] ?? "") ?? "";
    }
    if (!resolvedPlayerId && playerNameIndex >= 0) {
      resolvedPlayerId = playerIdByNormalizedName.get(normalizeSearchText(cells[playerNameIndex] ?? "")) ?? "";
    }
    if (!resolvedPlayerId) continue;

    byPlayerId.set(makeLineLookupKey(resolvedPlayerId, gameDateEt, market), {
      line: lineValue,
      overPrice:
        overPriceIndex >= 0 && Number.isFinite(Number(cells[overPriceIndex] ?? ""))
          ? Number(cells[overPriceIndex] ?? "")
          : null,
      underPrice:
        underPriceIndex >= 0 && Number.isFinite(Number(cells[underPriceIndex] ?? ""))
          ? Number(cells[underPriceIndex] ?? "")
          : null,
    });
  }

  return { byPlayerId };
}

function isCompositeMarket(market: SnapshotMarket): boolean {
  return market === "PRA" || market === "PA" || market === "PR" || market === "RA";
}

function positionGroup(position: string | null): "G" | "W" | "B" {
  const normalized = (position ?? "").toUpperCase();
  if (normalized.includes("C")) return "B";
  if (normalized.includes("PG") || normalized.includes("SG") || normalized.includes("G")) return "G";
  if (normalized.includes("SF") || normalized.includes("PF") || normalized.includes("F")) return "W";
  return "W";
}

function usageTierFromHistory(history: HistoryLog[], fallbackPoints: number | null, fallbackMinutes: number | null): "LOW" | "MID" | "HIGH" {
  const recent = history.slice(-10);
  const minutes = recent.map((item) => item.minutes).filter((value) => value > 0);
  const points = recent.map((item) => item.metrics.PTS ?? 0);
  let ptsPer36: number | null = null;
  const minAvg = average(minutes);
  const ptsAvg = average(points);
  if (minAvg != null && minAvg > 0 && ptsAvg != null) {
    ptsPer36 = (ptsAvg / minAvg) * 36;
  } else if (fallbackPoints != null && fallbackMinutes != null && fallbackMinutes > 0) {
    ptsPer36 = (fallbackPoints / fallbackMinutes) * 36;
  }
  if (ptsPer36 == null) return "MID";
  if (ptsPer36 < 18) return "LOW";
  if (ptsPer36 <= 26) return "MID";
  return "HIGH";
}

function archetypeKey(position: string | null, history: HistoryLog[], fallbackPoints: number | null, fallbackMinutes: number | null): string {
  return `${positionGroup(position)}_${usageTierFromHistory(history, fallbackPoints, fallbackMinutes)}`;
}

function parseArgs(): Args {
  const todayEt = getTodayEtDateString();
  const defaultSeason = inferSeasonFromEtDate(todayEt);
  const raw = process.argv.slice(2);

  let season = defaultSeason;
  let from = `${defaultSeason}-10-01`;
  let to = todayEt;
  let out = path.join("exports", `projection-backtest-${defaultSeason}-${from}-to-${to}.json`);
  let lineFile: string | null = null;
  let minActualMinutes = 15;
  let minHistoryMinutesAvg = 0;
  let mode: Args["mode"] = "model";
  let opponentWindow = 20;
  let playerBiasWeight = 0;
  let playerBiasWindow = 24;
  let globalBiasWeight = 0;
  let globalBiasMinSamples = 60;
  let playerLinearWeight = 0;
  let playerLinearWindow = 28;
  let marketBiasWeight = 0;
  let marketBiasMinSamples = 120;
  let restWeight = 0;
  let restMinSamples = 6;
  let quantileClampWeight = 0;
  let quantileClampMinSamples = 20;
  let hybridPlayerMinutesThreshold = 15;
  let hybridPlayerMinSamples = 24;
  let hybridLearningRate = 0.02;
  let hybridL2 = 0.002;
  let hybridPlayerBlend = 0.7;
  let hybridGlobalBlend = 0.6;
  let compositeFromCore = false;
  let medianBlendWeight = 0;
  let medianBlendTake = 26;
  let ptsBadGameWeight = 0;
  let ptsBadGamePlayerMinSamples = 4;
  let ptsBadGameGlobalMinSamples = 50;
  let ptsBadGameCap = 3.5;
  let ptsBadGameThresholdPts = 4;
  let ptsBadGameThresholdPct = 0.2;
  let ptsPpmBlendWeight = 0;
  let ptsPpmBandWidth = 4;
  let ptsPpmMinSamples = 6;
  let ptsPpmTake = 24;
  let ptsMinutesRecoveryWeight = 0;
  let ptsMinutesRecoveryCap = 2.5;
  let ptsMinutesRecoveryMinDeficit = 4;
  let ptsVolatilityDampenWeight = 0;
  let ptsVolatilityDampenThreshold = 8;
  let ptsTrendReversionWeight = 0;
  let ptsTrendReversionCap = 2.5;
  let ptsGlobalLinearWeight = 0;
  let ptsGlobalLinearWindow = 900;
  let ptsSideOverrideEnabled = true;
  let rebSideOverrideEnabled = true;
  let astSideOverrideEnabled = true;
  let threesSideOverrideEnabled = true;
  let praSideOverrideEnabled = true;
  let paSideOverrideEnabled = true;
  let prSideOverrideEnabled = true;
  let raSideOverrideEnabled = true;
  let emitPlayerRows = false;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];

    if ((token === "--season" || token === "-s") && next) {
      season = next;
      from = `${season}-10-01`;
      out = path.join("exports", `projection-backtest-${season}-${from}-to-${to}.json`);
      i += 1;
      continue;
    }
    if (token.startsWith("--season=")) {
      season = token.slice("--season=".length);
      from = `${season}-10-01`;
      out = path.join("exports", `projection-backtest-${season}-${from}-to-${to}.json`);
      continue;
    }

    if (token === "--from" && next) {
      from = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }

    if (token === "--to" && next) {
      to = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }

    if ((token === "--out" || token === "-o") && next) {
      out = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }

    if (token === "--line-file" && next) {
      lineFile = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--line-file=")) {
      lineFile = token.slice("--line-file=".length);
      continue;
    }

    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        minActualMinutes = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        minActualMinutes = parsed;
      }
      continue;
    }

    if (token === "--mode" && next) {
      if (
        next === "model" ||
        next === "mean10" ||
        next === "median10" ||
        next === "season" ||
        next === "player_conditional_median" ||
        next === "player_hybrid"
      ) {
        mode = next;
      }
      i += 1;
      continue;
    }
    if (token === "--disable-pts-side-override") {
      ptsSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-reb-side-override") {
      rebSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-ast-side-override") {
      astSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-threes-side-override") {
      threesSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-pra-side-override") {
      praSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-pa-side-override") {
      paSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-pr-side-override") {
      prSideOverrideEnabled = false;
      continue;
    }
    if (token === "--disable-ra-side-override") {
      raSideOverrideEnabled = false;
      continue;
    }
    if (token === "--emit-player-rows") {
      emitPlayerRows = true;
      continue;
    }
    if (token.startsWith("--mode=")) {
      const parsed = token.slice("--mode=".length);
      if (
        parsed === "model" ||
        parsed === "mean10" ||
        parsed === "median10" ||
        parsed === "season" ||
        parsed === "player_conditional_median" ||
        parsed === "player_hybrid"
      ) {
        mode = parsed;
      }
      continue;
    }

    if (token === "--min-history-minutes-avg" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        minHistoryMinutesAvg = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--min-history-minutes-avg=")) {
      const parsed = Number(token.slice("--min-history-minutes-avg=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        minHistoryMinutesAvg = parsed;
      }
      continue;
    }

    if (token === "--opponent-window" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 4) {
        opponentWindow = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--opponent-window=")) {
      const parsed = Number(token.slice("--opponent-window=".length));
      if (Number.isFinite(parsed) && parsed >= 4) {
        opponentWindow = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--player-bias-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        playerBiasWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--player-bias-weight=")) {
      const parsed = Number(token.slice("--player-bias-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        playerBiasWeight = parsed;
      }
      continue;
    }

    if (token === "--player-bias-window" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 6) {
        playerBiasWindow = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--player-bias-window=")) {
      const parsed = Number(token.slice("--player-bias-window=".length));
      if (Number.isFinite(parsed) && parsed >= 6) {
        playerBiasWindow = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--global-bias-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        globalBiasWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--global-bias-weight=")) {
      const parsed = Number(token.slice("--global-bias-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        globalBiasWeight = parsed;
      }
      continue;
    }

    if (token === "--global-bias-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) {
        globalBiasMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--global-bias-min-samples=")) {
      const parsed = Number(token.slice("--global-bias-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) {
        globalBiasMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--player-linear-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        playerLinearWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--player-linear-weight=")) {
      const parsed = Number(token.slice("--player-linear-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        playerLinearWeight = parsed;
      }
      continue;
    }

    if (token === "--player-linear-window" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 8) {
        playerLinearWindow = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--player-linear-window=")) {
      const parsed = Number(token.slice("--player-linear-window=".length));
      if (Number.isFinite(parsed) && parsed >= 8) {
        playerLinearWindow = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--market-bias-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        marketBiasWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--market-bias-weight=")) {
      const parsed = Number(token.slice("--market-bias-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        marketBiasWeight = parsed;
      }
      continue;
    }

    if (token === "--market-bias-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 20) {
        marketBiasMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--market-bias-min-samples=")) {
      const parsed = Number(token.slice("--market-bias-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 20) {
        marketBiasMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--rest-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        restWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--rest-weight=")) {
      const parsed = Number(token.slice("--rest-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        restWeight = parsed;
      }
      continue;
    }

    if (token === "--rest-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 2) {
        restMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--rest-min-samples=")) {
      const parsed = Number(token.slice("--rest-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 2) {
        restMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--quantile-clamp-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        quantileClampWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--quantile-clamp-weight=")) {
      const parsed = Number(token.slice("--quantile-clamp-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        quantileClampWeight = parsed;
      }
      continue;
    }

    if (token === "--quantile-clamp-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 6) {
        quantileClampMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--quantile-clamp-min-samples=")) {
      const parsed = Number(token.slice("--quantile-clamp-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 6) {
        quantileClampMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--hybrid-player-minutes-threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridPlayerMinutesThreshold = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-player-minutes-threshold=")) {
      const parsed = Number(token.slice("--hybrid-player-minutes-threshold=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridPlayerMinutesThreshold = parsed;
      }
      continue;
    }

    if (token === "--hybrid-player-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) {
        hybridPlayerMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-player-min-samples=")) {
      const parsed = Number(token.slice("--hybrid-player-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) {
        hybridPlayerMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--hybrid-learning-rate" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        hybridLearningRate = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-learning-rate=")) {
      const parsed = Number(token.slice("--hybrid-learning-rate=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        hybridLearningRate = parsed;
      }
      continue;
    }

    if (token === "--hybrid-l2" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridL2 = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-l2=")) {
      const parsed = Number(token.slice("--hybrid-l2=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridL2 = parsed;
      }
      continue;
    }

    if (token === "--hybrid-player-blend" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridPlayerBlend = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-player-blend=")) {
      const parsed = Number(token.slice("--hybrid-player-blend=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridPlayerBlend = parsed;
      }
      continue;
    }

    if (token === "--hybrid-global-blend" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridGlobalBlend = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--hybrid-global-blend=")) {
      const parsed = Number(token.slice("--hybrid-global-blend=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        hybridGlobalBlend = parsed;
      }
      continue;
    }

    if (token === "--composite-from-core") {
      compositeFromCore = true;
      continue;
    }
    if (token === "--no-composite-from-core") {
      compositeFromCore = false;
      continue;
    }

    if (token === "--median-blend-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        medianBlendWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--median-blend-weight=")) {
      const parsed = Number(token.slice("--median-blend-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        medianBlendWeight = parsed;
      }
      continue;
    }

    if (token === "--median-blend-take" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 4) {
        medianBlendTake = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--median-blend-take=")) {
      const parsed = Number(token.slice("--median-blend-take=".length));
      if (Number.isFinite(parsed) && parsed >= 4) {
        medianBlendTake = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--pts-bad-game-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-weight=")) {
      const parsed = Number(token.slice("--pts-bad-game-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-bad-game-player-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsBadGamePlayerMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-player-min-samples=")) {
      const parsed = Number(token.slice("--pts-bad-game-player-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsBadGamePlayerMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--pts-bad-game-global-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsBadGameGlobalMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-global-min-samples=")) {
      const parsed = Number(token.slice("--pts-bad-game-global-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsBadGameGlobalMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--pts-bad-game-cap" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameCap = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-cap=")) {
      const parsed = Number(token.slice("--pts-bad-game-cap=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameCap = parsed;
      }
      continue;
    }

    if (token === "--pts-bad-game-threshold-pts" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameThresholdPts = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-threshold-pts=")) {
      const parsed = Number(token.slice("--pts-bad-game-threshold-pts=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameThresholdPts = parsed;
      }
      continue;
    }

    if (token === "--pts-bad-game-threshold-pct" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameThresholdPct = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-bad-game-threshold-pct=")) {
      const parsed = Number(token.slice("--pts-bad-game-threshold-pct=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsBadGameThresholdPct = parsed;
      }
      continue;
    }

    if (token === "--pts-ppm-blend-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsPpmBlendWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-ppm-blend-weight=")) {
      const parsed = Number(token.slice("--pts-ppm-blend-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsPpmBlendWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-ppm-band-width" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsPpmBandWidth = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-ppm-band-width=")) {
      const parsed = Number(token.slice("--pts-ppm-band-width=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsPpmBandWidth = parsed;
      }
      continue;
    }

    if (token === "--pts-ppm-min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsPpmMinSamples = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-ppm-min-samples=")) {
      const parsed = Number(token.slice("--pts-ppm-min-samples=".length));
      if (Number.isFinite(parsed) && parsed >= 1) {
        ptsPpmMinSamples = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--pts-ppm-take" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 4) {
        ptsPpmTake = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-ppm-take=")) {
      const parsed = Number(token.slice("--pts-ppm-take=".length));
      if (Number.isFinite(parsed) && parsed >= 4) {
        ptsPpmTake = Math.floor(parsed);
      }
      continue;
    }

    if (token === "--pts-minutes-recovery-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-minutes-recovery-weight=")) {
      const parsed = Number(token.slice("--pts-minutes-recovery-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-minutes-recovery-cap" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryCap = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-minutes-recovery-cap=")) {
      const parsed = Number(token.slice("--pts-minutes-recovery-cap=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryCap = parsed;
      }
      continue;
    }

    if (token === "--pts-minutes-recovery-min-deficit" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryMinDeficit = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-minutes-recovery-min-deficit=")) {
      const parsed = Number(token.slice("--pts-minutes-recovery-min-deficit=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsMinutesRecoveryMinDeficit = parsed;
      }
      continue;
    }

    if (token === "--pts-volatility-dampen-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsVolatilityDampenWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-volatility-dampen-weight=")) {
      const parsed = Number(token.slice("--pts-volatility-dampen-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsVolatilityDampenWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-volatility-dampen-threshold" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsVolatilityDampenThreshold = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-volatility-dampen-threshold=")) {
      const parsed = Number(token.slice("--pts-volatility-dampen-threshold=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsVolatilityDampenThreshold = parsed;
      }
      continue;
    }

    if (token === "--pts-trend-reversion-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) {
        ptsTrendReversionWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-trend-reversion-weight=")) {
      const parsed = Number(token.slice("--pts-trend-reversion-weight=".length));
      if (Number.isFinite(parsed)) {
        ptsTrendReversionWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-trend-reversion-cap" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsTrendReversionCap = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-trend-reversion-cap=")) {
      const parsed = Number(token.slice("--pts-trend-reversion-cap=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsTrendReversionCap = parsed;
      }
      continue;
    }

    if (token === "--pts-global-linear-weight" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsGlobalLinearWeight = parsed;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-global-linear-weight=")) {
      const parsed = Number(token.slice("--pts-global-linear-weight=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        ptsGlobalLinearWeight = parsed;
      }
      continue;
    }

    if (token === "--pts-global-linear-window" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 12) {
        ptsGlobalLinearWindow = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--pts-global-linear-window=")) {
      const parsed = Number(token.slice("--pts-global-linear-window=".length));
      if (Number.isFinite(parsed) && parsed >= 12) {
        ptsGlobalLinearWindow = Math.floor(parsed);
      }
      continue;
    }
  }

  return {
    season,
    from,
    to,
    out,
    lineFile,
    minActualMinutes,
    minHistoryMinutesAvg,
    mode,
    opponentWindow,
    playerBiasWeight,
    playerBiasWindow,
    globalBiasWeight,
    globalBiasMinSamples,
    playerLinearWeight,
    playerLinearWindow,
    marketBiasWeight,
    marketBiasMinSamples,
    restWeight,
    restMinSamples,
    quantileClampWeight,
    quantileClampMinSamples,
    hybridPlayerMinutesThreshold,
    hybridPlayerMinSamples,
    hybridLearningRate,
    hybridL2,
    hybridPlayerBlend,
    hybridGlobalBlend,
    compositeFromCore,
    medianBlendWeight,
    medianBlendTake,
    ptsBadGameWeight,
    ptsBadGamePlayerMinSamples,
    ptsBadGameGlobalMinSamples,
    ptsBadGameCap,
    ptsBadGameThresholdPts,
    ptsBadGameThresholdPct,
    ptsPpmBlendWeight,
    ptsPpmBandWidth,
    ptsPpmMinSamples,
    ptsPpmTake,
    ptsMinutesRecoveryWeight,
    ptsMinutesRecoveryCap,
    ptsMinutesRecoveryMinDeficit,
    ptsVolatilityDampenWeight,
    ptsVolatilityDampenThreshold,
    ptsTrendReversionWeight,
    ptsTrendReversionCap,
    ptsGlobalLinearWeight,
    ptsGlobalLinearWindow,
    ptsSideOverrideEnabled,
    rebSideOverrideEnabled,
    astSideOverrideEnabled,
    threesSideOverrideEnabled,
    praSideOverrideEnabled,
    paSideOverrideEnabled,
    prSideOverrideEnabled,
    raSideOverrideEnabled,
    emitPlayerRows,
  };
}

function isEtDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function restTier(days: number | null): 0 | 1 | 2 {
  if (days == null || days <= 1) return 0;
  if (days === 2) return 1;
  return 2;
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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function blendNumber(base: number | null, overlay: number | null, weight: number): number | null {
  if (base == null && overlay == null) return null;
  if (base == null) return overlay;
  if (overlay == null) return base;
  const w = clamp(weight, 0, 1);
  return round(base * (1 - w) + overlay * w, 2);
}

function blendMetricRecords(
  base: SnapshotMetricRecord,
  overlay: SnapshotMetricRecord,
  weight: number,
): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = blendNumber(base[market], overlay[market], weight);
  });
  return result;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round((sorted[mid - 1] + sorted[mid]) / 2, 2);
  }
  return round(sorted[mid], 2);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return round(sorted[low], 2);
  const weight = rank - low;
  return round(sorted[low] * (1 - weight) + sorted[high] * weight, 2);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
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

function marketValueFromHistory(log: HistoryLog, market: SnapshotMarket): number {
  return log.metrics[market] ?? 0;
}

function averagesByMarket(logs: HistoryLog[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = average(logs.map((log) => marketValueFromHistory(log, market)));
  });
  return result;
}

function createRollingAgg(): RollingAgg {
  return {
    count: 0,
    window: null,
    queue: [],
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

function createRollingWindowAgg(window: number): RollingAgg {
  const agg = createRollingAgg();
  agg.window = window;
  return agg;
}

function addToRollingAgg(agg: RollingAgg, metrics: SnapshotMetricRecord): void {
  agg.count += 1;
  agg.queue.push(metrics);
  MARKETS.forEach((market) => {
    agg.sums[market] += metrics[market] ?? 0;
  });

  if (agg.window != null && agg.queue.length > agg.window) {
    const removed = agg.queue.shift();
    if (removed) {
      agg.count -= 1;
      MARKETS.forEach((market) => {
        agg.sums[market] -= removed[market] ?? 0;
      });
    }
  }
}

function averageFromAgg(agg: RollingAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) return blankMetricRecord();
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

function arraysByMarket(logs: HistoryLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.metrics.PTS ?? 0),
    REB: logs.map((log) => log.metrics.REB ?? 0),
    AST: logs.map((log) => log.metrics.AST ?? 0),
    THREES: logs.map((log) => log.metrics.THREES ?? 0),
    PRA: logs.map((log) => log.metrics.PRA ?? 0),
    PA: logs.map((log) => log.metrics.PA ?? 0),
    PR: logs.map((log) => log.metrics.PR ?? 0),
    RA: logs.map((log) => log.metrics.RA ?? 0),
  };
}

function projectedFromBaseline(
  mode: Args["mode"],
  last10Average: SnapshotMetricRecord,
  seasonAverage: SnapshotMetricRecord,
  last10ByMarket: Record<SnapshotMarket, number[]>,
): SnapshotMetricRecord {
  const base = blankMetricRecord();
  const coreMarkets: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];
  coreMarkets.forEach((market) => {
    if (mode === "season") {
      base[market] = seasonAverage[market];
      return;
    }
    if (mode === "median10") {
      base[market] = median(last10ByMarket[market]);
      return;
    }
    base[market] = last10Average[market];
  });

  const points = base.PTS;
  const rebounds = base.REB;
  const assists = base.AST;
  base.PRA = points == null || rebounds == null || assists == null ? null : round(points + rebounds + assists, 2);
  base.PA = points == null || assists == null ? null : round(points + assists, 2);
  base.PR = points == null || rebounds == null ? null : round(points + rebounds, 2);
  base.RA = rebounds == null || assists == null ? null : round(rebounds + assists, 2);
  return base;
}

function toRecentFirst(logs: HistoryLog[]): HistoryLog[] {
  return logs.slice().reverse();
}

function conditionalMedianFromHistory(
  history: HistoryLog[],
  expectedMinutes: number,
  market: SnapshotMarket,
  take: number,
): number | null {
  if (history.length === 0) return null;
  const ranked = history
    .map((log, index) => {
      const minutesDiff = Math.abs((log.minutes ?? 0) - expectedMinutes);
      const recencyPenalty = index * 0.05;
      return {
        value: log.metrics[market],
        score: minutesDiff + recencyPenalty,
      };
    })
    .filter((item) => item.value != null)
    .sort((a, b) => a.score - b.score)
    .slice(0, take)
    .map((item) => item.value as number);
  return median(ranked);
}

function projectedFromPlayerConditionalMedian(
  history: HistoryLog[],
  minutesLast10Avg: number | null,
  minutesLast3Avg: number | null,
): SnapshotMetricRecord {
  const result = blankMetricRecord();
  const expectedMinutes = minutesLast10Avg ?? minutesLast3Avg ?? average(history.map((item) => item.minutes)) ?? 0;
  const coreMarkets: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];
  coreMarkets.forEach((market) => {
    result[market] = conditionalMedianFromHistory(history, expectedMinutes, market, 26);
  });

  const pra = conditionalMedianFromHistory(history, expectedMinutes, "PRA", 26);
  const pa = conditionalMedianFromHistory(history, expectedMinutes, "PA", 26);
  const pr = conditionalMedianFromHistory(history, expectedMinutes, "PR", 26);
  const ra = conditionalMedianFromHistory(history, expectedMinutes, "RA", 26);
  result.PRA = pra;
  result.PA = pa;
  result.PR = pr;
  result.RA = ra;

  return result;
}

type PtsPpmEstimate = {
  pointsProjection: number | null;
  ppm: number | null;
  sampleCount: number;
  q15: number | null;
  q85: number | null;
};

function estimatePtsFromPpmHistory(
  history: HistoryLog[],
  expectedMinutes: number,
  bandWidth: number,
  minSamples: number,
  take: number,
): PtsPpmEstimate {
  if (history.length === 0 || expectedMinutes <= 0) {
    return { pointsProjection: null, ppm: null, sampleCount: 0, q15: null, q85: null };
  }
  const candidates = history
    .map((log, index) => {
      const pts = log.metrics.PTS;
      if (pts == null || log.minutes <= 0) return null;
      const ppm = pts / log.minutes;
      if (!Number.isFinite(ppm) || ppm < 0) return null;
      const minutesDiff = Math.abs(log.minutes - expectedMinutes);
      const recencyPenalty = index * 0.06;
      return {
        points: pts,
        ppm,
        score: minutesDiff + recencyPenalty,
        inBand: minutesDiff <= bandWidth,
      };
    })
    .filter((item): item is { points: number; ppm: number; score: number; inBand: boolean } => item != null)
    .sort((a, b) => a.score - b.score);

  if (candidates.length === 0) {
    return { pointsProjection: null, ppm: null, sampleCount: 0, q15: null, q85: null };
  }

  let selected = candidates.filter((item) => item.inBand);
  if (selected.length < minSamples) {
    selected = candidates.slice(0, Math.max(minSamples, take));
  } else if (selected.length > take) {
    selected = selected.slice(0, take);
  }
  if (selected.length === 0) {
    return { pointsProjection: null, ppm: null, sampleCount: 0, q15: null, q85: null };
  }

  const ppmMedian = median(selected.map((item) => item.ppm));
  const pointsFromPpm = ppmMedian == null ? null : round(Math.max(0, ppmMedian * expectedMinutes), 2);
  const pointsValues = selected.map((item) => item.points);
  const q15 = percentile(pointsValues, 0.15);
  const q85 = percentile(pointsValues, 0.85);
  const pointsMedian = median(pointsValues);
  const blendedProjection =
    pointsFromPpm == null && pointsMedian == null
      ? null
      : pointsFromPpm == null
        ? pointsMedian
        : pointsMedian == null
          ? pointsFromPpm
          : round(pointsFromPpm * 0.65 + pointsMedian * 0.35, 2);

  return {
    pointsProjection: blendedProjection,
    ppm: ppmMedian,
    sampleCount: selected.length,
    q15,
    q85,
  };
}

function ptsMinutesRecoveryBoost(
  history: HistoryLog[],
  expectedMinutes: number,
  ppm: number | null,
  weight: number,
  cap: number,
  minDeficit: number,
): number {
  if (weight <= 0 || history.length === 0 || expectedMinutes <= 0 || minDeficit <= 0) return 0;
  const last = history[history.length - 1];
  const minutesDeficit = Math.max(0, expectedMinutes - last.minutes);
  if (minutesDeficit < minDeficit) return 0;
  const safePpm = ppm ?? ((last.metrics.PTS ?? 0) / Math.max(1, last.minutes));
  const baseBoost = minutesDeficit * Math.max(0, safePpm) * weight;
  return clamp(baseBoost, -Math.max(0, cap), Math.max(0, cap));
}

function restAdjustedPrediction(
  market: SnapshotMarket,
  history: HistoryLog[],
  currentRestDays: number | null,
  predicted: number,
  restWeight: number,
  restMinSamples: number,
): number {
  if (restWeight <= 0 || history.length < restMinSamples) return predicted;
  const tier = restTier(currentRestDays);
  const tierValues = history
    .filter((item) => restTier(item.restDaysBefore) === tier)
    .map((item) => item.metrics[market])
    .filter((value): value is number => value != null);
  if (tierValues.length < restMinSamples) return predicted;
  const tierAvg = average(tierValues);
  const seasonAvg = average(
    history.map((item) => item.metrics[market]).filter((value): value is number => value != null),
  );
  if (tierAvg == null || seasonAvg == null) return predicted;
  const delta = tierAvg - seasonAvg;
  const adjustment = Math.max(
    -residualCapForMarket(market),
    Math.min(residualCapForMarket(market), delta * Math.max(0, restWeight)),
  );
  return round(Math.max(0, predicted + adjustment), 2);
}

function quantileClampedPrediction(
  market: SnapshotMarket,
  history: HistoryLog[],
  predicted: number,
  weight: number,
  minSamples: number,
): number {
  if (weight <= 0) return predicted;
  const values = history
    .map((item) => item.metrics[market])
    .filter((value): value is number => value != null);
  if (values.length < minSamples) return predicted;
  const qLow = percentile(values, 0.15);
  const qHigh = percentile(values, 0.85);
  if (qLow == null || qHigh == null) return predicted;
  const clamped = Math.max(qLow, Math.min(qHigh, predicted));
  const blendWeight = Math.max(0, Math.min(1, weight));
  return round(predicted * (1 - blendWeight) + clamped * blendWeight, 2);
}

type PlayerResidualSeries = Record<SnapshotMarket, number[]>;

type LinearPair = { x: number; y: number };
type LinearSeries = {
  sumX: number;
  sumY: number;
  sumXX: number;
  sumXY: number;
  points: LinearPair[];
};
type PlayerLinearSeries = Record<SnapshotMarket, LinearSeries>;

function createPlayerResidualSeries(): PlayerResidualSeries {
  return {
    PTS: [],
    REB: [],
    AST: [],
    THREES: [],
    PRA: [],
    PA: [],
    PR: [],
    RA: [],
  };
}

function createLinearSeries(): LinearSeries {
  return {
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumXY: 0,
    points: [],
  };
}

function createPlayerLinearSeries(): PlayerLinearSeries {
  return {
    PTS: createLinearSeries(),
    REB: createLinearSeries(),
    AST: createLinearSeries(),
    THREES: createLinearSeries(),
    PRA: createLinearSeries(),
    PA: createLinearSeries(),
    PR: createLinearSeries(),
    RA: createLinearSeries(),
  };
}

function addLinearPoint(series: LinearSeries, point: LinearPair, window: number): void {
  series.points.push(point);
  series.sumX += point.x;
  series.sumY += point.y;
  series.sumXX += point.x * point.x;
  series.sumXY += point.x * point.y;
  if (series.points.length > window) {
    const removed = series.points.shift();
    if (removed) {
      series.sumX -= removed.x;
      series.sumY -= removed.y;
      series.sumXX -= removed.x * removed.x;
      series.sumXY -= removed.x * removed.y;
    }
  }
}

function regressionAdjustedPrediction(
  market: SnapshotMarket,
  predicted: number,
  series: LinearSeries,
  baseWeight: number,
): number {
  const n = series.points.length;
  if (n < 8 || baseWeight <= 0) return predicted;
  const denom = series.sumXX - (series.sumX * series.sumX) / n;
  const ridge = 1.2;
  const slopeRaw = (series.sumXY - (series.sumX * series.sumY) / n) / Math.max(0.001, denom + ridge);
  const slope = Math.max(0.55, Math.min(1.45, slopeRaw));
  const meanX = series.sumX / n;
  const meanY = series.sumY / n;
  const interceptRaw = meanY - slope * meanX;
  const interceptCap = residualCapForMarket(market);
  const intercept = Math.max(-interceptCap, Math.min(interceptCap, interceptRaw));
  const linearPrediction = Math.max(0, intercept + slope * predicted);
  const confidence = Math.max(0, Math.min(1, (n - 6) / 20));
  const weight = Math.max(0, Math.min(1, baseWeight * confidence));
  return round(predicted * (1 - weight) + linearPrediction * weight, 2);
}

function residualCapForMarket(market: SnapshotMarket): number {
  switch (market) {
    case "PTS":
      return 2.6;
    case "PRA":
      return 3.8;
    case "PA":
      return 3.2;
    case "PR":
      return 3.4;
    case "RA":
      return 2.1;
    case "REB":
      return 1.4;
    case "AST":
      return 1.3;
    case "THREES":
      return 0.8;
    default:
      return 2;
  }
}

function residualWeightScaleForMarket(market: SnapshotMarket): number {
  switch (market) {
    case "PRA":
      return 1.75;
    case "PA":
      return 1.6;
    case "PR":
      return 1.65;
    case "RA":
      return 1.35;
    case "PTS":
      return 1.15;
    case "THREES":
      return 0.85;
    default:
      return 1;
  }
}

function biasBinSizeForMarket(market: SnapshotMarket): number {
  switch (market) {
    case "THREES":
      return 0.5;
    case "REB":
    case "AST":
      return 1;
    case "PTS":
    case "RA":
      return 2;
    case "PA":
    case "PR":
      return 2;
    case "PRA":
      return 3;
    default:
      return 1;
  }
}

function projectBinKey(value: number, binSize: number): number {
  return Math.floor(value / Math.max(0.1, binSize));
}

type GlobalResidualByBin = Record<SnapshotMarket, Map<number, number[]>>;

function createGlobalResidualByBin(): GlobalResidualByBin {
  return {
    PTS: new Map<number, number[]>(),
    REB: new Map<number, number[]>(),
    AST: new Map<number, number[]>(),
    THREES: new Map<number, number[]>(),
    PRA: new Map<number, number[]>(),
    PA: new Map<number, number[]>(),
    PR: new Map<number, number[]>(),
    RA: new Map<number, number[]>(),
  };
}

type MarketResidualSeries = Record<SnapshotMarket, number[]>;

function createMarketResidualSeries(): MarketResidualSeries {
  return {
    PTS: [],
    REB: [],
    AST: [],
    THREES: [],
    PRA: [],
    PA: [],
    PR: [],
    RA: [],
  };
}

type HybridModel = {
  weights: number[];
  samples: number;
};

type HybridModelSet = Record<SnapshotMarket, HybridModel>;

type HybridPendingUpdate = {
  playerId: string;
  market: SnapshotMarket;
  features: number[];
  targetNormalized: number;
  playerEligible: boolean;
};

function marketScale(market: SnapshotMarket): number {
  switch (market) {
    case "PTS":
      return 30;
    case "REB":
      return 10;
    case "AST":
      return 9;
    case "THREES":
      return 3;
    case "PRA":
      return 42;
    case "PA":
      return 34;
    case "PR":
      return 36;
    case "RA":
      return 18;
    default:
      return 20;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createHybridModel(featureCount: number): HybridModel {
  return {
    weights: Array.from({ length: featureCount }, (_, index) => (index === 0 ? 0.05 : 0)),
    samples: 0,
  };
}

function createHybridModelSet(featureCount: number): HybridModelSet {
  return {
    PTS: createHybridModel(featureCount),
    REB: createHybridModel(featureCount),
    AST: createHybridModel(featureCount),
    THREES: createHybridModel(featureCount),
    PRA: createHybridModel(featureCount),
    PA: createHybridModel(featureCount),
    PR: createHybridModel(featureCount),
    RA: createHybridModel(featureCount),
  };
}

function predictHybridModel(model: HybridModel, features: number[]): number {
  const count = Math.min(model.weights.length, features.length);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += model.weights[i] * features[i];
  }
  return total;
}

function updateHybridModel(model: HybridModel, features: number[], target: number, learningRate: number, l2: number): void {
  const prediction = predictHybridModel(model, features);
  const error = prediction - target;
  const count = Math.min(model.weights.length, features.length);
  for (let i = 0; i < count; i += 1) {
    const gradient = error * features[i] + l2 * model.weights[i];
    model.weights[i] -= learningRate * gradient;
  }
  model.samples += 1;
}

function buildHybridFeatures(params: {
  market: SnapshotMarket;
  basePrediction: number;
  last3Average: number | null;
  last10Average: number | null;
  seasonAverage: number | null;
  homeAwayAverage: number | null;
  opponentDelta: number | null;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesSeasonAvg: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  isHome: boolean | null;
  restDays: number | null;
  historyGames: number;
}): number[] {
  const scale = marketScale(params.market);
  const base = params.basePrediction;
  const last10 = params.last10Average ?? base;
  const season = params.seasonAverage ?? last10;
  const last3 = params.last3Average ?? last10;
  const homeAway = params.homeAwayAverage ?? last10;
  const minutesSeason = params.minutesSeasonAvg ?? params.minutesLast10Avg ?? 0;
  const minutesLast10 = params.minutesLast10Avg ?? minutesSeason;
  const minutesLast3 = params.minutesLast3Avg ?? minutesLast10;
  const rest = params.restDays == null ? 0.33 : clamp(params.restDays / 4, 0, 1);

  return [
    1,
    clamp(base / scale, 0, 3),
    clamp(last3 / scale, 0, 3),
    clamp(last10 / scale, 0, 3),
    clamp(season / scale, 0, 3),
    clamp(homeAway / scale, 0, 3),
    clamp((params.opponentDelta ?? 0) / scale, -1.5, 1.5),
    clamp(minutesLast3 / 36, 0, 1.5),
    clamp(minutesLast10 / 36, 0, 1.5),
    clamp(minutesSeason / 36, 0, 1.5),
    clamp((params.minutesVolatility ?? 0) / 10, 0, 1.5),
    clamp(params.starterRateLast10 ?? 0.5, 0, 1),
    params.isHome ? 1 : 0,
    rest,
    clamp(params.historyGames / 40, 0, 1.5),
  ];
}

function getOrCreatePlayerHybridModelSet(
  modelByPlayerId: Map<string, HybridModelSet>,
  playerId: string,
  featureCount: number,
): HybridModelSet {
  const existing = modelByPlayerId.get(playerId);
  if (existing) return existing;
  const created = createHybridModelSet(featureCount);
  modelByPlayerId.set(playerId, created);
  return created;
}

type BadGameSeverity = "MINOR" | "MODERATE" | "SEVERE";

type BadGameContext = {
  isBad: boolean;
  severity: BadGameSeverity | null;
  deficitPts: number;
  deficitPct: number;
  baselinePts: number | null;
  lastGamePts: number | null;
};

type PtsBadGameBuckets = {
  playerResidualByKey: Map<string, number[]>;
  globalResidualBySeverity: Record<BadGameSeverity, number[]>;
  playerOutcomeByKey: Map<string, number[]>;
  globalOutcomeBySeverity: Record<BadGameSeverity, number[]>;
};

function createPtsBadGameBuckets(): PtsBadGameBuckets {
  return {
    playerResidualByKey: new Map<string, number[]>(),
    globalResidualBySeverity: {
      MINOR: [],
      MODERATE: [],
      SEVERE: [],
    },
    playerOutcomeByKey: new Map<string, number[]>(),
    globalOutcomeBySeverity: {
      MINOR: [],
      MODERATE: [],
      SEVERE: [],
    },
  };
}

function ptsBadGamePlayerKey(playerId: string, severity: BadGameSeverity): string {
  return `${playerId}|${severity}`;
}

function detectPtsBadGameContext(
  history: HistoryLog[],
  thresholdPts: number,
  thresholdPct: number,
): BadGameContext {
  if (history.length < 2) {
    return {
      isBad: false,
      severity: null,
      deficitPts: 0,
      deficitPct: 0,
      baselinePts: null,
      lastGamePts: history.length === 1 ? history[0].metrics.PTS ?? null : null,
    };
  }
  const last = history[history.length - 1];
  const lastPts = last.metrics.PTS;
  if (lastPts == null) {
    return {
      isBad: false,
      severity: null,
      deficitPts: 0,
      deficitPct: 0,
      baselinePts: null,
      lastGamePts: null,
    };
  }
  const preLastWindow = history
    .slice(Math.max(0, history.length - 11), history.length - 1)
    .map((item) => item.metrics.PTS)
    .filter((value): value is number => value != null);
  const baseline = average(preLastWindow);
  if (baseline == null) {
    return {
      isBad: false,
      severity: null,
      deficitPts: 0,
      deficitPct: 0,
      baselinePts: null,
      lastGamePts: lastPts,
    };
  }
  const deficitPts = Math.max(0, baseline - lastPts);
  const deficitPct = baseline > 0 ? deficitPts / baseline : 0;
  const badCut = Math.max(0, Math.max(thresholdPts, baseline * thresholdPct));
  if (deficitPts < badCut) {
    return {
      isBad: false,
      severity: null,
      deficitPts,
      deficitPct,
      baselinePts: baseline,
      lastGamePts: lastPts,
    };
  }
  const severity: BadGameSeverity =
    deficitPts >= badCut * 2 || deficitPct >= 0.45
      ? "SEVERE"
      : deficitPts >= badCut * 1.4 || deficitPct >= 0.3
        ? "MODERATE"
        : "MINOR";
  return {
    isBad: true,
    severity,
    deficitPts,
    deficitPct,
    baselinePts: baseline,
    lastGamePts: lastPts,
  };
}

function pushBounded(values: number[], value: number, maxSize: number): void {
  values.push(value);
  if (values.length > maxSize) {
    values.shift();
  }
}

function inferLineupStarter(history: HistoryLog[]): { lineupStarter: boolean | null; starterRateLast10: number | null } {
  if (history.length === 0) {
    return { lineupStarter: null, starterRateLast10: null };
  }
  const recent10 = history.slice(-10);
  const knownStarter = recent10.filter((item) => item.starter != null);
  const starts = knownStarter.reduce((count, item) => count + (item.starter ? 1 : 0), 0);
  const starterRateLast10 =
    knownStarter.length > 0 ? round(starts / Math.max(1, knownStarter.length), 2) : null;
  const lastKnownStarter = [...recent10].reverse().find((item) => item.starter != null)?.starter ?? null;

  if (lastKnownStarter != null) {
    return { lineupStarter: lastKnownStarter, starterRateLast10 };
  }
  if (starterRateLast10 == null) {
    return { lineupStarter: null, starterRateLast10: null };
  }
  if (starterRateLast10 >= 0.6) {
    return { lineupStarter: true, starterRateLast10 };
  }
  if (starterRateLast10 <= 0.2) {
    return { lineupStarter: false, starterRateLast10 };
  }
  return { lineupStarter: null, starterRateLast10 };
}

function createMarketStats(): Record<SnapshotMarket, MarketErrorStats> {
  return {
    PTS: createEmptyMarketErrorStats(),
    REB: createEmptyMarketErrorStats(),
    AST: createEmptyMarketErrorStats(),
    THREES: createEmptyMarketErrorStats(),
    PRA: createEmptyMarketErrorStats(),
    PA: createEmptyMarketErrorStats(),
    PR: createEmptyMarketErrorStats(),
    RA: createEmptyMarketErrorStats(),
  };
}

function finalizeMarketStats(stats: MarketErrorStats): FinalizedMarketStats {
  if (stats.count === 0) {
    return {
      samples: 0,
      mae: null,
      rmse: null,
      bias: null,
      within1Pct: null,
      within2Pct: null,
      lineSamples: stats.lineCount,
      lineResolvedSamples: stats.lineResolvedCount,
      predictedPushes: stats.linePushes,
      actualPushes: stats.actualPushes,
      correctSide: stats.correctSide,
      wrongSide: stats.wrongSide,
      sideAccuracyPct: null,
      overCalls: stats.overCalls,
      underCalls: stats.underCalls,
      overCallPct: null,
      underCallPct: null,
    };
  }
  const directionalCalls = stats.overCalls + stats.underCalls;
  return {
    samples: stats.count,
    mae: round(stats.sumAbsError / stats.count, 3),
    rmse: round(Math.sqrt(stats.sumSquaredError / stats.count), 3),
    bias: round(stats.sumError / stats.count, 3),
    within1Pct: round((stats.within1 / stats.count) * 100, 2),
    within2Pct: round((stats.within2 / stats.count) * 100, 2),
    lineSamples: stats.lineCount,
    lineResolvedSamples: stats.lineResolvedCount,
    predictedPushes: stats.linePushes,
    actualPushes: stats.actualPushes,
    correctSide: stats.correctSide,
    wrongSide: stats.wrongSide,
    sideAccuracyPct:
      stats.lineResolvedCount > 0 ? round((stats.correctSide / stats.lineResolvedCount) * 100, 2) : null,
    overCalls: stats.overCalls,
    underCalls: stats.underCalls,
    overCallPct: directionalCalls > 0 ? round((stats.overCalls / directionalCalls) * 100, 2) : null,
    underCallPct: directionalCalls > 0 ? round((stats.underCalls / directionalCalls) * 100, 2) : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isEtDate(args.from) || !isEtDate(args.to)) {
    throw new Error("Dates must be YYYY-MM-DD (ET). Example: --from 2025-10-01 --to 2026-03-01");
  }

  const players = await prisma.player.findMany({
    select: {
      id: true,
      externalId: true,
      fullName: true,
      position: true,
    },
  });
  const playerPositionById = new Map<string, string | null>(players.map((player) => [player.id, player.position]));
  const playerIdByExternalId = new Map<string, string>();
  players.forEach((player) => {
    if (player.externalId) {
      playerIdByExternalId.set(player.externalId, player.id);
    }
  });
  const playerIdByNormalizedName = new Map<string, string>(
    players.map((player) => [normalizeSearchText(player.fullName), player.id]),
  );
  const playerNameById = new Map<string, string>(players.map((player) => [player.id, player.fullName]));
  const lineMaps = await loadHistoricalLineMaps(args.lineFile, playerIdByExternalId, playerIdByNormalizedName);
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      abbreviation: true,
    },
  });
  const teamCodeById = new Map<string, string>(teams.map((team) => [team.id, team.abbreviation]));
  const games = await prisma.game.findMany({
    where: {
      gameDateEt: { gte: args.from, lte: args.to },
    },
    select: {
      externalId: true,
      gameDateEt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
    },
  });
  const gameContextByExternalId = new Map<string, BacktestGameContext>(
    games.map((game) => [
      game.externalId,
      {
        externalId: game.externalId,
        gameDateEt: game.gameDateEt,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeCode: game.homeTeam.abbreviation,
        awayCode: game.awayTeam.abbreviation,
      },
    ]),
  );

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: { lte: args.to },
      minutes: { gt: 0 },
    },
    select: {
      playerId: true,
      externalGameId: true,
      gameDateEt: true,
      teamId: true,
      isHome: true,
      starter: true,
      opponentTeamId: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
    },
    orderBy: [{ gameDateEt: "asc" }, { playerId: "asc" }],
  });

  if (logs.length === 0) {
    throw new Error(`No player_game_logs found in range ${args.from}..${args.to}`);
  }

  const logsByDate = new Map<string, typeof logs>();
  logs.forEach((log) => {
    const bucket = logsByDate.get(log.gameDateEt) ?? [];
    bucket.push(log);
    logsByDate.set(log.gameDateEt, bucket);
  });
  const allDates = Array.from(logsByDate.keys()).sort((a, b) => a.localeCompare(b));
  const evaluationDates = allDates.filter((date) => date >= args.from && date <= args.to);
  const logsInRange = logs.filter(
    (log) => log.gameDateEt >= args.from && log.gameDateEt <= args.to && (log.minutes ?? 0) >= args.minActualMinutes,
  ).length;
  const historicalPregameByExternalGameId = new Map<string, Awaited<ReturnType<typeof fetchHistoricalPregameOdds>>>();
  const historicalRotowireByDate = new Map<string, Awaited<ReturnType<typeof fetchHistoricalRotowireSnapshot>>>();

  if (args.emitPlayerRows) {
    const evaluationGames = Array.from(
      new Map(
        logs
          .filter((log) => log.gameDateEt >= args.from && log.gameDateEt <= args.to)
          .map((log) => {
            const game = gameContextByExternalId.get(log.externalGameId);
            return game ? [game.externalId, game] : null;
          })
          .filter((entry): entry is [string, BacktestGameContext] => Boolean(entry)),
      ).values(),
    );

    await mapLimit(evaluationDates, 6, async (date) => {
      const snapshot = await fetchHistoricalRotowireSnapshot(date).catch(() => null);
      historicalRotowireByDate.set(date, snapshot);
      return snapshot;
    });

    await mapLimit(evaluationGames, 8, async (game) => {
      const pregame = await fetchHistoricalPregameOdds(game.gameDateEt, game.awayCode, game.homeCode).catch(() => null);
      historicalPregameByExternalGameId.set(game.externalId, pregame);
      return pregame;
    });
  }

  const playerHistory = new Map<string, HistoryLog[]>();
  const playerResidualById = new Map<string, PlayerResidualSeries>();
  const playerLinearById = new Map<string, PlayerLinearSeries>();
  const globalResidualByBin = createGlobalResidualByBin();
  const marketResidualSeries = createMarketResidualSeries();
  const opponentAggByTeamId = new Map<string, RollingAgg>();
  const opponentAggByTeamAndArchetype = new Map<string, RollingAgg>();
  const leagueAgg = createRollingAgg();
  const marketStats = createMarketStats();
  const playerMarketStats = new Map<string, MarketErrorStats>();
  const playerMarketRows: PlayerMarketTrainingRow[] = [];
  const hybridFeatureCount = 15;
  const hybridGlobalModels = createHybridModelSet(hybridFeatureCount);
  const hybridPlayerModels = new Map<string, HybridModelSet>();
  const ptsBadGameBuckets = createPtsBadGameBuckets();
  const ptsGlobalLinearSeries = createLinearSeries();

  let rowsWithHistory = 0;
  let rowsWithoutHistory = 0;
  let rowsWithoutProjection = 0;

  for (const date of allDates) {
    const dayLogs = logsByDate.get(date) ?? [];
    const inEvaluationWindow = date >= args.from && date <= args.to;
    const pendingGlobalBinUpdates: Array<{ market: SnapshotMarket; binKey: number; residual: number }> = [];
    const pendingHybridUpdates: HybridPendingUpdate[] = [];
    const pendingPtsGlobalLinearUpdates: LinearPair[] = [];

    if (inEvaluationWindow) {
      for (const log of dayLogs) {
        if ((log.minutes ?? 0) < args.minActualMinutes) {
          continue;
        }
        const history = playerHistory.get(log.playerId) ?? [];
        if (history.length === 0) {
          rowsWithoutHistory += 1;
          continue;
        }

        rowsWithHistory += 1;
        const last10 = history.slice(-10);
        const last3 = history.slice(-3);
        const homeAway = log.isHome == null ? [] : history.filter((item) => item.isHome === log.isHome);
        const sameTeamHistory =
          log.teamId == null ? history : history.filter((item) => item.teamId != null && item.teamId === log.teamId);
        const sameTeamLast8 = sameTeamHistory.slice(-8);
        const sameTeamLast3 = sameTeamHistory.slice(-3);
        const sameTeamLast10 = sameTeamHistory.slice(-10);
        const sameTeamWeightShort = clamp(sameTeamHistory.length / 8, 0, 1) * 0.65;
        const sameTeamWeightLong = clamp(sameTeamHistory.length / 16, 0, 1) * 0.55;

        const seasonAverageBase = averagesByMarket(history);
        const last10AverageBase = averagesByMarket(last10);
        const last3AverageBase = averagesByMarket(last3);
        const homeAwayAverageBase = averagesByMarket(homeAway);
        const sameTeamAverage = averagesByMarket(sameTeamLast8.length > 0 ? sameTeamLast8 : sameTeamHistory);
        const sameTeamLast3Average = averagesByMarket(sameTeamLast3);
        const seasonAverage = blendMetricRecords(seasonAverageBase, sameTeamAverage, sameTeamWeightLong);
        const last10Average = blendMetricRecords(last10AverageBase, sameTeamAverage, sameTeamWeightShort);
        const last3Average = blendMetricRecords(last3AverageBase, sameTeamLast3Average, clamp(sameTeamLast3.length / 3, 0, 1) * 0.5);
        const homeAwayAverage = blendMetricRecords(homeAwayAverageBase, sameTeamAverage, sameTeamWeightShort * 0.7);

        const modelHistory = sameTeamHistory.length >= 8 ? sameTeamHistory : history;
        const modelHistoryRecent = toRecentFirst(modelHistory);
        const historyByMarket = arraysByMarket(modelHistory);
        const historyByMarketRecent = arraysByMarket(modelHistoryRecent);
        const last10ByMarket = arraysByMarket(toRecentFirst(sameTeamLast10.length >= 6 ? sameTeamLast10 : last10));
        const historyMinutesRecent = modelHistoryRecent.map((item) => item.minutes);

        const minutesSeasonAvgBase = average(history.map((item) => item.minutes));
        const minutesSeasonTeamAvg = average(sameTeamHistory.map((item) => item.minutes));
        const minutesSeasonAvg = blendNumber(minutesSeasonAvgBase, minutesSeasonTeamAvg, sameTeamWeightLong);
        if ((minutesSeasonAvg ?? 0) < args.minHistoryMinutesAvg) {
          continue;
        }
        const personalModels = buildPlayerPersonalModels({
          historyByMarket,
          minutesSeasonAvg: minutesSeasonAvg ?? 0,
        });

        const playerPosition = playerPositionById.get(log.playerId) ?? null;
        const playerArchetype = archetypeKey(playerPosition, history, null, null);
        const lastHistoryDate = history.length > 0 ? history[history.length - 1].gameDateEt : null;
        const currentRestDays = lastHistoryDate ? daysBetween(lastHistoryDate, date) : null;
        const opponentArchetypeAgg =
          log.opponentTeamId != null
            ? (opponentAggByTeamAndArchetype.get(`${log.opponentTeamId}|${playerArchetype}`) ?? null)
            : null;
        const opponentTeamAgg = log.opponentTeamId ? (opponentAggByTeamId.get(log.opponentTeamId) ?? null) : null;
        const opponentAllowance = averageFromAgg(
          opponentArchetypeAgg && opponentArchetypeAgg.count >= 6 ? opponentArchetypeAgg : opponentTeamAgg,
        );
        const leagueAverage = averageFromAgg(leagueAgg.count > 0 ? leagueAgg : null);
        const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);

        const minutesLast10Avg = blendNumber(
          average(last10.map((item) => item.minutes)),
          average(sameTeamLast10.map((item) => item.minutes)),
          sameTeamWeightShort,
        );
        const minutesLast3Avg = blendNumber(
          average(last3.map((item) => item.minutes)),
          average(sameTeamLast3.map((item) => item.minutes)),
          clamp(sameTeamLast3.length / 3, 0, 1) * 0.5,
        );
        const minutesVolatility = blendNumber(
          standardDeviation(last10.map((item) => item.minutes)),
          standardDeviation(sameTeamLast10.map((item) => item.minutes)),
          sameTeamWeightShort,
        );
        const lineupStarterSignal = inferLineupStarter(history);
        const currentTeamHistoryWindow = sameTeamHistory.length > 0 ? sameTeamHistory : last10;
        const ptsPpmHistory = currentTeamHistoryWindow.length >= 8 ? currentTeamHistoryWindow : history;
        const projected =
          args.mode === "model" || args.mode === "player_hybrid"
            ? projectTonightMetrics({
                last3Average,
                last10Average,
                seasonAverage,
                homeAwayAverage,
                opponentAllowance,
                opponentAllowanceDelta,
                last10ByMarket,
                historyByMarket: historyByMarketRecent,
                historyMinutes: historyMinutesRecent,
                sampleSize: history.length,
                personalModels,
                minutesSeasonAvg,
                minutesLast3Avg,
                minutesLast10Avg,
                minutesVolatility,
                minutesHomeAwayAvg: average(homeAway.map((item) => item.minutes)),
                minutesCurrentTeamLast5Avg: average(currentTeamHistoryWindow.slice(-5).map((item) => item.minutes)),
                minutesCurrentTeamGames: Math.min(currentTeamHistoryWindow.length, 10),
                lineupStarter: lineupStarterSignal.lineupStarter,
                starterRateLast10: lineupStarterSignal.starterRateLast10,
              })
            : args.mode === "player_conditional_median"
              ? projectedFromPlayerConditionalMedian(history, minutesLast10Avg, minutesLast3Avg)
              : projectedFromBaseline(args.mode, last10Average, seasonAverage, last10ByMarket);
        const actual = metricsFromBase(
          toStat(log.points),
          toStat(log.rebounds),
          toStat(log.assists),
          toStat(log.threes),
        );
        const ptsBadGameContext =
          args.ptsBadGameWeight > 0
            ? detectPtsBadGameContext(history, args.ptsBadGameThresholdPts, args.ptsBadGameThresholdPct)
            : null;
        const playerResidualSeries = playerResidualById.get(log.playerId) ?? createPlayerResidualSeries();
        playerResidualById.set(log.playerId, playerResidualSeries);
        const playerLinearSeries = playerLinearById.get(log.playerId) ?? createPlayerLinearSeries();
        playerLinearById.set(log.playerId, playerLinearSeries);

        let projectedAtLeastOne = false;
        const finalPredictions = blankMetricRecord();
        MARKETS.forEach((market) => {
          if (args.compositeFromCore && isCompositeMarket(market)) return;
          const predictedValue = projected[market];
          if (predictedValue == null) return;
          projectedAtLeastOne = true;
          const actualValue = actual[market] ?? 0;
          const restAdjusted = restAdjustedPrediction(
            market,
            history,
            currentRestDays,
            predictedValue,
            args.restWeight,
            args.restMinSamples,
          );
          const linearSeries = playerLinearSeries[market];
          const linearAdjustedPrediction = regressionAdjustedPrediction(
            market,
            restAdjusted,
            linearSeries,
            Math.max(0, args.playerLinearWeight),
          );
          const residualHistory = playerResidualSeries[market];
          const residualMedian = median(residualHistory);
          const baseBiasWeight = Math.max(0, args.playerBiasWeight) * residualWeightScaleForMarket(market);
          const biasWeight = Math.min(
            2,
            Math.max(0, (residualHistory.length / 12) * baseBiasWeight),
          );
          const biasAdjustment =
            residualMedian == null
              ? 0
              : Math.max(
                  -residualCapForMarket(market),
                  Math.min(residualCapForMarket(market), residualMedian * biasWeight),
                );
          const playerAdjustedPrediction = round(Math.max(0, linearAdjustedPrediction + biasAdjustment), 2);
          const marketBins = globalResidualByBin[market];
          const binSize = biasBinSizeForMarket(market);
          const binKey = projectBinKey(playerAdjustedPrediction, binSize);
          const globalResiduals = marketBins.get(binKey) ?? [];
          const globalResidualMedian = median(globalResiduals);
          const globalBiasWeight = Math.max(0, Math.min(2.5, args.globalBiasWeight));
          const globalBiasAdjustment =
            globalResidualMedian == null || globalResiduals.length < args.globalBiasMinSamples
              ? 0
              : Math.max(
                  -residualCapForMarket(market),
                  Math.min(residualCapForMarket(market), globalResidualMedian * globalBiasWeight),
                );
          const marketResiduals = marketResidualSeries[market];
          const marketResidualMedian = median(marketResiduals);
          const marketBiasWeight = Math.max(0, Math.min(2.5, args.marketBiasWeight));
          const marketBiasAdjustment =
            marketResidualMedian == null || marketResiduals.length < args.marketBiasMinSamples
              ? 0
              : Math.max(
                  -residualCapForMarket(market),
                  Math.min(residualCapForMarket(market), marketResidualMedian * marketBiasWeight),
                );
          const adjustedPrediction = round(
            Math.max(0, playerAdjustedPrediction + globalBiasAdjustment + marketBiasAdjustment),
            2,
          );
          const quantileAdjustedPrediction = quantileClampedPrediction(
            market,
            history,
            adjustedPrediction,
            args.quantileClampWeight,
            args.quantileClampMinSamples,
          );
          let finalPrediction = quantileAdjustedPrediction;
          if (args.mode === "player_hybrid") {
            const features = buildHybridFeatures({
              market,
              basePrediction: quantileAdjustedPrediction,
              last3Average: last3Average[market],
              last10Average: last10Average[market],
              seasonAverage: seasonAverage[market],
              homeAwayAverage: homeAwayAverage[market],
              opponentDelta: opponentAllowanceDelta[market],
              minutesLast3Avg,
              minutesLast10Avg,
              minutesSeasonAvg,
              minutesVolatility,
              starterRateLast10: lineupStarterSignal.starterRateLast10,
              isHome: log.isHome,
              restDays: currentRestDays,
              historyGames: history.length,
            });
            const scale = marketScale(market);
            const globalModel = hybridGlobalModels[market];
            const globalPrediction = round(Math.max(0, predictHybridModel(globalModel, features) * scale), 2);
            const globalReliability = clamp(globalModel.samples / 60, 0, 1);
            const globalBlend = clamp(args.hybridGlobalBlend * (0.45 + globalReliability * 0.55), 0, 0.95);
            let blendedPrediction = round(
              quantileAdjustedPrediction * (1 - globalBlend) + globalPrediction * globalBlend,
              2,
            );

            const playerEligible = (minutesSeasonAvg ?? 0) >= args.hybridPlayerMinutesThreshold;
            let playerModel: HybridModel | null = null;
            if (playerEligible) {
              const playerModelSet = getOrCreatePlayerHybridModelSet(hybridPlayerModels, log.playerId, hybridFeatureCount);
              playerModel = playerModelSet[market];
            }

            if (playerModel && playerModel.samples >= args.hybridPlayerMinSamples) {
              const playerPrediction = round(Math.max(0, predictHybridModel(playerModel, features) * scale), 2);
              const playerReliability = clamp(
                (playerModel.samples - args.hybridPlayerMinSamples) / 70,
                0,
                1,
              );
              const playerBlend = clamp(args.hybridPlayerBlend * (0.4 + playerReliability * 0.6), 0, 0.97);
              const playerVsGlobalWeight = clamp(0.55 + playerReliability * 0.35, 0.4, 0.9);
              const mlPrediction = round(
                playerPrediction * playerVsGlobalWeight + globalPrediction * (1 - playerVsGlobalWeight),
                2,
              );
              blendedPrediction = round(
                quantileAdjustedPrediction * (1 - playerBlend) + mlPrediction * playerBlend,
                2,
              );
            }

            finalPrediction = round(Math.max(0, blendedPrediction), 2);
            pendingHybridUpdates.push({
              playerId: log.playerId,
              market,
              features,
              targetNormalized: actualValue / scale,
              playerEligible,
            });
          }

          if (args.medianBlendWeight > 0) {
            const expectedMinutes =
              minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg ?? average(history.map((item) => item.minutes)) ?? 0;
            const conditionalMedian = conditionalMedianFromHistory(
              history,
              expectedMinutes,
              market,
              args.medianBlendTake,
            );
            if (conditionalMedian != null) {
              const historyConfidence = clamp(history.length / 24, 0, 1);
              const blendWeight = clamp(args.medianBlendWeight * historyConfidence, 0, 0.8);
              finalPrediction = round(
                Math.max(0, finalPrediction * (1 - blendWeight) + conditionalMedian * blendWeight),
                2,
              );
            }
          }

          if (market === "PTS" && args.ptsPpmBlendWeight > 0) {
            const expectedMinutes =
              minutesLast10Avg ??
              minutesLast3Avg ??
              minutesSeasonAvg ??
              average(ptsPpmHistory.map((item) => item.minutes)) ??
              0;
            const ppmEstimate = estimatePtsFromPpmHistory(
              ptsPpmHistory,
              expectedMinutes,
              args.ptsPpmBandWidth,
              args.ptsPpmMinSamples,
              args.ptsPpmTake,
            );
            if (ppmEstimate.pointsProjection != null) {
              const confidence = clamp(
                ppmEstimate.sampleCount / Math.max(1, args.ptsPpmMinSamples),
                0,
                1,
              );
              const blendWeight = clamp(args.ptsPpmBlendWeight * (0.35 + confidence * 0.65), 0, 0.85);
              let ppmProjection = ppmEstimate.pointsProjection;
              if (ppmEstimate.q15 != null && ppmEstimate.q85 != null && ppmEstimate.q85 >= ppmEstimate.q15) {
                ppmProjection = clamp(ppmProjection, ppmEstimate.q15 - 2, ppmEstimate.q85 + 2);
              }
              finalPrediction = round(
                Math.max(0, finalPrediction * (1 - blendWeight) + ppmProjection * blendWeight),
                2,
              );
            }
            if (args.ptsMinutesRecoveryWeight > 0) {
              const recoveryBoost = ptsMinutesRecoveryBoost(
                ptsPpmHistory,
                expectedMinutes,
                ppmEstimate.ppm,
                args.ptsMinutesRecoveryWeight,
                args.ptsMinutesRecoveryCap,
                args.ptsMinutesRecoveryMinDeficit,
              );
              finalPrediction = round(Math.max(0, finalPrediction + recoveryBoost), 2);
            }
          }

          if (market === "PTS" && args.ptsVolatilityDampenWeight > 0) {
            const ptsVolWindow = (sameTeamLast10.length >= 6 ? sameTeamLast10 : last10)
              .map((item) => item.metrics.PTS)
              .filter((value): value is number => value != null);
            const ptsVol = standardDeviation(ptsVolWindow);
            const ptsMed = median(ptsVolWindow);
            if (ptsVol != null && ptsMed != null) {
              const threshold = Math.max(0.5, args.ptsVolatilityDampenThreshold);
              const volFactor = clamp((ptsVol - threshold) / threshold, 0, 1.5);
              const dampWeight = clamp(args.ptsVolatilityDampenWeight * volFactor, 0, 0.75);
              finalPrediction = round(
                Math.max(0, finalPrediction * (1 - dampWeight) + ptsMed * dampWeight),
                2,
              );
            }
          }

          if (market === "PTS" && args.ptsTrendReversionWeight !== 0) {
            const trendBase = (last3Average.PTS ?? finalPrediction) - (last10Average.PTS ?? finalPrediction);
            const trendAdjustment = clamp(
              -trendBase * args.ptsTrendReversionWeight,
              -Math.max(0, args.ptsTrendReversionCap),
              Math.max(0, args.ptsTrendReversionCap),
            );
            finalPrediction = round(Math.max(0, finalPrediction + trendAdjustment), 2);
          }

          if (
            market === "PTS" &&
            ptsBadGameContext?.isBad &&
            ptsBadGameContext.severity &&
            args.ptsBadGameWeight > 0
          ) {
            const severity = ptsBadGameContext.severity;
            const playerKey = ptsBadGamePlayerKey(log.playerId, severity);
            const playerResidualSeries = ptsBadGameBuckets.playerResidualByKey.get(playerKey) ?? [];
            const globalResidualSeries = ptsBadGameBuckets.globalResidualBySeverity[severity];
            const playerOutcomeSeries = ptsBadGameBuckets.playerOutcomeByKey.get(playerKey) ?? [];
            const globalOutcomeSeries = ptsBadGameBuckets.globalOutcomeBySeverity[severity];
            const playerResidualMedian =
              playerResidualSeries.length >= args.ptsBadGamePlayerMinSamples ? median(playerResidualSeries) : null;
            const globalResidualMedian =
              globalResidualSeries.length >= args.ptsBadGameGlobalMinSamples ? median(globalResidualSeries) : null;
            const playerOutcomeMedian =
              playerOutcomeSeries.length >= args.ptsBadGamePlayerMinSamples ? median(playerOutcomeSeries) : null;
            const globalOutcomeMedian =
              globalOutcomeSeries.length >= args.ptsBadGameGlobalMinSamples ? median(globalOutcomeSeries) : null;
            const normalizedDeficit = clamp(ptsBadGameContext.deficitPts / 8, 0.15, 1.5);
            const baseWeight = Math.max(0, args.ptsBadGameWeight) * normalizedDeficit;
            const playerOutcomeWeight =
              playerOutcomeMedian == null
                ? 0
                : clamp(baseWeight * 0.65 * clamp(playerOutcomeSeries.length / 20, 0.2, 1), 0, 0.85);
            const globalOutcomeWeight = globalOutcomeMedian == null ? 0 : clamp(baseWeight * 0.35, 0, 0.55);
            const totalOutcomeWeight = clamp(playerOutcomeWeight + globalOutcomeWeight, 0, 0.9);
            if (totalOutcomeWeight > 0) {
              const numer =
                (playerOutcomeMedian ?? 0) * playerOutcomeWeight + (globalOutcomeMedian ?? 0) * globalOutcomeWeight;
              const outcomeTarget = round(numer / totalOutcomeWeight, 2);
              finalPrediction = round(
                Math.max(0, finalPrediction * (1 - totalOutcomeWeight) + outcomeTarget * totalOutcomeWeight),
                2,
              );
            }
            const playerResidualWeight = playerResidualMedian == null ? 0 : clamp(baseWeight * 0.35, 0, 1.1);
            const globalResidualWeight = globalResidualMedian == null ? 0 : clamp(baseWeight * 0.15, 0, 0.7);
            const combinedAdjustment =
              (playerResidualMedian ?? 0) * playerResidualWeight + (globalResidualMedian ?? 0) * globalResidualWeight;
            const cappedAdjustment = clamp(combinedAdjustment, -args.ptsBadGameCap, args.ptsBadGameCap);
            finalPrediction = round(Math.max(0, finalPrediction + cappedAdjustment), 2);
          }

          if (market === "PTS" && args.ptsGlobalLinearWeight > 0) {
            finalPrediction = regressionAdjustedPrediction(
              "PTS",
              finalPrediction,
              ptsGlobalLinearSeries,
              args.ptsGlobalLinearWeight,
            );
          }
          const lineEntry = lineMaps.byPlayerId.get(makeLineLookupKey(log.playerId, log.gameDateEt, market)) ?? null;
          if (market === "PTS") {
            finalPrediction = priceAwarePtsPrediction(finalPrediction, lineEntry);
          } else if (market === "REB") {
            finalPrediction = priceAwareRebPrediction(finalPrediction, lineEntry);
          } else if (market === "AST") {
            finalPrediction = priceAwareAstPrediction(finalPrediction, lineEntry);
          } else if (market === "THREES") {
            finalPrediction = priceAwareThreesPrediction(finalPrediction, lineEntry);
          } else if (market === "PRA") {
            finalPrediction = priceAwarePraPrediction(finalPrediction, lineEntry);
          } else if (market === "PA") {
            finalPrediction = priceAwarePaPrediction(finalPrediction, lineEntry);
          } else if (market === "PR") {
            finalPrediction = priceAwarePrPrediction(finalPrediction, lineEntry);
          } else if (market === "RA") {
            finalPrediction = priceAwareRaPrediction(finalPrediction, lineEntry);
          }
          const ptsSideOverride =
            market === "PTS" && args.ptsSideOverrideEnabled
              ? applyGlobalPtsSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const rebSideOverride =
            market === "REB" && args.rebSideOverrideEnabled
              ? applyGlobalRebSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const astSideOverride =
            market === "AST" && args.astSideOverrideEnabled
              ? applyGlobalAstSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const threesSideOverride =
            market === "THREES" && args.threesSideOverrideEnabled
              ? applyGlobalThreesSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const praSideOverride =
            market === "PRA" && args.praSideOverrideEnabled
              ? applyGlobalPraSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const paSideOverride =
            market === "PA" && args.paSideOverrideEnabled
              ? applyGlobalPaSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const prSideOverride =
            market === "PR" && args.prSideOverrideEnabled
              ? applyGlobalPrSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          const raSideOverride =
            market === "RA" && args.raSideOverrideEnabled
              ? applyGlobalRaSideOverride({
                  projectedValue: finalPrediction,
                  lineEntry,
                  expectedMinutes: minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg,
                  minutesVolatility,
                  starterRateLast10: lineupStarterSignal.starterRateLast10,
                })
              : null;
          finalPredictions[market] = finalPrediction;

          applyPredictionStats(
            marketStats[market],
            finalPrediction,
            actualValue,
            lineEntry?.line ?? null,
            ptsSideOverride ??
              rebSideOverride ??
              astSideOverride ??
              threesSideOverride ??
              praSideOverride ??
              paSideOverride ??
              prSideOverride ??
              raSideOverride,
          );
          const playerMarketKey = `${log.playerId}|${market}`;
          const playerMarketStat = playerMarketStats.get(playerMarketKey) ?? createEmptyMarketErrorStats();
          applyPredictionStats(
            playerMarketStat,
            finalPrediction,
            actualValue,
            lineEntry?.line ?? null,
            ptsSideOverride ??
              rebSideOverride ??
              astSideOverride ??
              threesSideOverride ??
              praSideOverride ??
              paSideOverride ??
              prSideOverride ??
              raSideOverride,
          );
          playerMarketStats.set(playerMarketKey, playerMarketStat);

          if (args.emitPlayerRows && lineEntry) {
            const projectionSide = sideFromLine(finalPrediction, lineEntry.line);
            const finalSide =
              (ptsSideOverride ??
                rebSideOverride ??
                astSideOverride ??
                threesSideOverride ??
                praSideOverride ??
                paSideOverride ??
                prSideOverride ??
                raSideOverride ??
                projectionSide) as ResolvedSide | SnapshotModelSide;
            const actualSide = sideFromLine(actualValue, lineEntry.line);
            if (finalSide !== "PUSH" && actualSide !== "PUSH") {
              const signal = resolveMarketSignal(lineEntry);
              const expectedMinutes = minutesLast10Avg ?? minutesLast3Avg ?? minutesSeasonAvg ?? null;
              const lineGap = round(finalPrediction - lineEntry.line, 3);
              const gameContext = gameContextByExternalId.get(log.externalGameId) ?? null;
              const teamCode =
                log.teamId != null
                  ? teamCodeById.get(log.teamId) ??
                    (gameContext == null
                      ? null
                      : gameContext.homeTeamId === log.teamId
                        ? gameContext.homeCode
                        : gameContext.awayTeamId === log.teamId
                          ? gameContext.awayCode
                          : log.isHome === true
                            ? gameContext.homeCode
                            : log.isHome === false
                              ? gameContext.awayCode
                              : null)
                  : gameContext == null
                    ? null
                    : log.isHome === true
                      ? gameContext.homeCode
                      : log.isHome === false
                        ? gameContext.awayCode
                        : null;
              const historicalPregame = gameContext
                ? (historicalPregameByExternalGameId.get(gameContext.externalId) ?? null)
                : null;
              const openingTeamSpread =
                historicalPregame?.openingHomeSpread == null
                  ? null
                  : log.isHome === true
                    ? historicalPregame.openingHomeSpread
                    : log.isHome === false
                      ? round(-historicalPregame.openingHomeSpread, 2)
                      : null;
              const openingTotal = historicalPregame?.openingTotal ?? null;
              const historicalRotowire = historicalRotowireByDate.get(log.gameDateEt) ?? null;
              const teamSignal = getHistoricalRotowireTeamSignal(historicalRotowire, teamCode);
              const lineupTimingConfidence = computeLineupTimingConfidence(teamSignal);
              const completenessScore = computeTrainingRowCompleteness({
                last10Logs: sameTeamLast10.length >= 6 ? sameTeamLast10 : last10,
                opponentAllowance,
                minutesVolatility,
              });
              playerMarketRows.push({
                playerId: log.playerId,
                playerName: playerNameById.get(log.playerId) ?? log.playerId,
                market,
                gameDateEt: log.gameDateEt,
                projectedValue: finalPrediction,
                actualValue,
                line: lineEntry.line,
                overPrice: lineEntry.overPrice,
                underPrice: lineEntry.underPrice,
                projectionSide,
                finalSide,
                actualSide,
                projectionCorrect: projectionSide === actualSide,
                finalCorrect: finalSide === actualSide,
                priceLean: signal.priceLean,
                favoredSide: signal.favoredSide,
                expectedMinutes: expectedMinutes == null ? null : round(expectedMinutes, 3),
                minutesVolatility: minutesVolatility == null ? null : round(minutesVolatility, 3),
                starterRateLast10:
                  lineupStarterSignal.starterRateLast10 == null
                    ? null
                    : round(lineupStarterSignal.starterRateLast10, 3),
                actualMinutes: round(log.minutes ?? 0, 3),
                lineGap,
                absLineGap: round(Math.abs(lineGap), 3),
                openingTeamSpread,
                openingTotal,
                lineupTimingConfidence,
                completenessScore,
                spreadResolved: Boolean(openingTeamSpread != null || openingTotal != null),
              });
            }
          }

          residualHistory.push(actualValue - finalPrediction);
          if (residualHistory.length > args.playerBiasWindow) {
            residualHistory.shift();
          }

          if (
            market === "PTS" &&
            ptsBadGameContext?.isBad &&
            ptsBadGameContext.severity &&
            args.ptsBadGameWeight > 0
          ) {
            const severity = ptsBadGameContext.severity;
            const residual = actualValue - finalPrediction;
            const playerKey = ptsBadGamePlayerKey(log.playerId, severity);
            const playerResidualSeries = ptsBadGameBuckets.playerResidualByKey.get(playerKey) ?? [];
            pushBounded(playerResidualSeries, residual, 120);
            ptsBadGameBuckets.playerResidualByKey.set(playerKey, playerResidualSeries);
            pushBounded(ptsBadGameBuckets.globalResidualBySeverity[severity], residual, 6000);

            const playerOutcomeSeries = ptsBadGameBuckets.playerOutcomeByKey.get(playerKey) ?? [];
            pushBounded(playerOutcomeSeries, actualValue, 120);
            ptsBadGameBuckets.playerOutcomeByKey.set(playerKey, playerOutcomeSeries);
            pushBounded(ptsBadGameBuckets.globalOutcomeBySeverity[severity], actualValue, 6000);
          }
          if (market === "PTS" && args.ptsGlobalLinearWeight > 0) {
            pendingPtsGlobalLinearUpdates.push({ x: finalPrediction, y: actualValue });
          }
          addLinearPoint(linearSeries, { x: restAdjusted, y: actualValue }, args.playerLinearWindow);

          pendingGlobalBinUpdates.push({
            market,
            binKey,
            residual: actualValue - finalPrediction,
          });
        });

        if (args.compositeFromCore) {
          const pts = finalPredictions.PTS;
          const reb = finalPredictions.REB;
          const ast = finalPredictions.AST;
          if (pts != null && reb != null && ast != null) {
            const derivedComposites: SnapshotMetricRecord = {
              ...blankMetricRecord(),
              PRA: round(pts + reb + ast, 2),
              PA: round(pts + ast, 2),
              PR: round(pts + reb, 2),
              RA: round(reb + ast, 2),
            };
            (["PRA", "PA", "PR", "RA"] as SnapshotMarket[]).forEach((market) => {
              const finalPrediction = derivedComposites[market];
              if (finalPrediction == null) return;
              const actualValue = actual[market] ?? 0;
              const lineEntry = lineMaps.byPlayerId.get(makeLineLookupKey(log.playerId, log.gameDateEt, market)) ?? null;
              applyPredictionStats(marketStats[market], finalPrediction, actualValue, lineEntry?.line ?? null);
              const playerMarketKey = `${log.playerId}|${market}`;
              const playerMarketStat = playerMarketStats.get(playerMarketKey) ?? createEmptyMarketErrorStats();
              applyPredictionStats(playerMarketStat, finalPrediction, actualValue, lineEntry?.line ?? null);
              playerMarketStats.set(playerMarketKey, playerMarketStat);
              finalPredictions[market] = finalPrediction;
              const residualHistory = playerResidualSeries[market];
              residualHistory.push(actualValue - finalPrediction);
              if (residualHistory.length > args.playerBiasWindow) {
                residualHistory.shift();
              }
              const binKey = projectBinKey(finalPrediction, biasBinSizeForMarket(market));
              pendingGlobalBinUpdates.push({
                market,
                binKey,
                residual: actualValue - finalPrediction,
              });
            });
          }
        }

        if (!projectedAtLeastOne) rowsWithoutProjection += 1;
      }
    }

    pendingGlobalBinUpdates.forEach((entry) => {
      const marketBins = globalResidualByBin[entry.market];
          const globalSeries = marketBins.get(entry.binKey) ?? [];
          globalSeries.push(entry.residual);
      if (globalSeries.length > 900) {
        globalSeries.shift();
      }
          marketBins.set(entry.binKey, globalSeries);
          const marketSeries = marketResidualSeries[entry.market];
          marketSeries.push(entry.residual);
          if (marketSeries.length > 2400) {
            marketSeries.shift();
          }
    });

    if (args.ptsGlobalLinearWeight > 0) {
      pendingPtsGlobalLinearUpdates.forEach((pair) => {
        addLinearPoint(ptsGlobalLinearSeries, pair, args.ptsGlobalLinearWindow);
      });
    }

    if (args.mode === "player_hybrid") {
      pendingHybridUpdates.forEach((entry) => {
        const globalModel = hybridGlobalModels[entry.market];
        updateHybridModel(globalModel, entry.features, entry.targetNormalized, args.hybridLearningRate, args.hybridL2);
        if (entry.playerEligible) {
          const playerModelSet = getOrCreatePlayerHybridModelSet(hybridPlayerModels, entry.playerId, hybridFeatureCount);
          const playerModel = playerModelSet[entry.market];
          updateHybridModel(playerModel, entry.features, entry.targetNormalized, args.hybridLearningRate, args.hybridL2);
        }
      });
    }

    for (const log of dayLogs) {
      const metrics = metricsFromBase(
        toStat(log.points),
        toStat(log.rebounds),
        toStat(log.assists),
        toStat(log.threes),
      );
      const history = playerHistory.get(log.playerId) ?? [];
      const playerPosition = playerPositionById.get(log.playerId) ?? null;
      const currentArchetype = archetypeKey(playerPosition, history, metrics.PTS, toStat(log.minutes));
      const previousDate = history.length > 0 ? history[history.length - 1].gameDateEt : null;
      const restDaysBefore = previousDate ? daysBetween(previousDate, log.gameDateEt) : null;
      history.push({
        gameDateEt: log.gameDateEt,
        teamId: log.teamId,
        isHome: log.isHome,
        starter: log.starter,
        restDaysBefore,
        minutes: toStat(log.minutes),
        metrics,
      });
      if (history.length > 140) {
        history.splice(0, history.length - 140);
      }
      playerHistory.set(log.playerId, history);

      if (log.opponentTeamId) {
        const teamAgg = opponentAggByTeamId.get(log.opponentTeamId) ?? createRollingWindowAgg(args.opponentWindow);
        addToRollingAgg(teamAgg, metrics);
        opponentAggByTeamId.set(log.opponentTeamId, teamAgg);

        const archetypeKeyByTeam = `${log.opponentTeamId}|${currentArchetype}`;
        const archetypeAgg =
          opponentAggByTeamAndArchetype.get(archetypeKeyByTeam) ?? createRollingWindowAgg(args.opponentWindow);
        addToRollingAgg(archetypeAgg, metrics);
        opponentAggByTeamAndArchetype.set(archetypeKeyByTeam, archetypeAgg);
      }
      addToRollingAgg(leagueAgg, metrics);
    }
  }

  const byMarket = MARKETS.map((market) => ({
    market,
    ...finalizeMarketStats(marketStats[market]),
  }));

  const overall = finalizeMarketStats(
    MARKETS.reduce<MarketErrorStats>(
      (acc, market) => {
        const current = marketStats[market];
        acc.count += current.count;
        acc.sumAbsError += current.sumAbsError;
        acc.sumSquaredError += current.sumSquaredError;
        acc.sumError += current.sumError;
        acc.within1 += current.within1;
        acc.within2 += current.within2;
        acc.lineCount += current.lineCount;
        acc.lineResolvedCount += current.lineResolvedCount;
        acc.linePushes += current.linePushes;
        acc.actualPushes += current.actualPushes;
        acc.correctSide += current.correctSide;
        acc.wrongSide += current.wrongSide;
        acc.overCalls += current.overCalls;
        acc.underCalls += current.underCalls;
        return acc;
      },
      createEmptyMarketErrorStats(),
    ),
  );

  const modelName =
    args.mode === "model"
      ? "snapshot_projection_v4_player_specific_15mpg"
      : args.mode === "player_hybrid"
        ? "snapshot_projection_v5_player_hybrid_online"
        : `baseline_${args.mode}`;

  const byPlayerMarket: FinalizedPlayerMarketStats[] = Array.from(playerMarketStats.entries())
    .map(([key, stats]) => {
      const [playerId, market] = key.split("|") as [string, SnapshotMarket];
      const resolvedSides = stats.correctSide + stats.wrongSide;
      return {
        playerId,
        playerName: playerNameById.get(playerId) ?? playerId,
        market,
        samples: stats.count,
        mae: stats.count > 0 ? round(stats.sumAbsError / stats.count, 3) : null,
        bias: stats.count > 0 ? round(stats.sumError / stats.count, 3) : null,
        lineSamples: stats.lineCount,
        lineResolvedSamples: stats.lineResolvedCount,
        correctSide: stats.correctSide,
        wrongSide: stats.wrongSide,
        sideAccuracyPct: resolvedSides > 0 ? round((stats.correctSide / resolvedSides) * 100, 2) : null,
      };
    })
    .filter((entry) => entry.lineResolvedSamples > 0)
    .sort(
      (left, right) =>
        (right.sideAccuracyPct ?? -1) - (left.sideAccuracyPct ?? -1) ||
        right.lineResolvedSamples - left.lineResolvedSamples ||
        left.playerName.localeCompare(right.playerName),
    );

  const result = {
    model: modelName,
    season: args.season,
    from: args.from,
    to: args.to,
    lineFile: args.lineFile,
    directionalAccuracyEnabled: Boolean(args.lineFile),
    evaluatedDates: evaluationDates.length,
    logsInRange,
    rowsWithHistory,
    rowsWithoutHistory,
    rowsWithoutProjection,
    byMarket,
    byPlayerMarket,
    ...(args.emitPlayerRows ? { playerMarketRows } : {}),
    overall,
    notes: [
      "Backtest uses strictly historical data before each game date (no same-day leakage).",
      "Opponent allowance is rolling by opponent team/archetype from prior logs in the selected window.",
      `Only completed logs with at least ${args.minActualMinutes} actual minutes are evaluated.`,
      `Opponent allowance window: last ${args.opponentWindow} opponent games.`,
      ...(args.lineFile
        ? [
            `Side accuracy is evaluated against historical prop lines from ${args.lineFile}. Correct side = projected OVER/UNDER matches final OVER/UNDER; pushes are excluded.`,
          ]
        : [
            "No historical line file was supplied, so over/under side accuracy is not included. Use --line-file to score directional accuracy.",
          ]),
      ...(args.playerBiasWeight > 0
        ? [
            `Player residual correction enabled (weight=${round(args.playerBiasWeight, 2)}, window=${args.playerBiasWindow}).`,
          ]
        : []),
      ...(args.globalBiasWeight > 0
        ? [
            `Global bin residual correction enabled (weight=${round(args.globalBiasWeight, 2)}, minSamples=${args.globalBiasMinSamples}).`,
          ]
        : []),
      ...(args.marketBiasWeight > 0
        ? [
            `Market residual correction enabled (weight=${round(args.marketBiasWeight, 2)}, minSamples=${args.marketBiasMinSamples}).`,
          ]
        : []),
      ...(args.restWeight > 0
        ? [`Rest context correction enabled (weight=${round(args.restWeight, 2)}, minSamples=${args.restMinSamples}).`]
        : []),
      ...(args.quantileClampWeight > 0
        ? [
            `Player quantile clamp enabled (weight=${round(args.quantileClampWeight, 2)}, minSamples=${args.quantileClampMinSamples}).`,
          ]
        : []),
      ...(args.playerLinearWeight > 0
        ? [
            `Player linear correction enabled (weight=${round(args.playerLinearWeight, 2)}, window=${args.playerLinearWindow}).`,
          ]
        : []),
      ...(args.minHistoryMinutesAvg > 0
        ? [`Rows with trailing history minutes average below ${round(args.minHistoryMinutesAvg, 2)} are excluded.`]
        : []),
      ...(args.mode === "player_hybrid"
        ? [
            `Player hybrid correction enabled (threshold=${round(args.hybridPlayerMinutesThreshold, 2)} mpg, playerMinSamples=${args.hybridPlayerMinSamples}, lr=${round(args.hybridLearningRate, 4)}, l2=${round(args.hybridL2, 4)}).`,
            `Hybrid blends: player=${round(args.hybridPlayerBlend, 2)}, global=${round(args.hybridGlobalBlend, 2)}.`,
          ]
        : []),
      ...(args.medianBlendWeight > 0
        ? [`Conditional median blend enabled (weight=${round(args.medianBlendWeight, 2)}, take=${args.medianBlendTake}).`]
        : []),
      ...(args.ptsPpmBlendWeight > 0
        ? [
            `PTS minutes/ppm blend enabled (weight=${round(args.ptsPpmBlendWeight, 2)}, bandWidth=${round(args.ptsPpmBandWidth, 2)}, minSamples=${args.ptsPpmMinSamples}, take=${args.ptsPpmTake}).`,
            ...(args.ptsMinutesRecoveryWeight > 0
              ? [
                  `PTS minutes-recovery boost enabled (weight=${round(args.ptsMinutesRecoveryWeight, 2)}, cap=${round(args.ptsMinutesRecoveryCap, 2)}, minDeficit=${round(args.ptsMinutesRecoveryMinDeficit, 2)}).`,
                ]
              : []),
          ]
        : []),
      ...(args.ptsVolatilityDampenWeight > 0
        ? [
            `PTS volatility dampening enabled (weight=${round(args.ptsVolatilityDampenWeight, 2)}, threshold=${round(args.ptsVolatilityDampenThreshold, 2)}).`,
          ]
        : []),
      ...(args.ptsTrendReversionWeight !== 0
        ? [
            `PTS trend reversion enabled (weight=${round(args.ptsTrendReversionWeight, 3)}, cap=${round(args.ptsTrendReversionCap, 2)}).`,
          ]
        : []),
      ...(args.ptsGlobalLinearWeight > 0
        ? [
            `PTS global linear calibration enabled (weight=${round(args.ptsGlobalLinearWeight, 2)}, window=${args.ptsGlobalLinearWindow}).`,
          ]
        : []),
      ...(args.ptsSideOverrideEnabled
        ? ["PTS market-aware side override is enabled for directional grading."]
        : ["PTS market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.rebSideOverrideEnabled
        ? ["REB market-aware side override is enabled for directional grading."]
        : ["REB market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.astSideOverrideEnabled
        ? ["AST market-aware side override is enabled for directional grading."]
        : ["AST market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.threesSideOverrideEnabled
        ? ["THREES market-aware side override is enabled for directional grading."]
        : ["THREES market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.praSideOverrideEnabled
        ? ["PRA market-aware side override is enabled for directional grading."]
        : ["PRA market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.paSideOverrideEnabled
        ? ["PA market-aware side override is enabled for directional grading."]
        : ["PA market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.prSideOverrideEnabled
        ? ["PR market-aware side override is enabled for directional grading."]
        : ["PR market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.raSideOverrideEnabled
        ? ["RA market-aware side override is enabled for directional grading."]
        : ["RA market-aware side override is disabled; side grading uses raw projection vs line."]),
      ...(args.ptsBadGameWeight > 0
        ? [
            `PTS bounce-back correction enabled after bad games (weight=${round(args.ptsBadGameWeight, 2)}, playerMin=${args.ptsBadGamePlayerMinSamples}, globalMin=${args.ptsBadGameGlobalMinSamples}, cap=${round(args.ptsBadGameCap, 2)}, threshold=max(${round(args.ptsBadGameThresholdPts, 2)} pts, ${round(args.ptsBadGameThresholdPct * 100, 1)}%)).`,
          ]
        : []),
      ...(args.compositeFromCore
        ? ["Composite markets are derived from projected core stats (PTS/REB/AST) rather than modeled independently."]
        : []),
    ],
  };

  const outputPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\nSaved backtest report: ${outputPath}`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Projection backtest failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
