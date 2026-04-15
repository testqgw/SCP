import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH,
  resolveProjectPath,
} from "@/lib/snapshot/universalArtifactPaths";
import {
  buildUniversalProjectionDistributionKey,
  type UniversalProjectionDistributionFile,
  type UniversalProjectionDistributionRecord,
} from "@/lib/snapshot/universalProjectionDistribution";
import {
  buildUniversalResidualCalibrationKey,
  universalMinutesBucket,
  type UniversalMinutesBucket,
  type UniversalResidualCalibrationFile,
  type UniversalResidualCalibrationRecord,
} from "@/lib/snapshot/universalResidualCalibration";
import { computeBenchBigRoleStability } from "@/lib/snapshot/benchBigRoleStability";
import { buildPRAComboState } from "@/lib/snapshot/praComboState";
import { gateShapeNumber, shouldExposeShapeContext } from "@/lib/snapshot/shapeRegime";
import {
  predictUniversalBaselineRouter,
  resolveRouterLeaf,
  type RouterDatasetRow,
  type RouterFeatureMode,
  type UniversalBaselineRouterModel,
} from "@/lib/snapshot/universalBaselineRouter";
import type { SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;
export type Archetype =
  | "LEAD_GUARD"
  | "TABLE_SETTING_LEAD_GUARD"
  | "SCORE_FIRST_LEAD_GUARD"
  | "HELIOCENTRIC_GUARD"
  | "ELITE_SHOOTING_GUARD"
  | "SCORING_GUARD_CREATOR"
  | "JUMBO_CREATOR_GUARD"
  | "WING"
  | "CONNECTOR_WING"
  | "SPOTUP_WING"
  | "BENCH_SHOOTING_GUARD"
  | "BENCH_PASS_FIRST_GUARD"
  | "BENCH_LOW_USAGE_GUARD"
  | "BENCH_TRADITIONAL_GUARD"
  | "BENCH_WING"
  | "BENCH_LOW_USAGE_WING"
  | "BENCH_MIDRANGE_SCORER"
  | "BENCH_VOLUME_SCORER"
  | "BENCH_CREATOR_SCORER"
  | "BENCH_REBOUNDING_SCORER"
  | "BENCH_SPACER_SCORER"
  | "BENCH_STRETCH_BIG"
  | "BENCH_LOW_USAGE_BIG"
  | "BENCH_TRADITIONAL_BIG"
  | "TWO_WAY_MARKET_WING"
  | "SCORER_CREATOR_WING"
  | "SHOT_CREATING_WING"
  | "MARKET_SHAPED_SCORING_WING"
  | "CENTER"
  | "STRETCH_RIM_PROTECTOR_CENTER"
  | "POINT_FORWARD"
  | "LOW_MINUTE_BENCH";

type FeatureName =
  | "lineGap"
  | "absLineGap"
  | "l5CurrentLineDeltaAvg"
  | "l5CurrentLineOverRate"
  | "l5MinutesAvg"
  | "emaCurrentLineDelta"
  | "emaCurrentLineOverRate"
  | "emaMinutesAvg"
  | "l15ValueMean"
  | "l15ValueMedian"
  | "l15ValueStdDev"
  | "l15ValueSkew"
  | "projectionMedianDelta"
  | "medianLineGap"
  | "competitivePaceFactor"
  | "blowoutRisk"
  | "minutesShiftDelta"
  | "minutesShiftAbsDelta"
  | "seasonMinutesAvg"
  | "minutesLiftPct"
  | "activeCorePts"
  | "activeCoreAst"
  | "missingCorePts"
  | "missingCoreAst"
  | "missingCoreShare"
  | "stepUpRoleFlag"
  | "expectedMinutes"
  | "minutesVolatility"
  | "benchBigRoleStability"
  | "starterRateLast10"
  | "priceLean"
  | "priceAbsLean"
  | "line"
  | "projectedValue"
  | "projectionPerMinute"
  | "projectionToLineRatio"
  | "lineTier"
  | "priceStrength"
  | "contextQuality"
  | "roleStability"
  | "projectionMarketAgreement"
  | "openingTeamSpread"
  | "openingSpreadAbs"
  | "openingTotal"
  | "lineupTimingConfidence"
  | "completenessScore"
  | "spreadResolved"
  | "favoriteFlag"
  | "bigFavoriteFlag"
  | "closeGameFlag"
  | "pointForwardFlag"
  | "heliocentricGuardFlag"
  | "stretchRimProtectorCenterFlag"
  | "rimPressureStarFlag"
  | "lowThreeVolumeStarFlag"
  | "comboGapPressure"
  | "favoredOver"
  | "overPrice"
  | "underPrice"
  | "overProbability"
  | "underProbability"
  | "assistRate"
  | "astToLineRatio"
  | "ptsShareOfPRA"
  | "rebShareOfPRA"
  | "astShareOfPRA"
  | "maxLegShareOfCombo"
  | "comboEntropy"
  | "comboBalanceScore"
  | "ptsLedPRAFlag"
  | "highLinePRAFlag"
  | "veryHighLinePRAFlag"
  | "lateSeasonFlag"
  | "lateSeasonHighLinePRAFlag"
  | "guardWingArchetypeFlag"
  | "ptsLedPRAxGuardWing"
  | "highLinePRAxGuardWing"
  | "lateSeasonxGuardWing"
  | "closeGamexGuardWing"
  | "ptsLedPRAxCloseGame"
  | "ptsLedPRAxLateSeason"
  | "ptsLedPRAxHighLine";

type LeafNode = {
  kind: "leaf";
  side: Side;
  count?: number;
  accuracy?: number;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  left: TreeNode;
  right: TreeNode;
  count?: number;
  accuracy?: number;
};

type TreeNode = LeafNode | SplitNode;

type RoutedModelDecision = Side | "projection" | "finalOverride" | "marketFavored";
type FeatureThresholdRouterFeature = "expectedMinutes" | "minutesVolatility" | "projectedValue";

type ModelVariant =
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "constant"; side: Side }
  | {
      kind: "featureThresholdRouter";
      feature: FeatureThresholdRouterFeature;
      threshold: number;
      lteDecision: RoutedModelDecision;
      gtDecision: RoutedModelDecision;
    }
  | { kind: "lowMinutesThenFinalElseConstant"; threshold: number; side: Side }
  | { kind: "underGapThenFinalElseConstant"; threshold: number; side: Side }
  | { kind: "lowMinutesThenFinal"; threshold: number }
  | { kind: "lowMinutesDisagreementThenFinal"; threshold: number }
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "overGapThenMarket"; threshold: number }
  | { kind: "strongPriceThenMarket"; threshold: number }
  | { kind: "nearLineThenMarket"; threshold: number }
  | { kind: "agreementThenProjection"; threshold: number }
  | { kind: "favoriteOverSuppress"; spreadThreshold: number; gapThreshold: number }
  | { kind: "favoriteOverSuppressPositiveGap"; spreadThreshold: number; gapThreshold: number; minExpectedMinutes: number }
  | { kind: "lowQualityThenMarket"; threshold: number }
  | { kind: "lowVolatilityHelioOver"; volatilityThreshold: number; gapThreshold: number }
  | { kind: "tree"; tree: TreeNode; maxDepth: number; minLeaf: number };

type UniversalModelRecord = {
  market: SnapshotMarket;
  archetype: Archetype;
  samples?: number;
  modelAccuracy?: number;
  lateWindowAccuracy?: number | null;
  model: ModelVariant;
};

type UniversalModelFile = {
  models?: UniversalModelRecord[];
};

type TreeDisagreementContainmentBucket = {
  key: string;
  market: SnapshotMarket;
  archetype: string;
  disagreementSamples: number;
  disagreementRaw: number | null;
  agreementSamples: number;
  agreementRaw: number | null;
  disagreementMinusAgreement: number | null;
  disagreementFoldStdDev: number | null;
  unstable: boolean;
  reasonFlags?: string[];
};

type TreeDisagreementContainmentConfig = {
  generatedAt?: string;
  triggerRules?: {
    nearLineAbsGapMax?: number;
    instabilityDeltaMax?: number;
    lowSupportMax?: number;
    highVarianceStdDevMin?: number;
  };
  buckets?: TreeDisagreementContainmentBucket[];
};

type TreeDisagreementParentBucketFallbackBucket = TreeDisagreementContainmentBucket & {
  parentArchetype: Archetype;
};

type TreeDisagreementParentBucketFallbackConfig = {
  generatedAt?: string;
  triggerRules?: {
    nearLineAbsGapMax?: number;
    instabilityDeltaMax?: number;
    lowSupportMax?: number;
    highVarianceStdDevMin?: number;
  };
  buckets?: TreeDisagreementParentBucketFallbackBucket[];
};

type LiveUniversalQualificationThresholds = {
  minBucketLateAccuracy: number;
  minBucketSamples: number;
  minLeafAccuracy: number;
  minLeafCount: number;
  minProjectionWinProbability: number;
  minProjectionPriceEdge: number;
};

type LiveUniversalQualificationArchetypeOverrides = Partial<
  Record<Archetype, Partial<LiveUniversalQualificationThresholds>>
>;

type LiveUniversalQualificationMarketOverride = Partial<LiveUniversalQualificationThresholds> & {
  archetypeOverrides?: LiveUniversalQualificationArchetypeOverrides;
};

export type LiveUniversalQualificationSettings = LiveUniversalQualificationThresholds & {
  marketOverrides?: Partial<
    Record<SnapshotMarket, LiveUniversalQualificationMarketOverride>
  >;
};

export type RawLiveUniversalModelDecision = {
  market: SnapshotMarket;
  rawSide: SnapshotModelSide;
  finalSide: SnapshotModelSide;
  archetype: Archetype | null;
  minutesBucket: UniversalMinutesBucket | null;
  modelKind: ModelVariant["kind"] | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  absLineGap: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL" | null;
  priceLean: number | null;
  priceStrength: number | null;
  projectionMarketAgreement: number | null;
  overProbability: number | null;
  underProbability: number | null;
  projectionWinProbability: number | null;
  projectionPriceEdge: number | null;
  projectionResidualMean: number | null;
  projectionResidualStdDev: number | null;
  runtimeOverrideLabel?: string | null;
  runtimeOverrideSourceArchetype?: Archetype | null;
  runtimeOverrideTargetArchetype?: Archetype | null;
};

export type LiveUniversalModelDecision = RawLiveUniversalModelDecision & {
  side: SnapshotModelSide;
  qualified: boolean;
  rejectionReasons: string[];
};

type LiveUniversalModelRow = {
  projectedValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
  priceLean: number | null;
  l5CurrentLineDeltaAvg: number | null;
  l5CurrentLineOverRate: number | null;
  l5MinutesAvg: number | null;
  emaCurrentLineDelta: number | null;
  emaCurrentLineOverRate: number | null;
  emaMinutesAvg: number | null;
  l15ValueMean: number | null;
  l15ValueMedian: number | null;
  l15ValueStdDev: number | null;
  l15ValueSkew: number | null;
  projectionMedianDelta: number | null;
  medianLineGap: number | null;
  competitivePaceFactor: number | null;
  blowoutRisk: number | null;
  minutesShiftDelta: number | null;
  minutesShiftAbsDelta: number | null;
  seasonMinutesAvg: number | null;
  minutesLiftPct: number | null;
  activeCorePts: number | null;
  activeCoreAst: number | null;
  missingCorePts: number | null;
  missingCoreAst: number | null;
  missingCoreShare: number | null;
  stepUpRoleFlag: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  benchBigRoleStability: number | null;
  starterRateLast10: number | null;
  lineGap: number;
  absLineGap: number;
  projectionPerMinute: number | null;
  projectionToLineRatio: number | null;
  lineTier: number | null;
  priceStrength: number | null;
  contextQuality: number | null;
  roleStability: number | null;
  projectionMarketAgreement: number | null;
  openingTeamSpread: number | null;
  openingSpreadAbs: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
  favoriteFlag: number | null;
  bigFavoriteFlag: number | null;
  closeGameFlag: number | null;
  pointForwardFlag: number | null;
  heliocentricGuardFlag: number | null;
  stretchRimProtectorCenterFlag: number | null;
  rimPressureStarFlag: number | null;
  lowThreeVolumeStarFlag: number | null;
  comboGapPressure: number | null;
  assistRate: number | null;
  astToLineRatio: number | null;
  ptsShareOfPRA: number | null;
  rebShareOfPRA: number | null;
  astShareOfPRA: number | null;
  maxLegShareOfCombo: number | null;
  comboEntropy: number | null;
  comboBalanceScore: number | null;
  ptsLedPRAFlag: number;
  highLinePRAFlag: number;
  veryHighLinePRAFlag: number;
  lateSeasonFlag: number;
  lateSeasonHighLinePRAFlag: number;
  guardWingArchetypeFlag: number;
  ptsLedPRAxGuardWing: number;
  highLinePRAxGuardWing: number;
  lateSeasonxGuardWing: number;
  closeGamexGuardWing: number;
  ptsLedPRAxCloseGame: number;
  ptsLedPRAxLateSeason: number;
  ptsLedPRAxHighLine: number;
};

export type PredictLiveUniversalSideInput = {
  gameDateEt?: string | null;
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: SnapshotModelSide;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
  emaCurrentLineDelta?: number | null;
  emaCurrentLineOverRate?: number | null;
  emaMinutesAvg?: number | null;
  l15ValueMean?: number | null;
  l15ValueMedian?: number | null;
  l15ValueStdDev?: number | null;
  l15ValueSkew?: number | null;
  projectionMedianDelta?: number | null;
  medianLineGap?: number | null;
  competitivePaceFactor?: number | null;
  blowoutRisk?: number | null;
  seasonMinutesAvg?: number | null;
  minutesLiftPct?: number | null;
  activeCorePts?: number | null;
  activeCoreAst?: number | null;
  missingCorePts?: number | null;
  missingCoreAst?: number | null;
  missingCoreShare?: number | null;
  stepUpRoleFlag?: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  benchBigRoleStability?: number | null;
  starterRateLast10: number | null;
  archetypeExpectedMinutes?: number | null;
  archetypeStarterRateLast10?: number | null;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  playerPosition: string | null;
  assistProjection: number | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  threesProjection?: number | null;
};

const POINT_FORWARD_WEAK_MARKET_ROLE_FIX_MARKETS: readonly Market[] = ["THREES", "PA", "RA"];
const HELIOCENTRIC_WEAK_MARKET_ROLE_FIX_MARKETS: readonly Market[] = ["PTS", "PRA", "PR", "PA", "RA"];
const HELIOCENTRIC_GUARD_ROLE_FIX_EXCLUDED_MARKETS: readonly Market[] = ["THREES", "AST"];
const BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX_MARKETS: readonly Market[] = ["PA", "PR"];
const BENCH_CREATOR_SCORER_ROLE_FIX_MARKETS: readonly Market[] = ["PTS", "AST", "PRA", "PR"];
const POINT_FORWARD_WEAK_MARKET_ROLE_FIX = {
  minMinutes: 30,
  minPoints: 22,
  minRebounds: 6,
  minAssists: 4.5,
  maxAssistsExclusive: 6.8,
  maxThrees: 2.6,
} as const;
const HELIOCENTRIC_GUARD_ROLE_FIX = {
  minMinutes: 27,
  minStarterRate: 0.5,
  minPoints: 19,
  minAssists: 7.2,
  minThrees: 2.7,
} as const;
const BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX = {
  maxMinutes: 16.5,
  maxStarterRate: 0.3,
  maxPoints: 6.5,
  maxRebounds: 5.75,
  maxThrees: 0.5,
} as const;
const BENCH_CREATOR_SCORER_ROLE_FIX = {
  minMinutes: 20,
  minStarterRate: 0.25,
  minPoints: 10,
  minAssists: 1.3,
  minThrees: 2.2,
  maxRebounds: 4.5,
} as const;
const HELIOCENTRIC_WEAK_MARKET_ROLE_FIX_ARCHETYPE = (() => {
  const raw = process.env.SNAPSHOT_HELIOCENTRIC_WEAK_MARKET_ROLE_FIX_ARCHETYPE?.trim();
  if (!raw) return "POINT_FORWARD" as Archetype;
  const normalized = raw.toUpperCase();
  if (normalized === "OFF" || normalized === "NONE") return null;
  switch (normalized) {
    case "POINT_FORWARD":
      return "POINT_FORWARD" as Archetype;
    case "SCORE_FIRST_LEAD_GUARD":
      return "SCORE_FIRST_LEAD_GUARD" as Archetype;
    case "TABLE_SETTING_LEAD_GUARD":
      return "TABLE_SETTING_LEAD_GUARD" as Archetype;
    case "JUMBO_CREATOR_GUARD":
      return "JUMBO_CREATOR_GUARD" as Archetype;
    default:
      return "POINT_FORWARD" as Archetype;
  }
})();

const DEFAULT_MODEL_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
const DEFAULT_MODEL_FALLBACK_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
const DEFAULT_CALIBRATION_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
const DEFAULT_PROJECTION_DISTRIBUTION_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH);
const ENABLE_MISSING_POSITION_STARTER_FALLBACK =
  process.env.SNAPSHOT_DISABLE_MISSING_POSITION_STARTER_FALLBACK?.trim() !== "1";

// Targeted residual corrector for PRA bad bucket conditions
// These archetypes had regression issues in the PRA combo state audit
const BAD_BUCKET_PRA_ARCHETYPES = new Set(["SCORE_FIRST_LEAD_GUARD", "LEAD_GUARD", "WING"]);
const BAD_BUCKET_PRA_LEAF_THRESHOLD = 65; // Conservative threshold for bad bucket conditions
const PTS_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PTS_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PTS_MIN_LEAF_ACCURACY)
  : 58;
const REB_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_REB_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_REB_MIN_LEAF_ACCURACY)
  : 60;
const AST_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_AST_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_AST_MIN_LEAF_ACCURACY)
  : 58;
const PTS_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PTS_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 56;
const PTS_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PTS_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : PTS_MIN_LEAF_ACCURACY;
const PTS_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const PTS_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : 57;
const PTS_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PTS_WING_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PTS_WING_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PTS_WING_MIN_LEAF_ACCURACY)
  : 55;
const PTS_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY)
  : 55;
const PTS_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY)
  : 55;
const PTS_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PTS_CONNECTOR_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_CONNECTOR_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_CONNECTOR_WING_MIN_LEAF_ACCURACY)
  : PTS_MIN_LEAF_ACCURACY;
const PTS_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PTS_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY)
  : 60;
const PTS_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PTS_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY)
  : 60;
const REB_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_CENTER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_CENTER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_CENTER_MIN_LEAF_ACCURACY)
  : 54;
