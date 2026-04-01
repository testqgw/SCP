import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  inspectLiveUniversalModelSide,
  type PredictLiveUniversalSideInput,
} from "@/lib/snapshot/liveUniversalSideModels";
import type {
  SnapshotMarket,
  SnapshotModelSide,
  SnapshotPrecisionCardEntry,
  SnapshotPrecisionCardSource,
  SnapshotPrecisionPickSignal,
  SnapshotPrecisionSystemSummary,
} from "@/lib/types/snapshot";

type PrecisionAvailabilityStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN";
type PrecisionPickInput = PredictLiveUniversalSideInput & {
  playerId?: string | null;
  playerName?: string | null;
  availabilityStatus?: PrecisionAvailabilityStatus | null;
  availabilityPercentPlay?: number | null;
  weightedCurrentLineOverRate?: number | null;
  l10CurrentLineOverRate?: number | null;
  l15CurrentLineOverRate?: number | null;
  sameOpponentDeltaVsAnchor?: number | null;
  sameOpponentSample?: number | null;
  sameOpponentMinutesSimilarity?: number | null;
  matchupKey?: string | null;
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
export type PrecisionRankingMode = "historical-prior-first" | "dynamic-edge-first";
export type PrecisionMode = "live_vfinal" | "core_three_expansion_shadow" | "expanded_v1";
export type PrecisionShadowMarketKey = "PTS" | "REB" | "AST" | "THREES" | "PA" | "PRA" | "PR" | "RA";
export type PrecisionSelectorFamily = "precision" | "tier2" | "shadow";
export type PrecisionShadowRejectionReason =
  | "unsupported_market"
  | "bucket_recent_accuracy"
  | "leaf_accuracy"
  | "abs_line_gap"
  | "projection_win_probability"
  | "projection_price_edge"
  | "missing_calibration"
  | "threes_over_side"
  | "threes_starter_high"
  | "threes_expected_minutes"
  | "threes_minutes_volatility"
  | "threes_starter_rate"
  | "threes_calibration_disagreement"
  | "portfolio_player_cap"
  | "portfolio_game_cap"
  | "portfolio_market_cap"
  | "below_minimum_score";

export type MarketGateConfig = {
  bucketRecentAccuracyMin: number;
  leafAccuracyMin: number;
  absLineGapMin: number;
  projectionWinProbabilityMin: number;
  projectionPriceEdgeMin?: number;
};

export type ShadowConfig = {
  targetPicks: number;
  minimumPicks: number;
  maxPerPlayer: number;
  maxPerGame: number;
  maxPerMarket: number;
  oppositeTeamGameExceptionDelta: number;
  gates: Record<PrecisionShadowMarketKey, MarketGateConfig>;
};

export type CoreThreeExpansionCalibration = {
  plattProb: number;
  isotonicProb: number;
  calibratedProb: number;
};

export type CoreThreeExpansionPenaltyBreakdown = {
  volatilityPenalty: number;
  rolePenalty: number;
  totalPenalty: number;
};

export type PrecisionSlateCandidate = {
  playerId: string;
  playerName?: string | null;
  matchupKey: string;
  market: SnapshotMarket;
  signal: SnapshotPrecisionPickSignal;
  selectionScore: number;
  source: SnapshotPrecisionCardSource;
};

type PrecisionCardCoreThreeVFinalPair = {
  playerId: string;
  market: SnapshotMarket;
  playerName?: string;
  picks?: number;
};

type PrecisionCardCoreThreeVFinalFile = {
  generatedAt?: string;
  source?: string;
  summary?: {
    walkForward?: {
      picks?: number;
      correct?: number;
      accuracyPct?: number;
      picksPerDay?: number;
      coveragePct?: number;
    };
    last14?: {
      accuracyPct?: number;
      picksPerDay?: number;
    };
    last30?: {
      accuracyPct?: number;
      picksPerDay?: number;
    };
  };
  pairs?: PrecisionCardCoreThreeVFinalPair[];
};

export const DAILY_6_MARKET_PACKS = {
  COMBO_CORE: ["PRA", "PR", "RA"],
  COMBO_PLUS_PA: ["PRA", "PA", "PR", "RA"],
  COMBO_PLUS_PTS_PA: ["PTS", "PRA", "PA", "PR", "RA"],
  BETTABLE_60_V1: ["PTS", "REB", "THREES", "PRA", "PA"],
  BETTABLE_60_V2: ["REB", "THREES", "PRA", "PA", "RA"],
  HIGH_PRECISION_70_V1: ["REB", "THREES", "PA"],
  EXPANDED_PRECISION_V1: ["PTS", "REB", "THREES", "PRA", "PA", "RA"],
  SELECTOR_V2: ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"],
} as const satisfies Record<string, SnapshotMarket[]>;

export const ALL_DAILY_6_RULES: PrecisionRuleSet = {
  PTS: {
    minBucketLateAccuracy: 60,
    minLeafAccuracy: 88,
    minAbsLineGap: 1,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 76.84,
    historicalPicks: 190,
    historicalCoveragePct: 0.23,
  },
  REB: {
    minBucketLateAccuracy: 56,
    minLeafAccuracy: 84,
    minAbsLineGap: 0.75,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 75.86,
    historicalPicks: 116,
    historicalCoveragePct: 0.14,
  },
  AST: {
    minBucketLateAccuracy: 60,
    minLeafAccuracy: 85,
    minAbsLineGap: 1,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 79.55,
    historicalPicks: 44,
    historicalCoveragePct: 0.05,
  },
  THREES: {
    minBucketLateAccuracy: 56,
    minLeafAccuracy: 68,
    minAbsLineGap: 0.65,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 74.05,
    historicalPicks: 235,
    historicalCoveragePct: 0.29,
  },
  PRA: {
    minBucketLateAccuracy: 70,
    minLeafAccuracy: 80,
    minAbsLineGap: 3.0,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 70.3,
    historicalPicks: 730,
    historicalCoveragePct: 0.15,
  },
  PA: {
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 86,
    minAbsLineGap: 5.5,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 70,
    historicalPicks: 10,
    historicalCoveragePct: 0.05,
  },
  PR: {
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 88,
    minAbsLineGap: 0.8,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 71.55,
    historicalPicks: 300,
    historicalCoveragePct: 0.15,
  },
  RA: {
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 75,
    minAbsLineGap: 1.0,
    minProjectionWinProbability: 0,
    minProjectionPriceEdge: 0,
    historicalAccuracy: 70.9,
    historicalPicks: 90,
    historicalCoveragePct: 0.12,
  },
};

const DAILY_6_CURRENT_MARKETS = DAILY_6_MARKET_PACKS.SELECTOR_V2;

export const LOOSE_RULES: PrecisionRuleSet = {};
for (const m of ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"] as SnapshotMarket[]) {
  LOOSE_RULES[m] = {
    minBucketLateAccuracy: 10,
    minLeafAccuracy: 10,
    minAbsLineGap: 0.1,
    minProjectionWinProbability: 0.5,
    minProjectionPriceEdge: -1,
    historicalAccuracy: 0,
    historicalPicks: 0,
    historicalCoveragePct: 0,
  };
}

export const DEFAULT_DAILY_6_RULES: PrecisionRuleSet = {
  PTS: {
    ...ALL_DAILY_6_RULES.PTS!,
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 92,
    minAbsLineGap: 1.5,
    minProjectionWinProbability: 0.60,
    minProjectionPriceEdge: 0.03,
  },
  REB: {
    ...ALL_DAILY_6_RULES.REB!,
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 85,
    minAbsLineGap: 0.8,
    minProjectionWinProbability: 0.57,
    minProjectionPriceEdge: 0.02,
  },
  AST: {
    ...ALL_DAILY_6_RULES.AST!,
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 80,
    minAbsLineGap: 1.0,
    minProjectionWinProbability: 0.55,
    minProjectionPriceEdge: 0.015,
  },
  THREES: {
    ...ALL_DAILY_6_RULES.THREES!,
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 65,
    minAbsLineGap: 0.5,
    minProjectionWinProbability: 0.55,
    minProjectionPriceEdge: 0.01,
  },
  PA: {
    ...ALL_DAILY_6_RULES.PA!,
    minBucketLateAccuracy: 69,
    minLeafAccuracy: 86,
    minAbsLineGap: 6.5,
    minProjectionWinProbability: 0.6,
    minProjectionPriceEdge: 0.02,
  },
  PR: {
    ...ALL_DAILY_6_RULES.PR!,
    minBucketLateAccuracy: 60,
    minLeafAccuracy: 88,
    minAbsLineGap: 4.5,
    minProjectionWinProbability: 0.56,
    minProjectionPriceEdge: 0.015,
  },
  PRA: {
    ...ALL_DAILY_6_RULES.PRA!,
    minBucketLateAccuracy: 60,
    minLeafAccuracy: 65,
    minAbsLineGap: 1.5,
    minProjectionWinProbability: 0.55,
    minProjectionPriceEdge: 0.015,
  },
  RA: {
    ...ALL_DAILY_6_RULES.RA!,
    minBucketLateAccuracy: 54,
    minLeafAccuracy: 76,
    minAbsLineGap: 0.5,
    minProjectionWinProbability: 0.52,
    minProjectionPriceEdge: 0.005,
  },
};

/** Tier 2: high-confidence bypass gates for players NOT in the manifest */
export const TIER_2_HIGH_CONFIDENCE_RULES: PrecisionRuleSet = {
  PTS: {
    ...ALL_DAILY_6_RULES.PTS!,
    minBucketLateAccuracy: 99,
    minLeafAccuracy: 99,
    minAbsLineGap: 99,
    minProjectionWinProbability: 0.99,
    minProjectionPriceEdge: 0.99,
  },
  REB: {
    ...ALL_DAILY_6_RULES.REB!,
    minBucketLateAccuracy: 70,
    minLeafAccuracy: 92,
    minAbsLineGap: 0.8,
    minProjectionWinProbability: 0.60,
    minProjectionPriceEdge: 0.025,
  },
  AST: {
    ...ALL_DAILY_6_RULES.AST!,
    minBucketLateAccuracy: 74,
    minLeafAccuracy: 86,
    minAbsLineGap: 0.8,
    minProjectionWinProbability: 0.62,
    minProjectionPriceEdge: 0.03,
  },
  THREES: {
    ...ALL_DAILY_6_RULES.THREES!,
    minBucketLateAccuracy: 50,
    minLeafAccuracy: 65,
    minAbsLineGap: 1.0,
    minProjectionWinProbability: 0.58,
    minProjectionPriceEdge: 0.02,
  },
  PA: {
    ...ALL_DAILY_6_RULES.PA!,
    minBucketLateAccuracy: 99,
    minLeafAccuracy: 99,
    minAbsLineGap: 99.0,
    minProjectionWinProbability: 1.0,
    minProjectionPriceEdge: 1.0,
  },
  PRA: {
    ...ALL_DAILY_6_RULES.PRA!,
    minBucketLateAccuracy: 76,
    minLeafAccuracy: 84,
    minAbsLineGap: 4.5,
    minProjectionWinProbability: 0.62,
    minProjectionPriceEdge: 0.03,
  },
  PR: {
    ...ALL_DAILY_6_RULES.PR!,
    minBucketLateAccuracy: 56,
    minLeafAccuracy: 86,
    minAbsLineGap: 4.5,
    minProjectionWinProbability: 0.54,
    minProjectionPriceEdge: 0.01,
  },
  RA: {
    ...ALL_DAILY_6_RULES.RA!,
    minBucketLateAccuracy: 70,
    minLeafAccuracy: 85,
    minAbsLineGap: 1.5,
    minProjectionWinProbability: 0.62,
    minProjectionPriceEdge: 0.025,
  },
};

export const PRECISION_80_SYSTEM_SUMMARY: SnapshotPrecisionSystemSummary = {
  label: "Precision Selector v2",
  historicalAccuracy: 68.8,
  historicalPicks: 686,
  historicalCoveragePct: 0.01,
  historicalPicksPerDay: 4.64,
  supportedMarkets: DAILY_6_CURRENT_MARKETS,
  accuracyLabel: "Backtest Rate",
  picksPerDayLabel: "Picks/Day",
  note:
    "Backtested 2025-10-23 through 2026-03-27. Precision-only replay now sits at 68.8% overall and 72.03% over the last 30 days on 4.64 picks/day. The live card stays short on thin slates instead of adding selector fill.",
  targetCardCount: 6,
  allowFill: false,
};

export const PRECISION_80_SYSTEM_SUMMARY_VERSION = "2026-04-01-precision-selector-v2-precision-only";

export const CORE_THREE_EXPANSION_V1: ShadowConfig = {
  targetPicks: 15,
  minimumPicks: 4,
  maxPerPlayer: 10,
  maxPerGame: 10,
  maxPerMarket: 20,
  oppositeTeamGameExceptionDelta: 0.01,
  gates: {
    PTS: {
      bucketRecentAccuracyMin: 66,
      leafAccuracyMin: 88,
      absLineGapMin: 1.0,
      projectionWinProbabilityMin: 0.55,
      projectionPriceEdgeMin: 0.015,
    },
    REB: {
      bucketRecentAccuracyMin: 52,
      leafAccuracyMin: 60,
      absLineGapMin: 0.85,
      projectionWinProbabilityMin: 0.53,
      projectionPriceEdgeMin: 0.005,
    },
    AST: {
      bucketRecentAccuracyMin: 66,
      leafAccuracyMin: 60,
      absLineGapMin: 1.0,
      projectionWinProbabilityMin: 0.53,
      projectionPriceEdgeMin: 0.01,
    },
    THREES: {
      bucketRecentAccuracyMin: 60,
      leafAccuracyMin: 45,
      absLineGapMin: 0.65,
      projectionWinProbabilityMin: 0.49,
    },
    PA: {
      bucketRecentAccuracyMin: 64,
      leafAccuracyMin: 60,
      absLineGapMin: 4.5,
      projectionWinProbabilityMin: 0.53,
      projectionPriceEdgeMin: 0.01,
    },
    PRA: {
      bucketRecentAccuracyMin: 68,
      leafAccuracyMin: 74,
      absLineGapMin: 3.0,
      projectionWinProbabilityMin: 0.55,
      projectionPriceEdgeMin: 0.015,
    },
    PR: {
      bucketRecentAccuracyMin: 56,
      leafAccuracyMin: 86,
      absLineGapMin: 4.5,
      projectionWinProbabilityMin: 0.54,
      projectionPriceEdgeMin: 0.01,
    },
    RA: {
      bucketRecentAccuracyMin: 56,
      leafAccuracyMin: 78,
      absLineGapMin: 0.75,
      projectionWinProbabilityMin: 0.52,
      projectionPriceEdgeMin: 0.005,
    },
  },
};

export function buildShadowPrecisionRuleSet(
  config: ShadowConfig = CORE_THREE_EXPANSION_V1,
): PrecisionRuleSet {
  return Object.fromEntries(
    (Object.entries(config.gates) as Array<[PrecisionShadowMarketKey, MarketGateConfig]>).map(([market, gate]) => [
      market,
      {
        ...ALL_DAILY_6_RULES[market]!,
        minBucketLateAccuracy: gate.bucketRecentAccuracyMin,
        minLeafAccuracy: gate.leafAccuracyMin,
        minAbsLineGap: gate.absLineGapMin,
        minProjectionWinProbability: gate.projectionWinProbabilityMin,
        minProjectionPriceEdge: gate.projectionPriceEdgeMin ?? 0,
      },
    ]),
  ) as PrecisionRuleSet;
}

export function getRebPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 5.5 ? 0.02 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 24 ? 0.01 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getThreesPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility" | "starterRateLast10">,
): CoreThreeExpansionPenaltyBreakdown {
  const expectedMinutes = input.expectedMinutes ?? 0;
  const starterRateLast10 = input.starterRateLast10;
  const minutesVolatility = input.minutesVolatility ?? 0;
  const volatilityPenalty =
    (minutesVolatility > 5.5 ? 0.02 : 0) +
    (minutesVolatility > 7 ? 0.01 : 0);
  const rolePenalty =
    (expectedMinutes < 26 ? 0.02 : 0) +
    (expectedMinutes < 22 ? 0.015 : 0) +
    (starterRateLast10 != null && starterRateLast10 < 0.5 ? 0.01 : 0);
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getThreesPreRankVetoReason(input: {
  expectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
  plattProb: number;
  isotonicProb: number;
}): PrecisionShadowRejectionReason | null {
  const expectedMinutes = input.expectedMinutes ?? 0;
  const minutesVolatility = input.minutesVolatility ?? 0;
  const starterRateLast10 = input.starterRateLast10;
  const disagreement = Math.abs(input.plattProb - input.isotonicProb);

  if (expectedMinutes < 20) {
    return "threes_expected_minutes";
  }
  if (minutesVolatility > 8) {
    return "threes_minutes_volatility";
  }
  if (starterRateLast10 != null && starterRateLast10 < 0.25 && expectedMinutes < 24) {
    return "threes_starter_rate";
  }
  if (disagreement > 0.12) {
    return "threes_calibration_disagreement";
  }
  return null;
}

export function getThreesShadowV3VetoReason(input: {
  side: SnapshotModelSide;
  starterRateLast10?: number | null;
}): PrecisionShadowRejectionReason | null {
  if (input.side === "OVER") {
    return "threes_over_side";
  }
  if ((input.starterRateLast10 ?? 0) >= 0.5) {
    return "threes_starter_high";
  }
  return null;
}

export function computeCoreThreeExpansionThreesV3SelectionScore(input: {
  leafAccuracy: number | null;
  absLineGap: number | null;
  isotonicProb: number;
}): number {
  const leafComponent = (input.leafAccuracy ?? 0) / 100;
  const gapComponent = (input.absLineGap ?? 0) * 0.001;
  const isotonicComponent = input.isotonicProb * 0.0001;
  return leafComponent + gapComponent + isotonicComponent;
}

export function getPaPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const stableMinutes = (input.expectedMinutes ?? 0) >= 28;
  const stableVolatility = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) <= 6;
  const rolePenalty = stableMinutes && stableVolatility ? 0 : 0.03;
  return {
    volatilityPenalty: 0,
    rolePenalty,
    totalPenalty: rolePenalty,
  };
}

