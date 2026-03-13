import { round } from "@/lib/utils";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

export const SNAPSHOT_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

type PersonalMarketModel = {
  slope: number;
  intercept: number;
  confidence: number;
  samples: number;
  mae: number;
};

export type PlayerPersonalModels = Record<SnapshotMarket, PersonalMarketModel | null>;

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

const PLAYER_SPECIFIC_MODEL_MIN_SAMPLES = (() => {
  const parsed = Number(process.env.SNAPSHOT_PLAYER_MODEL_MIN_SAMPLES);
  if (!Number.isFinite(parsed) || parsed <= 0) return 18;
  return clamp(Math.floor(parsed), 10, 34);
})();

const COMBO_SUM_WEIGHT = (() => {
  const parsed = Number(process.env.SNAPSHOT_COMBO_SUM_WEIGHT);
  if (!Number.isFinite(parsed)) return 0.88;
  return clamp(parsed, 0, 1);
})();

const COMBO_DIRECT_WEIGHT = (() => {
  const parsed = Number(process.env.SNAPSHOT_COMBO_DIRECT_WEIGHT);
  if (!Number.isFinite(parsed)) return 0.12;
  return clamp(parsed, 0, 1);
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
  personalModel: PersonalMarketModel | null;
  minutesSeasonAvg: number | null;
  historyValues: number[];
  historyMinutes: number[];
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
  historyByMarket: Record<SnapshotMarket, number[]>;
  historyMinutes: number[];
  sampleSize: number;
  personalModels?: PlayerPersonalModels | null;
  minutesSeasonAvg?: number | null;
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

export type BuildPlayerPersonalModelsInput = {
  historyByMarket: Record<SnapshotMarket, number[]>;
  minutesSeasonAvg: number | null;
  minSamples?: number;
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

function createEmptyPlayerPersonalModels(): PlayerPersonalModels {
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

function buildPersonalSignal(values: number[]): number | null {
  if (values.length === 0) return null;
  const last3 = average(values.slice(-3));
  const last10 = average(values.slice(-10));
  const season = average(values);
  return weightedBlend([
    { value: last3, weight: 0.4 },
    { value: last10, weight: 0.4 },
    { value: season, weight: 0.2 },
  ]);
}

function buildPersonalMarketModel(valuesChronological: number[], minSamples: number): PersonalMarketModel | null {
  if (valuesChronological.length < Math.max(14, minSamples)) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 10; index < valuesChronological.length; index += 1) {
    const history = valuesChronological.slice(0, index);
    const signal = buildPersonalSignal(history);
    const actual = valuesChronological[index];
    if (signal == null || !Number.isFinite(actual)) continue;
    xs.push(signal);
    ys.push(actual);
  }

  if (xs.length < minSamples) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  if (meanX == null || meanY == null) return null;

  let sumCov = 0;
  let sumVarX = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sumCov += dx * dy;
    sumVarX += dx * dx;
  }

  const ridge = 0.8;
  const rawSlope = sumCov / Math.max(0.0001, sumVarX + ridge);
  const slope = clamp(rawSlope, 0.25, 1.75);
  const rawIntercept = meanY - slope * meanX;
  const interceptCap = Math.max(2.5, Math.abs(meanY) * 0.75 + 3);
  const intercept = clamp(rawIntercept, -interceptCap, interceptCap);

  let maeAcc = 0;
  let sst = 0;
  let sse = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const predicted = intercept + slope * xs[i];
    const error = predicted - ys[i];
    maeAcc += Math.abs(error);
    sse += error * error;
    const centered = ys[i] - meanY;
    sst += centered * centered;
  }

  const mae = maeAcc / xs.length;
  const r2 = sst <= 0 ? 0 : clamp(1 - sse / sst, -1, 1);
  const sampleScore = clamp((xs.length - minSamples) / 42, 0, 1);
  const fitScore = clamp(1 - mae / (Math.abs(meanY) + 1.25), 0, 1);
  const r2Score = clamp((r2 + 1) / 2, 0, 1);
  const confidence = clamp(0.18 + sampleScore * 0.42 + fitScore * 0.25 + r2Score * 0.15, 0.18, 0.95);

  return {
    slope: round(slope, 4),
    intercept: round(intercept, 3),
    confidence: round(confidence, 3),
    samples: xs.length,
    mae: round(mae, 3),
  };
}

function minutesConditionedEstimate(
  historyValuesRecentFirst: number[],
  historyMinutesRecentFirst: number[],
  expectedMinutes: number,
): { value: number | null; median: number | null; sample: number } {
  if (historyValuesRecentFirst.length === 0 || historyMinutesRecentFirst.length === 0) {
    return { value: null, median: null, sample: 0 };
  }

  const pairs = historyValuesRecentFirst
    .map((value, index) => ({
      value,
      minutes: historyMinutesRecentFirst[index] ?? 0,
    }))
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.minutes) && item.minutes > 0);

  if (pairs.length === 0) return { value: null, median: null, sample: 0 };

  const weighted = (
    items: Array<{ value: number; minutes: number }>,
    decay: number,
  ): { value: number | null; median: number | null; sample: number } => {
    if (items.length === 0) return { value: null, median: null, sample: 0 };
    let totalWeight = 0;
    let weightedSum = 0;
    items.forEach((item) => {
      const weight = Math.exp(-Math.abs(item.minutes - expectedMinutes) / decay);
      totalWeight += weight;
      weightedSum += item.value * weight;
    });
    const values = items.map((item) => item.value);
    const med = median(values);
    if (totalWeight <= 0) return { value: null, median: med, sample: items.length };
    return { value: round(weightedSum / totalWeight, 2), median: med, sample: items.length };
  };

  const near = pairs.filter((item) => Math.abs(item.minutes - expectedMinutes) <= 3).slice(0, 32);
  if (near.length >= 7) {
    return weighted(near, 2.3);
  }

  const medium = pairs.filter((item) => Math.abs(item.minutes - expectedMinutes) <= 5).slice(0, 40);
  if (medium.length >= 9) {
    return weighted(medium, 3.2);
  }

  return weighted(pairs.slice(0, 40), 4.6);
}

