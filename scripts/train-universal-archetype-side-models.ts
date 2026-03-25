import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { buildPRAComboState } from "../lib/snapshot/praComboState";
import { gateShapeNumber, shouldExposeShapeContext } from "../lib/snapshot/shapeRegime";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type Archetype =
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

const ENABLE_BENCH_BIG_ROLE_STABILITY = process.env.SNAPSHOT_ENABLE_BENCH_BIG_ROLE_STABILITY?.trim() === "1";
const ENABLE_CURRENT_LINE_MOMENTUM = process.env.SNAPSHOT_ENABLE_CURRENT_LINE_MOMENTUM?.trim() === "1";
const ENABLE_L5_MARKET_MOMENTUM = process.env.SNAPSHOT_ENABLE_L5_MARKET_MOMENTUM?.trim() === "1";
const SHAPE_SPECIALIZATION_MODE =
  process.env.SNAPSHOT_SHAPE_SPECIALIZATION_MODE?.trim().toLowerCase() === "off" ? "off" : "targeted";
const L5_MOMENTUM_RHYTHM_MARKETS = new Set<Market>(["PTS", "THREES", "PRA"]);
const ENABLE_L5_CREATOR_FAMILY = process.env.SNAPSHOT_ENABLE_L5_CREATOR_FAMILY?.trim() === "1";
const L5_CREATOR_ARCHETYPE_FAMILY = new Set<Archetype>([
  "LEAD_GUARD",
  "SCORE_FIRST_LEAD_GUARD",
  "ELITE_SHOOTING_GUARD",
  "SCORING_GUARD_CREATOR",
  "POINT_FORWARD",
  "TWO_WAY_MARKET_WING",
  "SCORER_CREATOR_WING",
  "SHOT_CREATING_WING",
]);
const L5_CREATOR_WORKLOAD_STABILITY_THRESHOLD = 4;
const ENABLE_L5_CREATOR_ALLOWLIST = process.env.SNAPSHOT_ENABLE_L5_CREATOR_ALLOWLIST?.trim() === "1";
const L5_CREATOR_ALLOWLIST = new Set([
  "AST|SCORE_FIRST_LEAD_GUARD",
  "PA|ELITE_SHOOTING_GUARD",
  "PA|SCORING_GUARD_CREATOR",
  "PRA|POINT_FORWARD",
  "PRA|TWO_WAY_MARKET_WING",
  "PR|SCORING_GUARD_CREATOR",
  "PR|ELITE_SHOOTING_GUARD",
]);
const ENABLE_BIG_MAN_SPECIALIST_SEARCH =
  process.env.SNAPSHOT_ENABLE_BIG_MAN_SPECIALIST_SEARCH?.trim() === "1" ||
  process.env.SNAPSHOT_ENABLE_BIG_MAN_SPECIALIST_SEARCH?.trim()?.toLowerCase() === "true";
const BIG_MAN_ARCHETYPE_SET = new Set<Archetype>([
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "BENCH_TRADITIONAL_BIG",
  "BENCH_STRETCH_BIG",
  "BENCH_LOW_USAGE_BIG",
]);
const BIG_MAN_SPECIALIST_MARKET_SET = new Set<Market>(["REB", "RA", "PR", "PRA", "PA", "PTS"]);
const ENABLE_WING_SPECIALIST_SEARCH =
  process.env.SNAPSHOT_ENABLE_WING_SPECIALIST_SEARCH?.trim() === "1" ||
  process.env.SNAPSHOT_ENABLE_WING_SPECIALIST_SEARCH?.trim()?.toLowerCase() === "true";
const WING_SPECIALIST_ARCHETYPE_SET = new Set<Archetype>([
  "SPOTUP_WING",
  "BENCH_WING",
  "CONNECTOR_WING",
  "SCORING_GUARD_CREATOR",
  "POINT_FORWARD",
  "TWO_WAY_MARKET_WING",
]);
const WING_SPECIALIST_MARKET_SET = new Set<Market>(["PRA", "PA", "PTS", "THREES", "RA"]);
const RECENCY_PRIORITY_MARKETS = new Set<Market>(["PTS", "REB", "AST", "PRA", "PA", "PR", "RA"]);
const RECENCY_PRIORITY_ARCHETYPES = new Set<Archetype>([
  "BENCH_CREATOR_SCORER",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_SPACER_SCORER",
  "BENCH_VOLUME_SCORER",
  "BENCH_PASS_FIRST_GUARD",
  "BENCH_LOW_USAGE_WING",
  "SCORE_FIRST_LEAD_GUARD",
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "CONNECTOR_WING",
]);

const USAGE_CONTEXT_PRIORITY_MARKETS = new Set<Market>(["PTS", "AST", "PRA", "PA", "PR", "RA"]);
const USAGE_CONTEXT_PRIORITY_ARCHETYPES = new Set<Archetype>([
  "SCORE_FIRST_LEAD_GUARD",
  "SCORING_GUARD_CREATOR",
  "POINT_FORWARD",
  "BENCH_CREATOR_SCORER",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_SPACER_SCORER",
  "BENCH_VOLUME_SCORER",
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
]);

const SHAPE_PRIORITY_MARKETS = new Set<Market>(["PRA", "PR"]);
const SHAPE_PRIORITY_ARCHETYPES = new Set<Archetype>([
  "MARKET_SHAPED_SCORING_WING",
  "HELIOCENTRIC_GUARD",
  "POINT_FORWARD",
  "BENCH_PASS_FIRST_GUARD",
  "SCORING_GUARD_CREATOR",
]);
const SHAPE_PRIORITY_FEATURES: FeatureName[] = [
  "l15ValueSkew",
  "projectionMedianDelta",
  "competitivePaceFactor",
  "blowoutRisk",
];
const MEDIAN_AWARE_BLOCKED_FEATURES = new Set<FeatureName>([
  "lineGap",
  "absLineGap",
  "projectedValue",
  "projectionPerMinute",
  "projectionToLineRatio",
  "projectionMarketAgreement",
  "comboGapPressure",
]);
// Targeted PRA combo features - only for specific bad buckets (SCORE_FIRST_LEAD_GUARD, LEAD_GUARD, WING)
// Using orthogonal subset instead of all 18 features to avoid overfitting
const PRA_COMBO_STATE_BUCKETS = new Set([
  "PRA|SCORE_FIRST_LEAD_GUARD",
  "PRA|LEAD_GUARD",
  "PRA|WING",
]);

// Smaller orthogonal subset - avoid cross-interactions and redundant share features
const PRA_COMBO_STATE_FEATURES: FeatureName[] = [
  "guardWingArchetypeFlag",
  "closeGameFlag",
  "lateSeasonFlag",
  "highLinePRAFlag",
];

function isRecencyPriorityBucket(market: Market, archetype: Archetype): boolean {
  return RECENCY_PRIORITY_MARKETS.has(market) || RECENCY_PRIORITY_ARCHETYPES.has(archetype);
}

function isUsageContextPriorityBucket(market: Market, archetype: Archetype): boolean {
  return USAGE_CONTEXT_PRIORITY_MARKETS.has(market) || USAGE_CONTEXT_PRIORITY_ARCHETYPES.has(archetype);
}

function isShapePriorityBucket(market: Market, archetype: Archetype): boolean {
  if (SHAPE_SPECIALIZATION_MODE === "off") return false;
  return SHAPE_PRIORITY_MARKETS.has(market) && SHAPE_PRIORITY_ARCHETYPES.has(archetype);
}

function isMedianAwareBucket(market: Market, archetype: Archetype): boolean {
  return isShapePriorityBucket(market, archetype);
}

function isBigManArchetype(archetype: Archetype): boolean {
  return BIG_MAN_ARCHETYPE_SET.has(archetype);
}

function isBigManSpecialistBucket(archetype: Archetype, market: Market): boolean {
  return ENABLE_BIG_MAN_SPECIALIST_SEARCH && isBigManArchetype(archetype) && BIG_MAN_SPECIALIST_MARKET_SET.has(market);
}

function isWingSpecialistBucket(archetype: Archetype, market: Market): boolean {
  return ENABLE_WING_SPECIALIST_SEARCH && WING_SPECIALIST_ARCHETYPE_SET.has(archetype) && WING_SPECIALIST_MARKET_SET.has(market);
}

function dedupeFeatures(features: FeatureName[]): FeatureName[] {
  const seen = new Set<FeatureName>();
  const result: FeatureName[] = [];
  features.forEach((feature) => {
    if (seen.has(feature)) return;
    seen.add(feature);
    result.push(feature);
  });
  return result;
}

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  projectionSide: Side;
  finalSide: Side;
  actualSide: Side;
  projectionCorrect: boolean;
  finalCorrect: boolean;
  priceLean: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL";
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
  starterRateLast10: number | null;
  benchBigRoleStability?: number | null;
  l5MarketDeltaAvg?: number | null;
  l5OverRate?: number | null;
  l5MinutesAvg?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  emaCurrentLineDelta?: number | null;
  emaCurrentLineOverRate?: number | null;
  emaMinutesAvg?: number | null;
  l15ValueMean?: number | null;
  l15ValueMedian?: number | null;
  l15ValueStdDev?: number | null;
  l15ValueSkew?: number | null;
  actualMinutes: number;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type PlayerMeta = {
  id: string;
  fullName: string | null;
  position: string | null;
};

type PlayerSummary = {
  playerId: string;
  playerName: string;
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

type EnrichedRow = TrainingRow & {
  archetype: Archetype;
  projectionPerMinute: number | null;
  projectionToLineRatio: number | null;
  lineTier: number | null;
  priceStrength: number | null;
  contextQuality: number | null;
  roleStability: number | null;
  projectionMarketAgreement: number | null;
  minutesShiftDelta: number | null;
  minutesShiftAbsDelta: number | null;
  l15ValueMean: number | null;
  l15ValueMedian: number | null;
  l15ValueStdDev: number | null;
  l15ValueSkew: number | null;
  projectionMedianDelta: number | null;
  medianLineGap: number | null;
  competitivePaceFactor: number | null;
  blowoutRisk: number | null;
  seasonMinutesAvg: number | null;
  minutesLiftPct: number | null;
  activeCorePts: number | null;
  activeCoreAst: number | null;
  missingCorePts: number | null;
  missingCoreAst: number | null;
  missingCoreShare: number | null;
  stepUpRoleFlag: number | null;
  openingSpreadAbs: number | null;
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

type FeatureName =
  | "lineGap"
  | "absLineGap"
  | "expectedMinutes"
  | "minutesVolatility"
  | "benchBigRoleStability"
  | "l5CurrentLineDeltaAvg"
  | "l5CurrentLineOverRate"
  | "l5MarketDeltaAvg"
  | "l5OverRate"
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
  count: number;
  accuracy: number;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
  count: number;
  accuracy: number;
  left: TreeNode;
  right: TreeNode;
};

type TreeNode = LeafNode | SplitNode;

type ModelVariant =
  | { kind: "projection" }
  | { kind: "finalOverride" }
  | { kind: "marketFavored" }
  | { kind: "constant"; side: Side }
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

type ModelScore = {
  accuracy: number;
  correct: number;
  wrong: number;
};

type UniversalModelRecord = {
  market: Market;
  archetype: Archetype;
  samples: number;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  lateWindowAccuracy: number | null;
  selectionTrainAccuracy?: number | null;
  selectionHoldoutAccuracy?: number | null;
  selectionStrategy?: ModelSelectionStrategy;
  model: ModelVariant;
};

type CandidateEvaluation = {
  selectionScore: ModelScore;
  fitScore: ModelScore;
  model: ModelVariant;
};

type ModelSelectionStrategy = "in_sample" | "temporal_holdout";

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  maxDepth: number;
  lateWindowRatio: number;
  selectionStrategy: ModelSelectionStrategy;
  debugMarket?: Market;
  debugArchetype?: Archetype;
  debugTop: number;
};

