import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  inspectLiveUniversalModelSide,
  type PredictLiveUniversalSideInput,
} from "@/lib/snapshot/liveUniversalSideModels";
import type { SnapshotMarket, SnapshotModelSide, SnapshotPrecisionPickSignal, SnapshotPrecisionSystemSummary } from "@/lib/types/snapshot";

type PrecisionAvailabilityStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN";
type PrecisionPickInput = PredictLiveUniversalSideInput & {
  playerId?: string | null;
  playerName?: string | null;
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
export type PrecisionRankingMode = "historical-prior-first" | "dynamic-edge-first";
export type PrecisionMode = "live_vfinal" | "core_three_expansion_shadow" | "expanded_v1";
export type PrecisionShadowMarketKey = "PTS" | "REB" | "AST" | "THREES" | "PA" | "PRA" | "PR" | "RA";
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

const DAILY_6_CURRENT_MARKETS = DAILY_6_MARKET_PACKS.EXPANDED_PRECISION_V1;

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
  label: "Precision Expanded v1",
  historicalAccuracy: 71.50,
  historicalPicks: 207,
  historicalCoveragePct: 0.17,
  historicalPicksPerDay: 6.2,
  supportedMarkets: DAILY_6_CURRENT_MARKETS,
  accuracyLabel: "WF Rate",
  picksPerDayLabel: "WF Picks/Day",
  note:
    "Expanded precision card v1 through 2026-04-01. Core Five markets (REB, AST, THREES, PA, PR, PTS) with player-local manifest gating (Tier 1), high-confidence bypass (Tier 2), and fill when true picks are low. Based on v13-live manifest with 507 entries.",
  targetCardCount: 6,
  allowFill: false,
};

export const PRECISION_80_SYSTEM_SUMMARY_VERSION = "2026-04-01-precision-expanded-v1-better-formula";

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
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
  right: Pick<SnapshotPrecisionPickSignal, "historicalAccuracy" | "absLineGap" | "leafAccuracy" | "bucketRecentAccuracy"> &
    Partial<Pick<SnapshotPrecisionPickSignal, "projectionWinProbability" | "projectionPriceEdge">>,
  rankingMode: PrecisionRankingMode = "historical-prior-first",
): number {
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
          rightWinProbability - leftWinProbability,
          rightPriceEdge - leftPriceEdge,
          rightGap - leftGap,
          rightLeaf - leftLeaf,
          rightBucket - leftBucket,
          right.historicalAccuracy - left.historicalAccuracy,
        ]
      : [
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
    return {
      ...looseSignal,
      reasons: [...(looseSignal.reasons ?? []), "Tier 3: player-market pair qualified via high-volume bypass."],
    };
  }

  // Not Tier 3, so must pass strict rules for Tier 1 or Tier 2
  const strictSignal = buildPrecisionPick(input, DEFAULT_DAILY_6_RULES);
  if (!strictSignal) return null;
  if (!strictSignal.qualified || strictSignal.side === "NEUTRAL") return strictSignal;

  const tier = getPrecisionCardTier(input, input.market, strictSignal);

  if (tier === "tier1") {
    return {
      ...strictSignal,
      reasons: [...(strictSignal.reasons ?? []), "Tier 1: player-market pair is in the expanded precision manifest."],
    };
  }

  if (tier === "tier2") {
    return {
      ...strictSignal,
      reasons: [...(strictSignal.reasons ?? []), "Tier 2: player-market pair qualified via high-confidence universal bypass."],
    };
  }

  return {
    ...strictSignal,
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




























