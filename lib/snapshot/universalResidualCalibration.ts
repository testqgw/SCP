import type { SnapshotMarket } from "@/lib/types/snapshot";

export type UniversalMinutesBucket = "LT_24" | "MIN_24_29" | "MIN_30_35" | "MIN_36_PLUS";

export type UniversalResidualCalibrationRecord = {
  market: SnapshotMarket;
  archetype: string;
  minutesBucket: UniversalMinutesBucket;
  sampleCount: number;
  recent7Samples: number;
  recent14Samples: number;
  fullAccuracy: number;
  recent7Accuracy: number | null;
  recent14Accuracy: number | null;
  recentWeightedAccuracy: number | null;
  bucketAccuracyAdjustment: number;
  leafAccuracyAdjustment: number;
};

export type UniversalResidualCalibrationFile = {
  generatedAt: string;
  inputFile: string;
  modelFile: string;
  shortWindowDays: number;
  longWindowDays: number;
  adjustmentMode?: "penalties_only" | "symmetric";
  records: UniversalResidualCalibrationRecord[];
};

export function universalMinutesBucket(expectedMinutes: number | null | undefined): UniversalMinutesBucket {
  const minutes = expectedMinutes ?? 0;
  if (minutes < 24) return "LT_24";
  if (minutes < 30) return "MIN_24_29";
  if (minutes < 36) return "MIN_30_35";
  return "MIN_36_PLUS";
}

export function buildUniversalResidualCalibrationKey(
  market: SnapshotMarket,
  archetype: string | null | undefined,
  minutesBucket: UniversalMinutesBucket | null | undefined,
): string | null {
  if (!archetype || !minutesBucket) return null;
  return `${market}|${archetype}|${minutesBucket}`;
}
