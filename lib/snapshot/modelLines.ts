import type {
  SnapshotMarket,
  SnapshotMetricRecord,
  SnapshotModelLine,
  SnapshotModelLineRecord,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

const BASE_BUFFER_BY_MARKET: Record<SnapshotMarket, number> = {
  PTS: 1,
  REB: 0.5,
  AST: 0.5,
  THREES: 0.5,
  PRA: 1.5,
  PA: 1,
  PR: 1,
  RA: 1,
};

const VOL_FACTOR_BY_MARKET: Record<SnapshotMarket, number> = {
  PTS: 0.18,
  REB: 0.22,
  AST: 0.24,
  THREES: 0.34,
  PRA: 0.16,
  PA: 0.18,
  PR: 0.18,
  RA: 0.2,
};

const MAX_BUFFER_BY_MARKET: Record<SnapshotMarket, number> = {
  PTS: 2.5,
  REB: 1.5,
  AST: 1.5,
  THREES: 1,
  PRA: 3,
  PA: 2.5,
  PR: 2.5,
  RA: 2,
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | null {
  const avg = average(values);
  if (avg == null || values.length === 0) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return Math.sqrt(variance);
}

function toHalfStep(value: number): number {
  return round(Math.round(value * 2) / 2, 1);
}

function toHalfHookLine(value: number): number {
  const base = Math.floor(value);
  const lower = Math.max(0.5, base + 0.5);
  const upper = lower + 1;
  return round(Math.abs(value - lower) <= Math.abs(upper - value) ? lower : upper, 1);
}

function completenessMultiplier(score: number): number {
  if (score >= 85) return 0.9;
  if (score >= 70) return 1;
  return 1.15;
}

function neutralModelLine(): SnapshotModelLine {
  return {
    fairLine: null,
    modelSide: "NEUTRAL",
    projectionGap: null,
    actionOverLine: null,
    actionUnderLine: null,
    actionBuffer: null,
    volatility: null,
  };
}

export function buildModelLineRecord(input: {
  projectedTonight: SnapshotMetricRecord;
  last10ByMarket: Record<SnapshotMarket, number[]>;
  dataCompletenessScore: number;
}): SnapshotModelLineRecord {
  const result = {} as SnapshotModelLineRecord;

  MARKETS.forEach((market) => {
    const projection = input.projectedTonight[market];
    if (projection == null) {
      result[market] = neutralModelLine();
      return;
    }

    const volatilityRaw = standardDeviation(input.last10ByMarket[market]);
    const volatility = volatilityRaw == null ? null : round(volatilityRaw, 2);
    const rawBuffer = Math.max(
      BASE_BUFFER_BY_MARKET[market],
      (volatilityRaw ?? BASE_BUFFER_BY_MARKET[market]) * VOL_FACTOR_BY_MARKET[market],
    );
    const adjustedBuffer = Math.min(
      MAX_BUFFER_BY_MARKET[market],
      rawBuffer * completenessMultiplier(input.dataCompletenessScore),
    );
    const actionBuffer = Math.max(0.5, toHalfStep(adjustedBuffer));
    const fairLine = toHalfHookLine(projection);
    const projectionGap = round(projection - fairLine, 2);

    result[market] = {
      fairLine,
      modelSide: projectionGap > 0 ? "OVER" : projectionGap < 0 ? "UNDER" : "NEUTRAL",
      projectionGap,
      actionOverLine: round(Math.max(0.5, fairLine - actionBuffer), 1),
      actionUnderLine: round(fairLine + actionBuffer, 1),
      actionBuffer,
      volatility,
    };
  });

  return result;
}