export function getPraPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 6 ? 0.02 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 26 ? 0.015 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getPrPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 5.5 ? 0.015 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 24 ? 0.01 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getRaPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 6 ? 0.015 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 22 ? 0.02 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getPtsPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 5 ? 0.02 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 20 ? 0.025 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getAstPenalty(
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility">,
): CoreThreeExpansionPenaltyBreakdown {
  const volatilityPenalty = (input.minutesVolatility ?? Number.POSITIVE_INFINITY) > 5 ? 0.015 : 0;
  const rolePenalty = (input.expectedMinutes ?? 0) < 22 ? 0.02 : 0;
  return {
    volatilityPenalty,
    rolePenalty,
    totalPenalty: volatilityPenalty + rolePenalty,
  };
}

export function getCoreThreeExpansionPenalty(
  market: PrecisionShadowMarketKey,
  input: Pick<PrecisionPickInput, "expectedMinutes" | "minutesVolatility" | "starterRateLast10">,
): CoreThreeExpansionPenaltyBreakdown {
  switch (market) {
    case "PTS":
      return getPtsPenalty(input);
    case "REB":
      return getRebPenalty(input);
    case "AST":
      return getAstPenalty(input);
    case "THREES":
      return getThreesPenalty(input);
    case "PA":
      return getPaPenalty(input);
    case "PRA":
      return getPraPenalty(input);
    case "PR":
      return getPrPenalty(input);
    case "RA":
      return getRaPenalty(input);
  }
}