export function buildPlayerPersonalModels(input: BuildPlayerPersonalModelsInput): PlayerPersonalModels {
  const result = createEmptyPlayerPersonalModels();
  if (input.minutesSeasonAvg == null || input.minutesSeasonAvg < PLAYER_SPECIFIC_MINUTES_THRESHOLD) {
    return result;
  }

  const minSamples = clamp(Math.floor(input.minSamples ?? PLAYER_SPECIFIC_MODEL_MIN_SAMPLES), 10, 40);
  SNAPSHOT_MARKETS.forEach((market) => {
    const series = input.historyByMarket[market] ?? [];
    result[market] = buildPersonalMarketModel(series, minSamples);
  });
  return result;
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
  const isVolumeMarket =
    input.market === "PTS" || input.market === "PRA" || input.market === "PA" || input.market === "PR";
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
  const minutesConditioned = minutesConditionedEstimate(input.historyValues, input.historyMinutes, expectedMinutes);
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
  const seasonMinutes = input.minutesSeasonAvg ?? input.minutesLast10Avg ?? expectedMinutes;
  const playerSpecificTier = seasonMinutes >= PLAYER_SPECIFIC_MINUTES_THRESHOLD;

  const globalProjection =
    seasonAnchor + (base - seasonAnchor) * volatilityShrink + minutesAdjustment + opponentAdjustment + trendAdjustment;
  let projected = globalProjection;

  if (playerSpecificTier) {
    // Personalized model for stable rotation players (>=15 mpg): trust player-specific rate + robust median.
    const personalizedBlend = weightedBlend([
      { value: globalProjection, weight: isVolumeMarket ? 0.28 : 0.36 },
      { value: perMinuteProjection, weight: isVolumeMarket ? 0.33 : 0.26 },
      { value: input.last10Average, weight: 0.2 },
      { value: median10, weight: isVolumeMarket ? 0.12 : 0.11 },
      { value: input.seasonAverage, weight: isVolumeMarket ? 0.07 : 0.07 },
    ]);
    projected = personalizedBlend ?? globalProjection;
    const personalizedTrust = clamp(
      (isVolumeMarket ? 0.32 : 0.3) +
        sampleConfidence * (isVolumeMarket ? 0.36 : 0.34) +
        minutesStability * 0.2 +
        consistencyScore * 0.16,
      isVolumeMarket ? 0.32 : 0.3,
      isVolumeMarket ? 0.94 : 0.92,
    );
    projected =
      weightedBlend([
        { value: projected, weight: personalizedTrust },
        { value: seasonAnchor, weight: 1 - personalizedTrust },
      ]) ?? projected;

    const personalSignal = weightedBlend([
      { value: input.last3Average, weight: 0.4 },
      { value: input.last10Average, weight: 0.4 },
      { value: input.seasonAverage, weight: 0.2 },
    ]);
    const personalProjection =
      input.personalModel && personalSignal != null
        ? round(Math.max(0, input.personalModel.intercept + input.personalModel.slope * personalSignal), 2)
        : null;
    if (personalProjection != null && input.personalModel) {
      const personalWeight = clamp(
        (isVolumeMarket ? 0.22 : 0.15) + input.personalModel.confidence * (isVolumeMarket ? 0.68 : 0.55),
        isVolumeMarket ? 0.22 : 0.15,
        isVolumeMarket ? 0.86 : 0.72,
      );
      projected =
        weightedBlend([
          { value: projected, weight: 1 - personalWeight },
          { value: personalProjection, weight: personalWeight },
        ]) ?? projected;
    }
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

  if (minutesConditioned.value != null) {
    const minutesConditionWeight = clamp(
      0.1 + (minutesConditioned.sample >= 12 ? 0.13 : 0.06) + sampleConfidence * 0.1,
      0.1,
      0.34,
    );
    projected =
      weightedBlend([
        { value: projected, weight: 1 - minutesConditionWeight },
        { value: minutesConditioned.value, weight: minutesConditionWeight },
      ]) ?? projected;
  }

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
  const baseMarkets: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];
  const comboMarkets: SnapshotMarket[] = ["PRA", "PA", "PR", "RA"];
  const directComboProjection = blankMetricRecord();

  const projectionInputFor = (market: SnapshotMarket): ProjectMarketInput => ({
    market,
    last3Average: input.last3Average[market],
    last10Average: input.last10Average[market],
    seasonAverage: input.seasonAverage[market],
    homeAwayAverage: input.homeAwayAverage[market],
    opponentAllowance: input.opponentAllowance[market],
    opponentAllowanceDelta: input.opponentAllowanceDelta[market],
    last10Values: input.last10ByMarket[market],
    historyValues: input.historyByMarket[market],
    historyMinutes: input.historyMinutes,
    sampleSize: input.sampleSize,
    minutesProfile,
    personalModel: input.personalModels?.[market] ?? null,
    minutesSeasonAvg: input.minutesSeasonAvg ?? null,
    minutesLast3Avg: input.minutesLast3Avg,
    minutesLast10Avg: input.minutesLast10Avg,
    minutesVolatility: input.minutesVolatility,
    minutesHomeAwayAvg: input.minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg: input.minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: input.minutesCurrentTeamGames,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });

  baseMarkets.forEach((market) => {
    result[market] = projectMarket(projectionInputFor(market));
  });

  comboMarkets.forEach((market) => {
    directComboProjection[market] = projectMarket(projectionInputFor(market));
  });

  const sumOrNull = (...values: Array<number | null>): number | null => {
    if (values.some((value) => value == null)) return null;
    const numericValues = values as number[];
    return round(numericValues.reduce((total, value) => total + value, 0), 2);
  };

  const summedCombo: Partial<Record<SnapshotMarket, number | null>> = {
    PRA: sumOrNull(result.PTS, result.REB, result.AST),
    PA: sumOrNull(result.PTS, result.AST),
    PR: sumOrNull(result.PTS, result.REB),
    RA: sumOrNull(result.REB, result.AST),
  };

  comboMarkets.forEach((market) => {
    result[market] =
      weightedBlend([
        { value: summedCombo[market] ?? null, weight: COMBO_SUM_WEIGHT },
        { value: directComboProjection[market], weight: COMBO_DIRECT_WEIGHT },
      ]) ??
      summedCombo[market] ??
      directComboProjection[market];
  });

  return result;
}