const REB_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 55.5;
const REB_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 53.5;
const REB_ELITE_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_ELITE_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_ELITE_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_ELITE_SHOOTING_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_ELITE_SHOOTING_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_ELITE_SHOOTING_GUARD_MIN_LEAF_ACCURACY)
  : REB_MIN_LEAF_ACCURACY;
const REB_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 60;
const REB_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : 64;
const REB_BENCH_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_WING_MIN_BUCKET_LATE_ACCURACY)
  : 52;
const REB_BENCH_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_WING_MIN_LEAF_ACCURACY)
  : 52.5;
const REB_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY)
  : 57;
const REB_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY)
  : 57;
const REB_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_WING_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_REB_WING_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_REB_WING_MIN_LEAF_ACCURACY)
  : 56;
const REB_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_CONNECTOR_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_CONNECTOR_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_CONNECTOR_WING_MIN_LEAF_ACCURACY)
  : 56;
const REB_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : REB_MIN_LEAF_ACCURACY;
const AST_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 60;
const AST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 53.5;
const AST_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_CENTER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const AST_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY)
  : 62;
const AST_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const AST_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY)
  : AST_MIN_LEAF_ACCURACY;
const AST_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const AST_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY)
  : AST_MIN_LEAF_ACCURACY;
const AST_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 55;
const AST_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY)
  : 55.5;
const AST_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 55;
const AST_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_AST_CENTER_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_AST_CENTER_MIN_LEAF_ACCURACY)
  : 57;
const AST_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const AST_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : 56;
const AST_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY)
  : 60;
const AST_TWO_WAY_MARKET_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_TWO_WAY_MARKET_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_TWO_WAY_MARKET_WING_MIN_LEAF_ACCURACY)
  : 62;
const AST_BENCH_TRADITIONAL_BIG_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_BIG_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_BIG_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const AST_BENCH_TRADITIONAL_BIG_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_BIG_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_TRADITIONAL_BIG_MIN_LEAF_ACCURACY)
  : 56;
const AST_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const AST_BENCH_STRETCH_BIG_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_BENCH_STRETCH_BIG_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_BENCH_STRETCH_BIG_MIN_LEAF_ACCURACY)
  : AST_MIN_LEAF_ACCURACY;
const AST_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const AST_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_AST_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_AST_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : AST_MIN_LEAF_ACCURACY;
const PRA_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PRA_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PRA_MIN_LEAF_ACCURACY)
  : 58;
const PA_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PA_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PA_MIN_LEAF_ACCURACY)
  : 67;
const PA_SPOTUP_WING_USE_LEGACY_SIDE_BIAS =
  process.env.SNAPSHOT_PA_SPOTUP_WING_USE_LEGACY_SIDE_BIAS?.trim() === "1";
const PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD_RAW =
  process.env.SNAPSHOT_PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD?.trim() ?? null;
const PA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 52;
const PA_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : 69;
const PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD =
  PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD_RAW?.toLowerCase() === "off"
    ? null
    : Number.isFinite(Number(PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD_RAW))
      ? Number(PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD_RAW)
      : 1;
const PA_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const PA_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PA_WING_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PA_WING_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PA_WING_MIN_LEAF_ACCURACY)
  : 56;
const PA_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PA_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY)
  : 56;
const PA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PA_BENCH_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_WING_MIN_LEAF_ACCURACY)
  : 56;
const PA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY)
  : 59;
const PA_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 60;
const PA_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY)
  : 70;
const PA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 49;
const PA_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 58;
const PA_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_CENTER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 46;
const PA_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PA_CENTER_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PA_CENTER_MIN_LEAF_ACCURACY)
  : 57;
const PA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PA_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : PA_MIN_LEAF_ACCURACY;
const PA_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const PA_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY)
  : 65;
const PR_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PR_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PR_MIN_LEAF_ACCURACY)
  : 60;
const PTS_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_CENTER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PTS_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PTS_CENTER_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PTS_CENTER_MIN_LEAF_ACCURACY)
  : 56;
const PTS_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 63;
const PTS_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : PTS_MIN_LEAF_ACCURACY;
const PTS_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PTS_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY)
  : PTS_MIN_LEAF_ACCURACY;
const PR_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PR_CENTER_MIN_BUCKET_LATE_ACCURACY))
  ? Number(process.env.SNAPSHOT_PR_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 47;
const PR_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 54.5;
const PR_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PR_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY)
  : PR_MIN_LEAF_ACCURACY;
const PR_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PR_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY)
  : PR_MIN_LEAF_ACCURACY;
const RA_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_RA_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_RA_MIN_LEAF_ACCURACY)
  : 67;
const RA_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_RA_CENTER_MIN_BUCKET_LATE_ACCURACY))
  ? Number(process.env.SNAPSHOT_RA_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 55;
const RA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 48;
const RA_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_RA_LEAD_GUARD_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_RA_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 54;
const RA_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_RA_CENTER_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_RA_CENTER_MIN_LEAF_ACCURACY)
  : 54;
const PR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PR_WING_MIN_BUCKET_LATE_ACCURACY))
  ? Number(process.env.SNAPSHOT_PR_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PR_WING_MIN_LEAF_ACCURACY = Number.isFinite(Number(process.env.SNAPSHOT_PR_WING_MIN_LEAF_ACCURACY))
  ? Number(process.env.SNAPSHOT_PR_WING_MIN_LEAF_ACCURACY)
  : 58;
const PR_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY)
  : PR_WING_MIN_BUCKET_LATE_ACCURACY;
const PR_BENCH_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_WING_MIN_BUCKET_LATE_ACCURACY)
  : PR_WING_MIN_BUCKET_LATE_ACCURACY;
const PR_CONNECTOR_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_CONNECTOR_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_CONNECTOR_WING_MIN_LEAF_ACCURACY)
  : 56;
const PR_BENCH_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_WING_MIN_LEAF_ACCURACY)
  : 56;
const PR_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PR_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 57;
const PR_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 62;
const PR_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 62;
const PR_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : PR_MIN_LEAF_ACCURACY;
const PR_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PR_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PR_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY)
  : 50;
const THREES_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PRA_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 58;
const PRA_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 60;
const PRA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PRA_LEAD_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_LEAD_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_LEAD_GUARD_MIN_LEAF_ACCURACY)
  : 60;
const PRA_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PRA_BENCH_CREATOR_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_BENCH_CREATOR_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_BENCH_CREATOR_SCORER_MIN_LEAF_ACCURACY)
  : PRA_MIN_LEAF_ACCURACY;
const PRA_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : PRA_MIN_LEAF_ACCURACY;
const THREES_SCORE_FIRST_LEAD_GUARD_SIDE_BIAS = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_SCORE_FIRST_LEAD_GUARD_SIDE_BIAS),
)
  ? Number(process.env.SNAPSHOT_THREES_SCORE_FIRST_LEAD_GUARD_SIDE_BIAS)
  : 0;
const THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_BUCKET_LATE_ACCURACY)
  : 54.5;
const THREES_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const THREES_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : 60;
const THREES_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const THREES_CONNECTOR_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_CONNECTOR_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_CONNECTOR_WING_MIN_LEAF_ACCURACY)
  : 58;
const THREES_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const THREES_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY)
  : 58;
const THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_LEAF_ACCURACY)
  : 56;
const RA_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const REB_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_REB_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_REB_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY)
  : REB_MIN_LEAF_ACCURACY;
const RA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const RA_BENCH_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_WING_MIN_LEAF_ACCURACY)
  : 54;
const RA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY)
  : 51;
const RA_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY)
  : 64;
const RA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY)
  : 52;
const RA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY)
  : 53.5;
const RA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const RA_POINT_FORWARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_POINT_FORWARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_POINT_FORWARD_MIN_LEAF_ACCURACY)
  : RA_MIN_LEAF_ACCURACY;
const RA_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const RA_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY)
  : 62;
const RA_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const RA_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY)
  : RA_MIN_LEAF_ACCURACY;
const RA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY)
  : 54;
const RA_SPOTUP_WING_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_SPOTUP_WING_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_RA_SPOTUP_WING_MIN_LEAF_ACCURACY)
  : 62;
// 2026-03-17: Bench traditional big combo markets were skewing too UNDER-heavy.
const PA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE?.trim() || "projection";
const PA_SCORING_GUARD_CREATOR_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PA_SCORING_GUARD_CREATOR_MODEL_OVERRIDE?.trim() || "projection";
const PA_SPOTUP_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PA_SPOTUP_WING_MODEL_OVERRIDE?.trim() || "gapThenMarket:1";
const PA_CONNECTOR_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PA_CONNECTOR_WING_MODEL_OVERRIDE?.trim() || "";
const PTS_LEAD_GUARD_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "";
const PTS_SPOTUP_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_SPOTUP_WING_MODEL_OVERRIDE?.trim() || "";
const PTS_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_WING_MODEL_OVERRIDE?.trim() || "";
const PTS_CONNECTOR_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_CONNECTOR_WING_MODEL_OVERRIDE?.trim() || "";
const PTS_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PTS_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "";
const PTS_BENCH_SPACER_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PTS_BENCH_SPACER_SCORER_MODEL_OVERRIDE?.trim() || "";
const PTS_CENTER_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_CENTER_MODEL_OVERRIDE?.trim() || "";
const PTS_POINT_FORWARD_MODEL_OVERRIDE = process.env.SNAPSHOT_PTS_POINT_FORWARD_MODEL_OVERRIDE?.trim() || "";
const PTS_JUMBO_CREATOR_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PTS_JUMBO_CREATOR_GUARD_MODEL_OVERRIDE?.trim() || "marketFavored";
const PTS_JUMBO_CREATOR_GUARD_MIN_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_JUMBO_CREATOR_GUARD_MIN_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_JUMBO_CREATOR_GUARD_MIN_BUCKET_LATE_ACCURACY)
  : 56;
const PTS_JUMBO_CREATOR_GUARD_MIN_LEAF_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_PTS_JUMBO_CREATOR_GUARD_MIN_LEAF_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_PTS_JUMBO_CREATOR_GUARD_MIN_LEAF_ACCURACY)
  : PTS_MIN_LEAF_ACCURACY;
const REB_CENTER_MODEL_OVERRIDE = process.env.SNAPSHOT_REB_CENTER_MODEL_OVERRIDE?.trim() || "";
const AST_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_AST_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE?.trim() || "marketFavored";
const AST_CENTER_MODEL_OVERRIDE = process.env.SNAPSHOT_AST_CENTER_MODEL_OVERRIDE?.trim() || "";
const AST_LEAD_GUARD_MODEL_OVERRIDE = process.env.SNAPSHOT_AST_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "";
const PR_CENTER_MODEL_OVERRIDE = process.env.SNAPSHOT_PR_CENTER_MODEL_OVERRIDE?.trim() || "";
const PR_BENCH_CREATOR_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PR_BENCH_CREATOR_SCORER_MODEL_OVERRIDE?.trim() || "";
const PR_BENCH_VOLUME_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PR_BENCH_VOLUME_SCORER_MODEL_OVERRIDE?.trim() || "projection";
const PR_BENCH_STRETCH_BIG_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PR_BENCH_STRETCH_BIG_MODEL_OVERRIDE?.trim() || "gapThenProjection:1";
const PR_LEAD_GUARD_MODEL_OVERRIDE = process.env.SNAPSHOT_PR_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "nearLineThenMarket:0.75";
const PR_POINT_FORWARD_MODEL_OVERRIDE = process.env.SNAPSHOT_PR_POINT_FORWARD_MODEL_OVERRIDE?.trim() || "";
const PRA_LEAD_GUARD_MODEL_OVERRIDE = process.env.SNAPSHOT_PRA_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "";
const PA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE?.trim() || "";
const PRA_SPOTUP_WING_MODEL_OVERRIDE = process.env.SNAPSHOT_PRA_SPOTUP_WING_MODEL_OVERRIDE?.trim() || "marketFavored";
const PA_BENCH_WING_MODEL_OVERRIDE =
  process.env.PA_BENCH_WING_MODEL_OVERRIDE?.trim() ||
  process.env.SNAPSHOT_PA_BENCH_WING_MODEL_OVERRIDE?.trim() ||
  "";
const PRA_FAMILY_MODEL_OVERRIDE =
  process.env.PRA_FAMILY_MODEL_OVERRIDE?.trim() ||
  process.env.SNAPSHOT_PRA_FAMILY_MODEL_OVERRIDE?.trim() ||
  "";
const RA_TWMW_MODEL_OVERRIDE =
  process.env.RA_TWMW_MODEL_OVERRIDE?.trim() ||
  process.env.SNAPSHOT_RA_TWMW_MODEL_OVERRIDE?.trim() ||
  "";
const DRAG_MIN_BUCKET_LATE = Number.isFinite(
  Number(process.env.DRAG_MIN_BUCKET_LATE ?? process.env.SNAPSHOT_DRAG_MIN_BUCKET_LATE),
)
  ? Number(process.env.DRAG_MIN_BUCKET_LATE ?? process.env.SNAPSHOT_DRAG_MIN_BUCKET_LATE)
  : null;
const PA_BENCH_WING_NATIVE_VETO_MAX_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MAX_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MAX_ABS_LINE_GAP)
  : null;
const PA_BENCH_WING_NATIVE_VETO_MIN_PRICE_STRENGTH = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MIN_PRICE_STRENGTH),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MIN_PRICE_STRENGTH)
  : null;
const PA_BENCH_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT = Number.isFinite(
  Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT),
)
  ? Number(process.env.SNAPSHOT_PA_BENCH_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  : null;
const PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP)
  : null;
const PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP)
  : 2;
const PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT),
)
  ? Number(process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  : null;
const PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN =
  process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN?.trim() === "1";
const PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_FAVORED_MATCH =
  process.env.SNAPSHOT_PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_FAVORED_MATCH?.trim() === "1";
const PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP)
  : null;
const PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT = Number.isFinite(
  Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT),
)
  ? Number(process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  : null;
const PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN =
  process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN?.trim() === "1";
const PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH =
  process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH == null
    ? true
    : process.env.SNAPSHOT_PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH?.trim() === "1";
const RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP)
  : null;
const RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP),
)
  ? Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP)
  : null;
const RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT = Number.isFinite(
  Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT),
)
  ? Number(process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  : 0;
const RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MATCH =
  process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MATCH?.trim() === "1";
const RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH =
  process.env.SNAPSHOT_RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH?.trim() === "1";
const RA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE =
  process.env.SNAPSHOT_RA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE?.trim() || "gapThenMarket:1";
const RA_BENCH_CREATOR_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_RA_BENCH_CREATOR_SCORER_MODEL_OVERRIDE?.trim() || "finalOverride";
const RA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_RA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE?.trim() || "";
const RA_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_RA_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE?.trim() || "projection";
const THREES_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_THREES_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "favoriteOverSuppress:-6.5:1.5";
const THREES_STRETCH_RIM_PROTECTOR_CENTER_MODEL_OVERRIDE =
  process.env.SNAPSHOT_THREES_STRETCH_RIM_PROTECTOR_CENTER_MODEL_OVERRIDE?.trim() || "";
const PRA_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE =
  process.env.SNAPSHOT_PRA_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE?.trim() || "gapThenMarket:0.25";
const PRA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY = DRAG_MIN_BUCKET_LATE ?? 56;
const PRA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY = DRAG_MIN_BUCKET_LATE ?? 56;
const RA_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY = DRAG_MIN_BUCKET_LATE ?? 56;
// 2026-03-17: Narrow opposite-juice veto for weaker buckets only.
const JUICE_VETO_THRESHOLD = Number.isFinite(Number(process.env.SNAPSHOT_JUICE_VETO_THRESHOLD))
  ? Number(process.env.SNAPSHOT_JUICE_VETO_THRESHOLD)
  : 0.59;
const JUICE_VETO_MAX_BUCKET_LATE_ACCURACY = Number.isFinite(
  Number(process.env.SNAPSHOT_JUICE_VETO_MAX_BUCKET_LATE_ACCURACY),
)
  ? Number(process.env.SNAPSHOT_JUICE_VETO_MAX_BUCKET_LATE_ACCURACY)
  : 62;
const TREE_DISAGREEMENT_CONTAINMENT_SCOPE =
  process.env.SNAPSHOT_UNIVERSAL_TREE_DISAGREEMENT_CONTAINMENT_SCOPE?.trim() ||
  (process.env.SNAPSHOT_UNIVERSAL_ENABLE_NEAR_LINE_TREE_DISAGREEMENT_CONTAINMENT?.trim() === "1" ? "near_line" : "");
const DEFAULT_TREE_DISAGREEMENT_CONTAINMENT_FILE = resolveProjectPath(
  path.join("exports", "direct-disagreement-containment-config.json"),
);
const TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE =
  process.env.SNAPSHOT_UNIVERSAL_TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE?.trim() ||
  (process.env.SNAPSHOT_UNIVERSAL_ENABLE_TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK?.trim() === "1"
    ? "near_line"
    : "");
const DEFAULT_TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_FILE = resolveProjectPath(
  path.join("exports", "direct-parent-bucket-fallback-config.json"),
);
const DEFAULT_UNIVERSAL_BASELINE_ROUTER_V1_FILE = resolveProjectPath(path.join("exports", "universal-baseline-router-live.json"));
const DEFAULT_UNIVERSAL_BASELINE_ROUTER_PACK_FILE = resolveProjectPath(
  path.join("exports", "universal-baseline-router-pack-v3-oos-2of3-25-58-52-0-0-models.json"),
);

function parseJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as T;
}

function resolveUniversalBaselineRouterMode(): RuntimeRouterMode {
  const raw = process.env.SNAPSHOT_UNIVERSAL_ROUTER_MODE?.trim().toLowerCase();
  if (raw === "v1") return "v1";
  if (raw === "specialist_pack_v3" || raw === "pack" || raw === "specialist-pack-v3") return "specialist_pack_v3";
  return "off";
}

function resolveModelFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_MODEL_FILE?.trim();
  if (!override) {
    return fs.existsSync(DEFAULT_MODEL_FILE) ? DEFAULT_MODEL_FILE : DEFAULT_MODEL_FALLBACK_FILE;
  }
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveCalibrationFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_CALIBRATION_FILE?.trim();
  if (!override) return DEFAULT_CALIBRATION_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveProjectionDistributionFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE?.trim();
  if (!override) return DEFAULT_PROJECTION_DISTRIBUTION_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveTreeDisagreementContainmentFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_TREE_DISAGREEMENT_CONTAINMENT_FILE?.trim();
  if (!override) return DEFAULT_TREE_DISAGREEMENT_CONTAINMENT_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveTreeDisagreementParentBucketFallbackFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_FILE?.trim();
  if (!override) return DEFAULT_TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveUniversalBaselineRouterV1FilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_ROUTER_MODEL_FILE?.trim();
  if (!override) return DEFAULT_UNIVERSAL_BASELINE_ROUTER_V1_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function resolveUniversalBaselineRouterPackFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_ROUTER_PACK_FILE?.trim();
  if (!override) return DEFAULT_UNIVERSAL_BASELINE_ROUTER_PACK_FILE;
  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