export function computeCoreThreeExpansionCalibration(
  plattProb: number,
  isotonicProb: number,
): CoreThreeExpansionCalibration {
  return {
    plattProb,
    isotonicProb,
    calibratedProb: (plattProb + isotonicProb) / 2,
  };
}

export function computeCoreThreeExpansionSelectionScore(input: {
  market: PrecisionShadowMarketKey;
  calibratedProb: number;
  plattProb: number;
  isotonicProb: number;
  projectionPriceEdge?: number | null;
  volatilityPenalty?: number;
  rolePenalty?: number;
}): number {
  const disagreementPenaltyMultiplier = input.market === "THREES" ? 0.85 : 0.6;
  const priceEdgeBoostMultiplier = input.market === "THREES" ? 0.25 : 0.5;
  const disagreementPenalty = disagreementPenaltyMultiplier * Math.abs(input.plattProb - input.isotonicProb);
  const volatilityPenalty = input.volatilityPenalty ?? 0;
  const rolePenalty = input.rolePenalty ?? 0;
  const priceEdgeBoost = priceEdgeBoostMultiplier * (input.projectionPriceEdge ?? 0);
  return input.calibratedProb - disagreementPenalty - volatilityPenalty - rolePenalty + priceEdgeBoost;
}

const PRECISION_SELECTOR_MARKET_CAPS: Record<SnapshotMarket, number> = {
  PTS: 1,
  REB: 2,
  AST: 1,
  THREES: 2,
  PRA: 2,
  PA: 2,
  PR: 1,
  RA: 1,
};
const PRECISION_SELECTOR_TARGET_COUNT = 6;
const PRECISION_SELECTOR_MARKET_BOOSTS: Partial<Record<SnapshotMarket, number>> = {
  PA: 0.03,
  REB: 0.02,
  PRA: 0.02,
  THREES: 0.02,
  PR: 0.01,
};
const PRECISION_SELECTOR_WEIGHTS = {
  historicalAccuracy: 0.14,
  bucketRecentAccuracy: 0.12,
  leafAccuracy: 0.1,
  absLineGap: 0.08,
  projectionWinProbability: 0.14,
  projectionPriceEdge: 0.1,
  recency: 0.1,
  minutes: 0.1,
  positionFit: 0.06,
  lineupTimingConfidence: 0.04,
  completenessScore: 0.02,
  familyBias: 0.02,
  sameOpponent: 0.03,
  usageContext: 0.04,
} as const;

