import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  resolveProjectPath,
} from "@/lib/snapshot/universalArtifactPaths";
import {
  buildUniversalResidualCalibrationKey,
  universalMinutesBucket,
  type UniversalMinutesBucket,
  type UniversalResidualCalibrationFile,
  type UniversalResidualCalibrationRecord,
} from "@/lib/snapshot/universalResidualCalibration";
import type { SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

type Side = "OVER" | "UNDER";
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
  | "BENCH_GUARD"
  | "BENCH_WING"
  | "BENCH_SCORING_WING"
  | "BENCH_LOW_USAGE_WING"
  | "BENCH_MIDRANGE_SCORER"
  | "BENCH_VOLUME_SCORER"
  | "BENCH_CREATOR_SCORER"
  | "BENCH_REBOUNDING_SCORER"
  | "BENCH_SPACER_SCORER"
  | "BENCH_BIG"
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
  | "expectedMinutes"
  | "minutesVolatility"
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
  | "astToLineRatio";

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

type ModelVariant =
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "constant"; side: Side }
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "strongPriceThenMarket"; threshold: number }
  | { kind: "nearLineThenMarket"; threshold: number }
  | { kind: "agreementThenProjection"; threshold: number }
  | { kind: "favoriteOverSuppress"; spreadThreshold: number; gapThreshold: number }
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

type LiveUniversalQualificationThresholds = {
  minBucketLateAccuracy: number;
  minBucketSamples: number;
  minLeafAccuracy: number;
  minLeafCount: number;
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
  archetype: Archetype | null;
  minutesBucket: UniversalMinutesBucket | null;
  modelKind: ModelVariant["kind"] | null;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
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
  expectedMinutes: number | null;
  minutesVolatility: number | null;
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
};

type PredictLiveUniversalSideInput = {
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  finalSide: SnapshotModelSide;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
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

const DEFAULT_MODEL_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
const DEFAULT_MODEL_FALLBACK_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
const DEFAULT_CALIBRATION_FILE = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);

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

export const DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS: LiveUniversalQualificationSettings = {
  minBucketLateAccuracy: 56,
  minBucketSamples: 0,
  minLeafAccuracy: 67,
  minLeafCount: 0,
  marketOverrides: {
    PTS: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 58,
      minLeafCount: 0,
    },
    REB: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 60,
      minLeafCount: 0,
    },
    AST: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 58,
      minLeafCount: 0,
    },
    THREES: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 60,
      minLeafCount: 0,
    },
    PRA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 58,
      minLeafCount: 0,
    },
    PA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 61,
      minLeafCount: 0,
    },
    PR: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 60,
      minLeafCount: 0,
    },
    RA: {
      minBucketLateAccuracy: 56,
      minBucketSamples: 0,
      minLeafAccuracy: 62,
      minLeafCount: 0,
    },
  },
};

