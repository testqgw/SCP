import { round } from "@/lib/utils";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

export const SNAPSHOT_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

type MarketProjectionConfig = {
  alpha: number;
  weights: {
    ewma: number;
    last3: number;
    last10: number;
    season: number;
    homeAway: number;
    opponentAllowance: number;
  };
  minuteImpact: number;
  minuteCap: number;
  opponentDeltaImpact: number;
  opponentCap: number;
};

const CONFIG_BY_MARKET: Record<SnapshotMarket, MarketProjectionConfig> = {
  PTS: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 3.6,
    opponentDeltaImpact: 0.2,
    opponentCap: 2.8,
  },
  REB: {
    alpha: 0.39,
    weights: { ewma: 0.2, last3: 0.14, last10: 0.34, season: 0.22, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.62,
    minuteCap: 2.4,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.8,
  },
  AST: {
    alpha: 0.42,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.68,
    minuteCap: 2.3,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.9,
  },
  THREES: {
    alpha: 0.5,
    weights: { ewma: 0.31, last3: 0.2, last10: 0.24, season: 0.15, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.58,
    minuteCap: 1.4,
    opponentDeltaImpact: 0.12,
    opponentCap: 1.0,
  },
  PRA: {
    alpha: 0.43,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 4.8,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.4,
  },
  PA: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.71,
    minuteCap: 4.2,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.0,
  },
  PR: {
    alpha: 0.42,
    weights: { ewma: 0.22, last3: 0.16, last10: 0.32, season: 0.2, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.69,
    minuteCap: 4.4,
    opponentDeltaImpact: 0.19,
    opponentCap: 3.1,
  },
  RA: {
    alpha: 0.4,
    weights: { ewma: 0.21, last3: 0.15, last10: 0.33, season: 0.21, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.65,
    minuteCap: 2.9,
    opponentDeltaImpact: 0.16,
    opponentCap: 2.0,
  },
};

type ProjectMarketInput = {
  market: SnapshotMarket;
  last3Average: number | null;
  last10Average: number | null;
  seasonAverage: number | null;
  homeAwayAverage: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  last10Values: number[];
  sampleSize: number;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesHomeAwayAvg: number | null;
};

export type ProjectTonightInput = {
  last3Average: SnapshotMetricRecord;
  last10Average: SnapshotMetricRecord;
  seasonAverage: SnapshotMetricRecord;
  homeAwayAverage: SnapshotMetricRecord;
  opponentAllowance: SnapshotMetricRecord;
  opponentAllowanceDelta: SnapshotMetricRecord;
  last10ByMarket: Record<SnapshotMarket, number[]>;
  sampleSize: number;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesHomeAwayAvg: number | null;
};

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

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function weightedBlend(parts: Array<{ value: number | null; weight: number }>): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  parts.forEach((part) => {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) return;
    weightedTotal += part.value * part.weight;
    totalWeight += part.weight;
  });
  if (totalWeight <= 0) return null;
  return round(weightedTotal / totalWeight, 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ewmaRecentFirst(valuesRecentFirst: number[], alpha: number): number | null {
  if (valuesRecentFirst.length === 0) return null;
  const ordered = valuesRecentFirst.slice().reverse();
  let ema = ordered[0];
  for (let i = 1; i < ordered.length; i += 1) {
    ema = alpha * ordered[i] + (1 - alpha) * ema;
  }
  return round(ema, 2);
}

function projectMarket(input: ProjectMarketInput): number | null {
  const config = CONFIG_BY_MARKET[input.market];
  const ewma = ewmaRecentFirst(input.last10Values, config.alpha);
  const base = weightedBlend([
    { value: ewma, weight: config.weights.ewma },
    { value: input.last3Average, weight: config.weights.last3 },
    { value: input.last10Average, weight: config.weights.last10 },
    { value: input.seasonAverage, weight: config.weights.season },
    { value: input.homeAwayAverage, weight: config.weights.homeAway },
    { value: input.opponentAllowance, weight: config.weights.opponentAllowance },
  ]);
  if (base == null) return null;

  const seasonAnchor = input.seasonAverage ?? input.last10Average ?? ewma ?? base;
  const last10Volatility = standardDeviation(input.last10Values) ?? 0;
  const volatilityDenom = Math.max(1, Math.abs(input.last10Average ?? seasonAnchor) + 1.5);
  const volatilityShrink = clamp(1 - (last10Volatility / volatilityDenom) * 0.34, 0.56, 0.98);

  const projectedMinutes = weightedBlend([
    { value: input.minutesLast3Avg, weight: 0.52 },
    { value: input.minutesLast10Avg, weight: 0.38 },
    { value: input.minutesHomeAwayAvg, weight: 0.1 },
  ]);
  const minuteDelta =
    projectedMinutes == null || input.minutesLast10Avg == null ? 0 : projectedMinutes - input.minutesLast10Avg;
  const perMinuteRate =
    input.minutesLast10Avg == null || input.minutesLast10Avg <= 0
      ? null
      : (input.last10Average ?? seasonAnchor) / input.minutesLast10Avg;
  const minutesAdjustment =
    perMinuteRate == null
      ? 0
      : clamp(perMinuteRate * minuteDelta * config.minuteImpact, -config.minuteCap, config.minuteCap);
  const opponentAdjustment = clamp(
    (input.opponentAllowanceDelta ?? 0) * config.opponentDeltaImpact,
    -config.opponentCap,
    config.opponentCap,
  );

  let projected = seasonAnchor + (base - seasonAnchor) * volatilityShrink + minutesAdjustment + opponentAdjustment;
  if (input.sampleSize < 10) {
    projected = weightedBlend([
      { value: projected, weight: 0.72 },
      { value: seasonAnchor, weight: 0.28 },
    ]) ?? projected;
  }
  if (input.sampleSize < 6) {
    projected = weightedBlend([
      { value: projected, weight: 0.58 },
      { value: seasonAnchor, weight: 0.42 },
    ]) ?? projected;
  }

  return round(Math.max(0, projected), 2);
}

export function projectTonightMetrics(input: ProjectTonightInput): SnapshotMetricRecord {
  const result = blankMetricRecord();
  SNAPSHOT_MARKETS.forEach((market) => {
    result[market] = projectMarket({
      market,
      last3Average: input.last3Average[market],
      last10Average: input.last10Average[market],
      seasonAverage: input.seasonAverage[market],
      homeAwayAverage: input.homeAwayAverage[market],
      opponentAllowance: input.opponentAllowance[market],
      opponentAllowanceDelta: input.opponentAllowanceDelta[market],
      last10Values: input.last10ByMarket[market],
      sampleSize: input.sampleSize,
      minutesLast3Avg: input.minutesLast3Avg,
      minutesLast10Avg: input.minutesLast10Avg,
      minutesHomeAwayAvg: input.minutesHomeAwayAvg,
    });
  });
  return result;
}
