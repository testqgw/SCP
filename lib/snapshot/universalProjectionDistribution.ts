import type { SnapshotMarket } from "@/lib/types/snapshot";
import type { UniversalMinutesBucket } from "@/lib/snapshot/universalResidualCalibration";

export type UniversalProjectionDistributionScope = "market_archetype_minutes" | "market_minutes" | "market";

export type UniversalProjectionDistributionRecord = {
  scope: UniversalProjectionDistributionScope;
  market: SnapshotMarket;
  archetype: string | null;
  minutesBucket: UniversalMinutesBucket | null;
  sampleCount: number;
  residualMean: number;
  residualMedian: number;
  residualStdDev: number;
  residualMad: number;
  residualQ10: number | null;
  residualQ25: number | null;
  residualQ75: number | null;
  residualQ90: number | null;
};

export type UniversalProjectionDistributionFile = {
  generatedAt: string;
  inputFile: string;
  modelFile: string;
  records: UniversalProjectionDistributionRecord[];
};

export function buildUniversalProjectionDistributionKey(
  scope: UniversalProjectionDistributionScope,
  market: SnapshotMarket,
  archetype: string | null | undefined,
  minutesBucket: UniversalMinutesBucket | null | undefined,
): string {
  switch (scope) {
    case "market_archetype_minutes":
      return `${scope}|${market}|${archetype ?? "UNKNOWN"}|${minutesBucket ?? "UNKNOWN"}`;
    case "market_minutes":
      return `${scope}|${market}|${minutesBucket ?? "UNKNOWN"}`;
    case "market":
      return `${scope}|${market}`;
    default:
      return `${scope}|${market}`;
  }
}