function roundSelectorScore(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function getPrecisionPositionAffinity(position: string | null | undefined, market: SnapshotMarket): number {
  if (!position) return 0.5;
  const normalized = position.toUpperCase();
  const isGuard = normalized.includes("G");
  const isForward = normalized.includes("F");
  const isCenter = normalized.includes("C");
  const guardMarkets = new Set<SnapshotMarket>(["PTS", "AST", "THREES", "PA", "PR"]);
  const wingMarkets = new Set<SnapshotMarket>(["PTS", "PRA", "PR", "RA"]);
  const bigMarkets = new Set<SnapshotMarket>(["REB", "PRA", "RA", "PR"]);

  if (isCenter && bigMarkets.has(market)) return 0.92;
  if (isGuard && guardMarkets.has(market)) return 0.88;
  if (isForward && wingMarkets.has(market)) return 0.84;
  if (isGuard || isForward || isCenter) return 0.6;
  return 0.5;
}

function getPrecisionSelectorFamilyBias(family: PrecisionSelectorFamily): number {
  switch (family) {
    case "precision":
      return 0.024;
    case "tier2":
      return 0.018;
    case "shadow":
      return 0.015;
    default:
      return 0;
  }
}

function getPrecisionSignalFeatures(signal: SnapshotPrecisionPickSignal) {
  return {
    historicalAccuracy: signal.historicalAccuracy / 100,
    bucketRecentAccuracy: (signal.bucketRecentAccuracy ?? signal.historicalAccuracy) / 100,
    leafAccuracy: (signal.leafAccuracy ?? signal.historicalAccuracy) / 100,
    absLineGap: clamp01((signal.absLineGap ?? 0) / 12),
    projectionWinProbability: signal.projectionWinProbability ?? 0.5,
    projectionPriceEdge: clamp01(((signal.projectionPriceEdge ?? 0) + 0.02) / 0.08),
  };
}

function getPrecisionRecencyFit(input: PrecisionPickInput, side: SnapshotModelSide): number {
  const weightedRate =
    input.weightedCurrentLineOverRate ??
    (input.l5CurrentLineOverRate != null || input.l10CurrentLineOverRate != null || input.l15CurrentLineOverRate != null
      ? [
          { value: input.l5CurrentLineOverRate ?? null, weight: 0.45 },
          { value: input.l10CurrentLineOverRate ?? null, weight: 0.35 },
          { value: input.l15CurrentLineOverRate ?? null, weight: 0.2 },
        ].reduce(
          (acc, part) => {
            if (part.value == null || !Number.isFinite(part.value)) return acc;
            return {
              total: acc.total + part.value * part.weight,
              weight: acc.weight + part.weight,
            };
          },
          { total: 0, weight: 0 },
        )
      : null);
  const overRate =
    weightedRate == null
      ? input.emaCurrentLineOverRate ?? input.l5CurrentLineOverRate ?? input.l10CurrentLineOverRate ?? input.l15CurrentLineOverRate ?? 0.5
      : typeof weightedRate === "number"
        ? weightedRate
        : weightedRate.weight > 0
          ? weightedRate.total / weightedRate.weight
          : 0.5;
  const delta = input.emaCurrentLineDelta ?? input.l5CurrentLineDeltaAvg ?? 0;
  const overRateFit = side === "OVER" ? overRate : 1 - overRate;
  const deltaFit = side === "OVER" ? clamp01((delta + 4) / 8) : clamp01((4 - delta) / 8);
  return roundSelectorScore(0.65 * overRateFit + 0.35 * deltaFit);
}

function getPrecisionMinutesFit(input: PrecisionPickInput, side: SnapshotModelSide): number {
  const expectedMinutes = input.expectedMinutes ?? input.emaMinutesAvg ?? input.l5MinutesAvg ?? 0;
  const volatility = input.minutesVolatility ?? 0;
  const starterRate = input.starterRateLast10 ?? 0.5;
  const stability = input.benchBigRoleStability ?? 0.5;
  const baselineMinutes = input.seasonMinutesAvg ?? input.archetypeExpectedMinutes ?? expectedMinutes;
  const minutesLiftPct =
    input.minutesLiftPct ??
    (baselineMinutes != null && baselineMinutes > 0 ? expectedMinutes / baselineMinutes - 1 : 0);
  const minutesComponent = clamp01(expectedMinutes / 38);
  const volatilityComponent = clamp01(volatility / 10);
  const stabilityComponent = clamp01(stability);
  const starterComponent = clamp01(starterRate);
  const liftComponent = clamp01((minutesLiftPct + 0.25) / 0.6);

  if (side === "OVER") {
    return roundSelectorScore(
      0.34 * minutesComponent +
        0.18 * starterComponent +
        0.16 * (1 - volatilityComponent) +
        0.12 * stabilityComponent +
        0.1 * clamp01((input.emaMinutesAvg ?? input.l5MinutesAvg ?? expectedMinutes) / 36) +
        0.1 * liftComponent,
    );
  }

  return roundSelectorScore(
    0.34 * (1 - minutesComponent) +
      0.18 * (1 - starterComponent) +
      0.16 * volatilityComponent +
      0.12 * (1 - stabilityComponent) +
      0.1 * (1 - clamp01((input.emaMinutesAvg ?? input.l5MinutesAvg ?? expectedMinutes) / 36)) +
      0.1 * (1 - liftComponent),
  );
}

function getPrecisionSameOpponentFit(input: PrecisionPickInput, side: SnapshotModelSide): number {
  if (input.sameOpponentSample == null || input.sameOpponentSample <= 0 || input.sameOpponentDeltaVsAnchor == null) {
    return 0.5;
  }
  const directionFit =
    side === "OVER"
      ? clamp01((input.sameOpponentDeltaVsAnchor + 3) / 6)
      : clamp01((3 - input.sameOpponentDeltaVsAnchor) / 6);
  const sampleFit = clamp01(input.sameOpponentSample / 4);
  const minutesFit = input.sameOpponentMinutesSimilarity == null ? 0.72 : clamp01(input.sameOpponentMinutesSimilarity);
  return roundSelectorScore(0.55 * directionFit + 0.25 * sampleFit + 0.2 * minutesFit);
}

function getPrecisionUsageContextFit(
  input: PrecisionPickInput,
  side: SnapshotModelSide,
  market: SnapshotMarket,
): number {
  const minutesLift = input.minutesLiftPct ?? 0;
  const missingCoreShare = input.missingCoreShare ?? 0;
  const stepUpRole = clamp01(input.stepUpRoleFlag ?? 0);
  const blowoutRisk = input.blowoutRisk == null ? 0.5 : clamp01(1 - input.blowoutRisk * 25);
  const paceFactor =
    input.competitivePaceFactor == null ? 0.5 : clamp01((input.competitivePaceFactor - 12) / 12);
  const usagePressure =
    market === "AST" || market === "PA"
      ? clamp01(((input.activeCoreAst ?? 0) + (input.missingCoreAst ?? 0)) / 30)
      : clamp01(((input.activeCorePts ?? 0) + (input.missingCorePts ?? 0)) / 80);
  const liftFit = clamp01((minutesLift + 0.3) / 0.6);
  const missingCoreFit = clamp01(missingCoreShare / 0.3);

  if (side === "OVER") {
    return roundSelectorScore(
      0.28 * liftFit + 0.24 * missingCoreFit + 0.2 * stepUpRole + 0.16 * blowoutRisk + 0.12 * Math.max(paceFactor, usagePressure),
    );
  }

  return roundSelectorScore(
    0.34 * (1 - liftFit) +
      0.22 * (1 - missingCoreFit) +
      0.18 * (1 - stepUpRole) +
      0.16 * (1 - blowoutRisk) +
      0.1 * (1 - Math.max(paceFactor, usagePressure)),
  );
}

export function computePrecisionSelectorScore(input: {
  market: SnapshotMarket;
  signal: SnapshotPrecisionPickSignal;
  selectorFamily: PrecisionSelectorFamily;
  selectorInput: PrecisionPickInput;
}): number {
  const features = getPrecisionSignalFeatures(input.signal);
  const recencyFit = getPrecisionRecencyFit(input.selectorInput, input.signal.side);
  const minutesFit = getPrecisionMinutesFit(input.selectorInput, input.signal.side);
  const positionFit = getPrecisionPositionAffinity(input.selectorInput.playerPosition, input.market);
  const lineupConfidence = clamp01((input.selectorInput.lineupTimingConfidence ?? 50) / 100);
  const completeness = clamp01((input.selectorInput.completenessScore ?? 50) / 100);
  const sameOpponentFit = getPrecisionSameOpponentFit(input.selectorInput, input.signal.side);
  const usageFit = getPrecisionUsageContextFit(input.selectorInput, input.signal.side, input.market);
  const marketBoost = PRECISION_SELECTOR_MARKET_BOOSTS[input.market] ?? 0;

  return roundSelectorScore(
    PRECISION_SELECTOR_WEIGHTS.historicalAccuracy * features.historicalAccuracy +
      PRECISION_SELECTOR_WEIGHTS.bucketRecentAccuracy * features.bucketRecentAccuracy +
      PRECISION_SELECTOR_WEIGHTS.leafAccuracy * features.leafAccuracy +
      PRECISION_SELECTOR_WEIGHTS.absLineGap * features.absLineGap +
      PRECISION_SELECTOR_WEIGHTS.projectionWinProbability * features.projectionWinProbability +
      PRECISION_SELECTOR_WEIGHTS.projectionPriceEdge * features.projectionPriceEdge +
      PRECISION_SELECTOR_WEIGHTS.recency * recencyFit +
      PRECISION_SELECTOR_WEIGHTS.minutes * minutesFit +
      PRECISION_SELECTOR_WEIGHTS.positionFit * positionFit +
      PRECISION_SELECTOR_WEIGHTS.lineupTimingConfidence * lineupConfidence +
      PRECISION_SELECTOR_WEIGHTS.completenessScore * completeness +
      PRECISION_SELECTOR_WEIGHTS.familyBias * getPrecisionSelectorFamilyBias(input.selectorFamily) +
      PRECISION_SELECTOR_WEIGHTS.sameOpponent * sameOpponentFit +
      PRECISION_SELECTOR_WEIGHTS.usageContext * usageFit +
      marketBoost,
    6,
  );
}

export function selectPrecisionCard(candidates: PrecisionSlateCandidate[]): SnapshotPrecisionCardEntry[] {
  const selected: SnapshotPrecisionCardEntry[] = [];
  const selectedPlayers = new Set<string>();
  const marketCounts = new Map<SnapshotMarket, number>();

  const sortCandidates = (left: PrecisionSlateCandidate, right: PrecisionSlateCandidate) =>
    right.selectionScore - left.selectionScore ||
    comparePrecisionSignals(left.signal, right.signal, "dynamic-edge-first") ||
    (left.playerName ?? left.playerId).localeCompare(right.playerName ?? right.playerId);

  const pool = candidates.filter((candidate) => candidate.source === "PRECISION").sort(sortCandidates);
  for (const candidate of pool) {
    if (selected.length >= PRECISION_SELECTOR_TARGET_COUNT) break;
    if (selectedPlayers.has(candidate.playerId)) continue;
    if ((marketCounts.get(candidate.market) ?? 0) >= (PRECISION_SELECTOR_MARKET_CAPS[candidate.market] ?? 0)) continue;

    selected.push({
      playerId: candidate.playerId,
      market: candidate.market,
      source: candidate.source,
      rank: selected.length + 1,
      selectionScore: candidate.selectionScore,
    });
    selectedPlayers.add(candidate.playerId);
    marketCounts.set(candidate.market, (marketCounts.get(candidate.market) ?? 0) + 1);
  }

  return selected;
}

function normalizePlayerNameForManifest(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadPrecisionCardExpandedPairSet(): {
  byId: Set<string>;
  byName: Set<string>;
} | null {
  // Try expanded manifest first, then fall back to vFinal
  const expandedPath = path.join(process.cwd(), "exports", "precision-card-expanded-v1.json");
  const vFinalPath = path.join(process.cwd(), "exports", "precision-card-core-three-vfinal.json");
  const manifestPath = existsSync(expandedPath) ? expandedPath : vFinalPath;
  if (!existsSync(manifestPath)) return null;

  try {
    const payload = JSON.parse(readFileSync(manifestPath, "utf8")) as PrecisionCardCoreThreeVFinalFile;
    const pairs = payload.pairs ?? [];
    if (!pairs.length) return null;
    const byId = new Set<string>();
    const byName = new Set<string>();
    for (const pair of pairs) {
      if (!pair?.market) continue;
      if (pair.playerId) {
        byId.add(`${pair.playerId}|${pair.market}`);
      }
      if (pair.playerName) {
        byName.add(`${normalizePlayerNameForManifest(pair.playerName)}|${pair.market}`);
      }
    }
    return { byId, byName };
  } catch {
    return null;
  }
}

const PRECISION_CARD_PAIR_SETS = loadPrecisionCardExpandedPairSet();

type PrecisionTier = "tier1" | "tier2" | "tier3" | "none";

export function getPrecisionCardTier(
  input: Pick<PrecisionPickInput, "playerId" | "playerName" | "minutesVolatility" | "openingTotal" | "openingTeamSpread">,
  market: SnapshotMarket,
  signal: SnapshotPrecisionPickSignal | null,
): PrecisionTier {
  const playerId = input.playerId;
  const playerName = input.playerName;
  // Tier 1: player is in the manifest
  if (PRECISION_CARD_PAIR_SETS && PRECISION_CARD_PAIR_SETS.byId.size + PRECISION_CARD_PAIR_SETS.byName.size > 0) {
    const inById = playerId ? PRECISION_CARD_PAIR_SETS.byId.has(`${playerId}|${market}`) : false;
    const inByName = playerName
      ? PRECISION_CARD_PAIR_SETS.byName.has(`${normalizePlayerNameForManifest(playerName)}|${market}`)
      : false;
    if (inById || inByName) return "tier1";
  } else {
    // No manifest loaded — everything is Tier 1 (backwards compat)
    return "tier1";
  }

  // Tier 2: high-confidence bypass — check if signal passes Tier 2 thresholds
  const tier2Rule = TIER_2_HIGH_CONFIDENCE_RULES[market];
  
  if (tier2Rule && signal) {
    const passesAllTier2 =
      (signal.bucketRecentAccuracy ?? 0) >= tier2Rule.minBucketLateAccuracy &&
      (signal.leafAccuracy ?? 0) >= tier2Rule.minLeafAccuracy &&
      (signal.absLineGap ?? 0) >= tier2Rule.minAbsLineGap &&
      (signal.projectionWinProbability ?? 0) >= tier2Rule.minProjectionWinProbability &&
      (signal.projectionPriceEdge ?? 0) >= tier2Rule.minProjectionPriceEdge;
    if (passesAllTier2) return "tier2";
  }

  // Tier 3: Volume Bypass (ignores leaf accuracy and bucket accuracy)
  if (signal) {
    const gap = signal.absLineGap ?? 0;
    const stableMins = input.minutesVolatility != null && input.minutesVolatility < 4;
    const highTotal = input.openingTotal != null && input.openingTotal > 225;
    const prob = signal.projectionWinProbability ?? 0;

    const blowoutRisk = input.openingTeamSpread != null && Math.abs(input.openingTeamSpread) > 8.5;
    const totalTooHighForUnder = input.openingTotal != null && input.openingTotal > 234 && signal.side === "UNDER";
    const totalTooLowForOver = input.openingTotal != null && input.openingTotal < 215 && signal.side === "OVER";

    if (!blowoutRisk && !totalTooHighForUnder && !totalTooLowForOver && prob >= 0.5 && market !== "PTS" && market !== "PA") {
      // Rule 3A: Giant Gap + High Total + Stable Role
      if (gap >= 4.0 && highTotal && stableMins) return "tier3";
      
      // Rule 3B: Big combos strict expansion
      if (market === "RA" && gap > 3.0 && highTotal) return "tier3";
      if (market === "PRA" && gap > 3.5 && highTotal) return "tier3";
      if (market === "PR" && gap > 3.5 && highTotal) return "tier3";
    }
  }

  return "none";
}

export function getPrecisionRule(ruleSet: PrecisionRuleSet, market: SnapshotMarket): PrecisionRule | null {
  return ruleSet[market] ?? null;
}

export function getPrecision80Rule(market: SnapshotMarket): PrecisionRule | null {
  return getPrecisionRule(DEFAULT_DAILY_6_RULES, market);
}

export function comparePrecisionSignals(
  left: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge" | "selectionScore">>,
  right: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge" | "selectionScore">>,
  rankingMode: PrecisionRankingMode = "historical-prior-first",
): number {
  const rightSelectionScore = right.selectionScore ?? Number.NEGATIVE_INFINITY;
  const leftSelectionScore = left.selectionScore ?? Number.NEGATIVE_INFINITY;
  const rightWinProbability = right.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  const leftWinProbability = left.projectionWinProbability ?? Number.NEGATIVE_INFINITY;
  const rightPriceEdge = right.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  const leftPriceEdge = left.projectionPriceEdge ?? Number.NEGATIVE_INFINITY;
  const rightGap = right.absLineGap ?? Number.NEGATIVE_INFINITY;
  const leftGap = left.absLineGap ?? Number.NEGATIVE_INFINITY;
  const rightLeaf = right.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftLeaf = left.leafAccuracy ?? Number.NEGATIVE_INFINITY;
  const rightBucket = right.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;
  const leftBucket = left.bucketRecentAccuracy ?? Number.NEGATIVE_INFINITY;

  const orderedComparisons =
    rankingMode === "dynamic-edge-first"
      ? [
          rightSelectionScore - leftSelectionScore,
          rightWinProbability - leftWinProbability,
          rightPriceEdge - leftPriceEdge,
          rightGap - leftGap,
          rightLeaf - leftLeaf,
          rightBucket - leftBucket,
          right.historicalAccuracy - left.historicalAccuracy,
        ]
      : [
          rightSelectionScore - leftSelectionScore,
          right.historicalAccuracy - left.historicalAccuracy,
          rightWinProbability - leftWinProbability,
          rightPriceEdge - leftPriceEdge,
          rightGap - leftGap,
          rightLeaf - leftLeaf,
          rightBucket - leftBucket,
        ];

  for (const comparison of orderedComparisons) {
    if (comparison !== 0) return comparison;
  }

  return 0;
}

export function buildPrecision80Pick(input: PrecisionPickInput): SnapshotPrecisionPickSignal | null {
  // First evaluate with LOOSE_RULES to check Tier 3 bypass
  const looseSignal = buildPrecisionPick(input, LOOSE_RULES);
  if (!looseSignal || looseSignal.side === "NEUTRAL") return looseSignal;

  const tier3Check = getPrecisionCardTier(input, input.market, looseSignal);
  if (tier3Check === "tier3") {
    const selectionScore = computePrecisionSelectorScore({
      market: input.market,
      signal: looseSignal,
      selectorFamily: "precision",
      selectorInput: input,
    });
    return {
      ...looseSignal,
      selectionScore,
      selectorFamily: "precision",
      selectorTier: "tier3",
      reasons: [...(looseSignal.reasons ?? []), "Tier 3: player-market pair qualified via high-volume bypass."],
    };
  }

  // Not Tier 3, so must pass strict rules for Tier 1 or Tier 2
  const strictSignal = buildPrecisionPick(input, DEFAULT_DAILY_6_RULES);
  if (!strictSignal) return null;
  if (!strictSignal.qualified || strictSignal.side === "NEUTRAL") return strictSignal;

  const tier = getPrecisionCardTier(input, input.market, strictSignal);
  const selectionScore = computePrecisionSelectorScore({
    market: input.market,
    signal: strictSignal,
    selectorFamily: "precision",
    selectorInput: input,
  });

  if (tier === "tier1") {
    return {
      ...strictSignal,
      selectionScore,
      selectorFamily: "precision",
      selectorTier: "tier1",
      reasons: [...(strictSignal.reasons ?? []), "Tier 1: player-market pair is in the expanded precision manifest."],
    };
  }

  if (tier === "tier2") {
    return {
      ...strictSignal,
      selectionScore,
      selectorFamily: "precision",
      selectorTier: "tier2",
      reasons: [...(strictSignal.reasons ?? []), "Tier 2: player-market pair qualified via high-confidence universal bypass."],
    };
  }

  return {
    ...strictSignal,
    selectionScore,
    selectorFamily: "precision",
    selectorTier: "none",
    side: "NEUTRAL",
    qualified: false,
    reasons: [...(strictSignal.reasons ?? []), "Player-market pair is outside precision manifest and did not pass Tier 2 or Tier 3 gates."],
  };
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
    reasons.push("Bucket recent accuracy below Core Six threshold.");
  }
  if (decision.leafAccuracy == null || decision.leafAccuracy < rule.minLeafAccuracy) {
    reasons.push("Tree leaf accuracy below Core Six threshold.");
  }
  if (decision.absLineGap == null || decision.absLineGap < rule.minAbsLineGap) {
    reasons.push("Projection gap below Core Six threshold.");
  }
  if (
    rule.minProjectionWinProbability > 0 &&
    (decision.projectionWinProbability == null ||
      decision.projectionWinProbability < rule.minProjectionWinProbability)
  ) {
    reasons.push("Projection win probability below Core Six threshold.");
  }
  if (
    rule.minProjectionPriceEdge > 0 &&
    (decision.projectionPriceEdge == null || decision.projectionPriceEdge < rule.minProjectionPriceEdge)
  ) {
    reasons.push("Projection price edge below Core Six threshold.");
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




























