import type { SnapshotMarket } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

export type CurrentLineRecencyMetrics = {
  l5CurrentLineDeltaAvg: number | null;
  l5CurrentLineOverRate: number | null;
  l10CurrentLineOverRate: number | null;
  l15CurrentLineOverRate: number | null;
  weightedCurrentLineOverRate: number | null;
  l5MinutesAvg: number | null;
  emaCurrentLineDelta: number | null;
  emaCurrentLineOverRate: number | null;
  emaMinutesAvg: number | null;
  l15ValueMean: number | null;
  l15ValueMedian: number | null;
  l15ValueStdDev: number | null;
  l15ValueSkew: number | null;
};

type NumberLike = number | null | undefined;

type CurrentLineRecencyRow = {
  playerId: string;
  market: SnapshotMarket;
  gameDateEt: string;
  line: number | null;
  projectedValue?: number | null;
  actualValue?: number | null;
  actualMinutes?: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => {
      const diff = value - avg;
      return sum + diff * diff;
    }, 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

function ema(values: number[], alpha: number): number | null {
  if (values.length === 0) return null;
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = alpha * values[index] + (1 - alpha) * current;
  }
  return current;
}

function normalizeFiniteValues(values: NumberLike[]): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

function weightedRate(parts: Array<{ value: number | null; weight: number }>): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  parts.forEach((part) => {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) return;
    weightedTotal += part.value * part.weight;
    totalWeight += part.weight;
  });
  if (totalWeight <= 0) return null;
  return weightedTotal / totalWeight;
}

function roundOrNull(value: number | null, digits: number): number | null {
  return value == null ? null : round(value, digits);
}

function buildEmptyCurrentLineRecencyMetrics(raw: {
  l5MinutesAvgRaw: number | null;
  emaMinutesAvgRaw: number | null;
  l15ValueMeanRaw: number | null;
  l15ValueMedianRaw: number | null;
  l15ValueStdDevRaw: number | null;
  l15ValueSkewRaw: number | null;
}): CurrentLineRecencyMetrics {
  return {
    l5CurrentLineDeltaAvg: null,
    l5CurrentLineOverRate: null,
    l10CurrentLineOverRate: null,
    l15CurrentLineOverRate: null,
    weightedCurrentLineOverRate: null,
    l5MinutesAvg: roundOrNull(raw.l5MinutesAvgRaw, 3),
    emaCurrentLineDelta: null,
    emaCurrentLineOverRate: null,
    emaMinutesAvg: roundOrNull(raw.emaMinutesAvgRaw, 3),
    l15ValueMean: roundOrNull(raw.l15ValueMeanRaw, 3),
    l15ValueMedian: roundOrNull(raw.l15ValueMedianRaw, 3),
    l15ValueStdDev: roundOrNull(raw.l15ValueStdDevRaw, 3),
    l15ValueSkew: roundOrNull(raw.l15ValueSkewRaw, 4),
  };
}

function buildCurrentLineRecencyMetrics(raw: {
  l5CurrentLineDeltaAvgRaw: number | null;
  l5CurrentLineOverRateRaw: number | null;
  l10CurrentLineOverRateRaw: number | null;
  l15CurrentLineOverRateRaw: number | null;
  weightedCurrentLineOverRateRaw: number | null;
  l5MinutesAvgRaw: number | null;
  emaCurrentLineDeltaRaw: number | null;
  emaCurrentLineOverRateRaw: number | null;
  emaMinutesAvgRaw: number | null;
  l15ValueMeanRaw: number | null;
  l15ValueMedianRaw: number | null;
  l15ValueStdDevRaw: number | null;
  l15ValueSkewRaw: number | null;
}): CurrentLineRecencyMetrics {
  return {
    l5CurrentLineDeltaAvg: roundOrNull(raw.l5CurrentLineDeltaAvgRaw, 3),
    l5CurrentLineOverRate: roundOrNull(raw.l5CurrentLineOverRateRaw, 3),
    l10CurrentLineOverRate: roundOrNull(raw.l10CurrentLineOverRateRaw, 3),
    l15CurrentLineOverRate: roundOrNull(raw.l15CurrentLineOverRateRaw, 3),
    weightedCurrentLineOverRate: roundOrNull(raw.weightedCurrentLineOverRateRaw, 3),
    l5MinutesAvg: roundOrNull(raw.l5MinutesAvgRaw, 3),
    emaCurrentLineDelta: roundOrNull(raw.emaCurrentLineDeltaRaw, 3),
    emaCurrentLineOverRate: roundOrNull(raw.emaCurrentLineOverRateRaw, 3),
    emaMinutesAvg: roundOrNull(raw.emaMinutesAvgRaw, 3),
    l15ValueMean: roundOrNull(raw.l15ValueMeanRaw, 3),
    l15ValueMedian: roundOrNull(raw.l15ValueMedianRaw, 3),
    l15ValueStdDev: roundOrNull(raw.l15ValueStdDevRaw, 3),
    l15ValueSkew: roundOrNull(raw.l15ValueSkewRaw, 4),
  };
}

const CURRENT_LINE_RECENCY_EMA_ALPHA = (() => {
  const raw = Number(process.env.SNAPSHOT_CURRENT_LINE_RECENCY_EMA_ALPHA);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.5;
})();

