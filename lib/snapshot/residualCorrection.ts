import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";

// Live port of the global residual-bin correction in scripts/backtest-projection-model.ts.
// The training rows behind the live side models were built with it (weight 1.3, residuals from
// games with 15+ actual minutes), so raw live projections reached those models biased high.
// Each market is corrected on its own bins: bins are keyed by the raw projection, and residuals
// are measured against the corrected projection, exactly as the backtest updates them.
export const RESIDUAL_CORRECTION_WEIGHT = 1.3;
export const RESIDUAL_MIN_ACTUAL_MINUTES = 15;
const MAX_RESIDUALS_PER_BIN = 900;

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

export type ResidualBins = Map<string, number[]>;

export type ResidualLedgerEntry = {
  market: SnapshotMarket;
  rawProjection: number;
  actual: number;
};

export type ResidualLedgerDay = {
  dateEt: string;
  // Only games with at least RESIDUAL_MIN_ACTUAL_MINUTES played.
  entries: ResidualLedgerEntry[];
};

export function residualCapForMarket(market: SnapshotMarket): number {
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

export function biasBinSizeForMarket(market: SnapshotMarket): number {
  switch (market) {
    case "THREES":
      return 0.5;
    case "REB":
    case "AST":
      return 1;
    case "PTS":
    case "RA":
    case "PA":
    case "PR":
      return 2;
    case "PRA":
      return 3;
    default:
      return 1;
  }
}

function binKey(market: SnapshotMarket, rawProjection: number): string {
  return `${market}:${Math.floor(rawProjection / Math.max(0.1, biasBinSizeForMarket(market)))}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function correctProjection(bins: ResidualBins, market: SnapshotMarket, rawProjection: number | null): number | null {
  if (rawProjection == null || !Number.isFinite(rawProjection)) return rawProjection;
  const residualMedian = median(bins.get(binKey(market, rawProjection)) ?? []);
  if (residualMedian == null) return rawProjection;
  const cap = residualCapForMarket(market);
  const adjustment = Math.max(-cap, Math.min(cap, residualMedian * RESIDUAL_CORRECTION_WEIGHT));
  return round2(Math.max(0, rawProjection + adjustment));
}

export function correctMetricRecord(bins: ResidualBins, raw: SnapshotMetricRecord): SnapshotMetricRecord {
  const corrected = { ...raw };
  for (const market of MARKETS) {
    corrected[market] = correctProjection(bins, market, raw[market]);
  }
  return corrected;
}

/** Adds one settled day; its entries are corrected from the bins as they stood before that day. */
export function addResidualDay(bins: ResidualBins, day: ResidualLedgerDay): void {
  const pending = day.entries.map((entry) => ({
    key: binKey(entry.market, entry.rawProjection),
    residual: entry.actual - (correctProjection(bins, entry.market, entry.rawProjection) ?? entry.rawProjection),
  }));
  for (const { key, residual } of pending) {
    const series = bins.get(key) ?? [];
    series.push(residual);
    if (series.length > MAX_RESIDUALS_PER_BIN) series.shift();
    bins.set(key, series);
  }
}

/** Replays settled days in date order; each day is corrected only from earlier days. */
export function buildResidualBins(days: ResidualLedgerDay[]): ResidualBins {
  const bins: ResidualBins = new Map();
  const ordered = [...days].sort((left, right) => left.dateEt.localeCompare(right.dateEt));
  for (const day of ordered) addResidualDay(bins, day);
  return bins;
}
