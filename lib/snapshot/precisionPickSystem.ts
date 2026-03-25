import {
  inspectLiveUniversalModelSide,
  type PredictLiveUniversalSideInput,
} from "@/lib/snapshot/liveUniversalSideModels";
import type { SnapshotMarket, SnapshotPrecisionPickSignal, SnapshotPrecisionSystemSummary } from "@/lib/types/snapshot";

type PrecisionAvailabilityStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN";
type PrecisionPickInput = PredictLiveUniversalSideInput & {
  availabilityStatus?: PrecisionAvailabilityStatus | null;
  availabilityPercentPlay?: number | null;
};

export type PrecisionRule = {
  minBucketLateAccuracy: number;
  minLeafAccuracy: number;
  minAbsLineGap: number;
  minProjectionWinProbability: number;
  minProjectionPriceEdge: number;
  historicalAccuracy: number;
  historicalPicks: number;
  historicalCoveragePct: number;
};

export type PrecisionRuleSet = Partial<Record<SnapshotMarket, PrecisionRule>>;

export const DAILY_6_MARKET_PACKS = {
  COMBO_CORE: ["PRA", "PR", "RA"],
  COMBO_PLUS_PA: ["PRA", "PA", "PR", "RA"],
  COMBO_PLUS_PTS_PA: ["PTS", "PRA", "PA", "PR", "RA"],
} as const satisfies Record<string, SnapshotMarket[]>;

export const ALL_DAILY_6_RULES: PrecisionRuleSet = {
  PTS: {
    minBucketLateAccuracy: 62,
    minLeafAccuracy: 84,
    minAbsLineGap: 0.75,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 76.84,
    historicalPicks: 190,
    historicalCoveragePct: 0.23,
  },
  REB: {
    minBucketLateAccuracy: 52,
    minLeafAccuracy: 80,
    minAbsLineGap: 0.5,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 75.86,
    historicalPicks: 116,
    historicalCoveragePct: 0.14,
  },
  AST: {
    minBucketLateAccuracy: 66,
    minLeafAccuracy: 76,
    minAbsLineGap: 1,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 79.55,
    historicalPicks: 44,
    historicalCoveragePct: 0.05,
  },
  THREES: {
    minBucketLateAccuracy: 62,
    minLeafAccuracy: 64,
    minAbsLineGap: 0.75,
    minProjectionWinProbability: 0.5,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 78.26,
    historicalPicks: 23,
    historicalCoveragePct: 0.03,
  },
  PRA: {
    minBucketLateAccuracy: 66,
    minLeafAccuracy: 72,
    minAbsLineGap: 2.5,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 76.32,
    historicalPicks: 76,
    historicalCoveragePct: 0.09,
  },
  PA: {
    minBucketLateAccuracy: 54,
    minLeafAccuracy: 72,
    minAbsLineGap: 4,
    minProjectionWinProbability: 0.5,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 73.47,
    historicalPicks: 49,
    historicalCoveragePct: 0.06,
  },
  PR: {
    minBucketLateAccuracy: 54,
    minLeafAccuracy: 84,
    minAbsLineGap: 4,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 81.58,
    historicalPicks: 76,
    historicalCoveragePct: 0.09,
  },
  RA: {
    minBucketLateAccuracy: 54,
    minLeafAccuracy: 76,
    minAbsLineGap: 0.5,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 80.9,
    historicalPicks: 199,
    historicalCoveragePct: 0.24,
  },
};

const DAILY_6_CURRENT_MARKETS = DAILY_6_MARKET_PACKS.COMBO_PLUS_PTS_PA;

export const DEFAULT_DAILY_6_RULES: PrecisionRuleSet = Object.fromEntries(
  DAILY_6_CURRENT_MARKETS.map((market) => [market, ALL_DAILY_6_RULES[market]!]),
) as PrecisionRuleSet;

export const PRECISION_80_SYSTEM_SUMMARY: SnapshotPrecisionSystemSummary = {
  label: "Daily 6",
  historicalAccuracy: 71.24,
  historicalPicks: 525,
  historicalCoveragePct: 0.99,
  historicalPicksPerDay: 6.56,
  supportedMarkets: DAILY_6_CURRENT_MARKETS,
  accuracyLabel: "WF Rate",
  picksPerDayLabel: "WF Picks/Day",
  note:
    "6-fold walk-forward through 2026-03-15. This pack also held 6.10 picks/day over the latest 30-date replay. Similar-spot percentages on individual picks are replay priors, not forward-tested hit rates.",
};