export function computeCurrentLineRecencyMetrics(input: {
  recentActualValues: NumberLike[];
  recentMinutes: NumberLike[];
  currentLine: number | null;
}): CurrentLineRecencyMetrics {
  const actualValues = normalizeFiniteValues(input.recentActualValues);
  const recentMinutes = normalizeFiniteValues(input.recentMinutes);
  const recentActualValuesL5 = actualValues.slice(-5);
  const recentActualValuesL10 = actualValues.slice(-10);
  const recentActualValuesL15 = actualValues.slice(-15);
  const recentMinutesL5 = recentMinutes.slice(-5);
  const line = input.currentLine != null && Number.isFinite(input.currentLine) ? input.currentLine : null;

  const l5MinutesAvgRaw = average(recentMinutesL5);
  const emaMinutesAvgRaw = ema(recentMinutesL5, CURRENT_LINE_RECENCY_EMA_ALPHA);
  const l15ValueMeanRaw = average(actualValues);
  const l15ValueMedianRaw = median(actualValues);
  const l15ValueStdDevRaw = standardDeviation(actualValues);
  const l15ValueSkewRaw =
    l15ValueMeanRaw == null ||
    l15ValueMedianRaw == null ||
    l15ValueStdDevRaw == null ||
    l15ValueStdDevRaw <= 0
      ? null
      : (l15ValueMeanRaw - l15ValueMedianRaw) / l15ValueStdDevRaw;
  if (line == null || actualValues.length === 0) {
    return buildEmptyCurrentLineRecencyMetrics({
      l5MinutesAvgRaw,
      emaMinutesAvgRaw,
      l15ValueMeanRaw,
      l15ValueMedianRaw,
      l15ValueStdDevRaw,
      l15ValueSkewRaw,
    });
  }

  const deltas = recentActualValuesL5.map((value) => value - line);
  const overIndicators = recentActualValuesL5.map((value) => (value > line ? 1 : value < line ? 0 : 0.5));
  const overIndicatorsL10 = recentActualValuesL10.map((value) => (value > line ? 1 : value < line ? 0 : 0.5));
  const overIndicatorsL15 = recentActualValuesL15.map((value) => (value > line ? 1 : value < line ? 0 : 0.5));

  const l5CurrentLineDeltaAvgRaw = average(deltas);
  const l5CurrentLineOverRateRaw = average(overIndicators);
  const l10CurrentLineOverRateRaw = average(overIndicatorsL10);
  const l15CurrentLineOverRateRaw = average(overIndicatorsL15);
  const weightedCurrentLineOverRateRaw = weightedRate([
    { value: l5CurrentLineOverRateRaw, weight: 0.45 },
    { value: l10CurrentLineOverRateRaw, weight: 0.35 },
    { value: l15CurrentLineOverRateRaw, weight: 0.2 },
  ]);
  const emaCurrentLineDeltaRaw = ema(deltas, CURRENT_LINE_RECENCY_EMA_ALPHA);
  const emaCurrentLineOverRateRaw = ema(overIndicators, CURRENT_LINE_RECENCY_EMA_ALPHA);

  return buildCurrentLineRecencyMetrics({
    l5CurrentLineDeltaAvgRaw,
    l5CurrentLineOverRateRaw,
    l10CurrentLineOverRateRaw,
    l15CurrentLineOverRateRaw,
    weightedCurrentLineOverRateRaw,
    l5MinutesAvgRaw,
    emaCurrentLineDeltaRaw,
    emaCurrentLineOverRateRaw,
    emaMinutesAvgRaw,
    l15ValueMeanRaw,
    l15ValueMedianRaw,
    l15ValueStdDevRaw,
    l15ValueSkewRaw,
  });
}

export function attachCurrentLineRecencyMetrics<T extends CurrentLineRecencyRow>(
  rows: readonly T[],
): Array<T & CurrentLineRecencyMetrics> {
  const grouped = new Map<string, Array<{ row: T; index: number }>>();
  rows.forEach((row, index) => {
    const bucket = grouped.get(`${row.playerId}|${row.market}`) ?? [];
    bucket.push({ row, index });
    grouped.set(`${row.playerId}|${row.market}`, bucket);
  });

  const enriched = new Array<T & CurrentLineRecencyMetrics>(rows.length);
  grouped.forEach((entries) => {
    entries.sort((left, right) => {
      if (left.row.gameDateEt !== right.row.gameDateEt) {
        return left.row.gameDateEt.localeCompare(right.row.gameDateEt);
      }
      return left.index - right.index;
    });

    const recentActualValues: number[] = [];
    const recentMinutes: number[] = [];
    entries.forEach(({ row, index }) => {
      enriched[index] = {
        ...row,
        ...computeCurrentLineRecencyMetrics({
          recentActualValues,
          recentMinutes,
          currentLine: row.line,
        }),
      };

      const actualValue = row.actualValue;
      if (actualValue != null && Number.isFinite(actualValue)) {
        recentActualValues.push(actualValue);
        if (recentActualValues.length > 15) recentActualValues.shift();
      }

      const actualMinutes = row.actualMinutes;
      if (actualMinutes != null && Number.isFinite(actualMinutes)) {
        recentMinutes.push(actualMinutes);
        if (recentMinutes.length > 15) recentMinutes.shift();
      }
    });
  });

  return enriched;
}