const prisma = new PrismaClient();
const SIMPLE_BASELINE_KINDS: ReadonlySet<ModelVariant["kind"]> = new Set(["projection", "finalOverride", "marketFavored"]);
const TEMPORAL_FIT_COLLAPSE_FALLBACK_DELTA = 8;
const TEMPORAL_HOLDOUT_EDGE_TO_KEEP_COMPLEX_MODEL = 6;
const TEMPORAL_BAD_HOLDOUT_FLOOR = 50;
const TEMPORAL_BAD_HOLDOUT_ANCHOR_MARGIN = 2;
const TEMPORAL_CONSTANT_HOLDOUT_GIVEBACK = 7;
const TEMPORAL_CONSTANT_FIT_EDGE_FOR_FALLBACK = 6;
const TEMPORAL_BENCH_SPACER_PRA_HOLDOUT_GIVEBACK = 4;
const TEMPORAL_BENCH_SPACER_PRA_FIT_EDGE_FOR_FALLBACK = 2;
const TEMPORAL_STRETCH_BIG_PRA_HOLDOUT_GIVEBACK = 1;
const TEMPORAL_STRETCH_BIG_PRA_FIT_EDGE_FOR_FALLBACK = 8;
const TEMPORAL_STRETCH_BIG_PR_HOLDOUT_GIVEBACK = 8;
const TEMPORAL_STRETCH_BIG_PR_FIT_EDGE_FOR_FALLBACK = 12;
const TEMPORAL_SPOTUP_WING_PR_HOLDOUT_GIVEBACK = 2;
const TEMPORAL_SPOTUP_WING_PR_FIT_EDGE_FOR_FALLBACK = 4;
const ENABLE_TARGETED_CONSTANT_TRAP_FALLBACKS =
  process.env.SNAPSHOT_DISABLE_TARGETED_CONSTANT_TRAP_FALLBACKS?.trim() !== "1";
const ENABLE_MISSING_POSITION_STARTER_FALLBACK =
  process.env.SNAPSHOT_DISABLE_MISSING_POSITION_STARTER_FALLBACK?.trim() !== "1";

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "universal-archetype-side-models-2025-10-23-to-2026-03-09.json");
  let minActualMinutes = 15;
  let maxDepth = 6;
  let lateWindowRatio = 0.3;
  let selectionStrategy: ModelSelectionStrategy = "in_sample";
  let debugMarket: Market | undefined;
  let debugArchetype: Archetype | undefined;
  let debugTop = 10;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
    if (token === "--max-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) maxDepth = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-depth=")) {
      const parsed = Number(token.slice("--max-depth=".length));
      if (Number.isFinite(parsed) && parsed >= 0) maxDepth = Math.floor(parsed);
      continue;
    }
    if (token === "--late-window-ratio" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) lateWindowRatio = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--late-window-ratio=")) {
      const parsed = Number(token.slice("--late-window-ratio=".length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) lateWindowRatio = parsed;
      continue;
    }
    if (token === "--selection-strategy" && next) {
      if (next === "in_sample" || next === "temporal_holdout") selectionStrategy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--selection-strategy=")) {
      const value = token.slice("--selection-strategy=".length);
      if (value === "in_sample" || value === "temporal_holdout") selectionStrategy = value;
      continue;
    }
    if (token === "--debug-market" && next) {
      if (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"].includes(next)) {
        debugMarket = next as Market;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--debug-market=")) {
      const value = token.slice("--debug-market=".length);
      if (["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"].includes(value)) {
        debugMarket = value as Market;
      }
      continue;
    }
    if (token === "--debug-archetype" && next) {
      debugArchetype = next as Archetype;
      index += 1;
      continue;
    }
    if (token.startsWith("--debug-archetype=")) {
      debugArchetype = token.slice("--debug-archetype=".length) as Archetype;
      continue;
    }
    if (token === "--debug-top" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) debugTop = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--debug-top=")) {
      const parsed = Number(token.slice("--debug-top=".length));
      if (Number.isFinite(parsed) && parsed > 0) debugTop = Math.floor(parsed);
      continue;
    }
  }

  return { input, out, minActualMinutes, maxDepth, lateWindowRatio, selectionStrategy, debugMarket, debugArchetype, debugTop };
}

function impliedProbability(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds < 0) {
    const abs = Math.abs(odds);
    return abs / (abs + 100);
  }
  return 100 / (odds + 100);
}

function mean(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, 3);
}

function resolveBenchReboundingScorerArchetype(summary: PlayerSummary, market?: Market): Archetype {
  if (
    market === "PTS" &&
    !summary.position &&
    (summary.avgExpectedMinutes ?? 0) >= 20 &&
    (summary.avgStarterRate ?? 0) <= 0.3 &&
    (summary.ptsProjectionAvg ?? 0) >= 12 &&
    (summary.rebProjectionAvg ?? 0) >= 5.2 &&
    (summary.rebProjectionAvg ?? 0) <= 6.4 &&
    (summary.astProjectionAvg ?? 0) < 3.2 &&
    (summary.threesProjectionAvg ?? 0) <= 1.2
  ) {
    return "BENCH_VOLUME_SCORER";
  }
  return "BENCH_REBOUNDING_SCORER";
}

function shouldUsePositionlessStarterArchetype(summary: PlayerSummary): boolean {
  if (!ENABLE_MISSING_POSITION_STARTER_FALLBACK) return false;
  if (summary.position) return false;
  const minutes = summary.avgExpectedMinutes ?? 0;
  const starterRate = summary.avgStarterRate ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

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

function classifyPositionlessStarterArchetype(summary: PlayerSummary): Archetype {
  const minutes = summary.avgExpectedMinutes ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes >= 26 && reb >= 9 && (threes >= 1.5 || pts >= 20)) {
    return "STRETCH_RIM_PROTECTOR_CENTER";
  }
  if (minutes >= 31 && threes >= 2 && pts >= 16.5 && ast >= 3.4 && ast <= 5.5 && (reb >= 5 || ast >= 3.8)) {
    return "CONNECTOR_WING";
  }
  return "CENTER";
}

function classifyBenchArchetype(summary: PlayerSummary, market?: Market): Archetype {
  const position = (summary.position ?? "").toUpperCase();
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

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
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(summary, market);
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
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(summary, market);
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
    if (reb >= 5.2) return resolveBenchReboundingScorerArchetype(summary, market);
    if (threes >= 1.9 || pts >= 15.5) return "BENCH_SPACER_SCORER";
    if (pts < 10 && threes < 1.0) return "BENCH_LOW_USAGE_WING";
    if (pts >= 10 && threes < 1.3) return "BENCH_MIDRANGE_SCORER";
    return "BENCH_VOLUME_SCORER";
  }
  return "LOW_MINUTE_BENCH";
}

