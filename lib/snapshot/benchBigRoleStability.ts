import type { SnapshotMetricRecord } from "@/lib/types/snapshot";

const BIG_ROLE_ARCHETYPES = new Set([
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "BENCH_TRADITIONAL_BIG",
  "BENCH_STRETCH_BIG",
  "BENCH_LOW_USAGE_BIG",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isBenchBigOrCenterArchetype(archetype: string | null | undefined): boolean {
  if (archetype == null) return false;
  if (BIG_ROLE_ARCHETYPES.has(archetype)) return true;

  // Backtest rows still use the coarse B_LOW / B_MID / B_HIGH archetype family.
  return archetype === "B" || archetype.startsWith("B_");
}

export function computeMissingFrontcourtLoad(missingCoreAverage: SnapshotMetricRecord | null | undefined): number {
  if (!missingCoreAverage) return 0;
  const rebLoad = (missingCoreAverage.REB ?? 0) / 7.5;
  const raLoad = (missingCoreAverage.RA ?? 0) / 8.5;
  const prLoad = (missingCoreAverage.PR ?? 0) / 18;
  const ptsLoad = (missingCoreAverage.PTS ?? 0) / 22;
  return round(clamp(rebLoad * 0.42 + raLoad * 0.28 + prLoad * 0.2 + ptsLoad * 0.1, 0, 1.6));
}

export function computeBenchBigRoleStability(input: {
  archetype: string | null | undefined;
  minutesVolatility: number | null | undefined;
  availabilitySeverity?: number | null | undefined;
  missingFrontcourtLoad?: number | null | undefined;
}): number | null {
  if (!isBenchBigOrCenterArchetype(input.archetype)) return null;

  const minutesStability =
    input.minutesVolatility == null ? 0.85 : Math.max(0.1, 1 / (Math.max(0, input.minutesVolatility) + 1));
  const missingFrontcourtPenalty = 1 - clamp((input.missingFrontcourtLoad ?? 0) / 1.6, 0, 1) * 0.65;
  const availabilityPenalty = 1 - clamp(input.availabilitySeverity ?? 0, 0, 1) * 0.35;

  return round(clamp(minutesStability * missingFrontcourtPenalty * availabilityPenalty, 0.08, 1));
}