let cachedModelMap: Map<string, UniversalModelRecord> | null = null;
let cachedCalibrationMap: Map<string, UniversalResidualCalibrationRecord> | null = null;

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
  };
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
    const payload = JSON.parse(fs.readFileSync(modelFilePath, "utf8")) as UniversalModelFile;
    for (const record of payload.models ?? []) {
      map.set(`${record.market}|${record.archetype}`, record);
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
    const payload = JSON.parse(fs.readFileSync(calibrationFilePath, "utf8")) as UniversalResidualCalibrationFile;
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

function classifyBenchArchetype(input: {
  playerPosition: string | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
}): Archetype {
  const position = (input.playerPosition ?? "").toUpperCase();
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  if (position.includes("C") || reb >= 7.5) return "BENCH_BIG";
  if (ast >= 4 || position.includes("PG") || position === "G") return "BENCH_GUARD";
  if (
    (position.includes("SG") || position.includes("SF") || position.includes("PF") || position === "F") &&
    (pts >= 16 || threes >= 1.8)
  ) {
    if (ast >= 3.2) return "BENCH_CREATOR_SCORER";
    if (reb >= 5.2) return "BENCH_REBOUNDING_SCORER";
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
    if (reb >= 5.2) return "BENCH_REBOUNDING_SCORER";
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  if (ast >= reb && ast >= 3.5) return "BENCH_GUARD";
  if (reb >= pts && reb >= ast) return "BENCH_BIG";
  if (pts >= reb && pts >= ast) {
    if (ast >= 3.2) return "BENCH_CREATOR_SCORER";
    if (reb >= 5.2) return "BENCH_REBOUNDING_SCORER";
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  return "LOW_MINUTE_BENCH";
}

function classifyArchetype(input: {
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

  if (minutes < 24 || starterRate < 0.35) {
    return classifyBenchArchetype({
      playerPosition: input.playerPosition,
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
  if (ast >= 3.4 || reb >= 5.6) return "CONNECTOR_WING";
  if (pts >= 15 || threes >= 2) return "SPOTUP_WING";
  return "WING";
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
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
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

export function inspectLiveUniversalModelSide(input: PredictLiveUniversalSideInput): RawLiveUniversalModelDecision {
  const archetypeMinutes = input.archetypeExpectedMinutes ?? input.expectedMinutes;
  const minutesBucket = universalMinutesBucket(archetypeMinutes);
  if (input.projectedValue == null || input.line == null) {
    return {
      market: input.market,
      rawSide: "NEUTRAL",
      archetype: null,
      minutesBucket: null,
      modelKind: null,
      bucketSamples: null,
      bucketModelAccuracy: null,
      bucketLateAccuracy: null,
      leafCount: null,
      leafAccuracy: null,
    };
  }

  const archetype = classifyArchetype({
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
  });
  const record = loadModelMap().get(`${input.market}|${archetype}`);
  if (!record) {
    return {
      market: input.market,
      rawSide: "NEUTRAL",
      archetype,
      minutesBucket,
      modelKind: null,
      bucketSamples: null,
      bucketModelAccuracy: null,
      bucketLateAccuracy: null,
      leafCount: null,
      leafAccuracy: null,
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
  const row: LiveUniversalModelRow = {
    projectedValue: input.projectedValue,
    line: input.line,
    overPrice: input.overPrice,
    underPrice: input.underPrice,
    projectionSide,
    finalSide,
    favoredSide,
    priceLean,
    expectedMinutes: input.expectedMinutes,
    minutesVolatility: input.minutesVolatility,
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
    openingSpreadAbs:
      input.openingTeamSpread == null ? null : round(Math.abs(input.openingTeamSpread), 3),
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
  };

  const leaf = model.kind === "tree" ? resolveTreeLeaf(model.tree, row) : null;

  return {
    market: input.market,
    rawSide: predictVariant(model, row),
    archetype,
    minutesBucket,
    modelKind: model.kind,
    bucketSamples: record.samples ?? null,
    bucketModelAccuracy: record.modelAccuracy ?? null,
    bucketLateAccuracy: record.lateWindowAccuracy ?? null,
    leafCount: leaf?.count ?? null,
    leafAccuracy: leaf?.accuracy ?? null,
  };
}

export function qualifyLiveUniversalModelDecision(
  decision: RawLiveUniversalModelDecision,
  settings: LiveUniversalQualificationSettings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
): LiveUniversalModelDecision {
  const rejectionReasons: string[] = [];
  const thresholds = resolveQualificationThresholds(decision.market, decision.archetype, settings);
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
  const effectiveLeafAccuracy =
    decision.leafAccuracy == null ? null : Math.round((decision.leafAccuracy + leafAccuracyAdjustment) * 100) / 100;
  if (effectiveLeafAccuracy != null && effectiveLeafAccuracy < thresholds.minLeafAccuracy) {
    rejectionReasons.push("Tree leaf accuracy below threshold.");
  }
  if (decision.leafCount != null && decision.leafCount < thresholds.minLeafCount) {
    rejectionReasons.push("Tree leaf sample count below threshold.");
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
  settings: LiveUniversalQualificationSettings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
): LiveUniversalModelDecision {
  return qualifyLiveUniversalModelDecision(inspectLiveUniversalModelSide(input), settings);
}

export function predictLiveUniversalModelSide(input: PredictLiveUniversalSideInput): SnapshotModelSide {
  return evaluateLiveUniversalModelSide(input).side;
}