export function getPrecisionRule(ruleSet: PrecisionRuleSet, market: SnapshotMarket): PrecisionRule | null {
  return ruleSet[market] ?? null;
}

export function getPrecision80Rule(market: SnapshotMarket): PrecisionRule | null {
  return getPrecisionRule(DEFAULT_DAILY_6_RULES, market);
}

export function comparePrecisionSignals(
  left: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
  right: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
): number {
  if (right.historicalAccuracy !== left.historicalAccuracy) {
    return right.historicalAccuracy - left.historicalAccuracy;
  }

  const rightWinProbability = right.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  const leftWinProbability = left.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  if (rightWinProbability !== leftWinProbability) {
    return rightWinProbability - leftWinProbability;
  }

  const rightPriceEdge = right.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  const leftPriceEdge = left.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  if (rightPriceEdge !== leftPriceEdge) {
    return rightPriceEdge - leftPriceEdge;
  }

  const rightGap = right.absLineGap ?? Number.NEGATIVE_INFINITY;
  const leftGap = left.absLineGap ?? Number.NEGATIVE_INFINITY;
  if (rightGap !== leftGap) {
    return rightGap - leftGap;
  }

  const rightLeaf = right.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftLeaf = left.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  if (rightLeaf !== leftLeaf) {
    return rightLeaf - leftLeaf;
  }

  const rightBucket = right.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftBucket = left.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;
  if (rightBucket !== leftBucket) {
    return rightBucket - leftBucket;
  }

  return 0;
}

export function buildPrecision80Pick(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  return buildPrecisionPick(input, DEFAULT_DAILY_6_RULES);
}

export function buildPrecisionPick(
  input: PrecisionPickInput,
  ruleSet: PrecisionRuleSet,
): SnapshotPrecisionPickSignal | null {
  const rule = getPrecisionRule(ruleSet, input.market);
  if (!rule) return null;

  const decision = inspectLiveUniversalModelSide(input);
  const bucketRecentAccuracy = decision.bucketLateAccuracy ?? decision.bucketModelAccuracy ?? null;
  const reasons: string[] = [];
  const availabilityStatus = input.availabilityStatus ?? null;
  const availabilityPercentPlay = input.availabilityPercentPlay ?? null;

  if (availabilityStatus === "OUT" || availabilityStatus === "DOUBTFUL") {
    reasons.push("Player is unavailable in the live injury feed.");
  }
  if (availabilityStatus === "QUESTIONABLE" && availabilityPercentPlay != null && availabilityPercentPlay <= 55) {
    reasons.push("Player is too risky in the live injury feed.");
  }

  if (decision.rawSide === "NEUTRAL") {
    reasons.push("No universal side.");
  }
  if (bucketRecentAccuracy == null || bucketRecentAccuracy < rule.minBucketLateAccuracy) {
    reasons.push("Bucket recent accuracy below Daily 6 threshold.");
  }
  if (decision.leafAccuracy == null || decision.leafAccuracy < rule.minLeafAccuracy) {
    reasons.push("Tree leaf accuracy below Daily 6 threshold.");
  }
  if (decision.absLineGap == null || decision.absLineGap < rule.minAbsLineGap) {
    reasons.push("Projection gap below Daily 6 threshold.");
  }
  if (
    rule.minProjectionWinProbability > 0 &&
    (decision.projectionWinProbability == null ||
      decision.projectionWinProbability < rule.minProjectionWinProbability)
  ) {
    reasons.push("Projection win probability below Daily 6 threshold.");
  }
  if (
    rule.minProjectionPriceEdge > 0 &&
    (decision.projectionPriceEdge == null || decision.projectionPriceEdge < rule.minProjectionPriceEdge)
  ) {
    reasons.push("Projection price edge below Daily 6 threshold.");
  }

  return {
    side: reasons.length === 0 ? decision.rawSide : "NEUTRAL",
    qualified: reasons.length === 0,
    historicalAccuracy: rule.historicalAccuracy,
    historicalPicks: rule.historicalPicks,
    historicalCoveragePct: rule.historicalCoveragePct,
    bucketRecentAccuracy,
    leafAccuracy: decision.leafAccuracy ?? null,
    absLineGap: decision.absLineGap ?? null,
    projectionWinProbability: decision.projectionWinProbability ?? null,
    projectionPriceEdge: decision.projectionPriceEdge ?? null,
    reasons,
  };
}