function classifyArchetype(summary: PlayerSummary, market?: Market): Archetype {
  const minutes = summary.avgExpectedMinutes ?? 0;
  const starterRate = summary.avgStarterRate ?? 0;
  const position = (summary.position ?? "").toUpperCase();
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;
  const usePositionlessStarterArchetype = shouldUsePositionlessStarterArchetype(summary);

  if (minutes < 24 || (starterRate < 0.35 && !usePositionlessStarterArchetype)) {
    return classifyBenchArchetype(summary, market);
  }
  if (!position && usePositionlessStarterArchetype) {
    return classifyPositionlessStarterArchetype(summary);
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
  if ((position.includes("PG") || position.includes("SG") || position === "G") && minutes >= 32 && pts >= 24 && ast >= 7) {
    return "HELIOCENTRIC_GUARD";
  }
  if (minutes >= 34 && pts >= 25 && ast >= 7.5 && !position.includes("C")) {
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
    market === "PR" &&
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

function lineTier(market: Market, line: number): number | null {
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

function getFeature(row: EnrichedRow, feature: FeatureName): number | null {
  const creatorFamilyMomentumBlocked =
    ENABLE_L5_CREATOR_FAMILY &&
    L5_CREATOR_ARCHETYPE_FAMILY.has(row.archetype) &&
    row.expectedMinutes != null &&
    row.l5MinutesAvg != null &&
    Math.abs(row.expectedMinutes - row.l5MinutesAvg) > L5_CREATOR_WORKLOAD_STABILITY_THRESHOLD;

  switch (feature) {
    case "lineGap":
      return row.lineGap;
    case "absLineGap":
      return row.absLineGap;
    case "expectedMinutes":
      return row.expectedMinutes;
    case "minutesVolatility":
      return row.minutesVolatility;
    case "benchBigRoleStability":
      return row.benchBigRoleStability ?? null;
    case "l5CurrentLineDeltaAvg":
      if (creatorFamilyMomentumBlocked) return null;
      return row.l5CurrentLineDeltaAvg ?? null;
    case "l5CurrentLineOverRate":
      if (creatorFamilyMomentumBlocked) return null;
      return row.l5CurrentLineOverRate ?? null;
    case "l5MarketDeltaAvg":
      if (creatorFamilyMomentumBlocked) return null;
      return row.l5MarketDeltaAvg ?? null;
    case "l5OverRate":
      if (creatorFamilyMomentumBlocked) return null;
      return row.l5OverRate ?? null;
    case "l5MinutesAvg":
      if (creatorFamilyMomentumBlocked) return null;
      return row.l5MinutesAvg ?? null;
    case "emaCurrentLineDelta":
      return row.emaCurrentLineDelta ?? null;
    case "emaCurrentLineOverRate":
      return row.emaCurrentLineOverRate ?? null;
    case "emaMinutesAvg":
      return row.emaMinutesAvg ?? null;
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

function scoreSide(rows: EnrichedRow[], sideSelector: (row: EnrichedRow) => Side): ModelScore {
  let correct = 0;
  let wrong = 0;
  rows.forEach((row) => {
    if (sideSelector(row) === row.actualSide) correct += 1;
    else wrong += 1;
  });
  return {
    accuracy: correct + wrong > 0 ? round((correct / (correct + wrong)) * 100, 2) : 0,
    correct,
    wrong,
  };
}

function scorePredictedRows(rows: Array<{ actualSide: Side; predicted: Side }>): ModelScore {
  let correct = 0;
  let wrong = 0;
  rows.forEach((row) => {
    if (row.predicted === row.actualSide) correct += 1;
    else wrong += 1;
  });
  return {
    accuracy: correct + wrong > 0 ? round((correct / (correct + wrong)) * 100, 2) : 0,
    correct,
    wrong,
  };
}

function majoritySide(rows: EnrichedRow[]): Side {
  let over = 0;
  let under = 0;
  rows.forEach((row) => {
    if (row.actualSide === "OVER") over += 1;
    else under += 1;
  });
  return over >= under ? "OVER" : "UNDER";
}

function leafFromRows(rows: EnrichedRow[]): LeafNode {
  const side = majoritySide(rows);
  const score = scoreSide(rows, () => side);
  return {
    kind: "leaf",
    side,
    count: rows.length,
    accuracy: score.accuracy,
  };
}

function featuresForMarket(market: Market, archetype: Archetype): FeatureName[] {
  if (isBigManSpecialistBucket(archetype, market)) {
    const baseBigFeatures: FeatureName[] = [
      "expectedMinutes",
      "minutesVolatility",
      "starterRateLast10",
      "roleStability",
      "contextQuality",
      "lineGap",
      "absLineGap",
      "projectedValue",
      "projectionPerMinute",
      "projectionToLineRatio",
      "priceLean",
      "priceAbsLean",
      "priceStrength",
      "projectionMarketAgreement",
      "openingTotal",
      "openingSpreadAbs",
      "lineupTimingConfidence",
      "completenessScore",
      "overProbability",
      "underProbability",
    ];
    if (ENABLE_BENCH_BIG_ROLE_STABILITY) baseBigFeatures.push("benchBigRoleStability");

    if (market === "REB") {
      return dedupeFeatures([
        "line",
        "overPrice",
        "underPrice",
        ...baseBigFeatures,
      ]);
    }
    if (market === "RA") {
      return dedupeFeatures([
        "comboGapPressure",
        ...baseBigFeatures,
      ]);
    }
    if (market === "PRA" || market === "PR" || market === "PA") {
      return dedupeFeatures([
        "comboGapPressure",
        ...baseBigFeatures,
      ]);
    }
    if (market === "PTS") {
      return dedupeFeatures([
        "overPrice",
        "underPrice",
        "line",
        ...baseBigFeatures,
      ]);
    }
  }

  if (archetype === "BENCH_CREATOR_SCORER") {
    if (market === "PTS") {
      return ["priceLean", "underPrice", "expectedMinutes", "lineGap", "absLineGap", "minutesVolatility", "projectedValue", "overProbability"];
    }
    if (market === "REB") {
      return ["lineGap", "expectedMinutes", "priceAbsLean", "line", "minutesVolatility", "underProbability", "overPrice"];
    }
    if (market === "AST") {
      return [
        "projectedValue",
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "expectedMinutes",
        "underProbability",
        "overPrice",
        "priceLean",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["lineGap", "absLineGap", "expectedMinutes", "minutesVolatility", "priceLean", "overPrice", "line", "lineTier"];
    }
    if (market === "PRA" || market === "PA" || market === "PR") {
      return ["lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "priceLean", "absLineGap", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["overProbability", "lineGap", "expectedMinutes", "minutesVolatility", "absLineGap", "priceLean", "projectedValue"];
    }
  }
  if (archetype === "BENCH_REBOUNDING_SCORER") {
    if (market === "PTS") {
      return ["expectedMinutes", "lineGap", "absLineGap", "projectedValue", "priceLean", "minutesVolatility", "underProbability"];
    }
    if (market === "REB") {
      return ["lineGap", "expectedMinutes", "line", "projectedValue", "priceAbsLean", "minutesVolatility", "overPrice", "underProbability"];
    }
    if (market === "AST") {
      return [
        "underProbability",
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "priceLean",
        "absLineGap",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["absLineGap", "expectedMinutes", "minutesVolatility", "priceLean", "lineGap", "line", "lineTier"];
    }
    if (market === "PRA" || market === "PR") {
      return ["lineGap", "expectedMinutes", "projectedValue", "priceLean", "absLineGap", "minutesVolatility", "comboGapPressure"];
    }
    if (market === "PA") {
      return ["lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "absLineGap", "priceLean", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["lineGap", "expectedMinutes", "projectedValue", "absLineGap", "minutesVolatility", "priceLean", "comboGapPressure"];
    }
  }
  if (archetype === "BENCH_SPACER_SCORER") {
    if (market === "PTS") {
      return ["priceLean", "expectedMinutes", "projectedValue", "lineGap", "absLineGap", "underPrice", "priceAbsLean", "overProbability"];
    }
    if (market === "REB") {
      return ["underProbability", "lineGap", "expectedMinutes", "line", "priceAbsLean", "minutesVolatility", "overPrice"];
    }
    if (market === "AST") {
      return [
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "absLineGap",
        "underProbability",
        "priceLean",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["priceLean", "overPrice", "lineGap", "absLineGap", "expectedMinutes", "minutesVolatility", "line", "lineTier", "projectionToLineRatio"];
    }
    if (market === "PRA" || market === "PA" || market === "PR") {
      return ["lineGap", "expectedMinutes", "priceLean", "absLineGap", "projectedValue", "minutesVolatility", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["lineGap", "absLineGap", "expectedMinutes", "minutesVolatility", "priceLean", "overProbability", "projectedValue"];
    }
  }
  if (archetype === "TWO_WAY_MARKET_WING") {
    if (market === "PTS") {
      return ["priceLean", "expectedMinutes", "projectedValue", "lineGap", "absLineGap", "underProbability", "overPrice", "priceAbsLean"];
    }
    if (market === "REB") {
      return ["expectedMinutes", "lineGap", "line", "priceAbsLean", "minutesVolatility", "overPrice", "underProbability"];
    }
    if (market === "AST") {
      return [
        "underProbability",
        "overPrice",
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "priceLean",
        "absLineGap",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["absLineGap", "lineGap", "minutesVolatility", "expectedMinutes", "priceLean", "overPrice", "line", "lineTier"];
    }
    if (market === "PRA") {
      return ["expectedMinutes", "lineGap", "absLineGap", "priceLean", "projectedValue", "minutesVolatility", "comboGapPressure"];
    }
    if (market === "PA") {
      return ["overPrice", "lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "absLineGap", "comboGapPressure"];
    }
    if (market === "PR") {
      return ["priceAbsLean", "lineGap", "expectedMinutes", "priceLean", "projectedValue", "minutesVolatility", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["lineGap", "expectedMinutes", "absLineGap", "priceLean", "minutesVolatility", "projectedValue", "overProbability"];
    }
  }
  if (archetype === "SCORER_CREATOR_WING") {
    if (market === "PTS") {
      return ["priceLean", "overProbability", "underPrice", "expectedMinutes", "projectedValue", "lineGap", "absLineGap", "line"];
    }
    if (market === "REB") {
      return ["line", "expectedMinutes", "lineGap", "priceAbsLean", "overPrice", "absLineGap", "minutesVolatility"];
    }
    if (market === "AST") {
      return [
        "projectedValue",
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "expectedMinutes",
        "underProbability",
        "overPrice",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["priceLean", "absLineGap", "lineGap", "expectedMinutes", "minutesVolatility", "overPrice", "line", "lineTier"];
    }
    if (market === "PRA" || market === "PA" || market === "PR") {
      return ["lineGap", "absLineGap", "expectedMinutes", "priceLean", "projectedValue", "minutesVolatility", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["expectedMinutes", "lineGap", "absLineGap", "minutesVolatility", "projectedValue", "priceLean", "overProbability"];
    }
  }
  if (archetype === "JUMBO_CREATOR_GUARD") {
    if (market === "PTS") {
      return [
        "priceLean",
        "projectedValue",
        "expectedMinutes",
        "underPrice",
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "overProbability",
        "underProbability",
        "priceAbsLean",
      ];
    }
    if (market === "REB") {
      return ["lineGap", "expectedMinutes", "priceAbsLean", "line", "minutesVolatility", "overPrice", "underPrice"];
    }
    if (market === "AST") {
      return [
        "overPrice",
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "priceLean",
        "absLineGap",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["lineGap", "absLineGap", "expectedMinutes", "minutesVolatility", "priceLean", "overPrice", "line", "lineTier"];
    }
    if (market === "PRA" || market === "PA") {
      return [
        "minutesVolatility",
        "expectedMinutes",
        "lineGap",
        "projectedValue",
        "absLineGap",
        "priceLean",
        "comboGapPressure",
      ];
    }
    if (market === "PR") {
      return [
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "priceLean",
        "absLineGap",
        "comboGapPressure",
      ];
    }
    if (market === "RA") {
      return ["absLineGap", "lineGap", "expectedMinutes", "minutesVolatility", "priceLean", "projectedValue", "overProbability"];
    }
  }
  if (archetype === "MARKET_SHAPED_SCORING_WING") {
    if (market === "PTS") {
      return ["overProbability", "priceLean", "underPrice", "lineGap", "expectedMinutes", "projectedValue", "absLineGap", "priceAbsLean"];
    }
    if (market === "REB") {
      return ["underProbability", "lineGap", "expectedMinutes", "priceAbsLean", "line", "minutesVolatility"];
    }
    if (market === "AST") {
      return [
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "priceLean",
        "absLineGap",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return ["priceLean", "overPrice", "lineGap", "absLineGap", "minutesVolatility", "expectedMinutes", "line", "lineTier"];
    }
    if (market === "PRA") {
      return ["lineGap", "expectedMinutes", "minutesVolatility", "priceLean", "projectedValue", "absLineGap", "comboGapPressure"];
    }
    if (market === "PA" || market === "PR") {
      return ["expectedMinutes", "lineGap", "minutesVolatility", "priceLean", "projectedValue", "absLineGap", "comboGapPressure"];
    }
    if (market === "RA") {
      return ["lineGap", "absLineGap", "minutesVolatility", "expectedMinutes", "priceLean", "overProbability"];
    }
  }
  if (archetype === "ELITE_SHOOTING_GUARD") {
    if (market === "PTS") {
      return [
        "priceLean",
        "expectedMinutes",
        "projectedValue",
        "underPrice",
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "line",
        "priceAbsLean",
        "overProbability",
        "underProbability",
        "priceStrength",
        "projectionToLineRatio",
        "projectionPerMinute",
      ];
    }
    if (market === "REB") {
      return [
        "lineGap",
        "expectedMinutes",
        "priceAbsLean",
        "line",
        "minutesVolatility",
        "overPrice",
        "underPrice",
        "priceLean",
        "absLineGap",
      ];
    }
    if (market === "AST") {
      return [
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "projectedValue",
        "absLineGap",
        "priceLean",
        "underProbability",
        "overPrice",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return [
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "expectedMinutes",
        "priceLean",
        "overPrice",
        "line",
        "lineTier",
        "priceAbsLean",
        "projectionToLineRatio",
      ];
    }
    if (market === "PRA" || market === "PA" || market === "PR") {
      return [
        "expectedMinutes",
        "lineGap",
        "priceLean",
        "absLineGap",
        "projectedValue",
        "minutesVolatility",
        "comboGapPressure",
        "priceAbsLean",
      ];
    }
    if (market === "RA") {
      return [
        "lineGap",
        "priceLean",
        "absLineGap",
        "projectedValue",
        "expectedMinutes",
        "minutesVolatility",
        "overProbability",
      ];
    }
  }
  if (archetype === "SCORING_GUARD_CREATOR") {
    if (market === "PTS") {
      return [
        "priceLean",
        "underPrice",
        "line",
        "expectedMinutes",
        "lineGap",
        "absLineGap",
        "priceAbsLean",
        "minutesVolatility",
        "projectedValue",
        "overProbability",
        "underProbability",
      ];
    }
    if (market === "REB") {
      return [
        "lineGap",
        "expectedMinutes",
        "priceAbsLean",
        "line",
        "minutesVolatility",
        "overPrice",
        "underPrice",
      ];
    }
    if (market === "AST") {
      return [
        "projectedValue",
        "absLineGap",
        "minutesVolatility",
        "lineGap",
        "expectedMinutes",
        "underProbability",
        "overPrice",
        "priceLean",
        "assistRate",
        "astToLineRatio",
      ];
    }
    if (market === "THREES") {
      return [
        "absLineGap",
        "minutesVolatility",
        "priceLean",
        "lineGap",
        "expectedMinutes",
        "overPrice",
        "line",
        "lineTier",
        "priceAbsLean",
      ];
    }
    if (market === "PRA") {
      return [
        "projectedValue",
        "expectedMinutes",
        "priceLean",
        "lineGap",
        "absLineGap",
        "minutesVolatility",
        "comboGapPressure",
      ];
    }
    if (market === "PA") {
      return [
        "lineGap",
        "minutesVolatility",
        "underPrice",
        "expectedMinutes",
        "projectedValue",
        "absLineGap",
        "priceLean",
      ];
    }
    if (market === "PR") {
      return [
        "lineGap",
        "expectedMinutes",
        "priceLean",
        "absLineGap",
        "projectedValue",
        "minutesVolatility",
        "comboGapPressure",
      ];
    }
    if (market === "RA") {
      return [
        "overProbability",
        "lineGap",
        "minutesVolatility",
        "absLineGap",
        "priceLean",
        "expectedMinutes",
        "projectedValue",
      ];
    }
  }
  if (market === "THREES") {
    return [
      "expectedMinutes",
      "overPrice",
      "lineGap",
      "minutesVolatility",
      "priceLean",
      "expectedMinutes",
      "stretchRimProtectorCenterFlag",
      "heliocentricGuardFlag",
      "lowThreeVolumeStarFlag",
      "pointForwardFlag",
      "line",
      "lineTier",
      "lineGap",
      "absLineGap",
      "minutesVolatility",
      "overPrice",
      "priceAbsLean",
      "priceStrength",
      "contextQuality",
      "roleStability",
      "projectionMarketAgreement",
      "openingTeamSpread",
      "openingSpreadAbs",
      "openingTotal",
      "lineupTimingConfidence",
      "completenessScore",
      "favoriteFlag",
      "bigFavoriteFlag",
      "closeGameFlag",
      "overProbability",
      "underProbability",
      "underPrice",
      "projectionToLineRatio",
    ];
  }
  if (market === "RA") {
    return [
      "priceLean",
      "minutesVolatility",
      "lineGap",
      "stretchRimProtectorCenterFlag",
      "absLineGap",
      "projectedValue",
      "expectedMinutes",
      "comboGapPressure",
      "lineGap",
      "minutesVolatility",
      "heliocentricGuardFlag",
      "pointForwardFlag",
      "rimPressureStarFlag",
      "projectionPerMinute",
      "projectionToLineRatio",
      "priceLean",
      "priceAbsLean",
      "priceStrength",
      "contextQuality",
      "roleStability",
      "projectionMarketAgreement",
      "openingTeamSpread",
      "openingSpreadAbs",
      "openingTotal",
      "lineupTimingConfidence",
      "completenessScore",
      "favoriteFlag",
      "bigFavoriteFlag",
      "closeGameFlag",
      "overProbability",
      "underProbability",
    ];
  }
  if (market === "PRA" || market === "PA" || market === "PR") {
    if (market === "PA") {
      return [
        "lineGap",
        "expectedMinutes",
        "minutesVolatility",
        "overPrice",
        "stretchRimProtectorCenterFlag",
        "lineGap",
        "projectedValue",
        "overPrice",
        "absLineGap",
        "expectedMinutes",
        "heliocentricGuardFlag",
        "pointForwardFlag",
        "rimPressureStarFlag",
        "projectionPerMinute",
        "projectionToLineRatio",
        "comboGapPressure",
        "minutesVolatility",
        "priceLean",
        "priceAbsLean",
        "priceStrength",
        "contextQuality",
        "roleStability",
        "projectionMarketAgreement",
        "openingTeamSpread",
        "openingSpreadAbs",
        "openingTotal",
        "lineupTimingConfidence",
        "completenessScore",
        "favoriteFlag",
        "bigFavoriteFlag",
        "closeGameFlag",
        "overProbability",
        "underProbability",
      ];
    }
    if (market === "PRA" || market === "PR") {
      return [
        "stretchRimProtectorCenterFlag",
        "expectedMinutes",
        "priceLean",
        "priceAbsLean",
        "lineGap",
        "absLineGap",
        "projectedValue",
        "heliocentricGuardFlag",
        "pointForwardFlag",
        "rimPressureStarFlag",
        "projectionPerMinute",
        "projectionToLineRatio",
        "comboGapPressure",
        "lineGap",
        "minutesVolatility",
        "priceLean",
        "priceAbsLean",
        "priceStrength",
        "contextQuality",
        "roleStability",
        "projectionMarketAgreement",
        "openingTeamSpread",
        "openingSpreadAbs",
        "openingTotal",
        "lineupTimingConfidence",
        "completenessScore",
        "favoriteFlag",
        "bigFavoriteFlag",
        "closeGameFlag",
        "overProbability",
        "underProbability",
      ];
    }
  }
  if (market === "REB") {
    return [
      "overPrice",
      "expectedMinutes",
      "line",
      "stretchRimProtectorCenterFlag",
      "expectedMinutes",
      "priceAbsLean",
      "lineGap",
      "absLineGap",
      "minutesVolatility",
      "starterRateLast10",
      "heliocentricGuardFlag",
      "priceStrength",
      "pointForwardFlag",
      "rimPressureStarFlag",
      "contextQuality",
      "roleStability",
      "projectionMarketAgreement",
      "openingTeamSpread",
      "openingSpreadAbs",
      "openingTotal",
      "lineupTimingConfidence",
      "completenessScore",
      "favoriteFlag",
      "bigFavoriteFlag",
      "closeGameFlag",
      "line",
      "projectedValue",
      "projectionPerMinute",
      "projectionToLineRatio",
      "overProbability",
      "underProbability",
      "overPrice",
      "underPrice",
    ];
  }
  if (market === "PTS") {
    return [
      "overProbability",
      "lineGap",
      "underPrice",
      "expectedMinutes",
      "stretchRimProtectorCenterFlag",
      "projectedValue",
      "expectedMinutes",
      "lineGap",
      "absLineGap",
      "minutesVolatility",
      "heliocentricGuardFlag",
      "priceLean",
      "priceAbsLean",
      "overPrice",
      "underPrice",
      "priceStrength",
      "pointForwardFlag",
      "rimPressureStarFlag",
      "contextQuality",
      "roleStability",
      "projectionMarketAgreement",
      "openingTeamSpread",
      "openingSpreadAbs",
      "openingTotal",
      "lineupTimingConfidence",
      "completenessScore",
      "favoriteFlag",
      "bigFavoriteFlag",
      "closeGameFlag",
      "line",
      "projectedValue",
      "projectionPerMinute",
      "projectionToLineRatio",
      "overProbability",
      "underProbability",
    ];
  }
  if (market === "AST") {
    return [
      "projectedValue",
      "underProbability",
      "overPrice",
      "lineGap",
      "stretchRimProtectorCenterFlag",
      "priceLean",
      "priceAbsLean",
      "priceStrength",
      "minutesVolatility",
      "heliocentricGuardFlag",
      "expectedMinutes",
      "lineGap",
      "absLineGap",
      "contextQuality",
      "roleStability",
      "projectionMarketAgreement",
      "openingTeamSpread",
      "openingSpreadAbs",
      "openingTotal",
      "lineupTimingConfidence",
      "completenessScore",
      "favoriteFlag",
      "bigFavoriteFlag",
      "closeGameFlag",
      "line",
      "projectedValue",
      "projectionPerMinute",
      "projectionToLineRatio",
      "overProbability",
      "underProbability",
      "overPrice",
      "underPrice",
      "assistRate",
      "astToLineRatio",
    ];
  }
  return [
    "lineGap",
    "absLineGap",
    "expectedMinutes",
    "minutesVolatility",
    "starterRateLast10",
    "priceLean",
    "priceAbsLean",
    "priceStrength",
    "contextQuality",
    "roleStability",
    "projectionMarketAgreement",
    "openingTeamSpread",
    "openingSpreadAbs",
    "openingTotal",
    "lineupTimingConfidence",
    "completenessScore",
    "favoriteFlag",
    "bigFavoriteFlag",
    "closeGameFlag",
    "line",
    "projectedValue",
    "projectionPerMinute",
    "projectionToLineRatio",
    "overProbability",
    "underProbability",
    "overPrice",
    "underPrice",
  ];
}

function candidateThresholds(rows: EnrichedRow[], feature: FeatureName): number[] {
  const values = rows
    .map((row) => getFeature(row, feature))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length < 2) return [];

  const thresholds: number[] = [];
  const pushMidpoint = (left: number, right: number) => {
    const midpoint = round((left + right) / 2, 4);
    if (!thresholds.includes(midpoint)) thresholds.push(midpoint);
  };

  if (values.length <= 40) {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] !== values[i - 1]) pushMidpoint(values[i - 1], values[i]);
    }
    return thresholds;
  }

  const quantiles = [0.08, 0.16, 0.24, 0.32, 0.4, 0.5, 0.6, 0.68, 0.76, 0.84, 0.92];
  quantiles.forEach((quantile) => {
    const index = Math.max(1, Math.min(values.length - 1, Math.floor(values.length * quantile)));
    if (values[index] !== values[index - 1]) pushMidpoint(values[index - 1], values[index]);
  });
  return thresholds;
}

function trainTree(rows: EnrichedRow[], maxDepth: number, minLeaf: number, market: Market): TreeNode {
  const baseLeaf = leafFromRows(rows);
  if (maxDepth <= 0 || rows.length < minLeaf * 2) return baseLeaf;

  let bestFeature: FeatureName | null = null;
  let bestThreshold: number | null = null;
  let bestLeft: EnrichedRow[] | null = null;
  let bestRight: EnrichedRow[] | null = null;
  let bestAccuracy = baseLeaf.accuracy;

  const archetype = rows[0]?.archetype ?? "LOW_MINUTE_BENCH";
  let featurePool = featuresForMarket(market, archetype);
  const bucketKey = `${market}|${archetype}`;
  if (ENABLE_BENCH_BIG_ROLE_STABILITY && !featurePool.includes("benchBigRoleStability")) {
    featurePool.push("benchBigRoleStability");
  }
  // Targeted PRA combo features only for specific bad buckets that regressed
  if (market === "PRA" && PRA_COMBO_STATE_BUCKETS.has(bucketKey)) {
    PRA_COMBO_STATE_FEATURES.forEach((feature) => {
      if (!featurePool.includes(feature)) featurePool.push(feature);
    });
  }
  if (isRecencyPriorityBucket(market, archetype)) {
    if (!featurePool.includes("emaCurrentLineDelta")) featurePool.push("emaCurrentLineDelta");
    if (!featurePool.includes("emaCurrentLineOverRate")) featurePool.push("emaCurrentLineOverRate");
    if (!featurePool.includes("emaMinutesAvg")) featurePool.push("emaMinutesAvg");
    if (!featurePool.includes("minutesShiftDelta")) featurePool.push("minutesShiftDelta");
    if (!featurePool.includes("minutesShiftAbsDelta")) featurePool.push("minutesShiftAbsDelta");
  }
  if (isUsageContextPriorityBucket(market, archetype)) {
    if (!featurePool.includes("seasonMinutesAvg")) featurePool.push("seasonMinutesAvg");
    if (!featurePool.includes("minutesLiftPct")) featurePool.push("minutesLiftPct");
    if (!featurePool.includes("activeCorePts")) featurePool.push("activeCorePts");
    if (!featurePool.includes("activeCoreAst")) featurePool.push("activeCoreAst");
    if (!featurePool.includes("missingCorePts")) featurePool.push("missingCorePts");
    if (!featurePool.includes("missingCoreAst")) featurePool.push("missingCoreAst");
    if (!featurePool.includes("missingCoreShare")) featurePool.push("missingCoreShare");
    if (!featurePool.includes("stepUpRoleFlag")) featurePool.push("stepUpRoleFlag");
  }
  if (isShapePriorityBucket(market, archetype)) {
    SHAPE_PRIORITY_FEATURES.forEach((feature) => {
      if (!featurePool.includes(feature)) featurePool.push(feature);
    });
  }
  if (ENABLE_CURRENT_LINE_MOMENTUM) {
    if (!featurePool.includes("l5CurrentLineDeltaAvg")) featurePool.push("l5CurrentLineDeltaAvg");
    if (!featurePool.includes("l5CurrentLineOverRate")) featurePool.push("l5CurrentLineOverRate");
    if (!featurePool.includes("l5MinutesAvg")) featurePool.push("l5MinutesAvg");
  }
  if (ENABLE_L5_MARKET_MOMENTUM && L5_MOMENTUM_RHYTHM_MARKETS.has(market)) {
    if (!featurePool.includes("l5MarketDeltaAvg")) featurePool.push("l5MarketDeltaAvg");
    if (!featurePool.includes("l5OverRate")) featurePool.push("l5OverRate");
    if (!featurePool.includes("l5MinutesAvg")) featurePool.push("l5MinutesAvg");
  }
  if (ENABLE_L5_CREATOR_FAMILY && L5_CREATOR_ARCHETYPE_FAMILY.has(archetype)) {
    if (!featurePool.includes("l5MarketDeltaAvg")) featurePool.push("l5MarketDeltaAvg");
    if (!featurePool.includes("l5OverRate")) featurePool.push("l5OverRate");
  }
  if (ENABLE_L5_CREATOR_ALLOWLIST && L5_CREATOR_ALLOWLIST.has(bucketKey)) {
    if (!featurePool.includes("l5MarketDeltaAvg")) featurePool.push("l5MarketDeltaAvg");
    if (!featurePool.includes("l5OverRate")) featurePool.push("l5OverRate");
    if (!featurePool.includes("l5MinutesAvg")) featurePool.push("l5MinutesAvg");
  }
  if (isMedianAwareBucket(market, archetype)) {
    featurePool = featurePool.filter((feature) => !MEDIAN_AWARE_BLOCKED_FEATURES.has(feature));
    SHAPE_PRIORITY_FEATURES.forEach((feature) => {
      if (!featurePool.includes(feature)) featurePool.push(feature);
    });
  }

  for (const feature of featurePool) {
    for (const threshold of candidateThresholds(rows, feature)) {
      const left = rows.filter((row) => {
        const value = getFeature(row, feature);
        return value != null && value <= threshold;
      });
      const right = rows.filter((row) => {
        const value = getFeature(row, feature);
        return value != null && value > threshold;
      });
      if (left.length < minLeaf || right.length < minLeaf) continue;

      const leftLeaf = leafFromRows(left);
      const rightLeaf = leafFromRows(right);
      const accuracy = round(
        (((leftLeaf.accuracy / 100) * left.length + (rightLeaf.accuracy / 100) * right.length) / rows.length) * 100,
        2,
      );
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestFeature = feature;
        bestThreshold = threshold;
        bestLeft = left;
        bestRight = right;
      }
    }
  }

  if (!bestFeature || bestThreshold == null || !bestLeft || !bestRight) return baseLeaf;

  return {
    kind: "split",
    feature: bestFeature,
    threshold: bestThreshold,
    count: rows.length,
    accuracy: bestAccuracy,
    left: trainTree(bestLeft, maxDepth - 1, minLeaf, market),
    right: trainTree(bestRight, maxDepth - 1, minLeaf, market),
  };
}

function predictTree(node: TreeNode, row: EnrichedRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictVariant(model: ModelVariant, row: EnrichedRow): Side {
  switch (model.kind) {
    case "constant":
      return model.side;
    case "projection":
      return row.projectionSide;
    case "finalOverride":
      return row.finalSide;
    case "marketFavored":
      return row.favoredSide === "NEUTRAL" ? row.projectionSide : row.favoredSide;
    case "lowMinutesThenFinalElseConstant":
      return (row.expectedMinutes ?? Infinity) <= model.threshold ? row.finalSide : model.side;
    case "underGapThenFinalElseConstant":
      return row.lineGap <= -model.threshold ? row.finalSide : model.side;
    case "lowMinutesThenFinal":
      return (row.expectedMinutes ?? Infinity) <= model.threshold ? row.finalSide : row.projectionSide;
    case "lowMinutesDisagreementThenFinal":
      return (row.expectedMinutes ?? Infinity) <= model.threshold && row.finalSide !== row.projectionSide
        ? row.finalSide
        : row.projectionSide;
    case "gapThenProjection":
      return row.absLineGap >= model.threshold
        ? row.projectionSide
        : row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide;
    case "gapThenMarket":
      return row.absLineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "overGapThenMarket":
      return row.lineGap >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "strongPriceThenMarket":
      return (row.priceStrength ?? 0) >= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "nearLineThenMarket":
      return (row.absLineGap ?? Infinity) <= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "agreementThenProjection":
      return (row.projectionMarketAgreement ?? 0) >= model.threshold
        ? row.projectionSide
        : row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide;
    case "favoriteOverSuppress":
      if (
        row.projectionSide === "OVER" &&
        row.openingTeamSpread != null &&
        row.openingTeamSpread <= model.spreadThreshold &&
        row.absLineGap <= model.gapThreshold
      ) {
        return row.favoredSide === "OVER" ? "UNDER" : row.favoredSide === "NEUTRAL" ? "UNDER" : row.favoredSide;
      }
      return row.projectionSide;
    case "favoriteOverSuppressPositiveGap":
      if (
        row.projectionSide === "OVER" &&
        row.openingTeamSpread != null &&
        row.openingTeamSpread <= model.spreadThreshold &&
        row.absLineGap <= model.gapThreshold &&
        row.lineGap >= 0 &&
        (row.expectedMinutes ?? 0) >= model.minExpectedMinutes
      ) {
        return row.favoredSide === "OVER" ? "UNDER" : row.favoredSide === "NEUTRAL" ? "UNDER" : row.favoredSide;
      }
      return row.projectionSide;
    case "lowQualityThenMarket":
      return (row.contextQuality ?? 1) <= model.threshold
        ? row.favoredSide === "NEUTRAL"
          ? row.projectionSide
          : row.favoredSide
        : row.projectionSide;
    case "lowVolatilityHelioOver":
      if (
        row.heliocentricGuardFlag === 1 &&
        (row.minutesVolatility ?? Infinity) <= model.volatilityThreshold &&
        row.absLineGap <= model.gapThreshold
      ) {
        return "OVER";
      }
      return row.projectionSide;
    case "tree":
      return predictTree(model.tree, row);
    default:
      return row.projectionSide;
  }
}

function scoreVariant(model: ModelVariant, rows: EnrichedRow[]): ModelScore {
  return scoreSide(rows, (row) => predictVariant(model, row));
}

function modelComplexity(model: ModelVariant): number {
  switch (model.kind) {
    case "tree":
      return model.maxDepth * 100 + model.minLeaf;
    case "constant":
      return 1;
    case "projection":
    case "finalOverride":
    case "marketFavored":
      return 2;
    case "lowMinutesThenFinalElseConstant":
    case "underGapThenFinalElseConstant":
    default:
      return 3;
  }
}

function splitTemporalHoldout(
  rows: EnrichedRow[],
  holdoutRatio: number,
): { fitRows: EnrichedRow[]; holdoutRows: EnrichedRow[] } {
  if (rows.length < 24) {
    return { fitRows: rows, holdoutRows: [] };
  }

  let holdoutCount = Math.max(8, Math.floor(rows.length * holdoutRatio));
  holdoutCount = Math.min(holdoutCount, rows.length - 12);
  if (holdoutCount < 8) {
    return { fitRows: rows, holdoutRows: [] };
  }

  const splitIndex = rows.length - holdoutCount;
  return {
    fitRows: rows.slice(0, splitIndex),
    holdoutRows: rows.slice(splitIndex),
  };
}

function buildCandidateVariants(rows: EnrichedRow[], market: Market, maxDepth: number): ModelVariant[] {
  const archetype = rows[0]?.archetype;
  const medianAwareBucket = archetype != null && isMedianAwareBucket(market, archetype);
  const bigManSpecialistBucket =
    archetype != null &&
    isBigManSpecialistBucket(archetype, market);
  const wingSpecialistBucket =
    archetype != null &&
    isWingSpecialistBucket(archetype, market);
  const candidates: ModelVariant[] = medianAwareBucket
    ? [{ kind: "marketFavored" }, { kind: "constant", side: "OVER" }, { kind: "constant", side: "UNDER" }]
    : [
        { kind: "projection" },
        { kind: "finalOverride" },
        { kind: "marketFavored" },
        { kind: "constant", side: "OVER" },
        { kind: "constant", side: "UNDER" },
      ];

  if (!medianAwareBucket) {
    const thresholds = market === "THREES" ? [0.15, 0.25, 0.35, 0.5, 0.75, 1] : [0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2];
    thresholds.forEach((threshold) => {
      candidates.push({ kind: "gapThenProjection", threshold });
      candidates.push({ kind: "gapThenMarket", threshold });
    });
    if (market === "PA" && rows[0]?.archetype === "BENCH_VOLUME_SCORER") {
      [1.5, 1.75, 2, 2.25, 2.5, 3].forEach((threshold) => {
        candidates.push({ kind: "overGapThenMarket", threshold });
      });
    }
    [14, 16, 18, 20, 22, 24].forEach((threshold) => {
      candidates.push({ kind: "lowMinutesThenFinal", threshold });
      candidates.push({ kind: "lowMinutesDisagreementThenFinal", threshold });
    });
    if (market === "PRA" && rows[0]?.archetype === "BENCH_STRETCH_BIG") {
      [18, 20, 22, 24, 26].forEach((threshold) => {
        candidates.push({ kind: "lowMinutesThenFinalElseConstant", threshold, side: "OVER" });
      });
      [0.5, 1, 1.5, 2, 2.5, 3].forEach((threshold) => {
        candidates.push({ kind: "underGapThenFinalElseConstant", threshold, side: "OVER" });
      });
    }
    const nearLineThresholds =
      market === "THREES" ? [0.15, 0.25, 0.35, 0.5] : market === "PRA" ? [0.5, 1, 1.5, 2] : [0.25, 0.5, 0.75, 1, 1.25];
    nearLineThresholds.forEach((threshold) => {
      candidates.push({ kind: "nearLineThenMarket", threshold });
    });
  }
  [0.02, 0.04, 0.06, 0.08, 0.12].forEach((threshold) => {
    candidates.push({ kind: "strongPriceThenMarket", threshold });
  });
  if (!medianAwareBucket) {
    [0, 0.5, 1].forEach((threshold) => {
      candidates.push({ kind: "agreementThenProjection", threshold });
    });
    [-8.5, -6.5, -5.5].forEach((spreadThreshold) => {
      [0.5, 1, 1.5].forEach((gapThreshold) => {
        candidates.push({ kind: "favoriteOverSuppress", spreadThreshold, gapThreshold });
      });
    });
    if (market === "PA" && rows[0]?.archetype === "CENTER") {
      [-8.5, -6.5, -5.5].forEach((spreadThreshold) => {
        [0.5, 1, 1.5].forEach((gapThreshold) => {
          [27, 28, 29, 30].forEach((minExpectedMinutes) => {
            candidates.push({ kind: "favoriteOverSuppressPositiveGap", spreadThreshold, gapThreshold, minExpectedMinutes });
          });
        });
      });
    }
  }
  [0.45, 0.55, 0.65].forEach((threshold) => {
    candidates.push({ kind: "lowQualityThenMarket", threshold });
  });
  if (market === "AST") {
    [1.75, 2, 2.5, 3].forEach((volatilityThreshold) => {
      [0.5, 0.75, 1, 1.25].forEach((gapThreshold) => {
        candidates.push({ kind: "lowVolatilityHelioOver", volatilityThreshold, gapThreshold });
      });
    });
  }

  const defaultMaxMinLeaf = Math.max(1, Math.min(8, Math.floor(rows.length / 10) || 1));
  const minLeafCandidates = new Set<number>();
  for (let minLeaf = 1; minLeaf <= defaultMaxMinLeaf; minLeaf += 1) {
    minLeafCandidates.add(minLeaf);
  }
  if (bigManSpecialistBucket) {
    [10, 12, 14, 16, 18].forEach((minLeaf) => {
      if (minLeaf < rows.length / 2) minLeafCandidates.add(minLeaf);
    });
  }
  if (wingSpecialistBucket) {
    [40, 60, 80].forEach((minLeaf) => {
      if (minLeaf < rows.length / 2) minLeafCandidates.add(minLeaf);
    });
  }

  const depthLimit = wingSpecialistBucket ? 6 : bigManSpecialistBucket ? Math.min(maxDepth, 6) : maxDepth;
  const orderedMinLeaves = Array.from(minLeafCandidates).sort((left, right) => left - right);
  for (let depth = 1; depth <= depthLimit; depth += 1) {
    for (const minLeaf of orderedMinLeaves) {
      candidates.push({ kind: "tree", tree: trainTree(rows, depth, minLeaf, market), maxDepth: depth, minLeaf });
    }
  }

  return candidates;
}

function refitVariant(model: ModelVariant, rows: EnrichedRow[], market: Market): ModelVariant {
  if (model.kind !== "tree") return model;
  return {
    kind: "tree",
    tree: trainTree(rows, model.maxDepth, model.minLeaf, market),
    maxDepth: model.maxDepth,
    minLeaf: model.minLeaf,
  };
}

function describeModelVariant(model: ModelVariant): string {
  switch (model.kind) {
    case "constant":
      return `constant:${model.side}`;
    case "tree":
      return `tree:d${model.maxDepth}:l${model.minLeaf}`;
    case "gapThenProjection":
    case "gapThenMarket":
    case "overGapThenMarket":
    case "lowMinutesThenFinalElseConstant":
    case "underGapThenFinalElseConstant":
    case "lowMinutesThenFinal":
    case "lowMinutesDisagreementThenFinal":
    case "nearLineThenMarket":
    case "agreementThenProjection":
    case "lowQualityThenMarket":
    case "strongPriceThenMarket":
      return `${model.kind}:${"threshold" in model ? model.threshold : "na"}`;
    case "favoriteOverSuppress":
      return `${model.kind}:${model.spreadThreshold}/${model.gapThreshold}`;
    case "lowVolatilityHelioOver":
      return `${model.kind}:${model.volatilityThreshold}/${model.gapThreshold}`;
    default:
      return model.kind;
  }
}

function isBetterModelCandidate(candidate: CandidateEvaluation, best: CandidateEvaluation | null): boolean {
  if (!best) return true;
  if (candidate.selectionScore.accuracy !== best.selectionScore.accuracy) {
    return candidate.selectionScore.accuracy > best.selectionScore.accuracy;
  }
  if (candidate.fitScore.accuracy !== best.fitScore.accuracy) {
    return candidate.fitScore.accuracy > best.fitScore.accuracy;
  }
  return modelComplexity(candidate.model) < modelComplexity(best.model);
}

function shouldFallbackToAnchorCandidate(
  candidate: CandidateEvaluation,
  anchor: CandidateEvaluation | null,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): boolean {
  if (selectionStrategy !== "temporal_holdout" || !hasHoldoutRows || !anchor) return false;

  const fitCollapse = anchor.fitScore.accuracy - candidate.fitScore.accuracy;
  const selectionEdge = candidate.selectionScore.accuracy - anchor.selectionScore.accuracy;
  if (
    fitCollapse >= TEMPORAL_FIT_COLLAPSE_FALLBACK_DELTA &&
    selectionEdge <= TEMPORAL_HOLDOUT_EDGE_TO_KEEP_COMPLEX_MODEL
  ) {
    return true;
  }

  if (
    candidate.selectionScore.accuracy < TEMPORAL_BAD_HOLDOUT_FLOOR &&
    anchor.selectionScore.accuracy >= candidate.selectionScore.accuracy + TEMPORAL_BAD_HOLDOUT_ANCHOR_MARGIN
  ) {
    return true;
  }

  return false;
}

function findConstantFallbackCandidate(
  candidate: CandidateEvaluation,
  candidates: CandidateEvaluation[],
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (selectionStrategy !== "temporal_holdout" || !hasHoldoutRows || candidate.model.kind !== "constant") return null;

  const minimumSelectionAccuracy = candidate.selectionScore.accuracy - TEMPORAL_CONSTANT_HOLDOUT_GIVEBACK;
  const minimumFitAccuracy = candidate.fitScore.accuracy + TEMPORAL_CONSTANT_FIT_EDGE_FOR_FALLBACK;
  return (
    candidates
      .filter(
        (alternative) =>
          alternative.model.kind !== "constant" &&
          alternative.selectionScore.accuracy >= minimumSelectionAccuracy &&
          alternative.fitScore.accuracy >= minimumFitAccuracy,
      )
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (modelComplexity(left.model) !== modelComplexity(right.model)) {
          return modelComplexity(left.model) - modelComplexity(right.model);
        }
        return right.fitScore.accuracy - left.fitScore.accuracy;
      })[0] ?? null
  );
}

function findStretchBigPRAFallbackCandidate(
  candidate: CandidateEvaluation,
  candidates: CandidateEvaluation[],
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (!ENABLE_TARGETED_CONSTANT_TRAP_FALLBACKS) return null;
  if (
    selectionStrategy !== "temporal_holdout" ||
    !hasHoldoutRows ||
    market !== "PRA" ||
    archetype !== "BENCH_STRETCH_BIG" ||
    (candidate.model.kind !== "constant" && candidate.model.kind !== "lowMinutesThenFinalElseConstant")
  ) {
    return null;
  }

  const minimumSelectionAccuracy = candidate.selectionScore.accuracy - TEMPORAL_STRETCH_BIG_PRA_HOLDOUT_GIVEBACK;
  const minimumFitAccuracy = candidate.fitScore.accuracy + TEMPORAL_STRETCH_BIG_PRA_FIT_EDGE_FOR_FALLBACK;
  const getThreshold = (evaluation: CandidateEvaluation): number =>
    evaluation.model.kind === "underGapThenFinalElseConstant" ? evaluation.model.threshold : Number.POSITIVE_INFINITY;
  return (
    candidates
      .filter(
        (alternative) =>
          alternative.model.kind === "underGapThenFinalElseConstant" &&
          alternative.selectionScore.accuracy >= minimumSelectionAccuracy &&
          alternative.fitScore.accuracy >= minimumFitAccuracy,
      )
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (right.fitScore.accuracy !== left.fitScore.accuracy) {
          return right.fitScore.accuracy - left.fitScore.accuracy;
        }
        return getThreshold(left) - getThreshold(right);
      })[0] ?? null
  );
}

function findBenchSpacerPRAFallbackCandidate(
  candidate: CandidateEvaluation,
  candidates: CandidateEvaluation[],
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (!ENABLE_TARGETED_CONSTANT_TRAP_FALLBACKS) return null;
  if (
    selectionStrategy !== "temporal_holdout" ||
    !hasHoldoutRows ||
    market !== "PRA" ||
    archetype !== "BENCH_SPACER_SCORER" ||
    candidate.model.kind !== "constant"
  ) {
    return null;
  }

  const minimumSelectionAccuracy = candidate.selectionScore.accuracy - TEMPORAL_BENCH_SPACER_PRA_HOLDOUT_GIVEBACK;
  const minimumFitAccuracy = candidate.fitScore.accuracy + TEMPORAL_BENCH_SPACER_PRA_FIT_EDGE_FOR_FALLBACK;
  return (
    candidates
      .filter(
        (alternative) =>
          (alternative.model.kind === "marketFavored" || alternative.model.kind === "finalOverride") &&
          alternative.selectionScore.accuracy >= minimumSelectionAccuracy &&
          alternative.fitScore.accuracy >= minimumFitAccuracy,
      )
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (modelComplexity(left.model) !== modelComplexity(right.model)) {
          return modelComplexity(left.model) - modelComplexity(right.model);
        }
        return right.fitScore.accuracy - left.fitScore.accuracy;
      })[0] ?? null
  );
}

function findStretchBigPRFallbackCandidate(
  candidate: CandidateEvaluation,
  candidates: CandidateEvaluation[],
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (
    selectionStrategy !== "temporal_holdout" ||
    !hasHoldoutRows ||
    market !== "PR" ||
    archetype !== "BENCH_STRETCH_BIG" ||
    candidate.model.kind !== "constant"
  ) {
    return null;
  }

  const minimumSelectionAccuracy = candidate.selectionScore.accuracy - TEMPORAL_STRETCH_BIG_PR_HOLDOUT_GIVEBACK;
  const minimumFitAccuracy = candidate.fitScore.accuracy + TEMPORAL_STRETCH_BIG_PR_FIT_EDGE_FOR_FALLBACK;
  const getThreshold = (evaluation: CandidateEvaluation): number =>
    evaluation.model.kind === "gapThenProjection" ? evaluation.model.threshold : Number.POSITIVE_INFINITY;
  return (
    candidates
      .filter(
        (alternative) =>
          alternative.model.kind === "gapThenProjection" &&
          alternative.selectionScore.accuracy >= minimumSelectionAccuracy &&
          alternative.fitScore.accuracy >= minimumFitAccuracy,
      )
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (right.fitScore.accuracy !== left.fitScore.accuracy) {
          return right.fitScore.accuracy - left.fitScore.accuracy;
        }
        return getThreshold(left) - getThreshold(right);
      })[0] ?? null
  );
}

function keepCenterPAConstantCandidate(
  candidate: CandidateEvaluation,
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (!ENABLE_TARGETED_CONSTANT_TRAP_FALLBACKS) return null;
  if (
    selectionStrategy !== "temporal_holdout" ||
    !hasHoldoutRows ||
    market !== "PA" ||
    archetype !== "CENTER" ||
    candidate.model.kind !== "constant" ||
    candidate.model.side !== "OVER"
  ) {
    return null;
  }

  if (candidate.selectionScore.accuracy < 52 || candidate.fitScore.accuracy < 49) {
    return null;
  }

  return candidate;
}

function findSpotupWingPRFallbackCandidate(
  candidate: CandidateEvaluation,
  candidates: CandidateEvaluation[],
  market: Market,
  archetype: Archetype | undefined,
  selectionStrategy: ModelSelectionStrategy,
  hasHoldoutRows: boolean,
): CandidateEvaluation | null {
  if (
    selectionStrategy !== "temporal_holdout" ||
    !hasHoldoutRows ||
    market !== "PR" ||
    archetype !== "SPOTUP_WING" ||
    candidate.model.kind !== "constant"
  ) {
    return null;
  }

  const minimumSelectionAccuracy = candidate.selectionScore.accuracy - TEMPORAL_SPOTUP_WING_PR_HOLDOUT_GIVEBACK;
  const minimumFitAccuracy = candidate.fitScore.accuracy + TEMPORAL_SPOTUP_WING_PR_FIT_EDGE_FOR_FALLBACK;
  const getThreshold = (evaluation: CandidateEvaluation): number =>
    evaluation.model.kind === "gapThenMarket" ? evaluation.model.threshold : Number.POSITIVE_INFINITY;
  return (
    candidates
      .filter(
        (alternative) =>
          alternative.model.kind === "gapThenMarket" &&
          alternative.selectionScore.accuracy >= minimumSelectionAccuracy &&
          alternative.fitScore.accuracy >= minimumFitAccuracy,
      )
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (right.fitScore.accuracy !== left.fitScore.accuracy) {
          return right.fitScore.accuracy - left.fitScore.accuracy;
        }
        return getThreshold(left) - getThreshold(right);
      })[0] ?? null
  );
}

function fitBestModel(
  rows: EnrichedRow[],
  market: Market,
  maxDepth: number,
  selectionStrategy: ModelSelectionStrategy,
  lateWindowRatio: number,
  debugLabel?: string,
  debugTop = 10,
): {
  model: ModelVariant;
  score: ModelScore;
  selectionTrainAccuracy: number | null;
  selectionHoldoutAccuracy: number | null;
} {
  const { fitRows, holdoutRows } =
    selectionStrategy === "temporal_holdout" ? splitTemporalHoldout(rows, lateWindowRatio) : { fitRows: rows, holdoutRows: [] };
  const candidates = buildCandidateVariants(fitRows, market, maxDepth);

  let best: CandidateEvaluation | null = null;
  let bestAnchor: CandidateEvaluation | null = null;
  const evaluatedCandidates: CandidateEvaluation[] = [];

  const selectionRows = holdoutRows.length ? holdoutRows : fitRows;
  for (const candidate of candidates) {
    const selectionScore = scoreVariant(candidate, selectionRows);
    const fitScore = scoreVariant(candidate, fitRows);
    const evaluation = { model: candidate, selectionScore, fitScore };
    evaluatedCandidates.push(evaluation);
    if (SIMPLE_BASELINE_KINDS.has(candidate.kind) && isBetterModelCandidate(evaluation, bestAnchor)) {
      bestAnchor = evaluation;
    }
    if (isBetterModelCandidate(evaluation, best)) {
      best = evaluation;
    }
  }

  const bestCandidate = best ?? {
    model: candidates[0],
    selectionScore: scoreVariant(candidates[0], holdoutRows.length ? holdoutRows : fitRows),
    fitScore: scoreVariant(candidates[0], fitRows),
  };
  const targetedFallbackCandidate = keepCenterPAConstantCandidate(
    bestCandidate,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  ) ?? findStretchBigPRAFallbackCandidate(
    bestCandidate,
    evaluatedCandidates,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  ) ?? findBenchSpacerPRAFallbackCandidate(
    bestCandidate,
    evaluatedCandidates,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  ) ?? findStretchBigPRFallbackCandidate(
    bestCandidate,
    evaluatedCandidates,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  ) ?? findSpotupWingPRFallbackCandidate(
    bestCandidate,
    evaluatedCandidates,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  );
  const constantFallbackCandidate = findConstantFallbackCandidate(
    bestCandidate,
    evaluatedCandidates,
    market,
    rows[0]?.archetype,
    selectionStrategy,
    holdoutRows.length > 0,
  );
  const anchorFallbackCandidate = shouldFallbackToAnchorCandidate(
    bestCandidate,
    bestAnchor,
    selectionStrategy,
    holdoutRows.length > 0,
  )
    ? (bestAnchor ?? bestCandidate)
    : null;
  const resolvedBest = targetedFallbackCandidate ?? constantFallbackCandidate ?? anchorFallbackCandidate ?? bestCandidate;

  if (debugLabel) {
    const sortedCandidates = evaluatedCandidates
      .slice()
      .sort((left, right) => {
        if (right.selectionScore.accuracy !== left.selectionScore.accuracy) {
          return right.selectionScore.accuracy - left.selectionScore.accuracy;
        }
        if (right.fitScore.accuracy !== left.fitScore.accuracy) {
          return right.fitScore.accuracy - left.fitScore.accuracy;
        }
        return modelComplexity(left.model) - modelComplexity(right.model);
      })
      .slice(0, debugTop)
      .map((candidate) => ({
        model: describeModelVariant(candidate.model),
        selectionAccuracy: candidate.selectionScore.accuracy,
        fitAccuracy: candidate.fitScore.accuracy,
        complexity: modelComplexity(candidate.model),
      }));
    console.error(
      JSON.stringify(
        {
          debugLabel,
          fitRows: fitRows.length,
          holdoutRows: holdoutRows.length,
          anchor: bestAnchor
            ? {
                model: describeModelVariant(bestAnchor.model),
                selectionAccuracy: bestAnchor.selectionScore.accuracy,
                fitAccuracy: bestAnchor.fitScore.accuracy,
              }
            : null,
          constantFallback: constantFallbackCandidate
            ? {
                model: describeModelVariant(constantFallbackCandidate.model),
                selectionAccuracy: constantFallbackCandidate.selectionScore.accuracy,
                fitAccuracy: constantFallbackCandidate.fitScore.accuracy,
              }
            : null,
          targetedFallback: targetedFallbackCandidate
            ? {
                model: describeModelVariant(targetedFallbackCandidate.model),
                selectionAccuracy: targetedFallbackCandidate.selectionScore.accuracy,
                fitAccuracy: targetedFallbackCandidate.fitScore.accuracy,
              }
            : null,
          selected: {
            model: describeModelVariant(resolvedBest.model),
            selectionAccuracy: resolvedBest.selectionScore.accuracy,
            fitAccuracy: resolvedBest.fitScore.accuracy,
          },
          topCandidates: sortedCandidates,
        },
        null,
        2,
      ),
    );
  }

  const refitModel = refitVariant(resolvedBest.model, rows, market);
  const refitScore = scoreVariant(refitModel, rows);

  return {
    model: refitModel,
    score: refitScore,
    selectionTrainAccuracy: fitRows.length ? resolvedBest.fitScore.accuracy : null,
    selectionHoldoutAccuracy: holdoutRows.length ? resolvedBest.selectionScore.accuracy : null,
  };
}

async function loadPlayerMetaMap(rows: TrainingRow[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: rows.map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
    fetcher: async (ids) =>
      prisma.player.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          fullName: true,
          position: true,
        },
      }),
  });
  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, fullName: meta.fullName, position: meta.position }]));
}

