import type { SnapshotPtsSignal } from "@/lib/types/snapshot";

type PrecisionConfidenceSignal = {
  side?: string | null;
  qualified?: boolean;
  historicalAccuracy?: number | null;
  projectionWinProbability?: number | null;
  projectionPriceEdge?: number | null;
  absLineGap?: number | null;
  selectionScore?: number | null;
};

type LiveConfidenceSignal = Pick<SnapshotPtsSignal, "confidence" | "sportsbookCount">;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function getMeaningfulHistoricalAccuracy(
  signal: Pick<PrecisionConfidenceSignal, "historicalAccuracy"> | null | undefined,
): number | null {
  const historicalAccuracy = signal?.historicalAccuracy;
  return historicalAccuracy != null && historicalAccuracy > 0 ? historicalAccuracy : null;
}

function weightedAverage(parts: Array<{ value: number | null; weight: number }>) {
  const active = parts.filter((part): part is { value: number; weight: number } => part.value != null && part.weight > 0);
  const totalWeight = active.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return null;
  return active.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
}

function selectionScoreBonus(selectionScore: number | null | undefined) {
  if (selectionScore == null || !Number.isFinite(selectionScore)) return 0;
  return clamp((selectionScore - 0.62) * 9, -1.5, 4.5);
}

function edgeBonus(input: Pick<PrecisionConfidenceSignal, "projectionPriceEdge" | "absLineGap">) {
  const priceEdge = input.projectionPriceEdge == null ? 0 : clamp(Math.abs(input.projectionPriceEdge) * 18, 0, 2.5);
  const lineGap = input.absLineGap == null ? 0 : clamp(input.absLineGap * 0.55, 0, 2.2);
  return Math.max(priceEdge, lineGap);
}

function bookSupportBonus(liveSignal: LiveConfidenceSignal | null | undefined) {
  const sportsbookCount = liveSignal?.sportsbookCount ?? 0;
  if (sportsbookCount <= 0) return 0;
  return clamp((sportsbookCount - 2) * 0.28, 0, 1.8);
}

function capForSupport(input: {
  confidence: number;
  precisionSignal: PrecisionConfidenceSignal | null;
  liveSignal: LiveConfidenceSignal | null;
}) {
  const projectionPct =
    input.precisionSignal?.projectionWinProbability == null
      ? null
      : clamp(input.precisionSignal.projectionWinProbability * 100, 45, 95);
  const historicalAccuracy = getMeaningfulHistoricalAccuracy(input.precisionSignal);
  const liveConfidence = input.liveSignal?.confidence ?? null;
  const sportsbookCount = input.liveSignal?.sportsbookCount ?? 0;
  let cap = 94;

  if (projectionPct != null && projectionPct < 55) cap = Math.min(cap, 72);
  else if (projectionPct != null && projectionPct < 60) cap = Math.min(cap, 78);

  if (historicalAccuracy != null && historicalAccuracy < 66) cap = Math.min(cap, 74);
  if (liveConfidence != null && liveConfidence < 58) cap = Math.min(cap, 77);
  if (sportsbookCount > 0 && sportsbookCount < 3) cap = Math.min(cap, 76);

  return Math.min(input.confidence, cap);
}

export function resolvePickConfidenceRating(input: {
  precisionSignal?: PrecisionConfidenceSignal | null;
  liveSignal?: LiveConfidenceSignal | null;
}): number | null {
  const precisionSignal = input.precisionSignal ?? null;
  const liveSignal = input.liveSignal ?? null;
  const projectionPct =
    precisionSignal?.projectionWinProbability == null
      ? null
      : clamp(precisionSignal.projectionWinProbability * 100, 45, 95);
  const historicalAccuracy = getMeaningfulHistoricalAccuracy(precisionSignal);
  const liveConfidence = liveSignal?.confidence == null ? null : clamp(liveSignal.confidence, 45, 92);

  let confidence = weightedAverage([
    { value: projectionPct, weight: projectionPct == null ? 0 : 0.56 },
    { value: historicalAccuracy, weight: historicalAccuracy == null ? 0 : 0.3 },
    { value: liveConfidence, weight: liveConfidence == null ? 0 : 0.14 },
  ]);

  if (confidence == null && liveConfidence != null) {
    confidence = clamp(liveConfidence + bookSupportBonus(liveSignal), 45, 88);
  }
  if (confidence == null) return null;

  if (precisionSignal) {
    confidence += selectionScoreBonus(precisionSignal.selectionScore);
    confidence += edgeBonus(precisionSignal);
    if (precisionSignal.qualified && precisionSignal.side != null && precisionSignal.side !== "NEUTRAL") confidence += 1.2;
  }
  confidence += bookSupportBonus(liveSignal);

  return round(clamp(capForSupport({ confidence, precisionSignal, liveSignal }), 45, 94), 2);
}