export const DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS: LiveUniversalQualificationSettings = {
  minBucketLateAccuracy: 56,
  minBucketSamples: 0,
  minLeafAccuracy: 67,
  minLeafCount: 0,
  minProjectionWinProbability: 0,
  minProjectionPriceEdge: 0,
  marketOverrides: {
    PTS: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: PTS_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      minProjectionWinProbability: 0,
      minProjectionPriceEdge: 0,
      archetypeOverrides: {
        CENTER: {
          minBucketLateAccuracy: PTS_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_CENTER_MIN_LEAF_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: PTS_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        SCORE_FIRST_LEAD_GUARD: {
          minBucketLateAccuracy: PTS_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        WING: {
          minBucketLateAccuracy: PTS_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_WING_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: PTS_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        SCORING_GUARD_CREATOR: {
          minBucketLateAccuracy: PTS_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY,
        },
        BENCH_LOW_USAGE_WING: {
          minBucketLateAccuracy: PTS_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_SHOOTING_GUARD: {
          minBucketLateAccuracy: PTS_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_TRADITIONAL_GUARD: {
          minBucketLateAccuracy: PTS_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY,
        },
        CONNECTOR_WING: {
          minBucketLateAccuracy: PTS_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_CONNECTOR_WING_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: PTS_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        JUMBO_CREATOR_GUARD: {
          minBucketLateAccuracy: PTS_JUMBO_CREATOR_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PTS_JUMBO_CREATOR_GUARD_MIN_LEAF_ACCURACY,
        },
      },
    },
    REB: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: REB_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        BENCH_WING: {
          minBucketLateAccuracy: REB_BENCH_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_BENCH_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_LOW_USAGE_WING: {
          minBucketLateAccuracy: REB_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY,
        },
        WING: {
          minBucketLateAccuracy: REB_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_WING_MIN_LEAF_ACCURACY,
        },
        CONNECTOR_WING: {
          minBucketLateAccuracy: REB_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_CONNECTOR_WING_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: REB_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        CENTER: {
          minBucketLateAccuracy: REB_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_CENTER_MIN_LEAF_ACCURACY,
        },
        SCORE_FIRST_LEAD_GUARD: {
          minBucketLateAccuracy: REB_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: REB_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        ELITE_SHOOTING_GUARD: {
          minBucketLateAccuracy: REB_ELITE_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_ELITE_SHOOTING_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_VOLUME_SCORER: {
          minBucketLateAccuracy: REB_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: REB_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY,
        },
      },
    },
    AST: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: AST_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        CENTER: {
          minBucketLateAccuracy: AST_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_CENTER_MIN_LEAF_ACCURACY,
        },
        BENCH_SHOOTING_GUARD: {
          minBucketLateAccuracy: AST_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_TRADITIONAL_GUARD: {
          minBucketLateAccuracy: AST_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_SPACER_SCORER: {
          minBucketLateAccuracy: AST_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY,
        },
        BENCH_STRETCH_BIG: {
          minBucketLateAccuracy: AST_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_STRETCH_BIG_MIN_LEAF_ACCURACY,
        },
        BENCH_TRADITIONAL_BIG: {
          minBucketLateAccuracy: AST_BENCH_TRADITIONAL_BIG_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_TRADITIONAL_BIG_MIN_LEAF_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: AST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: AST_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: AST_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_PASS_FIRST_GUARD: {
          minBucketLateAccuracy: AST_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY,
        },
        TWO_WAY_MARKET_WING: {
          minBucketLateAccuracy: AST_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: AST_TWO_WAY_MARKET_WING_MIN_LEAF_ACCURACY,
        },
      },
    },
    THREES: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 60,
      minLeafCount: 0,
      archetypeOverrides: {
        SCORE_FIRST_LEAD_GUARD: {
          minBucketLateAccuracy: THREES_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: THREES_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: THREES_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        CONNECTOR_WING: {
          minBucketLateAccuracy: THREES_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: THREES_CONNECTOR_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_VOLUME_SCORER: {
          minBucketLateAccuracy: THREES_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: THREES_BENCH_VOLUME_SCORER_MIN_LEAF_ACCURACY,
        },
        STRETCH_RIM_PROTECTOR_CENTER: {
          minBucketLateAccuracy: THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: THREES_STRETCH_RIM_PROTECTOR_CENTER_MIN_LEAF_ACCURACY,
        },
      },
    },
    PRA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: PRA_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        POINT_FORWARD: {
          minBucketLateAccuracy: PRA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PRA_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        SCORING_GUARD_CREATOR: {
          minBucketLateAccuracy: PRA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY,
        },
        SCORE_FIRST_LEAD_GUARD: {
          minBucketLateAccuracy: PRA_SCORE_FIRST_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PRA_SCORE_FIRST_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: PRA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PRA_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: 57,
        },
        BENCH_CREATOR_SCORER: {
          minBucketLateAccuracy: PRA_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PRA_BENCH_CREATOR_SCORER_MIN_LEAF_ACCURACY,
        },
      },
    },
    PA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: PA_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        BENCH_WING: {
          minBucketLateAccuracy: PA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_BENCH_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_LOW_USAGE_WING: {
          minBucketLateAccuracy: PA_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY,
        },
        CONNECTOR_WING: {
          minBucketLateAccuracy: PA_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY,
        },
        WING: {
          minBucketLateAccuracy: PA_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_REBOUNDING_SCORER: {
          minBucketLateAccuracy: PA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY,
        },
        BENCH_SPACER_SCORER: {
          minBucketLateAccuracy: PA_BENCH_SPACER_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_BENCH_SPACER_SCORER_MIN_LEAF_ACCURACY,
        },
        BENCH_SHOOTING_GUARD: {
          minBucketLateAccuracy: PA_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: PA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        CENTER: {
          minBucketLateAccuracy: PA_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_CENTER_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: PA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: PA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PA_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
      },
    },
    PR: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: PR_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        BENCH_WING: {
          minBucketLateAccuracy: PR_BENCH_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_BENCH_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_STRETCH_BIG: {
          minBucketLateAccuracy: PR_BENCH_STRETCH_BIG_MIN_BUCKET_LATE_ACCURACY,
        },
        BENCH_CREATOR_SCORER: {
          minBucketLateAccuracy: PR_BENCH_CREATOR_SCORER_MIN_BUCKET_LATE_ACCURACY,
        },
        BENCH_SHOOTING_GUARD: {
          minBucketLateAccuracy: PR_BENCH_SHOOTING_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_BENCH_SHOOTING_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_LOW_USAGE_WING: {
          minBucketLateAccuracy: PR_BENCH_LOW_USAGE_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_BENCH_LOW_USAGE_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_VOLUME_SCORER: {
          minBucketLateAccuracy: PR_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY,
        },
        CENTER: {
          minBucketLateAccuracy: PR_CENTER_MIN_BUCKET_LATE_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: PR_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: PR_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        CONNECTOR_WING: {
          minBucketLateAccuracy: PR_CONNECTOR_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_CONNECTOR_WING_MIN_LEAF_ACCURACY,
        },
        WING: {
          minBucketLateAccuracy: PR_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: PR_WING_MIN_LEAF_ACCURACY,
        },
      },
    },
    RA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: RA_MIN_LEAF_ACCURACY,
      minLeafCount: 0,
      archetypeOverrides: {
        BENCH_REBOUNDING_SCORER: {
          minBucketLateAccuracy: RA_BENCH_REBOUNDING_SCORER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_BENCH_REBOUNDING_SCORER_MIN_LEAF_ACCURACY,
        },
        POINT_FORWARD: {
          minBucketLateAccuracy: RA_POINT_FORWARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_POINT_FORWARD_MIN_LEAF_ACCURACY,
        },
        SCORING_GUARD_CREATOR: {
          minBucketLateAccuracy: RA_SCORING_GUARD_CREATOR_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_SCORING_GUARD_CREATOR_MIN_LEAF_ACCURACY,
        },
        BENCH_VOLUME_SCORER: {
          minBucketLateAccuracy: RA_BENCH_VOLUME_SCORER_MIN_BUCKET_LATE_ACCURACY,
        },
        BENCH_WING: {
          minBucketLateAccuracy: RA_BENCH_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_BENCH_WING_MIN_LEAF_ACCURACY,
        },
        BENCH_TRADITIONAL_GUARD: {
          minBucketLateAccuracy: RA_BENCH_TRADITIONAL_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_BENCH_TRADITIONAL_GUARD_MIN_LEAF_ACCURACY,
        },
        BENCH_PASS_FIRST_GUARD: {
          minBucketLateAccuracy: RA_BENCH_PASS_FIRST_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_BENCH_PASS_FIRST_GUARD_MIN_LEAF_ACCURACY,
        },
        CENTER: {
          minBucketLateAccuracy: RA_CENTER_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_CENTER_MIN_LEAF_ACCURACY,
        },
        LEAD_GUARD: {
          minBucketLateAccuracy: RA_LEAD_GUARD_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_LEAD_GUARD_MIN_LEAF_ACCURACY,
        },
        SPOTUP_WING: {
          minBucketLateAccuracy: RA_SPOTUP_WING_MIN_BUCKET_LATE_ACCURACY,
          minLeafAccuracy: RA_SPOTUP_WING_MIN_LEAF_ACCURACY,
        },
        TWO_WAY_MARKET_WING: {
          minBucketLateAccuracy: RA_TWO_WAY_MARKET_WING_MIN_BUCKET_LATE_ACCURACY,
        },
      },
    },
  },
};

type CachedLiveUniversalQualificationSettings = {
  filePath: string;
  mtimeMs: number | null;
  settings: LiveUniversalQualificationSettings;
};

let cachedLiveUniversalQualificationSettings: CachedLiveUniversalQualificationSettings | null = null;

function cloneLiveUniversalQualificationSettings(
  input: LiveUniversalQualificationSettings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
): LiveUniversalQualificationSettings {
  return JSON.parse(JSON.stringify(input)) as LiveUniversalQualificationSettings;
}

function mergeLiveUniversalQualificationSettings(
  base: LiveUniversalQualificationSettings,
  override: Partial<LiveUniversalQualificationSettings>,
): LiveUniversalQualificationSettings {
  const merged = cloneLiveUniversalQualificationSettings(base);
  const scalarKeys = [
    "minBucketLateAccuracy",
    "minBucketSamples",
    "minLeafAccuracy",
    "minLeafCount",
    "minProjectionWinProbability",
    "minProjectionPriceEdge",
  ] as const;

  scalarKeys.forEach((key) => {
    const value = override[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[key] = value;
    }
  });

  if (!override.marketOverrides) {
    return merged;
  }

  merged.marketOverrides = { ...(merged.marketOverrides ?? {}) };
  for (const [market, marketOverride] of Object.entries(override.marketOverrides)) {
    if (!marketOverride) continue;
    const baseMarket = (merged.marketOverrides[market as Market] ?? {}) as Record<string, unknown>;
    const nextMarket = { ...baseMarket } as Record<string, unknown>;

    scalarKeys.forEach((key) => {
      const value = marketOverride[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        nextMarket[key] = value;
      }
    });

    if (marketOverride.archetypeOverrides) {
      const nextArchetypeOverrides = {
        ...((baseMarket.archetypeOverrides as Record<string, Record<string, number>> | undefined) ?? {}),
      };
      for (const [archetype, archetypeOverride] of Object.entries(marketOverride.archetypeOverrides)) {
        if (!archetypeOverride) continue;
        const baseArchetype = nextArchetypeOverrides[archetype] ?? {};
        const nextArchetype = { ...baseArchetype } as Record<string, number>;
        scalarKeys.forEach((key) => {
          const value = archetypeOverride[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            nextArchetype[key] = value;
          }
        });
        nextArchetypeOverrides[archetype] = nextArchetype;
      }
      nextMarket.archetypeOverrides = nextArchetypeOverrides;
    }

    (merged.marketOverrides as Record<string, unknown>)[market] = nextMarket;
  }

  return merged;
}

function resolveLiveUniversalQualificationSettingsFilePath(): string {
  const override = process.env.SNAPSHOT_UNIVERSAL_QUALIFICATION_SETTINGS_FILE?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_QUALIFICATION_SETTINGS_RELATIVE_PATH);
}

export function getActiveLiveUniversalQualificationSettings(): LiveUniversalQualificationSettings {
  const filePath = resolveLiveUniversalQualificationSettingsFilePath();
  let mtimeMs: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = stat.mtimeMs;
  } catch {
    return cloneLiveUniversalQualificationSettings();
  }

  if (
    cachedLiveUniversalQualificationSettings &&
    cachedLiveUniversalQualificationSettings.filePath === filePath &&
    cachedLiveUniversalQualificationSettings.mtimeMs === mtimeMs
  ) {
    return cachedLiveUniversalQualificationSettings.settings;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LiveUniversalQualificationSettings>;
    const settings = mergeLiveUniversalQualificationSettings(cloneLiveUniversalQualificationSettings(), parsed);
    cachedLiveUniversalQualificationSettings = {
      filePath,
      mtimeMs,
      settings,
    };
    return settings;
  } catch {
    return cloneLiveUniversalQualificationSettings();
  }
}

let cachedModelMap: Map<string, UniversalModelRecord> | null = null;
let cachedCalibrationMap: Map<string, UniversalResidualCalibrationRecord> | null = null;
let cachedProjectionDistributionMap: Map<string, UniversalProjectionDistributionRecord> | null = null;
let cachedUniversalBaselineRouterV1Model:
  | {
      filePath: string;
      model: UniversalBaselineRouterModel | null;
    }
  | null = null;
let cachedUniversalBaselineRouterPackModel:
  | {
      filePath: string;
      model: RuntimeSpecialistRouterPackModel | null;
      specialistsByBucket: Map<string, RuntimeSpecialistPackEntry>;
      oosStatsByBucket: Map<string, Map<string, RuntimeOosSignatureStats>>;
    }
  | null = null;
let cachedTreeDisagreementContainmentConfig:
  | {
      rules: {
        nearLineAbsGapMax: number;
        instabilityDeltaMax: number;
        lowSupportMax: number;
        highVarianceStdDevMin: number;
      };
      bucketMap: Map<string, TreeDisagreementContainmentBucket>;
    }
  | null = null;
let cachedTreeDisagreementParentBucketFallbackConfig:
  | {
      rules: {
        nearLineAbsGapMax: number;
        instabilityDeltaMax: number;
        lowSupportMax: number;
        highVarianceStdDevMin: number;
      };
      bucketMap: Map<string, TreeDisagreementParentBucketFallbackBucket>;
    }
  | null = null;

type InspectLiveUniversalModelRuntimeOptions = {
  disableTreeDisagreementContainment?: boolean;
  disableTreeDisagreementParentBucketFallback?: boolean;
};

type RuntimeRouterMode = "off" | "v1" | "specialist_pack_v3";

type RuntimeSpecialistConfig = {
  id: string;
  bucketKey: string;
  maxDepth: number;
  minLeaf: number;
  featureMode: RouterFeatureMode;
};

type RuntimePackGateConfig = {
  minVetoLeafAccuracy: number | null;
  minLeafDisagreementSamples: number;
  minLeafWilsonLowerBound: number;
  minLeafRecent14dDelta: number;
  minLeafRecent30dDelta: number;
  minFoldAppearances: number;
  recurrenceFolds: number;
  minOosVetoRows: number;
  minOosVetoHitRate: number;
  minOosWilson: number;
  minLast2FoldDelta: number;
  minWalkDelta: number;
};

type RuntimeOosSignatureStats = {
  signature: string;
  specialistId: string;
  bucketKey: string;
  foldAppearances: number;
  oosVetoRows: number;
  pooledVetoHitRate: number;
  pooledWilsonLowerBound: number;
  last2FoldDelta: number;
  walkDelta: number;
  activeByOosGate: boolean;
};

type RuntimeSpecialistPackEntry = {
  specialistId: string;
  bucketKey: string;
  config: RuntimeSpecialistConfig;
  model: UniversalBaselineRouterModel | null;
  oosSignatureStats?: RuntimeOosSignatureStats[];
};

type RuntimeSpecialistRouterPackModel = {
  generatedAt: string;
  packName: string;
  gate: RuntimePackGateConfig;
  specialists: RuntimeSpecialistPackEntry[];
};

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const poly = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  const y = 1 - poly * Math.exp(-abs * abs);
  return sign * y;
}

function normalCdf(value: number, mean: number, stdDev: number): number {
  const safeStd = Math.max(stdDev, 1e-6);
  const z = (value - mean) / (safeStd * Math.sqrt(2));
  return clamp(0.5 * (1 + erf(z)), 0, 1);
}

function residualStdDevFloorForMarket(market: SnapshotMarket): number {
  switch (market) {
    case "PTS":
      return 4.2;
    case "REB":
      return 2.1;
    case "AST":
      return 1.9;
    case "THREES":
      return 1.05;
    case "PRA":
      return 5.8;
    case "PA":
      return 4.9;
    case "PR":
      return 5.1;
    case "RA":
      return 2.9;
    default:
      return 2.5;
  }
}

function resolveQualificationThresholds(
  market: SnapshotMarket,
  archetype: Archetype | null,
  settings: LiveUniversalQualificationSettings,
): LiveUniversalQualificationThresholds {
  const marketOverride = settings.marketOverrides?.[market];
  const archetypeOverride = archetype == null ? undefined : marketOverride?.archetypeOverrides?.[archetype];
  return {
    minBucketLateAccuracy:
      archetypeOverride?.minBucketLateAccuracy ?? marketOverride?.minBucketLateAccuracy ?? settings.minBucketLateAccuracy,
    minBucketSamples:
      archetypeOverride?.minBucketSamples ?? marketOverride?.minBucketSamples ?? settings.minBucketSamples,
    minLeafAccuracy: archetypeOverride?.minLeafAccuracy ?? marketOverride?.minLeafAccuracy ?? settings.minLeafAccuracy,
    minLeafCount: archetypeOverride?.minLeafCount ?? marketOverride?.minLeafCount ?? settings.minLeafCount,
    minProjectionWinProbability:
      archetypeOverride?.minProjectionWinProbability ??
      marketOverride?.minProjectionWinProbability ??
      settings.minProjectionWinProbability,
    minProjectionPriceEdge:
      archetypeOverride?.minProjectionPriceEdge ??
      marketOverride?.minProjectionPriceEdge ??
      settings.minProjectionPriceEdge,
  };
}

function parseModelOverride(value: string): ModelVariant | null {
  if (!value) return null;
  const [kind, first, second] = value.split(":");
  switch (kind) {
    case "projection":
      return { kind: "projection" };
    case "finalOverride":
      return { kind: "finalOverride" };
    case "marketFavored":
      return { kind: "marketFavored" };
    case "constant":
      return first === "OVER" || first === "UNDER" ? { kind: "constant", side: first } : null;
    case "gapThenProjection": {
      const threshold = Number(first);
      return Number.isFinite(threshold) ? { kind: "gapThenProjection", threshold } : null;
    }
    case "gapThenMarket": {
      const threshold = Number(first);
      return Number.isFinite(threshold) ? { kind: "gapThenMarket", threshold } : null;
    }
    case "agreementThenProjection": {
      const threshold = Number(first);
      return Number.isFinite(threshold) ? { kind: "agreementThenProjection", threshold } : null;
    }
    case "featureThresholdRouter": {
      const [feature, rawThreshold, lteDecision, gtDecision] = (first ?? "").split("/");
      const threshold = Number(rawThreshold);
      const validFeature =
        feature === "expectedMinutes" || feature === "minutesVolatility" || feature === "projectedValue"
          ? feature
          : null;
      const validLteDecision =
        lteDecision === "OVER" ||
        lteDecision === "UNDER" ||
        lteDecision === "projection" ||
        lteDecision === "finalOverride" ||
        lteDecision === "marketFavored"
          ? lteDecision
          : null;
      const validGtDecision =
        gtDecision === "OVER" ||
        gtDecision === "UNDER" ||
        gtDecision === "projection" ||
        gtDecision === "finalOverride" ||
        gtDecision === "marketFavored"
          ? gtDecision
          : null;
      return validFeature && Number.isFinite(threshold) && validLteDecision && validGtDecision
        ? { kind: "featureThresholdRouter", feature: validFeature, threshold, lteDecision: validLteDecision, gtDecision: validGtDecision }
        : null;
    }
    case "favoriteOverSuppress": {
      const spreadThreshold = Number(first);
      const gapThreshold = Number(second);
      return Number.isFinite(spreadThreshold) && Number.isFinite(gapThreshold)
        ? { kind: "favoriteOverSuppress", spreadThreshold, gapThreshold }
        : null;
    }
    case "lowQualityThenMarket": {
      const threshold = Number(first);
      return Number.isFinite(threshold) ? { kind: "lowQualityThenMarket", threshold } : null;
    }
    default:
      return null;
  }
}

function applyRuntimeModelOverride(record: UniversalModelRecord): UniversalModelRecord {
  let override: ModelVariant | null = null;
  if (record.market === "PTS" && record.archetype === "LEAD_GUARD") {
    override = parseModelOverride(PTS_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "WING") {
    override = parseModelOverride(PTS_WING_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "CONNECTOR_WING") {
    override = parseModelOverride(PTS_CONNECTOR_WING_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "SPOTUP_WING") {
    override = parseModelOverride(PTS_SPOTUP_WING_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "SCORE_FIRST_LEAD_GUARD") {
    override = parseModelOverride(PTS_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "BENCH_SPACER_SCORER") {
    override = parseModelOverride(PTS_BENCH_SPACER_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "CENTER") {
    override = parseModelOverride(PTS_CENTER_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "POINT_FORWARD") {
    override = parseModelOverride(PTS_POINT_FORWARD_MODEL_OVERRIDE);
  } else if (record.market === "PTS" && record.archetype === "JUMBO_CREATOR_GUARD") {
    override = parseModelOverride(PTS_JUMBO_CREATOR_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "REB" && record.archetype === "CENTER") {
    override = parseModelOverride(REB_CENTER_MODEL_OVERRIDE);
  } else if (record.market === "AST" && record.archetype === "CENTER") {
    override = parseModelOverride(AST_CENTER_MODEL_OVERRIDE);
  } else if (record.market === "AST" && record.archetype === "LEAD_GUARD") {
    override = parseModelOverride(AST_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "AST" && record.archetype === "BENCH_SHOOTING_GUARD") {
    override = parseModelOverride(AST_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "BENCH_TRADITIONAL_BIG") {
    override = parseModelOverride(PA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "BENCH_REBOUNDING_SCORER") {
    override = parseModelOverride(PA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "SCORING_GUARD_CREATOR") {
    override = parseModelOverride(PA_SCORING_GUARD_CREATOR_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "SPOTUP_WING") {
    override = parseModelOverride(PA_SPOTUP_WING_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "BENCH_WING") {
    override = parseModelOverride(PA_BENCH_WING_MODEL_OVERRIDE);
  } else if (record.market === "PA" && record.archetype === "CONNECTOR_WING") {
    override = parseModelOverride(PA_CONNECTOR_WING_MODEL_OVERRIDE);
  } else if (record.market === "PRA" && record.archetype === "SPOTUP_WING") {
    override = parseModelOverride(PRA_SPOTUP_WING_MODEL_OVERRIDE || PRA_FAMILY_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "CENTER") {
    override = parseModelOverride(PR_CENTER_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "BENCH_CREATOR_SCORER") {
    override = parseModelOverride(PR_BENCH_CREATOR_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "BENCH_VOLUME_SCORER") {
    override = parseModelOverride(PR_BENCH_VOLUME_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "BENCH_STRETCH_BIG") {
    override = parseModelOverride(PR_BENCH_STRETCH_BIG_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "LEAD_GUARD") {
    override = parseModelOverride(PR_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "PR" && record.archetype === "POINT_FORWARD") {
    override = parseModelOverride(PR_POINT_FORWARD_MODEL_OVERRIDE);
  } else if (
    record.market === "PRA" &&
    (record.archetype === "SCORING_GUARD_CREATOR" || record.archetype === "POINT_FORWARD")
  ) {
    override = parseModelOverride(PRA_FAMILY_MODEL_OVERRIDE);
  } else if (record.market === "PRA" && record.archetype === "LEAD_GUARD") {
    override = parseModelOverride(PRA_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "RA" && record.archetype === "BENCH_CREATOR_SCORER") {
    override = parseModelOverride(RA_BENCH_CREATOR_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "RA" && record.archetype === "BENCH_REBOUNDING_SCORER") {
    override = parseModelOverride(RA_BENCH_REBOUNDING_SCORER_MODEL_OVERRIDE);
  } else if (record.market === "RA" && record.archetype === "BENCH_SHOOTING_GUARD") {
    override = parseModelOverride(RA_BENCH_SHOOTING_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "RA" && record.archetype === "BENCH_TRADITIONAL_BIG") {
    override = parseModelOverride(RA_BENCH_TRADITIONAL_BIG_MODEL_OVERRIDE);
  } else if (record.market === "RA" && record.archetype === "TWO_WAY_MARKET_WING") {
    override = parseModelOverride(RA_TWMW_MODEL_OVERRIDE);
  } else if (record.market === "THREES" && record.archetype === "SCORE_FIRST_LEAD_GUARD") {
    override = parseModelOverride(THREES_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE);
  } else if (record.market === "THREES" && record.archetype === "STRETCH_RIM_PROTECTOR_CENTER") {
    override = parseModelOverride(THREES_STRETCH_RIM_PROTECTOR_CENTER_MODEL_OVERRIDE);
  } else if (record.market === "PRA" && record.archetype === "SCORE_FIRST_LEAD_GUARD") {
    override = parseModelOverride(PRA_SCORE_FIRST_LEAD_GUARD_MODEL_OVERRIDE);
  }

  if (!override) return record;
  return {
    ...record,
    model: override,
  };
}

function shouldApplyPaBenchWingNativeVeto(decision: RawLiveUniversalModelDecision): boolean {
  if (decision.market !== "PA" || decision.archetype !== "BENCH_WING") return false;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return false;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return false;
  if (decision.rawSide === decision.finalSide) return false;
  if (
    PA_BENCH_WING_NATIVE_VETO_MAX_ABS_LINE_GAP == null ||
    PA_BENCH_WING_NATIVE_VETO_MIN_PRICE_STRENGTH == null
  ) {
    return false;
  }
  if (decision.absLineGap == null || decision.absLineGap > PA_BENCH_WING_NATIVE_VETO_MAX_ABS_LINE_GAP) {
    return false;
  }
  if (decision.priceStrength == null || decision.priceStrength < PA_BENCH_WING_NATIVE_VETO_MIN_PRICE_STRENGTH) {
    return false;
  }
  if (
    decision.favoredSide == null ||
    decision.favoredSide === "NEUTRAL" ||
    decision.favoredSide === decision.rawSide
  ) {
    return false;
  }
  if (
    PA_BENCH_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT != null &&
    (decision.projectionMarketAgreement == null ||
      decision.projectionMarketAgreement > PA_BENCH_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  ) {
    return false;
  }
  return true;
}

function isAdversePriceLeanForSide(side: SnapshotModelSide, priceLean: number | null): boolean {
  if (priceLean == null) return false;
  if (side === "OVER") return priceLean < 0;
  if (side === "UNDER") return priceLean > 0;
  return false;
}

function shouldApplyPraScoringGuardCreatorNativeVeto(decision: RawLiveUniversalModelDecision): boolean {
  if (decision.market !== "PRA" || decision.archetype !== "SCORING_GUARD_CREATOR") return false;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return false;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return false;
  if (decision.rawSide === decision.finalSide) return false;
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP == null &&
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP == null &&
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT == null &&
    !PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN &&
    !PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_FAVORED_MATCH
  ) {
    return false;
  }
  if (decision.absLineGap == null) {
    return false;
  }
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP != null &&
    decision.absLineGap < PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MIN_ABS_LINE_GAP
  ) {
    return false;
  }
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP != null &&
    decision.absLineGap > PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_ABS_LINE_GAP
  ) {
    return false;
  }
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT != null &&
    (decision.projectionMarketAgreement == null ||
      decision.projectionMarketAgreement > PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  ) {
    return false;
  }
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN &&
    !isAdversePriceLeanForSide(decision.rawSide, decision.priceLean)
  ) {
    return false;
  }
  if (
    PRA_SCORING_GUARD_CREATOR_NATIVE_VETO_REQUIRE_FAVORED_MATCH &&
    (decision.favoredSide == null ||
      decision.favoredSide === "NEUTRAL" ||
      decision.favoredSide !== decision.rawSide)
  ) {
    return false;
  }
  return true;
}

function shouldApplyPraPointForwardNativeVeto(decision: RawLiveUniversalModelDecision): boolean {
  if (decision.market !== "PRA" || decision.archetype !== "POINT_FORWARD") return false;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return false;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return false;
  if (decision.rawSide === decision.finalSide) return false;
  if (
    PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP == null &&
    PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT == null &&
    !PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN &&
    !PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH
  ) {
    return false;
  }
  if (
    PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP != null &&
    (decision.absLineGap == null || decision.absLineGap > PRA_POINT_FORWARD_NATIVE_VETO_MAX_ABS_LINE_GAP)
  ) {
    return false;
  }
  if (
    PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT != null &&
    (decision.projectionMarketAgreement == null ||
      decision.projectionMarketAgreement > PRA_POINT_FORWARD_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  ) {
    return false;
  }
  if (
    PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_ADVERSE_PRICE_LEAN &&
    !isAdversePriceLeanForSide(decision.rawSide, decision.priceLean)
  ) {
    return false;
  }
  if (
    PRA_POINT_FORWARD_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH &&
    (decision.favoredSide == null ||
      decision.favoredSide === "NEUTRAL" ||
      decision.favoredSide === decision.rawSide)
  ) {
    return false;
  }
  return true;
}

function shouldApplyRaTwoWayMarketWingNativeVeto(decision: RawLiveUniversalModelDecision): boolean {
  if (decision.market !== "RA" || decision.archetype !== "TWO_WAY_MARKET_WING") return false;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return false;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return false;
  if (decision.rawSide === decision.finalSide) return false;
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP == null &&
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP == null &&
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT == null &&
    !RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MATCH &&
    !RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH
  ) {
    return false;
  }
  if (decision.absLineGap == null) {
    return false;
  }
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP != null &&
    decision.absLineGap < RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MIN_ABS_LINE_GAP
  ) {
    return false;
  }
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP != null &&
    decision.absLineGap > RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_ABS_LINE_GAP
  ) {
    return false;
  }
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT != null &&
    (decision.projectionMarketAgreement == null ||
      decision.projectionMarketAgreement > RA_TWO_WAY_MARKET_WING_NATIVE_VETO_MAX_PROJECTION_MARKET_AGREEMENT)
  ) {
    return false;
  }
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MATCH &&
    (decision.favoredSide == null ||
      decision.favoredSide === "NEUTRAL" ||
      decision.favoredSide !== decision.rawSide)
  ) {
    return false;
  }
  if (
    RA_TWO_WAY_MARKET_WING_NATIVE_VETO_REQUIRE_FAVORED_MISMATCH &&
    (decision.favoredSide == null ||
      decision.favoredSide === "NEUTRAL" ||
      decision.favoredSide === decision.rawSide)
  ) {
    return false;
  }
  return true;
}

function loadModelMap(): Map<string, UniversalModelRecord> {
  if (cachedModelMap) return cachedModelMap;

  const map = new Map<string, UniversalModelRecord>();
  const modelFilePath = resolveModelFilePath();
  if (!fs.existsSync(modelFilePath)) {
    cachedModelMap = map;
    return map;
  }

  try {
    const payload = parseJsonFile<UniversalModelFile>(modelFilePath);
    for (const record of payload.models ?? []) {
      map.set(`${record.market}|${record.archetype}`, applyRuntimeModelOverride(record));
    }
  } catch {
    cachedModelMap = map;
    return map;
  }

  cachedModelMap = map;
  return map;
}

function loadCalibrationMap(): Map<string, UniversalResidualCalibrationRecord> {
  if (cachedCalibrationMap) return cachedCalibrationMap;

  const map = new Map<string, UniversalResidualCalibrationRecord>();
  if (process.env.SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION?.trim() === "1") {
    cachedCalibrationMap = map;
    return map;
  }

  const calibrationFilePath = resolveCalibrationFilePath();
  if (!fs.existsSync(calibrationFilePath)) {
    cachedCalibrationMap = map;
    return map;
  }

  try {
    const payload = parseJsonFile<UniversalResidualCalibrationFile>(calibrationFilePath);
    for (const record of payload.records ?? []) {
      const key = buildUniversalResidualCalibrationKey(record.market, record.archetype, record.minutesBucket);
      if (key) {
        map.set(key, record);
      }
    }
  } catch {
    cachedCalibrationMap = map;
    return map;
  }

  cachedCalibrationMap = map;
  return map;
}

function loadProjectionDistributionMap(): Map<string, UniversalProjectionDistributionRecord> {
  if (cachedProjectionDistributionMap) return cachedProjectionDistributionMap;

  const map = new Map<string, UniversalProjectionDistributionRecord>();
  if (process.env.SNAPSHOT_UNIVERSAL_DISABLE_PROJECTION_DISTRIBUTION?.trim() === "1") {
    cachedProjectionDistributionMap = map;
    return map;
  }

  const distributionFilePath = resolveProjectionDistributionFilePath();
  if (!fs.existsSync(distributionFilePath)) {
    cachedProjectionDistributionMap = map;
    return map;
  }

  try {
    const payload = parseJsonFile<UniversalProjectionDistributionFile>(distributionFilePath);
    for (const record of payload.records ?? []) {
      map.set(
        buildUniversalProjectionDistributionKey(record.scope, record.market, record.archetype, record.minutesBucket),
        record,
      );
    }
  } catch {
    cachedProjectionDistributionMap = map;
    return map;
  }

  cachedProjectionDistributionMap = map;
  return map;
}

function loadTreeDisagreementContainmentConfig(): {
  rules: {
    nearLineAbsGapMax: number;
    instabilityDeltaMax: number;
    lowSupportMax: number;
    highVarianceStdDevMin: number;
  };
  bucketMap: Map<string, TreeDisagreementContainmentBucket>;
} {
  if (cachedTreeDisagreementContainmentConfig) return cachedTreeDisagreementContainmentConfig;

  const empty = {
    rules: {
      nearLineAbsGapMax: 0.5,
      instabilityDeltaMax: -2,
      lowSupportMax: 150,
      highVarianceStdDevMin: 4,
    },
    bucketMap: new Map<string, TreeDisagreementContainmentBucket>(),
  };

  if (TREE_DISAGREEMENT_CONTAINMENT_SCOPE !== "near_line" && TREE_DISAGREEMENT_CONTAINMENT_SCOPE !== "all_disagreement") {
    cachedTreeDisagreementContainmentConfig = empty;
    return empty;
  }

  const configFilePath = resolveTreeDisagreementContainmentFilePath();
  if (!fs.existsSync(configFilePath)) {
    cachedTreeDisagreementContainmentConfig = empty;
    return empty;
  }

  try {
    const payload = parseJsonFile<TreeDisagreementContainmentConfig>(configFilePath);
    const bucketMap = new Map<string, TreeDisagreementContainmentBucket>();
    for (const bucket of payload.buckets ?? []) {
      if (bucket?.key && bucket.unstable) {
        bucketMap.set(bucket.key, bucket);
      }
    }
    cachedTreeDisagreementContainmentConfig = {
      rules: {
        nearLineAbsGapMax:
          payload.triggerRules?.nearLineAbsGapMax != null ? payload.triggerRules.nearLineAbsGapMax : empty.rules.nearLineAbsGapMax,
        instabilityDeltaMax:
          payload.triggerRules?.instabilityDeltaMax != null
            ? payload.triggerRules.instabilityDeltaMax
            : empty.rules.instabilityDeltaMax,
        lowSupportMax:
          payload.triggerRules?.lowSupportMax != null ? payload.triggerRules.lowSupportMax : empty.rules.lowSupportMax,
        highVarianceStdDevMin:
          payload.triggerRules?.highVarianceStdDevMin != null
            ? payload.triggerRules.highVarianceStdDevMin
            : empty.rules.highVarianceStdDevMin,
      },
      bucketMap,
    };
    return cachedTreeDisagreementContainmentConfig;
  } catch {
    cachedTreeDisagreementContainmentConfig = empty;
    return empty;
  }
}

function loadTreeDisagreementParentBucketFallbackConfig(): {
  rules: {
    nearLineAbsGapMax: number;
    instabilityDeltaMax: number;
    lowSupportMax: number;
    highVarianceStdDevMin: number;
  };
  bucketMap: Map<string, TreeDisagreementParentBucketFallbackBucket>;
} {
  if (cachedTreeDisagreementParentBucketFallbackConfig) return cachedTreeDisagreementParentBucketFallbackConfig;

  const empty = {
    rules: {
      nearLineAbsGapMax: 0.5,
      instabilityDeltaMax: -2,
      lowSupportMax: 150,
      highVarianceStdDevMin: 4,
    },
    bucketMap: new Map<string, TreeDisagreementParentBucketFallbackBucket>(),
  };

  if (
    TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE !== "near_line" &&
    TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE !== "all_disagreement"
  ) {
    cachedTreeDisagreementParentBucketFallbackConfig = empty;
    return empty;
  }

  const configFilePath = resolveTreeDisagreementParentBucketFallbackFilePath();
  if (!fs.existsSync(configFilePath)) {
    cachedTreeDisagreementParentBucketFallbackConfig = empty;
    return empty;
  }

  try {
    const payload = parseJsonFile<TreeDisagreementParentBucketFallbackConfig>(configFilePath);
    const bucketMap = new Map<string, TreeDisagreementParentBucketFallbackBucket>();
    for (const bucket of payload.buckets ?? []) {
      if (bucket?.key && bucket.unstable && bucket.parentArchetype) {
        bucketMap.set(bucket.key, bucket);
      }
    }
    cachedTreeDisagreementParentBucketFallbackConfig = {
      rules: {
        nearLineAbsGapMax:
          payload.triggerRules?.nearLineAbsGapMax != null ? payload.triggerRules.nearLineAbsGapMax : empty.rules.nearLineAbsGapMax,
        instabilityDeltaMax:
          payload.triggerRules?.instabilityDeltaMax != null
            ? payload.triggerRules.instabilityDeltaMax
            : empty.rules.instabilityDeltaMax,
        lowSupportMax:
          payload.triggerRules?.lowSupportMax != null ? payload.triggerRules.lowSupportMax : empty.rules.lowSupportMax,
        highVarianceStdDevMin:
          payload.triggerRules?.highVarianceStdDevMin != null
            ? payload.triggerRules.highVarianceStdDevMin
            : empty.rules.highVarianceStdDevMin,
      },
      bucketMap,
    };
    return cachedTreeDisagreementParentBucketFallbackConfig;
  } catch {
    cachedTreeDisagreementParentBucketFallbackConfig = empty;
    return empty;
  }
}

function roundRouterLeafThreshold(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function normalizeRouterLeafThreshold(feature: string, threshold: number): string {
  const step =
    feature === "lineGap" || feature === "absLineGap"
      ? 0.05
      : feature === "priceLean" || feature === "bucketRecentAccuracy" || feature === "leafAccuracy"
        ? 0.1
        : feature === "expectedMinutes" || feature === "openingTeamSpread"
          ? 0.25
          : 0.1;
  const normalized = roundRouterLeafThreshold(threshold, step);
  return Number.isInteger(normalized)
    ? normalized.toString()
    : normalized.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
}

function normalizeRouterLeafSignature(specialist: RuntimeSpecialistConfig, leafPath: string): string {
  if (!leafPath || leafPath === "ROOT") return `${specialist.bucketKey} :: ROOT`;
  const normalizedSegments = leafPath
    .split(" -> ")
    .map((segment) => {
      const match = segment.match(/^(.*?)(<=|>)(-?\d+(?:\.\d+)?)$/);
      if (!match) return segment;
      const [, feature, operator, thresholdRaw] = match;
      const threshold = Number(thresholdRaw);
      if (!Number.isFinite(threshold)) return segment;
      return `${feature}${operator}${normalizeRouterLeafThreshold(feature, threshold)}`;
    })
    .sort((left, right) => left.localeCompare(right));
  return `${specialist.bucketKey} :: ${normalizedSegments.join(" & ")}`;
}

function loadUniversalBaselineRouterV1Model(): UniversalBaselineRouterModel | null {
  const filePath = resolveUniversalBaselineRouterV1FilePath();
  if (cachedUniversalBaselineRouterV1Model?.filePath === filePath) {
    return cachedUniversalBaselineRouterV1Model.model;
  }

  if (!fs.existsSync(filePath)) {
    cachedUniversalBaselineRouterV1Model = { filePath, model: null };
    return null;
  }

  try {
    const payload = parseJsonFile<UniversalBaselineRouterModel>(filePath);
    cachedUniversalBaselineRouterV1Model = { filePath, model: payload };
    return payload;
  } catch {
    cachedUniversalBaselineRouterV1Model = { filePath, model: null };
    return null;
  }
}

function loadUniversalBaselineRouterPackModel():
  | {
      model: RuntimeSpecialistRouterPackModel;
      specialistsByBucket: Map<string, RuntimeSpecialistPackEntry>;
      oosStatsByBucket: Map<string, Map<string, RuntimeOosSignatureStats>>;
    }
  | null {
  const filePath = resolveUniversalBaselineRouterPackFilePath();
  if (cachedUniversalBaselineRouterPackModel?.filePath === filePath) {
    return cachedUniversalBaselineRouterPackModel.model == null
      ? null
      : {
          model: cachedUniversalBaselineRouterPackModel.model,
          specialistsByBucket: cachedUniversalBaselineRouterPackModel.specialistsByBucket,
          oosStatsByBucket: cachedUniversalBaselineRouterPackModel.oosStatsByBucket,
        };
  }

  if (!fs.existsSync(filePath)) {
    cachedUniversalBaselineRouterPackModel = {
      filePath,
      model: null,
      specialistsByBucket: new Map(),
      oosStatsByBucket: new Map(),
    };
    return null;
  }

  try {
    const payload = parseJsonFile<RuntimeSpecialistRouterPackModel>(filePath);
    const specialistsByBucket = new Map<string, RuntimeSpecialistPackEntry>();
    const oosStatsByBucket = new Map<string, Map<string, RuntimeOosSignatureStats>>();
    for (const specialist of payload.specialists ?? []) {
      specialistsByBucket.set(specialist.bucketKey, specialist);
      oosStatsByBucket.set(
        specialist.bucketKey,
        new Map((specialist.oosSignatureStats ?? []).map((stats) => [stats.signature, stats])),
      );
    }
    cachedUniversalBaselineRouterPackModel = {
      filePath,
      model: payload,
      specialistsByBucket,
      oosStatsByBucket,
    };
    return {
      model: payload,
      specialistsByBucket,
      oosStatsByBucket,
    };
  } catch {
    cachedUniversalBaselineRouterPackModel = {
      filePath,
      model: null,
      specialistsByBucket: new Map(),
      oosStatsByBucket: new Map(),
    };
    return null;
  }
}

function buildRuntimeRouterDatasetRow(
  input: PredictLiveUniversalSideInput,
  decision: LiveUniversalModelDecision,
): RouterDatasetRow | null {
  if (decision.side !== "OVER" && decision.side !== "UNDER") return null;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return null;
  if (decision.archetype == null) return null;
  if (input.projectedValue == null || input.line == null) return null;

  return {
    rowKey: [
      input.gameDateEt ?? "",
      input.market,
      input.projectedValue.toFixed(4),
      input.line.toFixed(4),
      decision.archetype,
    ].join("|"),
    gameDateEt: input.gameDateEt ?? "",
    bucketKey: `${input.market}|${decision.archetype}`,
    market: input.market,
    archetype: decision.archetype,
    modelKind: decision.modelKind,
    qualifiedSide: decision.side,
    finalSide: decision.finalSide,
    favoredSide: decision.favoredSide,
    bucketSamples: decision.bucketSamples,
    bucketModelAccuracy: decision.bucketModelAccuracy,
    bucketLateAccuracy: decision.bucketLateAccuracy,
    bucketRecentAccuracy: decision.bucketLateAccuracy ?? decision.bucketModelAccuracy,
    leafCount: decision.leafCount,
    leafAccuracy: decision.leafAccuracy,
    projectionMarketAgreement: decision.projectionMarketAgreement,
    overProbability: decision.overProbability,
    underProbability: decision.underProbability,
    overPrice: input.overPrice ?? null,
    underPrice: input.underPrice ?? null,
    lineGap: round(input.projectedValue - input.line, 4),
    absLineGap: decision.absLineGap ?? round(Math.abs(input.projectedValue - input.line), 4),
    priceStrength: decision.priceStrength,
    priceLean: decision.priceLean,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    starterRateLast10: input.starterRateLast10,
    openingTeamSpread: input.openingTeamSpread,
    absOpeningSpread: input.openingTeamSpread == null ? null : round(Math.abs(input.openingTeamSpread), 4),
    openingTotal: input.openingTotal,
    lineupTimingConfidence: input.lineupTimingConfidence,
    completenessScore: input.completenessScore,
    spreadResolved: input.openingTeamSpread != null,
    universalCorrect: false,
    baselineCorrect: false,
    routerTarget: null,
  };
}

function applyOptionalUniversalBaselineRouterVeto(
  input: PredictLiveUniversalSideInput,
  decision: LiveUniversalModelDecision,
): LiveUniversalModelDecision {
  const routerMode = resolveUniversalBaselineRouterMode();
  if (routerMode === "off") return decision;
  if (!decision.qualified) return decision;
  if (decision.side !== "OVER" && decision.side !== "UNDER") return decision;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return decision;
  if (decision.side === decision.finalSide) return decision;

  const row = buildRuntimeRouterDatasetRow(input, decision);
  if (!row) return decision;

  let veto = false;
  if (routerMode === "v1") {
    const model = loadUniversalBaselineRouterV1Model();
    veto = model != null && predictUniversalBaselineRouter(model, row) === "VETO_BASELINE";
  } else if (routerMode === "specialist_pack_v3") {
    const pack = loadUniversalBaselineRouterPackModel();
    const specialist = pack?.specialistsByBucket.get(row.bucketKey) ?? null;
    if (pack && specialist?.model) {
      const rawAction = predictUniversalBaselineRouter(specialist.model, row);
      if (rawAction === "VETO_BASELINE") {
        const resolved = resolveRouterLeaf(specialist.model, row);
        const signature = normalizeRouterLeafSignature(specialist.config, resolved.path);
        const oosStats = pack.oosStatsByBucket.get(row.bucketKey)?.get(signature) ?? null;
        const passesAccuracyGate =
          pack.model.gate.minVetoLeafAccuracy == null || resolved.leaf.accuracy >= pack.model.gate.minVetoLeafAccuracy;
        veto = passesAccuracyGate && (oosStats?.activeByOosGate ?? false);
      }
    }
  }

  if (!veto) return decision;
  return {
    ...decision,
    side: "NEUTRAL",
    qualified: false,
    rejectionReasons: [...decision.rejectionReasons, "Universal baseline router veto."],
  };
}

function applyTreeDisagreementContainment(decision: RawLiveUniversalModelDecision): RawLiveUniversalModelDecision {
  if (TREE_DISAGREEMENT_CONTAINMENT_SCOPE !== "near_line" && TREE_DISAGREEMENT_CONTAINMENT_SCOPE !== "all_disagreement") {
    return decision;
  }
  if (decision.modelKind !== "tree") return decision;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return decision;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return decision;
  if (decision.rawSide === decision.finalSide) return decision;
  if (decision.archetype == null) return decision;

  const { rules, bucketMap } = loadTreeDisagreementContainmentConfig();
  if (!bucketMap.has(`${decision.market}|${decision.archetype}`)) return decision;
  if (TREE_DISAGREEMENT_CONTAINMENT_SCOPE === "near_line") {
    if (decision.absLineGap == null || decision.absLineGap > rules.nearLineAbsGapMax) return decision;
  }

  const preservedSide = decision.finalSide;
  const chosenMarketProbability = preservedSide === "OVER" ? decision.overProbability : decision.underProbability;
  const preservedProjectionWinProbability =
    decision.projectionWinProbability == null ? null : round(clamp(1 - decision.projectionWinProbability, 0, 1), 4);
  const preservedProjectionPriceEdge =
    preservedProjectionWinProbability == null || chosenMarketProbability == null
      ? null
      : round(preservedProjectionWinProbability - chosenMarketProbability, 4);

  return {
    ...decision,
    rawSide: preservedSide,
    projectionWinProbability: preservedProjectionWinProbability,
    projectionPriceEdge: preservedProjectionPriceEdge,
    leafCount: null,
    leafAccuracy: null,
    runtimeOverrideLabel: "tree_disagreement_baseline_preserve",
    runtimeOverrideSourceArchetype: decision.archetype,
    runtimeOverrideTargetArchetype: decision.archetype,
  };
}

function applyTreeDisagreementParentBucketFallback(
  input: PredictLiveUniversalSideInput,
  decision: RawLiveUniversalModelDecision,
  runtimeOptions: InspectLiveUniversalModelRuntimeOptions = {},
): RawLiveUniversalModelDecision {
  if (runtimeOptions.disableTreeDisagreementParentBucketFallback) return decision;
  if (
    TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE !== "near_line" &&
    TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE !== "all_disagreement"
  ) {
    return decision;
  }
  if (decision.modelKind !== "tree") return decision;
  if (decision.rawSide !== "OVER" && decision.rawSide !== "UNDER") return decision;
  if (decision.finalSide !== "OVER" && decision.finalSide !== "UNDER") return decision;
  if (decision.rawSide === decision.finalSide) return decision;
  if (decision.archetype == null) return decision;

  const { rules, bucketMap } = loadTreeDisagreementParentBucketFallbackConfig();
  const bucket = bucketMap.get(`${decision.market}|${decision.archetype}`);
  if (!bucket) return decision;
  if (TREE_DISAGREEMENT_PARENT_BUCKET_FALLBACK_SCOPE === "near_line") {
    if (decision.absLineGap == null || decision.absLineGap > rules.nearLineAbsGapMax) return decision;
  }
  if (bucket.parentArchetype === decision.archetype) return decision;

  const parentDecision = inspectLiveUniversalModelSideInternal(input, bucket.parentArchetype, {
    disableTreeDisagreementContainment: true,
    disableTreeDisagreementParentBucketFallback: true,
  });
  if (parentDecision.modelKind == null) return decision;
  if (parentDecision.rawSide !== "OVER" && parentDecision.rawSide !== "UNDER") return decision;

  return {
    ...parentDecision,
    runtimeOverrideLabel: "tree_disagreement_parent_bucket_fallback",
    runtimeOverrideSourceArchetype: decision.archetype,
    runtimeOverrideTargetArchetype: bucket.parentArchetype,
  };
}

type ProjectionDistributionEstimate = {
  sampleCount: number;
  residualMean: number;
  residualStdDev: number;
  overWinProbability: number;
  underWinProbability: number;
};

function comboComponentMarkets(market: SnapshotMarket): SnapshotMarket[] | null {
  switch (market) {
    case "PRA":
      return ["PTS", "REB", "AST"];
    case "PA":
      return ["PTS", "AST"];
    case "PR":
      return ["PTS", "REB"];
    case "RA":
      return ["REB", "AST"];
    default:
      return null;
  }
}

function resolveProjectionDistributionCandidates(
  distributionMap: Map<string, UniversalProjectionDistributionRecord>,
  market: SnapshotMarket,
  archetype: Archetype,
  minutesBucket: UniversalMinutesBucket,
): Array<{ record: UniversalProjectionDistributionRecord; baseWeight: number }> {
  const candidates: Array<{ record: UniversalProjectionDistributionRecord; baseWeight: number }> = [];
  const scoped = distributionMap.get(
    buildUniversalProjectionDistributionKey("market_archetype_minutes", market, archetype, minutesBucket),
  );
  if (scoped) candidates.push({ record: scoped, baseWeight: 1 });

  const marketMinutes = distributionMap.get(
    buildUniversalProjectionDistributionKey("market_minutes", market, null, minutesBucket),
  );
  if (marketMinutes) candidates.push({ record: marketMinutes, baseWeight: 0.62 });

  const marketWide = distributionMap.get(buildUniversalProjectionDistributionKey("market", market, null, null));
  if (marketWide) candidates.push({ record: marketWide, baseWeight: 0.38 });
  return candidates;
}

function combineProjectionDistributionCandidates(
  market: SnapshotMarket,
  projectedValue: number,
  line: number,
  candidates: Array<{ estimate: ProjectionDistributionEstimate; baseWeight: number }>,
): ProjectionDistributionEstimate | null {
  if (candidates.length === 0) return null;

  const weighted = candidates.map(({ estimate, baseWeight }) => {
    const sampleWeight = clamp(Math.log10(estimate.sampleCount + 1) / 2.3, 0.18, 1);
    return {
      estimate,
      weight: baseWeight * sampleWeight,
    };
  });
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  const residualMean =
    weighted.reduce((sum, entry) => sum + entry.estimate.residualMean * entry.weight, 0) / totalWeight;
  const secondMoment =
    weighted.reduce((sum, entry) => {
      const variance = entry.estimate.residualStdDev * entry.estimate.residualStdDev;
      return sum + (variance + entry.estimate.residualMean * entry.estimate.residualMean) * entry.weight;
    }, 0) / totalWeight;
  const residualStdDev = Math.max(
    residualStdDevFloorForMarket(market),
    Math.sqrt(Math.max(0, secondMoment - residualMean * residualMean)),
  );
  const threshold = line - projectedValue;
  const underWinProbability = normalCdf(threshold, residualMean, residualStdDev);
  const overWinProbability = clamp(1 - underWinProbability, 0, 1);
  const sampleCount = weighted.reduce((sum, entry) => sum + entry.estimate.sampleCount * entry.weight, 0) / totalWeight;

  return {
    sampleCount: round(sampleCount, 2),
    residualMean: round(residualMean, 4),
    residualStdDev: round(residualStdDev, 4),
    overWinProbability: round(overWinProbability, 4),
    underWinProbability: round(underWinProbability, 4),
  };
}

function estimateDirectProjectionDistribution(
  market: SnapshotMarket,
  archetype: Archetype,
  minutesBucket: UniversalMinutesBucket,
  projectedValue: number,
  line: number,
  distributionMap: Map<string, UniversalProjectionDistributionRecord>,
): ProjectionDistributionEstimate | null {
  const candidates = resolveProjectionDistributionCandidates(distributionMap, market, archetype, minutesBucket).map(
    ({ record, baseWeight }) => ({
      estimate: {
        sampleCount: record.sampleCount,
        residualMean: record.residualMean,
        residualStdDev: record.residualStdDev,
        overWinProbability: 0.5,
        underWinProbability: 0.5,
      },
      baseWeight,
    }),
  );
  return combineProjectionDistributionCandidates(market, projectedValue, line, candidates);
}

function estimateComboComponentProjectionDistribution(
  market: SnapshotMarket,
  archetype: Archetype,
  minutesBucket: UniversalMinutesBucket,
  projectedValue: number,
  line: number,
  distributionMap: Map<string, UniversalProjectionDistributionRecord>,
): ProjectionDistributionEstimate | null {
  const componentMarkets = comboComponentMarkets(market);
  if (!componentMarkets) return null;

  const componentEstimates = componentMarkets.map((componentMarket) =>
    estimateDirectProjectionDistribution(
      componentMarket,
      archetype,
      minutesBucket,
      0,
      0,
      distributionMap,
    ),
  );
  if (componentEstimates.some((estimate) => !estimate)) return null;

  const resolved = componentEstimates.filter(
    (estimate): estimate is ProjectionDistributionEstimate => estimate != null,
  );
  if (resolved.length !== componentMarkets.length) return null;

  const residualMean = resolved.reduce((sum, estimate) => sum + estimate.residualMean, 0);
  const variance = resolved.reduce((sum, estimate) => sum + estimate.residualStdDev * estimate.residualStdDev, 0);
  const residualStdDev = Math.max(residualStdDevFloorForMarket(market), Math.sqrt(Math.max(variance, 0)));
  const threshold = line - projectedValue;
  const underWinProbability = normalCdf(threshold, residualMean, residualStdDev);
  const overWinProbability = clamp(1 - underWinProbability, 0, 1);
  const sampleCount = resolved.reduce((min, estimate) => Math.min(min, estimate.sampleCount), Number.POSITIVE_INFINITY);

  return {
    sampleCount: round(Number.isFinite(sampleCount) ? sampleCount : 0, 2),
    residualMean: round(residualMean, 4),
    residualStdDev: round(residualStdDev, 4),
    overWinProbability: round(overWinProbability, 4),
    underWinProbability: round(underWinProbability, 4),
  };
}

function estimateProjectionDistribution(
  market: SnapshotMarket,
  archetype: Archetype | null,
  minutesBucket: UniversalMinutesBucket | null,
  projectedValue: number,
  line: number,
): ProjectionDistributionEstimate | null {
  if (!archetype || !minutesBucket) return null;

  const distributionMap = loadProjectionDistributionMap();
  if (distributionMap.size === 0) return null;

  const directEstimate = estimateDirectProjectionDistribution(
    market,
    archetype,
    minutesBucket,
    projectedValue,
    line,
    distributionMap,
  );
  const componentEstimate = estimateComboComponentProjectionDistribution(
    market,
    archetype,
    minutesBucket,
    projectedValue,
    line,
    distributionMap,
  );
  if (!componentEstimate) return directEstimate;
  if (!directEstimate) return componentEstimate;

  return combineProjectionDistributionCandidates(market, projectedValue, line, [
    { estimate: directEstimate, baseWeight: 0.74 },
    { estimate: componentEstimate, baseWeight: 0.26 },
  ]);
}

function resolveBenchReboundingScorerArchetype(
  input: {
    playerPosition: string | null;
    expectedMinutes?: number | null;
    starterRateLast10?: number | null;
    pointsProjection: number | null;
    reboundsProjection: number | null;
    assistProjection: number | null;
    threesProjection: number | null;
  },
  market?: Market,
): Archetype {
  if (
    market === "PTS" &&
    !input.playerPosition &&
    (input.expectedMinutes ?? 0) >= 20 &&
    (input.starterRateLast10 ?? 0) <= 0.3 &&
    (input.pointsProjection ?? 0) >= 12 &&
    (input.reboundsProjection ?? 0) >= 5.2 &&
    (input.reboundsProjection ?? 0) <= 6.4 &&
    (input.assistProjection ?? 0) < 3.2 &&
    (input.threesProjection ?? 0) <= 1.2
  ) {
    return "BENCH_VOLUME_SCORER";
  }
  return "BENCH_REBOUNDING_SCORER";
}

function shouldUsePositionlessStarterArchetype(input: {
  playerPosition: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
}): boolean {
  if (!ENABLE_MISSING_POSITION_STARTER_FALLBACK) return false;
  if (input.playerPosition) return false;
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  if (minutes < 28) return false;
  const frontcourtLike = reb >= 8 || (reb >= 7.25 && threes >= 1.25);
  if (frontcourtLike) {
    if (starterRate >= 0.35) return true;
    return pts >= 14 || ast >= 2.5 || threes >= 0.8;
  }
  if (minutes < 31 || threes < 2 || pts < 16.5 || ast < 3.4 || ast > 5.5) return false;
  if (starterRate >= 0.35) return true;
  return reb >= 5 || ast >= 3.8;
}

function classifyPositionlessStarterArchetype(input: {
  expectedMinutes: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection?: number | null;
  threesProjection: number | null;
}): Archetype {
  const minutes = input.expectedMinutes ?? 0;
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  if (minutes >= 26 && reb >= 9 && (threes >= 1.5 || pts >= 20)) {
    return "STRETCH_RIM_PROTECTOR_CENTER";
  }
  if (minutes >= 31 && threes >= 2 && pts >= 16.5 && ast >= 3.4 && ast <= 5.5 && (reb >= 5 || ast >= 3.8)) {
    return "CONNECTOR_WING";
  }
  return "CENTER";
}

function classifyBenchArchetype(
  input: {
  playerPosition: string | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
  expectedMinutes?: number | null;
  starterRateLast10?: number | null;
  },
  market?: Market,
): Archetype {
  const position = (input.playerPosition ?? "").toUpperCase();
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  if (position.includes("C") || reb >= 7.5) {
    if (threes >= 0.5) return "BENCH_STRETCH_BIG";
    if (pts < 6.5 && reb < 4.5) return "BENCH_LOW_USAGE_BIG";
    return "BENCH_TRADITIONAL_BIG";
  }
  if (ast >= 4 || position.includes("PG") || position === "G") {
    if (threes >= 1.5) return "BENCH_SHOOTING_GUARD";
    if (ast >= 4.5) return "BENCH_PASS_FIRST_GUARD";
    if (pts < 8.0 && ast < 2.5) return "BENCH_LOW_USAGE_GUARD";
    return "BENCH_TRADITIONAL_GUARD";
  }
  if (
    (position.includes("SG") || position.includes("SF") || position.includes("PF") || position === "F") &&
    (pts >= 16 || threes >= 1.8)
  ) {
    if (ast >= 3.2) return "BENCH_CREATOR_SCORER";
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(input, market);
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  if (position.includes("SG") || position.includes("SF") || position.includes("PF") || position === "F") {
    return "BENCH_WING";
  }
  if (pts >= 15 || threes >= 1.8) {
    if (ast >= 3.2) return "BENCH_CREATOR_SCORER";
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(input, market);
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  // Recover low-minute setup guards when upstream position metadata is missing.
  if (!position && ast >= 3 && ast >= reb + 1 && pts <= 9 && reb <= 3.75) {
    if (threes >= 1.5) return "BENCH_SHOOTING_GUARD";
    if (ast >= 4.5) return "BENCH_PASS_FIRST_GUARD";
    return "BENCH_TRADITIONAL_GUARD";
  }
  if (ast >= reb && ast >= 3.5) {
    if (threes >= 1.5) return "BENCH_SHOOTING_GUARD";
    if (ast >= 4.5) return "BENCH_PASS_FIRST_GUARD";
    if (pts < 8.0 && ast < 2.5) return "BENCH_LOW_USAGE_GUARD";
    return "BENCH_TRADITIONAL_GUARD";
  }
  if (reb >= pts && reb >= ast) {
    if (threes >= 0.5) return "BENCH_STRETCH_BIG";
    if (pts < 6.5 && reb < 4.5) return "BENCH_LOW_USAGE_BIG";
    return "BENCH_TRADITIONAL_BIG";
  }
  if (pts >= reb && pts >= ast) {
    if (ast >= 3.2) return "BENCH_CREATOR_SCORER";
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(input, market);
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  return "LOW_MINUTE_BENCH";
}

function classifyArchetype(input: {
  market?: Market;
  playerPosition: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
}): Archetype {
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const position = (input.playerPosition ?? "").toUpperCase();
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistProjection ?? 0;
  const threes = input.threesProjection ?? 0;
  const usePositionlessStarterArchetype = shouldUsePositionlessStarterArchetype(input);

  if (minutes < 24 || (starterRate < 0.35 && !usePositionlessStarterArchetype)) {
    return classifyBenchArchetype({
      playerPosition: input.playerPosition,
      pointsProjection: input.pointsProjection,
      reboundsProjection: input.reboundsProjection,
      assistProjection: input.assistProjection,
      threesProjection: input.threesProjection,
      expectedMinutes: input.expectedMinutes,
      starterRateLast10: input.starterRateLast10,
    }, input.market);
  }
  if (!position && usePositionlessStarterArchetype) {
    return classifyPositionlessStarterArchetype({
      expectedMinutes: input.expectedMinutes,
      pointsProjection: input.pointsProjection,
      reboundsProjection: input.reboundsProjection,
      assistProjection: input.assistProjection,
      threesProjection: input.threesProjection,
    });
  }
  if (position.includes("C") && minutes >= 26 && reb >= 9 && (threes >= 1.5 || pts >= 20)) {
    return "STRETCH_RIM_PROTECTOR_CENTER";
  }
  if (position.includes("C")) return "CENTER";
  if (
    !position.includes("C") &&
    minutes >= 30 &&
    pts >= 22 &&
    threes >= 3.2 &&
    ast <= 6.8 &&
    (position.includes("PG") || position.includes("SG") || position === "G")
  ) {
    return "ELITE_SHOOTING_GUARD";
  }
  if (
    !position.includes("C") &&
    minutes >= 31 &&
    pts >= 20 &&
    reb >= 5.5 &&
    ast >= 6 &&
    (position.includes("PG") || position.includes("SG") || position === "G")
  ) {
    return "JUMBO_CREATOR_GUARD";
  }
  if (
    ((position.includes("PG") || position === "G" || position.includes("SG")) &&
      minutes >= 32 &&
      pts >= 24 &&
      ast >= 7) ||
    (minutes >= 34 && pts >= 25 && ast >= 7.5 && !position.includes("C"))
  ) {
    return "HELIOCENTRIC_GUARD";
  }
  if (
    !position.includes("C") &&
    minutes >= 31 &&
    pts >= 23 &&
    ast >= 4.5 &&
    ast < 7.2 &&
    threes >= 1.8 &&
    (position.includes("PG") || position.includes("SG") || position === "G")
  ) {
    return "SCORING_GUARD_CREATOR";
  }
  if ((position.includes("PF") || position.includes("SF") || position === "F") && pts >= 20 && reb >= 7 && ast >= 4.5 && threes <= 1.5) {
    return "POINT_FORWARD";
  }
  if (pts >= 22 && reb >= 7 && ast >= 5 && threes <= 1.2 && !position.includes("PG") && !position.includes("SG")) {
    return "POINT_FORWARD";
  }
  if (
    !position.includes("C") &&
    minutes >= 30 &&
    pts >= 20 &&
    reb >= 5 &&
    ast >= 3 &&
    ast < 5.8 &&
    threes >= 1 &&
    threes <= 2.8 &&
    (position.includes("SG") || position.includes("SF") || position.includes("PF") || position.includes("F"))
  ) {
    return "TWO_WAY_MARKET_WING";
  }
  if (
    !position.includes("C") &&
    minutes >= 32 &&
    pts >= 24 &&
    ast >= 4 &&
    ast < 6.8 &&
    threes >= 1.8 &&
    (position.includes("SG") || position.includes("SF") || position.includes("PF") || position.includes("F"))
  ) {
    return "SCORER_CREATOR_WING";
  }
  if (
    !position.includes("C") &&
    minutes >= 32 &&
    pts >= 24 &&
    threes >= 2.2 &&
    ast < 7.25 &&
    (position.includes("SG") || position.includes("SF") || position.includes("F") || position === "G")
  ) {
    return "SHOT_CREATING_WING";
  }
  if (
    !position.includes("C") &&
    minutes >= 31 &&
    pts >= 21 &&
    ast < 5.5 &&
    threes >= 1.7 &&
    (position.includes("SG") || position.includes("SF") || position.includes("F"))
  ) {
    return "MARKET_SHAPED_SCORING_WING";
  }
  if (position.includes("PG") || position === "G" || position.includes("SG") || ast >= 5) {
    if (ast >= 6.8 && pts <= 22 && threes <= 2.6) return "TABLE_SETTING_LEAD_GUARD";
    if (pts >= 19 || threes >= 2.4) return "SCORE_FIRST_LEAD_GUARD";
    return "LEAD_GUARD";
  }
  if (
    input.market === "PR" &&
    !position &&
    minutes >= 28 &&
    starterRate >= 0.5 &&
    pts >= 14 &&
    pts <= 17.5 &&
    reb >= 4.2 &&
    reb < 5.6 &&
    ast >= 2.6 &&
    ast < 3.4 &&
    threes >= 1.6 &&
    threes <= 2.2
  ) {
    return "CONNECTOR_WING";
  }
  if (ast >= 3.4 || reb >= 5.6) return "CONNECTOR_WING";
  if (pts >= 15 || threes >= 2) return "SPOTUP_WING";
  return "WING";
}

function shouldApplyPointForwardWeakMarketRoleFix(
  archetype: Archetype,
  input: {
    market: Market;
    playerPosition: string | null;
    expectedMinutes: number | null;
    pointsProjection: number | null;
    reboundsProjection: number | null;
    assistProjection: number | null;
    threesProjection: number | null;
  },
): boolean {
  if (archetype !== "SCORING_GUARD_CREATOR") return false;
  if (!POINT_FORWARD_WEAK_MARKET_ROLE_FIX_MARKETS.includes(input.market)) return false;

  const position = (input.playerPosition ?? "").toUpperCase();
  const isGuard = position.includes("PG") || position.includes("SG") || position === "G";
  if (!isGuard || position.includes("C")) return false;

  if (
    input.expectedMinutes == null ||
    input.pointsProjection == null ||
    input.reboundsProjection == null ||
    input.assistProjection == null ||
    input.threesProjection == null
  ) {
    return false;
  }

  if (input.expectedMinutes < POINT_FORWARD_WEAK_MARKET_ROLE_FIX.minMinutes) return false;
  if (input.pointsProjection < POINT_FORWARD_WEAK_MARKET_ROLE_FIX.minPoints) return false;
  if (input.reboundsProjection < POINT_FORWARD_WEAK_MARKET_ROLE_FIX.minRebounds) return false;
  if (input.assistProjection < POINT_FORWARD_WEAK_MARKET_ROLE_FIX.minAssists) return false;
  if (input.assistProjection >= POINT_FORWARD_WEAK_MARKET_ROLE_FIX.maxAssistsExclusive) return false;
  if (input.threesProjection > POINT_FORWARD_WEAK_MARKET_ROLE_FIX.maxThrees) return false;
  return true;
}

function heliocentricWeakMarketRoleFixArchetype(): Archetype | null {
  return HELIOCENTRIC_WEAK_MARKET_ROLE_FIX_ARCHETYPE;
}

function shouldApplyHeliocentricWeakMarketRoleFix(
  archetype: Archetype,
  input: {
    market: Market;
  },
): boolean {
  if (archetype !== "HELIOCENTRIC_GUARD") return false;
  if (heliocentricWeakMarketRoleFixArchetype() == null) return false;
  return HELIOCENTRIC_WEAK_MARKET_ROLE_FIX_MARKETS.includes(input.market);
}

function shouldApplyHeliocentricGuardRoleFix(
  archetype: Archetype,
  input: {
    market: Market;
    playerPosition: string | null;
    expectedMinutes: number | null;
    starterRateLast10: number | null;
    pointsProjection: number | null;
    assistProjection: number | null;
    threesProjection: number | null;
  },
): boolean {
  if (archetype !== "SCORE_FIRST_LEAD_GUARD") return false;
  if (HELIOCENTRIC_GUARD_ROLE_FIX_EXCLUDED_MARKETS.includes(input.market)) return false;

  const position = (input.playerPosition ?? "").toUpperCase();
  const isGuard = position.includes("PG") || position.includes("SG") || position === "G";
  if (!isGuard || position.includes("C")) return false;

  if (
    input.expectedMinutes == null ||
    input.starterRateLast10 == null ||
    input.pointsProjection == null ||
    input.assistProjection == null ||
    input.threesProjection == null
  ) {
    return false;
  }

  if (input.expectedMinutes < HELIOCENTRIC_GUARD_ROLE_FIX.minMinutes) return false;
  if (input.starterRateLast10 < HELIOCENTRIC_GUARD_ROLE_FIX.minStarterRate) return false;
  if (input.pointsProjection < HELIOCENTRIC_GUARD_ROLE_FIX.minPoints) return false;
  if (input.assistProjection < HELIOCENTRIC_GUARD_ROLE_FIX.minAssists) return false;
  if (input.threesProjection < HELIOCENTRIC_GUARD_ROLE_FIX.minThrees) return false;
  return true;
}

function shouldApplyBenchLowUsageBigComboRoleFix(
  archetype: Archetype,
  input: {
    market: Market;
    expectedMinutes: number | null;
    starterRateLast10: number | null;
    pointsProjection: number | null;
    reboundsProjection: number | null;
    threesProjection: number | null;
  },
): boolean {
  if (archetype !== "BENCH_TRADITIONAL_BIG") return false;
  if (!BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX_MARKETS.includes(input.market)) return false;

  if (
    input.expectedMinutes == null ||
    input.starterRateLast10 == null ||
    input.pointsProjection == null ||
    input.reboundsProjection == null ||
    input.threesProjection == null
  ) {
    return false;
  }

  if (input.expectedMinutes > BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX.maxMinutes) return false;
  if (input.starterRateLast10 > BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX.maxStarterRate) return false;
  if (input.pointsProjection > BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX.maxPoints) return false;
  if (input.reboundsProjection > BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX.maxRebounds) return false;
  if (input.threesProjection > BENCH_LOW_USAGE_BIG_COMBO_ROLE_FIX.maxThrees) return false;
  return true;
}

function shouldApplyBenchCreatorScorerRoleFix(
  archetype: Archetype,
  input: {
    market: Market;
    playerPosition: string | null;
    expectedMinutes: number | null;
    starterRateLast10: number | null;
    pointsProjection: number | null;
    reboundsProjection: number | null;
    assistProjection: number | null;
    threesProjection: number | null;
  },
): boolean {
  if (archetype !== "BENCH_SPACER_SCORER") return false;
  if (!BENCH_CREATOR_SCORER_ROLE_FIX_MARKETS.includes(input.market)) return false;

  const position = (input.playerPosition ?? "").toUpperCase();
  if (!position || position.includes("C")) return false;

  if (
    input.expectedMinutes == null ||
    input.starterRateLast10 == null ||
    input.pointsProjection == null ||
    input.reboundsProjection == null ||
    input.assistProjection == null ||
    input.threesProjection == null
  ) {
    return false;
  }

  if (input.expectedMinutes < BENCH_CREATOR_SCORER_ROLE_FIX.minMinutes) return false;
  if (input.starterRateLast10 < BENCH_CREATOR_SCORER_ROLE_FIX.minStarterRate) return false;
  if (input.pointsProjection < BENCH_CREATOR_SCORER_ROLE_FIX.minPoints) return false;
  if (input.reboundsProjection > BENCH_CREATOR_SCORER_ROLE_FIX.maxRebounds) return false;
  if (input.assistProjection < BENCH_CREATOR_SCORER_ROLE_FIX.minAssists) return false;
  if (input.threesProjection < BENCH_CREATOR_SCORER_ROLE_FIX.minThrees) return false;
  return true;
}

function lineTier(market: SnapshotMarket, line: number): number | null {
  if (!Number.isFinite(line)) return null;
  if (market === "THREES") {
    if (line <= 1.5) return 1;
    if (line <= 2.5) return 2;
    return 3;
  }
  if (market === "PTS") {
    if (line <= 14.5) return 1;
    if (line <= 24.5) return 2;
    if (line <= 30.5) return 3;
    return 4;
  }
  return line <= 8.5 ? 1 : line <= 16.5 ? 2 : 3;
}

function getFeature(row: LiveUniversalModelRow, feature: FeatureName): number | null {
  switch (feature) {
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    case "l5CurrentLineDeltaAvg":
      return row.l5CurrentLineDeltaAvg;
    case "l5CurrentLineOverRate":
      return row.l5CurrentLineOverRate;
    case "l5MinutesAvg":
      return row.l5MinutesAvg;
    case "emaCurrentLineDelta":
      return row.emaCurrentLineDelta;
    case "emaCurrentLineOverRate":
      return row.emaCurrentLineOverRate;
    case "emaMinutesAvg":
      return row.emaMinutesAvg;
    case "l15ValueMean":
      return row.l15ValueMean;
    case "l15ValueMedian":
      return row.l15ValueMedian;
    case "l15ValueStdDev":
      return row.l15ValueStdDev;
    case "l15ValueSkew":
      return row.l15ValueSkew;
    case "projectionMedianDelta":
      return row.projectionMedianDelta;
    case "medianLineGap":
      return row.medianLineGap;
    case "competitivePaceFactor":
      return row.competitivePaceFactor;
    case "blowoutRisk":
      return row.blowoutRisk;
    case "minutesShiftDelta":
      return row.minutesShiftDelta;
    case "minutesShiftAbsDelta":
      return row.minutesShiftAbsDelta;
    case "seasonMinutesAvg":
      return row.seasonMinutesAvg;
    case "minutesLiftPct":
      return row.minutesLiftPct;
    case "activeCorePts":
      return row.activeCorePts;
    case "activeCoreAst":
      return row.activeCoreAst;
    case "missingCorePts":
      return row.missingCorePts;
    case "missingCoreAst":
      return row.missingCoreAst;
    case "missingCoreShare":
      return row.missingCoreShare;
    case "stepUpRoleFlag":
      return row.stepUpRoleFlag;
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "benchBigRoleStability":
      return row.benchBigRoleStability;
    case "starterRateLast10":
      return row.starterRateLast10;
    case "priceLean":
      return row.priceLean;
    case "priceAbsLean":
      return row.priceLean == null ? null : Math.abs(row.priceLean);
    case "line":
      return row.line;
    case "projectedValue":
      return row.projectedValue;
    case "projectionPerMinute":
      return row.projectionPerMinute;
    case "projectionToLineRatio":
      return row.projectionToLineRatio;
    case "lineTier":
      return row.lineTier;
    case "priceStrength":
      return row.priceStrength;
    case "contextQuality":
      return row.contextQuality;
    case "roleStability":
      return row.roleStability;
    case "projectionMarketAgreement":
      return row.projectionMarketAgreement;
    case "openingTeamSpread":
      return row.openingTeamSpread;
    case "openingSpreadAbs":
      return row.openingSpreadAbs;
    case "openingTotal":
      return row.openingTotal;
    case "lineupTimingConfidence":
      return row.lineupTimingConfidence;
    case "completenessScore":
      return row.completenessScore;
    case "spreadResolved":
      return row.spreadResolved ? 1 : 0;
    case "favoriteFlag":
      return row.favoriteFlag;
    case "bigFavoriteFlag":
      return row.bigFavoriteFlag;
    case "closeGameFlag":
      return row.closeGameFlag;
    case "pointForwardFlag":
      return row.pointForwardFlag;
    case "heliocentricGuardFlag":
      return row.heliocentricGuardFlag;
    case "stretchRimProtectorCenterFlag":
      return row.stretchRimProtectorCenterFlag;
    case "rimPressureStarFlag":
      return row.rimPressureStarFlag;
    case "lowThreeVolumeStarFlag":
      return row.lowThreeVolumeStarFlag;
    case "comboGapPressure":
      return row.comboGapPressure;
    case "favoredOver":
      return row.favoredSide === "OVER" ? 1 : row.favoredSide === "UNDER" ? -1 : 0;
    case "overPrice":
      return row.overPrice;
    case "underPrice":
      return row.underPrice;
    case "overProbability":
      return impliedProbability(row.overPrice);
    case "underProbability":
      return impliedProbability(row.underPrice);
    case "assistRate":
      return row.assistRate;
    case "astToLineRatio":
      return row.astToLineRatio;
    case "ptsShareOfPRA":
      return row.ptsShareOfPRA;
    case "rebShareOfPRA":
      return row.rebShareOfPRA;
    case "astShareOfPRA":
      return row.astShareOfPRA;
    case "maxLegShareOfCombo":
      return row.maxLegShareOfCombo;
    case "comboEntropy":
      return row.comboEntropy;
    case "comboBalanceScore":
      return row.comboBalanceScore;
    case "ptsLedPRAFlag":
      return row.ptsLedPRAFlag;
    case "highLinePRAFlag":
      return row.highLinePRAFlag;
    case "veryHighLinePRAFlag":
      return row.veryHighLinePRAFlag;
    case "lateSeasonFlag":
      return row.lateSeasonFlag;
    case "lateSeasonHighLinePRAFlag":
      return row.lateSeasonHighLinePRAFlag;
    case "guardWingArchetypeFlag":
      return row.guardWingArchetypeFlag;
    case "ptsLedPRAxGuardWing":
      return row.ptsLedPRAxGuardWing;
    case "highLinePRAxGuardWing":
      return row.highLinePRAxGuardWing;
    case "lateSeasonxGuardWing":
      return row.lateSeasonxGuardWing;
    case "closeGamexGuardWing":
      return row.closeGamexGuardWing;
    case "ptsLedPRAxCloseGame":
      return row.ptsLedPRAxCloseGame;
    case "ptsLedPRAxLateSeason":
      return row.ptsLedPRAxLateSeason;
    case "ptsLedPRAxHighLine":
      return row.ptsLedPRAxHighLine;
    default:
      return null;
  }
}

function resolveTreeLeaf(node: TreeNode, row: LiveUniversalModelRow): LeafNode {
  if (node.kind === "leaf") return node;
  const value = getFeature(row, node.feature);
  if (value == null) {
    return resolveTreeLeaf(node.left, row);
  }
  return value <= node.threshold ? resolveTreeLeaf(node.left, row) : resolveTreeLeaf(node.right, row);
}

function predictTree(node: TreeNode, row: LiveUniversalModelRow): Side {
  return resolveTreeLeaf(node, row).side;
}

function resolveRoutedDecision(decision: RoutedModelDecision, row: LiveUniversalModelRow): Side {
  switch (decision) {
    case "OVER":
    case "UNDER":
      return decision;
    case "projection":
      return row.projectionSide;
    case "finalOverride":
      return row.finalSide;
    case "marketFavored":
    default:
      return row.favoredSide === "NEUTRAL" ? row.finalSide : row.favoredSide;
  }
}

function predictVariant(model: ModelVariant, row: LiveUniversalModelRow): Side {
  switch (model.kind) {
    case "projection":
      return row.projectionSide;
    case "finalOverride":
      return row.finalSide;
    case "marketFavored":
      return row.favoredSide === "NEUTRAL" ? row.finalSide : row.favoredSide;
    case "constant":
      return model.side;
    case "featureThresholdRouter": {
      const value = getFeature(row, model.feature);
      return resolveRoutedDecision(
        (value ?? Number.POSITIVE_INFINITY) <= model.threshold ? model.lteDecision : model.gtDecision,
        row,
      );
    }
    case "lowMinutesThenFinalElseConstant":
      return (row.expectedMinutes ?? Number.POSITIVE_INFINITY) <= model.threshold ? row.finalSide : model.side;
    case "underGapThenFinalElseConstant":
      return row.lineGap <= -model.threshold ? row.finalSide : model.side;
    case "lowMinutesThenFinal":
      return (row.expectedMinutes ?? Number.POSITIVE_INFINITY) <= model.threshold ? row.finalSide : row.projectionSide;
    case "lowMinutesDisagreementThenFinal":
      return (row.expectedMinutes ?? Number.POSITIVE_INFINITY) <= model.threshold && row.finalSide !== row.projectionSide
        ? row.finalSide
        : row.projectionSide;
    case "gapThenProjection":
      return row.absLineGap >= model.threshold
        ? row.projectionSide
        : row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide;
    case "gapThenMarket":
      return row.absLineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide
        : row.projectionSide;
    case "overGapThenMarket":
      return row.lineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide
        : row.projectionSide;
    case "strongPriceThenMarket":
      return (row.priceStrength ?? 0) >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide
        : row.finalSide;
    case "nearLineThenMarket":
      return row.absLineGap <= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide
        : row.finalSide;
    case "agreementThenProjection":
      return (row.projectionMarketAgreement ?? 0) >= model.threshold ? row.projectionSide : row.finalSide;
    case "favoriteOverSuppress":
      if (
        row.finalSide === "OVER" &&
        row.openingTeamSpread != null &&
        row.openingTeamSpread <= model.spreadThreshold &&
        row.absLineGap <= model.gapThreshold
      ) {
        return "UNDER";
      }
      return row.finalSide;
    case "favoriteOverSuppressPositiveGap":
      if (
        row.finalSide === "OVER" &&
        row.openingTeamSpread != null &&
        row.openingTeamSpread <= model.spreadThreshold &&
        row.absLineGap <= model.gapThreshold &&
        row.lineGap >= 0 &&
        (row.expectedMinutes ?? 0) >= model.minExpectedMinutes
      ) {
        return "UNDER";
      }
      return row.finalSide;
    case "lowQualityThenMarket":
      return (row.contextQuality ?? 1) <= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.finalSide
          : row.favoredSide
        : row.finalSide;
    case "lowVolatilityHelioOver":
      if (
        row.heliocentricGuardFlag === 1 &&
        (row.minutesVolatility ?? Number.POSITIVE_INFINITY) <= model.volatilityThreshold &&
        row.absLineGap <= model.gapThreshold
      ) {
        return "OVER";
      }
      return row.projectionSide;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.finalSide;
  }
}

function applyBucketSideBias(
  market: SnapshotMarket,
  archetype: Archetype,
  row: LiveUniversalModelRow,
  side: Side,
  componentProjectionDistribution: ProjectionDistributionEstimate | null,
): Side {
  const marketLeanSide: Side =
    row.favoredSide === "OVER" || row.favoredSide === "UNDER" ? row.favoredSide : row.finalSide;
  const componentSide =
    componentProjectionDistribution == null
      ? null
      : componentProjectionDistribution.overWinProbability >= componentProjectionDistribution.underWinProbability
        ? "OVER"
        : "UNDER";
  const componentConfidence =
    componentProjectionDistribution == null
      ? null
      : Math.max(
          componentProjectionDistribution.overWinProbability,
          componentProjectionDistribution.underWinProbability,
        );

  if (market === "PTS" && archetype === "WING" && (row.openingTotal ?? Number.POSITIVE_INFINITY) <= 236.5) {
    return row.projectionSide;
  }
  if (market === "PTS" && archetype === "SPOTUP_WING" && (row.openingTotal ?? Number.POSITIVE_INFINITY) <= 227) {
    return marketLeanSide;
  }
  if (market === "PRA" && archetype === "CONNECTOR_WING" && (row.expectedMinutes ?? Number.POSITIVE_INFINITY) <= 30.5) {
    if (componentSide == null || componentSide === marketLeanSide || (componentConfidence ?? 0) <= 0.54) {
      return marketLeanSide;
    }
  }
  if (market === "PA" && archetype === "CONNECTOR_WING" && row.lineGap <= 0.25) {
    return marketLeanSide;
  }
  if (market === "PA" && archetype === "SPOTUP_WING" && (row.expectedMinutes ?? Number.POSITIVE_INFINITY) <= 29.5) {
    return marketLeanSide;
  }
  if (
    market === "PR" &&
    archetype === "CENTER" &&
    (row.expectedMinutes ?? 0) >= 32.25 &&
    componentSide != null &&
    componentSide === marketLeanSide &&
    (componentConfidence ?? 0) >= 0.54
  ) {
    return marketLeanSide;
  }
  if (
    market === "PA" &&
    archetype === "SPOTUP_WING" &&
    PA_SPOTUP_WING_USE_LEGACY_SIDE_BIAS &&
    PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD != null
  ) {
    return row.absLineGap >= PA_SPOTUP_WING_GAP_THEN_MARKET_THRESHOLD
      ? row.favoredSide === "NEUTRAL"
        ? row.finalSide
        : row.favoredSide
      : row.projectionSide;
  }
  if (
    market === "THREES" &&
    archetype === "SCORE_FIRST_LEAD_GUARD" &&
    THREES_SCORE_FIRST_LEAD_GUARD_SIDE_BIAS !== 0
  ) {
    const biasedGap = row.lineGap + THREES_SCORE_FIRST_LEAD_GUARD_SIDE_BIAS;
    if (biasedGap > 0) return "OVER";
    if (biasedGap < 0) return "UNDER";
  }
  return side;
}

function inspectLiveUniversalModelSideInternal(
  input: PredictLiveUniversalSideInput,
  forcedArchetype?: Archetype,
  runtimeOptions: InspectLiveUniversalModelRuntimeOptions = {},
): RawLiveUniversalModelDecision {
  const archetypeMinutes = input.archetypeExpectedMinutes ?? input.expectedMinutes;
  const minutesBucket = universalMinutesBucket(archetypeMinutes);
  if (input.projectedValue == null || input.line == null) {
    return {
      market: input.market,
      rawSide: "NEUTRAL",
      finalSide: input.finalSide,
      archetype: null,
      minutesBucket: null,
      modelKind: null,
      bucketSamples: null,
      bucketModelAccuracy: null,
      bucketLateAccuracy: null,
      leafCount: null,
      leafAccuracy: null,
      absLineGap: null,
      favoredSide: null,
      priceLean: null,
      priceStrength: null,
      projectionMarketAgreement: null,
      overProbability: null,
      underProbability: null,
      projectionWinProbability: null,
      projectionPriceEdge: null,
      projectionResidualMean: null,
      projectionResidualStdDev: null,
    };
  }

  const classificationInput = {
    market: input.market,
    playerPosition: input.playerPosition,
    expectedMinutes: archetypeMinutes,
    starterRateLast10: input.archetypeStarterRateLast10 ?? input.starterRateLast10,
    pointsProjection:
      input.pointsProjection ?? (input.market === "PTS" ? input.projectedValue : null),
    reboundsProjection:
      input.reboundsProjection ?? (input.market === "REB" ? input.projectedValue : null),
    assistProjection: input.assistProjection,
    threesProjection:
      input.threesProjection ?? (input.market === "THREES" ? input.projectedValue : null),
  };
  const classifiedArchetype = classifyArchetype(classificationInput);
  const roleAdjustedArchetype = shouldApplyPointForwardWeakMarketRoleFix(classifiedArchetype, classificationInput)
    ? "POINT_FORWARD"
    : shouldApplyHeliocentricGuardRoleFix(classifiedArchetype, classificationInput)
      ? "HELIOCENTRIC_GUARD"
      : shouldApplyBenchLowUsageBigComboRoleFix(classifiedArchetype, classificationInput)
        ? "BENCH_LOW_USAGE_BIG"
        : shouldApplyBenchCreatorScorerRoleFix(classifiedArchetype, classificationInput)
          ? "BENCH_CREATOR_SCORER"
          : classifiedArchetype;
  const archetype =
    forcedArchetype ??
    (shouldApplyHeliocentricWeakMarketRoleFix(roleAdjustedArchetype, classificationInput)
      ? heliocentricWeakMarketRoleFixArchetype()!
      : roleAdjustedArchetype);
  const record = loadModelMap().get(`${input.market}|${archetype}`);
  if (!record) {
    return {
      market: input.market,
      rawSide: "NEUTRAL",
      finalSide: input.finalSide,
      archetype,
      minutesBucket,
      modelKind: null,
      bucketSamples: null,
      bucketModelAccuracy: null,
      bucketLateAccuracy: null,
      leafCount: null,
      leafAccuracy: null,
      absLineGap: null,
      favoredSide: null,
      priceLean: null,
      priceStrength: null,
      projectionMarketAgreement: null,
      overProbability: null,
      underProbability: null,
      projectionWinProbability: null,
      projectionPriceEdge: null,
      projectionResidualMean: null,
      projectionResidualStdDev: null,
    };
  }
  const model = record.model;

  const projectionSide: Side =
    input.projectedValue > input.line ? "OVER" : input.projectedValue < input.line ? "UNDER" : "UNDER";
  const overProbability = impliedProbability(input.overPrice);
  const underProbability = impliedProbability(input.underPrice);
  const favoredSide: "OVER" | "UNDER" | "NEUTRAL" =
    overProbability == null || underProbability == null
      ? "NEUTRAL"
      : overProbability === underProbability
        ? "NEUTRAL"
        : overProbability > underProbability
          ? "OVER"
          : "UNDER";
  const priceLean =
    overProbability == null || underProbability == null ? null : round(overProbability - underProbability, 4);
  const priceStrength =
    overProbability == null && underProbability == null
      ? null
      : round(Math.max(overProbability ?? 0, underProbability ?? 0), 4);
  const completenessNormalized =
    input.completenessScore == null ? 0 : clamp(input.completenessScore / 100, 0, 1);
  const timingNormalized = input.lineupTimingConfidence == null ? 0 : clamp(input.lineupTimingConfidence, 0, 1);
  const spreadResolved = input.openingTeamSpread != null;
  const contextQuality = round(
    clamp(
      completenessNormalized * 0.45 +
        timingNormalized * 0.25 +
        (spreadResolved ? 0.12 : 0) +
        (input.expectedMinutes != null ? 0.1 : 0) +
        (priceLean != null ? 0.08 : 0),
      0,
      1,
    ),
    4,
  );
  const roleStability =
    input.minutesVolatility == null && input.starterRateLast10 == null
      ? null
      : round(
          clamp(
            (input.starterRateLast10 == null ? 0.5 : Math.abs(input.starterRateLast10 - 0.5) * 2) * 0.55 +
              (input.minutesVolatility == null ? 0.5 : Math.max(0, 1 - input.minutesVolatility / 10)) * 0.45,
            0,
            1,
          ),
          4,
        );
  const finalSide: Side =
    input.finalSide === "OVER" || input.finalSide === "UNDER" ? input.finalSide : projectionSide;
  const emaMinutesAvg = input.emaMinutesAvg ?? null;
  const minutesShiftDelta =
    input.expectedMinutes == null || emaMinutesAvg == null ? null : round(input.expectedMinutes - emaMinutesAvg, 4);
  const minutesLiftPct =
    input.minutesLiftPct != null
      ? round(input.minutesLiftPct, 4)
      : input.expectedMinutes == null || input.seasonMinutesAvg == null || input.seasonMinutesAvg <= 0
        ? null
        : round(input.expectedMinutes / input.seasonMinutesAvg - 1, 4);
  const stepUpRoleFlag =
    input.stepUpRoleFlag != null
      ? input.stepUpRoleFlag
      : input.missingCoreShare != null && minutesLiftPct != null && input.missingCoreShare > 0.2 && minutesLiftPct >= 0.15
        ? 1
        : 0;
  const minutesShiftAbsDelta = minutesShiftDelta == null ? null : round(Math.abs(minutesShiftDelta), 4);
  const openingSpreadAbs =
    input.openingTeamSpread == null ? null : round(Math.abs(input.openingTeamSpread), 3);
  const rawCompetitivePaceFactor =
    input.competitivePaceFactor != null
      ? round(input.competitivePaceFactor, 4)
      : input.openingTotal == null
        ? null
        : round(input.openingTotal / Math.max(openingSpreadAbs ?? 0, 1), 4);
  const rawBlowoutRisk =
    input.blowoutRisk != null
      ? round(input.blowoutRisk, 4)
      : input.openingTotal == null || openingSpreadAbs == null
        ? null
        : round(openingSpreadAbs / Math.max(input.openingTotal, 1), 4);
  const l15ValueMedian = input.l15ValueMedian ?? null;
  const rawProjectionMedianDelta =
    input.projectionMedianDelta != null
      ? round(input.projectionMedianDelta, 4)
      : l15ValueMedian == null
        ? null
        : round(input.projectedValue - l15ValueMedian, 4);
  const rawMedianLineGap =
    input.medianLineGap != null
      ? round(input.medianLineGap, 4)
      : l15ValueMedian == null
        ? null
        : round(l15ValueMedian - input.line, 4);
  const shapeContextEnabled = shouldExposeShapeContext({
    dateEt: input.gameDateEt ?? null,
    stepUpRoleFlag,
    expectedMinutes: input.expectedMinutes,
    emaMinutesAvg,
    minutesShiftAbsDelta,
    missingCoreShare: input.missingCoreShare ?? null,
    minutesLiftPct,
  });
  const competitivePaceFactor = gateShapeNumber(rawCompetitivePaceFactor, shapeContextEnabled);
  const blowoutRisk = gateShapeNumber(rawBlowoutRisk, shapeContextEnabled);
  const projectionMedianDelta = gateShapeNumber(rawProjectionMedianDelta, shapeContextEnabled);
  const medianLineGap = gateShapeNumber(rawMedianLineGap, shapeContextEnabled);
  const praComboState = buildPRAComboState({
    market: input.market,
    gameDateEt: input.gameDateEt ?? null,
    line: input.line,
    openingTeamSpread: input.openingTeamSpread,
    archetype,
    pointsProjection:
      input.pointsProjection ?? (input.market === "PTS" ? input.projectedValue : null),
    reboundsProjection:
      input.reboundsProjection ?? (input.market === "REB" ? input.projectedValue : null),
    assistProjection: input.assistProjection,
  });
  const row: LiveUniversalModelRow = {
    projectedValue: input.projectedValue,
    line: input.line,
    overPrice: input.overPrice,
    underPrice: input.underPrice,
    projectionSide,
    finalSide,
    favoredSide,
    priceLean,
    l5CurrentLineDeltaAvg: input.l5CurrentLineDeltaAvg ?? null,
    l5CurrentLineOverRate: input.l5CurrentLineOverRate ?? null,
    l5MinutesAvg: input.l5MinutesAvg ?? null,
    emaCurrentLineDelta: input.emaCurrentLineDelta ?? null,
    emaCurrentLineOverRate: input.emaCurrentLineOverRate ?? null,
    emaMinutesAvg,
    l15ValueMean: gateShapeNumber(input.l15ValueMean ?? null, shapeContextEnabled),
    l15ValueMedian: gateShapeNumber(l15ValueMedian, shapeContextEnabled),
    l15ValueStdDev: gateShapeNumber(input.l15ValueStdDev ?? null, shapeContextEnabled),
    l15ValueSkew: gateShapeNumber(input.l15ValueSkew ?? null, shapeContextEnabled),
    projectionMedianDelta,
    medianLineGap,
    competitivePaceFactor,
    blowoutRisk,
    minutesShiftDelta,
    minutesShiftAbsDelta,
    seasonMinutesAvg: input.seasonMinutesAvg ?? null,
    minutesLiftPct,
    activeCorePts: input.activeCorePts ?? null,
    activeCoreAst: input.activeCoreAst ?? null,
    missingCorePts: input.missingCorePts ?? null,
    missingCoreAst: input.missingCoreAst ?? null,
    missingCoreShare: input.missingCoreShare ?? null,
    stepUpRoleFlag,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
    benchBigRoleStability:
      input.benchBigRoleStability ??
      computeBenchBigRoleStability({
        archetype,
        minutesVolatility: input.minutesVolatility,
      }),
    starterRateLast10: input.starterRateLast10,
    lineGap: round(input.projectedValue - input.line, 4),
    absLineGap: round(Math.abs(input.projectedValue - input.line), 4),
    projectionPerMinute:
      input.expectedMinutes != null && input.expectedMinutes > 0 ? round(input.projectedValue / input.expectedMinutes, 4) : null,
    projectionToLineRatio: input.line > 0 ? round(input.projectedValue / input.line, 4) : null,
    lineTier: lineTier(input.market, input.line),
    priceStrength,
    contextQuality,
    roleStability,
    projectionMarketAgreement: favoredSide === "NEUTRAL" ? 0 : projectionSide === favoredSide ? 1 : -1,
    openingTeamSpread: input.openingTeamSpread,
    openingSpreadAbs,
    openingTotal: input.openingTotal,
    lineupTimingConfidence: input.lineupTimingConfidence,
    completenessScore: input.completenessScore,
    spreadResolved,
    favoriteFlag:
      input.openingTeamSpread == null
        ? null
        : input.openingTeamSpread < 0
          ? 1
          : input.openingTeamSpread > 0
            ? -1
            : 0,
    bigFavoriteFlag: input.openingTeamSpread != null && input.openingTeamSpread <= -6.5 ? 1 : 0,
    closeGameFlag: input.openingTeamSpread != null && Math.abs(input.openingTeamSpread) <= 4.5 ? 1 : 0,
    pointForwardFlag: archetype === "POINT_FORWARD" ? 1 : 0,
    heliocentricGuardFlag: archetype === "HELIOCENTRIC_GUARD" ? 1 : 0,
    stretchRimProtectorCenterFlag: archetype === "STRETCH_RIM_PROTECTOR_CENTER" ? 1 : 0,
    rimPressureStarFlag:
      archetype === "POINT_FORWARD" &&
      (input.expectedMinutes ?? 0) >= 30 &&
      (input.pointsProjection ?? (input.market === "PTS" ? input.projectedValue : 0) ?? 0) >= 20 &&
      (input.threesProjection ?? (input.market === "THREES" ? input.projectedValue : 0) ?? 0) <= 1.8
        ? 1
        : 0,
    lowThreeVolumeStarFlag:
      (input.expectedMinutes ?? 0) >= 30 &&
      (input.pointsProjection ?? (input.market === "PTS" ? input.projectedValue : 0) ?? 0) >= 18 &&
      (input.threesProjection ?? (input.market === "THREES" ? input.projectedValue : 0) ?? 0) <= 1.6
        ? 1
        : 0,
    comboGapPressure:
      input.market === "PRA" || input.market === "PA" || input.market === "PR" || input.market === "RA"
        ? round(
            Math.abs(input.projectedValue - input.line) *
              (1 +
                Math.max(0, (input.expectedMinutes ?? 0) - 30) * 0.015 +
                Math.max(0, ((input.pointsProjection ?? 0) || 0) - 20) * 0.01 +
                Math.max(0, ((input.reboundsProjection ?? 0) || 0) - 8) * 0.008 +
                Math.max(0, ((input.assistProjection ?? 0) || 0) - 5) * 0.008),
            4,
          )
        : null,
    assistRate:
      input.assistProjection != null && (input.expectedMinutes ?? 0) > 0
        ? round(input.assistProjection / Math.max(input.expectedMinutes!, 1), 4)
        : null,
    astToLineRatio:
      input.market === "AST" && input.line > 0
        ? round(input.projectedValue / input.line, 4)
        : null,
    ptsShareOfPRA: praComboState.ptsShareOfPRA,
    rebShareOfPRA: praComboState.rebShareOfPRA,
    astShareOfPRA: praComboState.astShareOfPRA,
    maxLegShareOfCombo: praComboState.maxLegShareOfCombo,
    comboEntropy: praComboState.comboEntropy,
    comboBalanceScore: praComboState.comboBalanceScore,
    ptsLedPRAFlag: praComboState.ptsLedPRAFlag,
    highLinePRAFlag: praComboState.highLinePRAFlag,
    veryHighLinePRAFlag: praComboState.veryHighLinePRAFlag,
    lateSeasonFlag: praComboState.lateSeasonFlag,
    lateSeasonHighLinePRAFlag: praComboState.lateSeasonHighLinePRAFlag,
    guardWingArchetypeFlag: praComboState.guardWingArchetypeFlag,
    ptsLedPRAxGuardWing: praComboState.ptsLedPRAxGuardWing,
    highLinePRAxGuardWing: praComboState.highLinePRAxGuardWing,
    lateSeasonxGuardWing: praComboState.lateSeasonxGuardWing,
    closeGamexGuardWing: praComboState.closeGamexGuardWing,
    ptsLedPRAxCloseGame: praComboState.ptsLedPRAxCloseGame,
    ptsLedPRAxLateSeason: praComboState.ptsLedPRAxLateSeason,
    ptsLedPRAxHighLine: praComboState.ptsLedPRAxHighLine,
  };

  const projectionDistribution = estimateProjectionDistribution(
    input.market,
    archetype,
    minutesBucket,
    input.projectedValue,
    input.line,
  );
  const componentProjectionDistribution = comboComponentMarkets(input.market)
    ? estimateComboComponentProjectionDistribution(
        input.market,
        archetype,
        minutesBucket,
        input.projectedValue,
        input.line,
        loadProjectionDistributionMap(),
      )
    : null;

  const leaf = model.kind === "tree" ? resolveTreeLeaf(model.tree, row) : null;
  const rawSide = applyBucketSideBias(
    input.market,
    archetype,
    row,
    predictVariant(model, row),
    componentProjectionDistribution,
  );
  const projectionWinProbability =
    rawSide === "OVER"
      ? projectionDistribution?.overWinProbability ?? null
      : rawSide === "UNDER"
        ? projectionDistribution?.underWinProbability ?? null
        : null;
  const chosenSideImpliedProbability =
    rawSide === "OVER" ? overProbability : rawSide === "UNDER" ? underProbability : null;
  const projectionPriceEdge =
    projectionWinProbability == null || chosenSideImpliedProbability == null
      ? null
      : round(projectionWinProbability - chosenSideImpliedProbability, 4);

  let decision: RawLiveUniversalModelDecision = {
    market: input.market,
    rawSide,
    finalSide,
    archetype,
    minutesBucket,
    modelKind: model.kind,
    bucketSamples: record.samples ?? null,
    bucketModelAccuracy: record.modelAccuracy ?? null,
    bucketLateAccuracy: record.lateWindowAccuracy ?? null,
    leafCount: leaf?.count ?? null,
    leafAccuracy: leaf?.accuracy ?? null,
    absLineGap: row.absLineGap,
    favoredSide,
    priceLean,
    priceStrength,
    projectionMarketAgreement: row.projectionMarketAgreement,
    overProbability,
    underProbability,
    projectionWinProbability,
    projectionPriceEdge,
    projectionResidualMean: projectionDistribution?.residualMean ?? null,
    projectionResidualStdDev: projectionDistribution?.residualStdDev ?? null,
  };

  decision = applyTreeDisagreementParentBucketFallback(input, decision, runtimeOptions);
  if (!runtimeOptions.disableTreeDisagreementContainment) {
    decision = applyTreeDisagreementContainment(decision);
  }
  return decision;
}

export function inspectLiveUniversalModelSide(input: PredictLiveUniversalSideInput): RawLiveUniversalModelDecision {
  return inspectLiveUniversalModelSideInternal(input);
}

export function inspectLiveUniversalModelSideForArchetype(
  input: PredictLiveUniversalSideInput,
  archetype: Archetype,
): RawLiveUniversalModelDecision {
  return inspectLiveUniversalModelSideInternal(input, archetype);
}

export function qualifyLiveUniversalModelDecision(
  decision: RawLiveUniversalModelDecision,
  settings?: LiveUniversalQualificationSettings,
): LiveUniversalModelDecision {
  const rejectionReasons: string[] = [];
  const activeSettings = settings ?? getActiveLiveUniversalQualificationSettings();
  const thresholds = resolveQualificationThresholds(decision.market, decision.archetype, activeSettings);
  const calibrationKey = buildUniversalResidualCalibrationKey(decision.market, decision.archetype, decision.minutesBucket);
  const calibration = calibrationKey == null ? null : loadCalibrationMap().get(calibrationKey) ?? null;
  const bucketAccuracyAdjustment = calibration?.bucketAccuracyAdjustment ?? 0;
  const leafAccuracyAdjustment = calibration?.leafAccuracyAdjustment ?? 0;

  if (decision.rawSide === "NEUTRAL") {
    rejectionReasons.push("No universal side.");
  }

  const rawBucketRecentAccuracy = decision.bucketLateAccuracy ?? decision.bucketModelAccuracy;
  const bucketRecentAccuracy =
    rawBucketRecentAccuracy == null ? null : Math.round((rawBucketRecentAccuracy + bucketAccuracyAdjustment) * 100) / 100;
  if (bucketRecentAccuracy != null && bucketRecentAccuracy < thresholds.minBucketLateAccuracy) {
    rejectionReasons.push("Bucket recent accuracy below threshold.");
  }
  if (decision.bucketSamples != null && decision.bucketSamples < thresholds.minBucketSamples) {
    rejectionReasons.push("Bucket sample count below threshold.");
  }
  // Calculate bad bucket corrector for PRA archetypes with low leaf accuracy
  // Target the specific bad buckets: SCORE_FIRST_LEAD_GUARD, LEAD_GUARD, WING in PRA market
  const badBucketCorrector =
    decision.leafAccuracy != null &&
    decision.market === "PRA" &&
    decision.archetype != null &&
    BAD_BUCKET_PRA_ARCHETYPES.has(decision.archetype) &&
    decision.leafAccuracy < BAD_BUCKET_PRA_LEAF_THRESHOLD
      ? -3 // Conservative penalty for these historically bad buckets
      : 0;
  const effectiveLeafAccuracy =
    decision.leafAccuracy == null
      ? null
      : Math.round((decision.leafAccuracy + leafAccuracyAdjustment + badBucketCorrector) * 100) / 100;
  if (effectiveLeafAccuracy != null && effectiveLeafAccuracy < thresholds.minLeafAccuracy) {
    rejectionReasons.push("Tree leaf accuracy below threshold.");
  }
  if (decision.leafCount != null && decision.leafCount < thresholds.minLeafCount) {
    rejectionReasons.push("Tree leaf sample count below threshold.");
  }
  if (
    thresholds.minProjectionWinProbability > 0 &&
    decision.projectionWinProbability != null &&
    decision.projectionWinProbability < thresholds.minProjectionWinProbability
  ) {
    rejectionReasons.push("Projection win probability below threshold.");
  }
  if (
    thresholds.minProjectionPriceEdge > 0 &&
    decision.projectionPriceEdge != null &&
    decision.projectionPriceEdge < thresholds.minProjectionPriceEdge
  ) {
    rejectionReasons.push("Projection price edge below threshold.");
  }
  if (JUICE_VETO_THRESHOLD != null && decision.rawSide !== "NEUTRAL") {
    const allowByBucketAccuracy =
      JUICE_VETO_MAX_BUCKET_LATE_ACCURACY == null ||
      bucketRecentAccuracy == null ||
      bucketRecentAccuracy <= JUICE_VETO_MAX_BUCKET_LATE_ACCURACY;
    if (allowByBucketAccuracy) {
      const opposingProbability =
        decision.rawSide === "OVER" ? decision.underProbability : decision.overProbability;
      if (opposingProbability != null && opposingProbability >= JUICE_VETO_THRESHOLD) {
        rejectionReasons.push("Opposing market juice veto.");
      }
    }
  }
  if (shouldApplyPaBenchWingNativeVeto(decision)) {
    rejectionReasons.push("PA | BENCH_WING native regime veto.");
  }
  if (shouldApplyPraScoringGuardCreatorNativeVeto(decision)) {
    rejectionReasons.push("PRA | SCORING_GUARD_CREATOR native regime veto.");
  }
  if (shouldApplyPraPointForwardNativeVeto(decision)) {
    rejectionReasons.push("PRA | POINT_FORWARD native regime veto.");
  }
  if (shouldApplyRaTwoWayMarketWingNativeVeto(decision)) {
    rejectionReasons.push("RA | TWO_WAY_MARKET_WING native regime veto.");
  }

  return {
    ...decision,
    side: rejectionReasons.length === 0 ? decision.rawSide : "NEUTRAL",
    qualified: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

export function evaluateLiveUniversalModelSide(
  input: PredictLiveUniversalSideInput,
  settings?: LiveUniversalQualificationSettings,
): LiveUniversalModelDecision {
  return applyOptionalUniversalBaselineRouterVeto(
    input,
    qualifyLiveUniversalModelDecision(inspectLiveUniversalModelSide(input), settings),
  );
}

export function predictLiveUniversalModelSide(input: PredictLiveUniversalSideInput): SnapshotModelSide {
  return evaluateLiveUniversalModelSide(input).side;
}