function summarizeRows(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  });

  const summaryMap = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    const meta = playerMetaMap.get(playerId);
    const ptsRows = playerRows.filter((row) => row.market === "PTS");
    const rebRows = playerRows.filter((row) => row.market === "REB");
    const astRows = playerRows.filter((row) => row.market === "AST");
    const threesRows = playerRows.filter((row) => row.market === "THREES");
    summaryMap.set(playerId, {
      playerId,
      playerName: meta?.fullName ?? playerRows[0]?.playerName ?? playerId,
      position: meta?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: mean(ptsRows.map((row) => row.projectedValue)),
      rebProjectionAvg: mean(rebRows.map((row) => row.projectedValue)),
      astProjectionAvg: mean(astRows.map((row) => row.projectedValue)),
      threesProjectionAvg: mean(threesRows.map((row) => row.projectedValue)),
    });
  });

  return summaryMap;
}

function enrichRows(rows: TrainingRow[], summaries: Map<string, PlayerSummary>): EnrichedRow[] {
  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const archetype = summary ? classifyArchetype(summary, row.market) : "LOW_MINUTE_BENCH";
    const summaryMinutes = summary?.avgExpectedMinutes ?? row.expectedMinutes ?? 0;
    const summaryPoints = summary?.ptsProjectionAvg ?? 0;
    const summaryRebounds = summary?.rebProjectionAvg ?? 0;
    const summaryAssists = summary?.astProjectionAvg ?? 0;
    const summaryThrees = summary?.threesProjectionAvg ?? 0;
    const praComboState = buildPRAComboState({
      market: row.market,
      gameDateEt: row.gameDateEt,
      line: row.line,
      openingTeamSpread: row.openingTeamSpread,
      archetype,
      pointsProjection: row.pointsProjection ?? (row.market === "PTS" ? row.projectedValue : null),
      reboundsProjection: row.reboundsProjection ?? (row.market === "REB" ? row.projectedValue : null),
      assistProjection: row.assistProjection ?? (row.market === "AST" ? row.projectedValue : null),
    });
    const pointForwardFlag = archetype === "POINT_FORWARD" ? 1 : 0;
    const heliocentricGuardFlag = archetype === "HELIOCENTRIC_GUARD" ? 1 : 0;
    const stretchRimProtectorCenterFlag = archetype === "STRETCH_RIM_PROTECTOR_CENTER" ? 1 : 0;
    const rimPressureStarFlag =
      pointForwardFlag === 1 && summaryMinutes >= 30 && summaryPoints >= 20 && summaryThrees <= 1.8 ? 1 : 0;
    const lowThreeVolumeStarFlag = summaryMinutes >= 30 && summaryPoints >= 18 && summaryThrees <= 1.6 ? 1 : 0;
    const overProbability = impliedProbability(row.overPrice);
    const underProbability = impliedProbability(row.underPrice);
    const priceStrength =
      overProbability == null && underProbability == null
        ? null
        : round(Math.max(overProbability ?? 0, underProbability ?? 0), 4);
    const completenessNormalized =
      row.completenessScore == null ? 0 : Math.max(0, Math.min(row.completenessScore / 100, 1));
    const timingNormalized =
      row.lineupTimingConfidence == null ? 0 : Math.max(0, Math.min(row.lineupTimingConfidence, 1));
    const emaMinutesAvg = row.emaMinutesAvg ?? null;
    const minutesShiftDelta =
      row.expectedMinutes == null || emaMinutesAvg == null ? null : round(row.expectedMinutes - emaMinutesAvg, 4);
    const openingSpreadAbs = row.openingTeamSpread == null ? null : round(Math.abs(row.openingTeamSpread), 3);
    const l15ValueMedian = row.l15ValueMedian ?? null;
    const minutesLiftPct =
      row.minutesLiftPct != null
        ? round(row.minutesLiftPct, 4)
        : row.expectedMinutes == null || row.seasonMinutesAvg == null || row.seasonMinutesAvg <= 0
          ? null
          : round(row.expectedMinutes / row.seasonMinutesAvg - 1, 4);
    const stepUpRoleFlag =
      row.stepUpRoleFlag != null
        ? row.stepUpRoleFlag
        : row.missingCoreShare != null && minutesLiftPct != null && row.missingCoreShare > 0.2 && minutesLiftPct >= 0.15
          ? 1
          : 0;
    const minutesShiftAbsDelta = minutesShiftDelta == null ? null : round(Math.abs(minutesShiftDelta), 4);
    const projectionMedianDelta =
      l15ValueMedian == null ? null : round(row.projectedValue - l15ValueMedian, 4);
    const medianLineGap = l15ValueMedian == null ? null : round(l15ValueMedian - row.line, 4);
    const competitivePaceFactor =
      row.openingTotal == null ? null : round(row.openingTotal / Math.max(openingSpreadAbs ?? 0, 1), 4);
    const blowoutRisk =
      row.openingTotal == null || openingSpreadAbs == null ? null : round(openingSpreadAbs / Math.max(row.openingTotal, 1), 4);
    const shapeContextEnabled =
      SHAPE_SPECIALIZATION_MODE === "off"
        ? false
        : shouldExposeShapeContext({
            dateEt: row.gameDateEt,
            stepUpRoleFlag,
            expectedMinutes: row.expectedMinutes,
            emaMinutesAvg,
            minutesShiftAbsDelta,
            missingCoreShare: row.missingCoreShare ?? null,
            minutesLiftPct,
          });
    const contextQuality = round(
      Math.max(
        0,
        Math.min(
          1,
          completenessNormalized * 0.45 +
            timingNormalized * 0.25 +
            (row.spreadResolved ? 0.12 : 0) +
            (row.expectedMinutes != null ? 0.1 : 0) +
            (row.priceLean != null ? 0.08 : 0),
        ),
      ),
      4,
    );
    const roleStability =
      row.minutesVolatility == null && row.starterRateLast10 == null
        ? null
        : round(
            Math.max(
              0,
              Math.min(
                1,
                (row.starterRateLast10 == null ? 0.5 : Math.abs(row.starterRateLast10 - 0.5) * 2) * 0.55 +
                  (row.minutesVolatility == null ? 0.5 : Math.max(0, 1 - row.minutesVolatility / 10)) * 0.45,
              ),
            ),
            4,
          );
    return {
      ...row,
      archetype,
      projectionPerMinute:
        row.expectedMinutes != null && row.expectedMinutes > 0 ? round(row.projectedValue / row.expectedMinutes, 4) : null,
      projectionToLineRatio: row.line > 0 ? round(row.projectedValue / row.line, 4) : null,
      lineTier: lineTier(row.market, row.line),
      priceStrength,
      contextQuality,
      roleStability,
      projectionMarketAgreement:
        row.favoredSide === "NEUTRAL" ? 0 : row.projectionSide === row.favoredSide ? 1 : -1,
      minutesShiftDelta,
      minutesShiftAbsDelta,
      l15ValueMean: gateShapeNumber(row.l15ValueMean ?? null, shapeContextEnabled),
      l15ValueMedian: gateShapeNumber(l15ValueMedian, shapeContextEnabled),
      l15ValueStdDev: gateShapeNumber(row.l15ValueStdDev ?? null, shapeContextEnabled),
      l15ValueSkew: gateShapeNumber(row.l15ValueSkew ?? null, shapeContextEnabled),
      projectionMedianDelta: gateShapeNumber(projectionMedianDelta, shapeContextEnabled),
      medianLineGap: gateShapeNumber(medianLineGap, shapeContextEnabled),
      competitivePaceFactor: gateShapeNumber(competitivePaceFactor, shapeContextEnabled),
      blowoutRisk: gateShapeNumber(blowoutRisk, shapeContextEnabled),
      seasonMinutesAvg: row.seasonMinutesAvg ?? null,
      minutesLiftPct,
      activeCorePts: row.activeCorePts ?? null,
      activeCoreAst: row.activeCoreAst ?? null,
      missingCorePts: row.missingCorePts ?? null,
      missingCoreAst: row.missingCoreAst ?? null,
      missingCoreShare: row.missingCoreShare ?? null,
      stepUpRoleFlag,
      openingSpreadAbs,
      favoriteFlag:
        row.openingTeamSpread == null ? null : row.openingTeamSpread < 0 ? 1 : row.openingTeamSpread > 0 ? -1 : 0,
      bigFavoriteFlag: row.openingTeamSpread != null && row.openingTeamSpread <= -6.5 ? 1 : 0,
      closeGameFlag: row.openingTeamSpread != null && Math.abs(row.openingTeamSpread) <= 4.5 ? 1 : 0,
      pointForwardFlag,
      heliocentricGuardFlag,
      stretchRimProtectorCenterFlag,
      rimPressureStarFlag,
      lowThreeVolumeStarFlag,
      comboGapPressure:
        row.market === "PRA" || row.market === "PA" || row.market === "PR" || row.market === "RA"
          ? round(
              row.absLineGap *
                (1 +
                  Math.max(0, summaryMinutes - 30) * 0.015 +
                  Math.max(0, summaryPoints - 20) * 0.01 +
                  Math.max(0, summaryRebounds - 8) * 0.008 +
                  Math.max(0, summaryAssists - 5) * 0.008),
              4,
            )
          : null,
      assistRate:
        summaryAssists != null && summaryMinutes != null && summaryMinutes > 0
          ? round(summaryAssists / Math.max(summaryMinutes, 1), 4)
          : null,
      astToLineRatio:
        row.market === "AST" && row.line > 0
          ? round(row.projectedValue / row.line, 4)
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
  });
}

