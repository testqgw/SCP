import type { SnapshotMarket } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

export type CurrentLineRecencyMetrics = {
  l5CurrentLineDeltaAvg: number | null;
  l5CurrentLineOverRate: number | null;
  l5MinutesAvg: number | null;
};

type NumberLike = number | null | undefined;

type CurrentLineRecencyRow = {
  playerId: string;
  market: SnapshotMarket;
  gameDateEt: string;
  line: number | null;
  actualValue?: number | null;
  actualMinutes?: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeFiniteValues(values: NumberLike[]): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

export function computeCurrentLineRecencyMetrics(input: {
  recentActualValues: NumberLike[];
  recentMinutes: NumberLike[];
  currentLine: number | null;
}): CurrentLineRecencyMetrics {
  const actualValues = normalizeFiniteValues(input.recentActualValues);
  const recentMinutes = normalizeFiniteValues(input.recentMinutes);
  const line = input.currentLine != null && Number.isFinite(input.currentLine) ? input.currentLine : null;

  const l5MinutesAvgRaw = average(recentMinutes);
  if (line == null || actualValues.length === 0) {
    return {
      l5CurrentLineDeltaAvg: null,
      l5CurrentLineOverRate: null,
      l5MinutesAvg: l5MinutesAvgRaw == null ? null : round(l5MinutesAvgRaw, 3),
    };
  }

  const deltas = actualValues.map((value) => value - line);
  const overIndicators = actualValues.map((value) => (value > line ? 1 : value < line ? 0 : 0.5));

  const l5CurrentLineDeltaAvgRaw = average(deltas);
  const l5CurrentLineOverRateRaw = average(overIndicators);

  return {
    l5CurrentLineDeltaAvg: l5CurrentLineDeltaAvgRaw == null ? null : round(l5CurrentLineDeltaAvgRaw, 3),
    l5CurrentLineOverRate: l5CurrentLineOverRateRaw == null ? null : round(l5CurrentLineOverRateRaw, 3),
    l5MinutesAvg: l5MinutesAvgRaw == null ? null : round(l5MinutesAvgRaw, 3),
  };
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
        if (recentActualValues.length > 5) recentActualValues.shift();
      }

      const actualMinutes = row.actualMinutes;
      if (actualMinutes != null && Number.isFinite(actualMinutes)) {
        recentMinutes.push(actualMinutes);
        if (recentMinutes.length > 5) recentMinutes.shift();
      }
    });
  });

  return enriched;
}
