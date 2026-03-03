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
  trendImpact: number;
  trendCap: number;
};

const CONFIG_BY_MARKET: Record<SnapshotMarket, MarketProjectionConfig> = {
  PTS: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 3.6,
    opponentDeltaImpact: 0.2,
    opponentCap: 2.8,
    trendImpact: 0.24,
    trendCap: 2.6,
  },
  REB: {
    alpha: 0.39,
    weights: { ewma: 0.2, last3: 0.14, last10: 0.34, season: 0.22, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.62,
    minuteCap: 2.4,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.8,
    trendImpact: 0.2,
    trendCap: 1.8,
  },
  AST: {
    alpha: 0.42,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.68,
    minuteCap: 2.3,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.9,
    trendImpact: 0.21,
    trendCap: 1.9,
  },
  THREES: {
    alpha: 0.5,
    weights: { ewma: 0.31, last3: 0.2, last10: 0.24, season: 0.15, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.58,
    minuteCap: 1.4,
    opponentDeltaImpact: 0.12,
    opponentCap: 1.0,
    trendImpact: 0.19,
    trendCap: 1.1,
  },
  PRA: {
    alpha: 0.43,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 4.8,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.4,
    trendImpact: 0.24,
    trendCap: 3.4,
  },
  PA: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.71,
    minuteCap: 4.2,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.0,
    trendImpact: 0.24,
    trendCap: 3.0,
  },
  PR: {
    alpha: 0.42,
    weights: { ewma: 0.22, last3: 0.16, last10: 0.32, season: 0.2, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.69,
    minuteCap: 4.4,
    opponentDeltaImpact: 0.19,
    opponentCap: 3.1,
    trendImpact: 0.23,
    trendCap: 3.2,
  },
  RA: {
    alpha: 0.4,
    weights: { ewma: 0.21, last3: 0.15, last10: 0.33, season: 0.21, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.65,
    minuteCap: 2.9,
    opponentDeltaImpact: 0.16,
    opponentCap: 2.0,
    trendImpact: 0.2,
    trendCap: 2.1,
  },
};

const PLAYER_SPECIFIC_MINUTES_THRESHOLD = (() => {
  const parsed = Number(process.env.SNAPSHOT_PLAYER_SPECIFIC_MINUTES_MIN);
  if (!Number.isFinite(parsed) || parsed <= 0) return 15;
  return clamp(Math.floor(parsed), 8, 24);
})();

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
  minutesProfile: MinutesProjectionProfile;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesVolatility: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
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
  minutesVolatility: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
};

export type MinutesProjectionInput = {
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
};

export type MinutesProjectionProfile = {
  expected: number | null;
  floor: number | null;
  ceiling: number | null;
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round((sorted[middle - 1] + sorted[middle]) / 2, 2);
  }
  return round(sorted[middle], 2);
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

function lineupMinutesDelta(lineupStarter: boolean | null, starterRateLast10: number | null): number {
  if (lineupStarter == null) {
    return 0;
  }
  if (lineupStarter) {
    return clamp((1 - (starterRateLast10 ?? 0.5)) * 2.4 + 0.35, 0.7, 2.8);
  }
  return -clamp((starterRateLast10 ?? 0.5) * 2.2 + 0.35, 0.7, 2.8);
}

export function projectMinutesProfile(input: MinutesProjectionInput): MinutesProjectionProfile {
  const baseline = weightedBlend([
    { value: input.minutesLast3Avg, weight: 0.52 },
    { value: input.minutesLast10Avg, weight: 0.38 },
    { value: input.minutesHomeAwayAvg, weight: 0.1 },
  ]);

  let roleAdjusted = baseline;
  if (baseline != null && input.minutesCurrentTeamLast5Avg != null && input.minutesCurrentTeamGames >= 2) {
    const teamWeight = clamp(0.22 + input.minutesCurrentTeamGames * 0.09, 0.28, 0.78);
    roleAdjusted =
      weightedBlend([
        { value: baseline, weight: 1 - teamWeight },
        { value: input.minutesCurrentTeamLast5Avg, weight: teamWeight },
      ]) ?? baseline;
  }

  const withLineup =
    roleAdjusted == null
      ? null
      : round(Math.max(0, roleAdjusted + lineupMinutesDelta(input.lineupStarter, input.starterRateLast10)), 2);

  const referenceValues = [
    input.minutesLast3Avg,
    input.minutesLast10Avg,
    input.minutesHomeAwayAvg,
    input.minutesCurrentTeamLast5Avg,
  ].filter((value): value is number => value != null && Number.isFinite(value));
  const spread = standardDeviation(referenceValues) ?? 2.4;
  const floorBuffer = clamp(spread * 1.15 + 1.1, 2.2, 8.2);
  const ceilingBuffer = clamp(spread * 1.2 + 1.7, 2.8, 9.4);

  return {
    expected: withLineup,
    floor: withLineup == null ? null : round(Math.max(0, withLineup - floorBuffer), 2),
    ceiling: withLineup == null ? null : round(withLineup + ceilingBuffer, 2),
  };
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
  const minutesProfile = input.minutesProfile;
  const minuteDelta =
    minutesProfile.expected == null || input.minutesLast10Avg == null ? 0 : minutesProfile.expected - input.minutesLast10Avg;
  const expectedMinutes = minutesProfile.expected ?? input.minutesLast10Avg ?? input.minutesLast3Avg ?? 0;
  const perMinuteRate =
    input.minutesLast10Avg == null || input.minutesLast10Avg <= 0
      ? null
      : (input.last10Average ?? seasonAnchor) / input.minutesLast10Avg;
  const perMinuteProjection = perMinuteRate == null ? null : round(Math.max(0, perMinuteRate * expectedMinutes), 2);
  const minutesAdjustment =
    perMinuteRate == null
      ? 0
      : clamp(perMinuteRate * minuteDelta * config.minuteImpact, -config.minuteCap, config.minuteCap);
  const opponentAdjustment = clamp(
    (input.opponentAllowanceDelta ?? 0) * config.opponentDeltaImpact,
    -config.opponentCap,
    config.opponentCap,
  );
  const trendDelta = (input.last3Average ?? input.last10Average ?? seasonAnchor) - (input.last10Average ?? seasonAnchor);
  const trendAdjustment = clamp(trendDelta * config.trendImpact, -config.trendCap, config.trendCap);
  const median10 = median(input.last10Values);
  const relativeVolatility = clamp(last10Volatility / Math.max(1.2, Math.abs(input.last10Average ?? seasonAnchor)), 0, 2);
  const minutesVolatilityRatio = clamp((input.minutesVolatility ?? 0) / Math.max(8, expectedMinutes || 8), 0, 1.8);
  const minutesStability = clamp(1 - minutesVolatilityRatio * 0.55, 0.2, 1);
  const sampleConfidence = clamp((input.sampleSize - 8) / 24, 0, 1);
  const consistencyScore = clamp(1 - relativeVolatility * 0.5, 0.18, 1);
  const playerSpecificTier = expectedMinutes >= PLAYER_SPECIFIC_MINUTES_THRESHOLD;

  const globalProjection =
    seasonAnchor + (base - seasonAnchor) * volatilityShrink + minutesAdjustment + opponentAdjustment + trendAdjustment;
  let projected = globalProjection;

  if (playerSpecificTier) {
    // Personalized model for stable rotation players (>=15 mpg): trust player-specific rate + robust median.
    const personalizedBlend = weightedBlend([
      { value: globalProjection, weight: 0.36 },
      { value: perMinuteProjection, weight: 0.26 },
      { value: input.last10Average, weight: 0.2 },
      { value: median10, weight: 0.11 },
      { value: input.seasonAverage, weight: 0.07 },
    ]);
    projected = personalizedBlend ?? globalProjection;
    const personalizedTrust = clamp(
      0.3 + sampleConfidence * 0.34 + minutesStability * 0.2 + consistencyScore * 0.16,
      0.3,
      0.92,
    );
    projected =
      weightedBlend([
        { value: projected, weight: personalizedTrust },
        { value: seasonAnchor, weight: 1 - personalizedTrust },
      ]) ?? projected;
  } else {
    // Conservative fallback for low-minute players: stronger shrinkage and a bench-minute penalty.
    const conservativeBlend = weightedBlend([
      { value: input.seasonAverage, weight: 0.42 },
      { value: input.last10Average, weight: 0.24 },
      { value: median10, weight: 0.16 },
      { value: perMinuteProjection, weight: 0.12 },
      { value: globalProjection, weight: 0.06 },
    ]);
    projected = conservativeBlend ?? globalProjection;
    const benchPenalty = clamp((PLAYER_SPECIFIC_MINUTES_THRESHOLD - expectedMinutes) * 0.22, 0, 3.0);
    projected = projected - benchPenalty;
    if (input.sampleSize < 18) {
      projected =
        weightedBlend([
          { value: projected, weight: 0.58 },
          { value: seasonAnchor, weight: 0.42 },
        ]) ?? projected;
    }
    if (input.sampleSize < 8) {
      projected =
        weightedBlend([
          { value: projected, weight: 0.4 },
          { value: seasonAnchor, weight: 0.6 },
        ]) ?? projected;
    }
    const upperCap = seasonAnchor + clamp((input.minutesLast10Avg ?? expectedMinutes) * 0.22, 1.5, config.minuteCap + 1.2);
    projected = clamp(projected, 0, Math.max(upperCap, 0));
  }

  const outlierGuardWeight = clamp(relativeVolatility * 0.14 + minutesVolatilityRatio * 0.11, 0, 0.24);
  projected =
    weightedBlend([
      { value: projected, weight: 1 - outlierGuardWeight },
      { value: seasonAnchor, weight: outlierGuardWeight },
    ]) ?? projected;

  if (input.sampleSize < 10 && playerSpecificTier) {
    projected = weightedBlend([
      { value: projected, weight: 0.72 },
      { value: seasonAnchor, weight: 0.28 },
    ]) ?? projected;
  }
  if (input.sampleSize < 6 && playerSpecificTier) {
    projected = weightedBlend([
      { value: projected, weight: 0.58 },
      { value: seasonAnchor, weight: 0.42 },
    ]) ?? projected;
  }

  return round(Math.max(0, projected), 2);
}

export function projectTonightMetrics(input: ProjectTonightInput): SnapshotMetricRecord {
  const minutesProfile = projectMinutesProfile({
    minutesLast3Avg: input.minutesLast3Avg,
    minutesLast10Avg: input.minutesLast10Avg,
    minutesHomeAwayAvg: input.minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg: input.minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: input.minutesCurrentTeamGames,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });

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
      minutesProfile,
      minutesLast3Avg: input.minutesLast3Avg,
      minutesLast10Avg: input.minutesLast10Avg,
      minutesVolatility: input.minutesVolatility,
      minutesHomeAwayAvg: input.minutesHomeAwayAvg,
      minutesCurrentTeamLast5Avg: input.minutesCurrentTeamLast5Avg,
      minutesCurrentTeamGames: input.minutesCurrentTeamGames,
      lineupStarter: input.lineupStarter,
      starterRateLast10: input.starterRateLast10,
    });
  });
  return result;
}