function baselineAccuracy(rows: EnrichedRow[], selector: (row: EnrichedRow) => Side): number {
  return scoreSide(rows, selector).accuracy;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes),
  );
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const rows = enrichRows(filteredRows, summaries);

  const markets: Market[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
  const archetypes: Archetype[] = [
    "LEAD_GUARD",
    "TABLE_SETTING_LEAD_GUARD",
    "SCORE_FIRST_LEAD_GUARD",
    "HELIOCENTRIC_GUARD",
    "ELITE_SHOOTING_GUARD",
    "SCORING_GUARD_CREATOR",
    "JUMBO_CREATOR_GUARD",
    "WING",
    "CONNECTOR_WING",
    "SPOTUP_WING",
    "BENCH_SHOOTING_GUARD",
    "BENCH_PASS_FIRST_GUARD",
    "BENCH_LOW_USAGE_GUARD",
    "BENCH_TRADITIONAL_GUARD",
    "BENCH_WING",
    "BENCH_LOW_USAGE_WING",
    "BENCH_MIDRANGE_SCORER",
    "BENCH_VOLUME_SCORER",
    "BENCH_CREATOR_SCORER",
    "BENCH_REBOUNDING_SCORER",
    "BENCH_SPACER_SCORER",
    "BENCH_STRETCH_BIG",
    "BENCH_LOW_USAGE_BIG",
    "BENCH_TRADITIONAL_BIG",
    "TWO_WAY_MARKET_WING",
    "SCORER_CREATOR_WING",
    "SHOT_CREATING_WING",
    "MARKET_SHAPED_SCORING_WING",
    "CENTER",
    "STRETCH_RIM_PROTECTOR_CENTER",
    "POINT_FORWARD",
    "LOW_MINUTE_BENCH",
  ];
  const models: UniversalModelRecord[] = [];
  const modelMap = new Map<string, ModelVariant>();

  for (const market of markets) {
    for (const archetype of archetypes) {
      const bucket = rows
        .filter((row) => row.market === market && row.archetype === archetype)
        .sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt));
      if (bucket.length === 0) continue;

      const { model, score, selectionTrainAccuracy, selectionHoldoutAccuracy } = fitBestModel(
        bucket,
        market,
        args.maxDepth,
        args.selectionStrategy,
        args.lateWindowRatio,
        args.debugMarket === market && args.debugArchetype === archetype ? `${market}|${archetype}` : undefined,
        args.debugTop,
      );
      const splitIndex = bucket.length < 8 ? bucket.length : Math.max(1, Math.floor(bucket.length * (1 - args.lateWindowRatio)));
      const lateWindow = bucket.slice(splitIndex);
      const lateWindowAccuracy = lateWindow.length ? scoreVariant(model, lateWindow).accuracy : null;

      models.push({
        market,
        archetype,
        samples: bucket.length,
        projectionBaselineAccuracy: baselineAccuracy(bucket, (row) => row.projectionSide),
        finalBaselineAccuracy: baselineAccuracy(bucket, (row) => row.finalSide),
        modelAccuracy: score.accuracy,
        lateWindowAccuracy,
        selectionTrainAccuracy,
        selectionHoldoutAccuracy,
        selectionStrategy: args.selectionStrategy,
        model,
      });
      modelMap.set(`${market}|${archetype}`, model);
    }
  }

  const byMarket = markets.map((market) => {
    const marketRows = rows.filter((row) => row.market === market).sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt));
    const resolved = marketRows.map((row) => {
      const model = modelMap.get(`${row.market}|${row.archetype}`);
      const predicted = model ? predictVariant(model, row) : row.finalSide;
      return { ...row, predicted };
    });
    const fullScore = scorePredictedRows(resolved);
    const splitIndex = marketRows.length < 8 ? marketRows.length : Math.max(1, Math.floor(marketRows.length * (1 - args.lateWindowRatio)));
    const lateWindow = resolved.slice(splitIndex);
    const lateScore = lateWindow.length ? scorePredictedRows(lateWindow).accuracy : null;
    return {
      market,
      samples: resolved.length,
      projectionBaselineAccuracy: baselineAccuracy(resolved, (row) => row.projectionSide),
      finalBaselineAccuracy: baselineAccuracy(resolved, (row) => row.finalSide),
      universalModelAccuracy: fullScore.accuracy,
      lateWindowAccuracy: lateScore,
      deltaVsFinalBaseline: round(fullScore.accuracy - baselineAccuracy(resolved, (row) => row.finalSide), 2),
    };
  });

  const overallFull = scorePredictedRows(
    rows.map((row) => ({
      ...row,
      predicted: predictVariant(modelMap.get(`${row.market}|${row.archetype}`) ?? { kind: "finalOverride" }, row),
    })),
  );
  const overallFinal = baselineAccuracy(rows, (row) => row.finalSide);

  const output = {
    input: args.input,
    from: payload.from,
    to: payload.to,
    filters: {
      minActualMinutes: args.minActualMinutes,
      lateWindowRatio: args.lateWindowRatio,
      selectionStrategy: args.selectionStrategy,
    },
    archetypeDefinitions: {
      LEAD_GUARD: "Expected 24+ minutes, not a center, guard position or assist-heavy profile.",
      TABLE_SETTING_LEAD_GUARD:
        "High-minute lead guard driven more by assist orchestration than pure scoring volume, below heliocentric thresholds.",
      SCORE_FIRST_LEAD_GUARD:
        "High-minute lead guard with stronger points and 3PM scoring pressure than table-setting creation volume.",
      HELIOCENTRIC_GUARD: "Expected 32+ minutes, star-level scoring and assists, primary ball-dominant guard creator.",
      JUMBO_CREATOR_GUARD:
        "Big guard with strong rebounds and assists, lead creation role, and stable 30+ minute workload.",
      WING: "Expected 24+ minutes, not a center, not classified as lead guard.",
      CONNECTOR_WING:
        "High-minute wing with balanced rebound and assist support, lower pure scoring pressure than scoring wings.",
      SPOTUP_WING:
        "High-minute wing leaning toward points and 3PM production without the broader creator profile of advanced wing archetypes.",
      BENCH_GUARD: "Low-minute or low-start-rate reserve guard with assist-driven secondary creation.",
      BENCH_WING: "Low-minute or low-start-rate reserve wing with balanced non-primary scoring profile.",
      BENCH_SCORING_WING: "Low-minute or low-start-rate scoring reserve wing driven by points and 3PM volume.",
      BENCH_CREATOR_SCORER: "Reserve scorer with secondary creation juice, stronger assist pressure than pure shooting specialists.",
      BENCH_REBOUNDING_SCORER: "Reserve scorer with stronger rebounding involvement and forward-style combo-market shape.",
      BENCH_SPACER_SCORER: "Reserve scorer leaning toward spacing, catch-and-shoot threes, and points-driven line shape.",
      BENCH_BIG: "Low-minute or low-start-rate reserve big with rebound-centric frontcourt profile.",
      TWO_WAY_MARKET_WING:
        "High-minute balanced wing with two-way box score output and market-shaped prop behavior across assists, threes, and combos.",
      SCORER_CREATOR_WING:
        "High-minute scoring wing with stable secondary creation, strong line-shape sensitivity, and combo markets driven by gap and minutes.",
      SHOT_CREATING_WING:
        "Expected 32+ minutes, non-center high-volume scorer with strong 3PM volume and secondary creation, but below heliocentric guard assist levels.",
      MARKET_SHAPED_SCORING_WING:
        "High-minute wing scorer whose prop behavior is strongly driven by market pricing and line shape.",
      CENTER: "Expected 24+ minutes and center position.",
      STRETCH_RIM_PROTECTOR_CENTER:
        "Expected 26+ minutes, center position, strong rebound profile, and either stretch 3PM volume or star-level scoring.",
      POINT_FORWARD: "Expected 24+ minutes, forward-sized creator with star-level points/rebounds/assists and low 3PM volume.",
      LOW_MINUTE_BENCH: "Expected under 24 minutes or low starter rate.",
    },
    byMarket,
    overall: {
      samples: rows.length,
      finalBaselineAccuracy: overallFinal,
      universalModelAccuracy: overallFull.accuracy,
      deltaVsFinalBaseline: round(overallFull.accuracy - overallFinal, 2),
      correct: overallFull.correct,
      wrong: overallFull.wrong,
    },
    archetypeModelCount: models.length,
    models,
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

