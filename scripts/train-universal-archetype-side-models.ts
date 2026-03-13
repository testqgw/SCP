import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { round } from "../lib/utils";

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

type TrainingRow = {
  playerId: string;
  playerName: string;
  market: Market;
  gameDateEt: string;
  projectedValue: number;
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
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
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
  fullName: string;
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
};

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
  | { kind: "gapThenProjection"; threshold: number }
  | { kind: "gapThenMarket"; threshold: number }
  | { kind: "strongPriceThenMarket"; threshold: number }
  | { kind: "nearLineThenMarket"; threshold: number }
  | { kind: "agreementThenProjection"; threshold: number }
  | { kind: "favoriteOverSuppress"; spreadThreshold: number; gapThreshold: number }
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

type ModelSelectionStrategy = "in_sample" | "temporal_holdout";

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  maxDepth: number;
  lateWindowRatio: number;
  selectionStrategy: ModelSelectionStrategy;
};

const prisma = new PrismaClient();

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
  let maxDepth = 5;
  let lateWindowRatio = 0.3;
  let selectionStrategy: ModelSelectionStrategy = "in_sample";

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
  }

  return { input, out, minActualMinutes, maxDepth, lateWindowRatio, selectionStrategy };
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

function classifyBenchArchetype(summary: PlayerSummary): Archetype {
  const position = (summary.position ?? "").toUpperCase();
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

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

function classifyArchetype(summary: PlayerSummary): Archetype {
  const minutes = summary.avgExpectedMinutes ?? 0;
  const starterRate = summary.avgStarterRate ?? 0;
  const position = (summary.position ?? "").toUpperCase();
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes < 24 || starterRate < 0.35) return classifyBenchArchetype(summary);
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
  if (archetype === "BENCH_CREATOR_SCORER") {
    if (market === "PTS") {
      return ["priceLean", "underPrice", "expectedMinutes", "lineGap", "absLineGap", "minutesVolatility", "projectedValue", "overProbability"];
    }
    if (market === "REB") {
      return ["lineGap", "expectedMinutes", "priceAbsLean", "line", "minutesVolatility", "underProbability", "overPrice"];
    }
    if (market === "AST") {
      return ["projectedValue", "lineGap", "absLineGap", "minutesVolatility", "expectedMinutes", "underProbability", "overPrice", "priceLean"];
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
      return ["underProbability", "lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "priceLean", "absLineGap"];
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
      return ["lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "absLineGap", "underProbability", "priceLean"];
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
      return ["underProbability", "overPrice", "lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "priceLean", "absLineGap"];
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
      return ["projectedValue", "lineGap", "absLineGap", "minutesVolatility", "expectedMinutes", "underProbability", "overPrice"];
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
      return ["overPrice", "lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "priceLean", "absLineGap"];
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
      return ["lineGap", "expectedMinutes", "minutesVolatility", "projectedValue", "priceLean", "absLineGap"];
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

  for (const feature of featuresForMarket(market, rows[0]?.archetype ?? "LOW_MINUTE_BENCH")) {
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
  const candidates: ModelVariant[] = [
    { kind: "projection" },
    { kind: "finalOverride" },
    { kind: "marketFavored" },
    { kind: "constant", side: "OVER" },
    { kind: "constant", side: "UNDER" },
  ];

  const thresholds = market === "THREES" ? [0.15, 0.25, 0.35, 0.5, 0.75, 1] : [0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2];
  thresholds.forEach((threshold) => {
    candidates.push({ kind: "gapThenProjection", threshold });
    candidates.push({ kind: "gapThenMarket", threshold });
  });
  const nearLineThresholds =
    market === "THREES" ? [0.15, 0.25, 0.35, 0.5] : market === "PRA" ? [0.5, 1, 1.5, 2] : [0.25, 0.5, 0.75, 1, 1.25];
  nearLineThresholds.forEach((threshold) => {
    candidates.push({ kind: "nearLineThenMarket", threshold });
  });
  [0.02, 0.04, 0.06, 0.08, 0.12].forEach((threshold) => {
    candidates.push({ kind: "strongPriceThenMarket", threshold });
  });
  [0, 0.5, 1].forEach((threshold) => {
    candidates.push({ kind: "agreementThenProjection", threshold });
  });
  [-8.5, -6.5, -5.5].forEach((spreadThreshold) => {
    [0.5, 1, 1.5].forEach((gapThreshold) => {
      candidates.push({ kind: "favoriteOverSuppress", spreadThreshold, gapThreshold });
    });
  });
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

  const maxMinLeaf = Math.max(1, Math.min(8, Math.floor(rows.length / 10) || 1));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    for (let minLeaf = 1; minLeaf <= maxMinLeaf; minLeaf += 1) {
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

function isBetterModelCandidate(
  candidate: { selectionScore: ModelScore; fitScore: ModelScore; model: ModelVariant },
  best: { selectionScore: ModelScore; fitScore: ModelScore; model: ModelVariant } | null,
): boolean {
  if (!best) return true;
  if (candidate.selectionScore.accuracy !== best.selectionScore.accuracy) {
    return candidate.selectionScore.accuracy > best.selectionScore.accuracy;
  }
  if (candidate.fitScore.accuracy !== best.fitScore.accuracy) {
    return candidate.fitScore.accuracy > best.fitScore.accuracy;
  }
  return modelComplexity(candidate.model) < modelComplexity(best.model);
}

function fitBestModel(
  rows: EnrichedRow[],
  market: Market,
  maxDepth: number,
  selectionStrategy: ModelSelectionStrategy,
  lateWindowRatio: number,
): {
  model: ModelVariant;
  score: ModelScore;
  selectionTrainAccuracy: number | null;
  selectionHoldoutAccuracy: number | null;
} {
  const { fitRows, holdoutRows } =
    selectionStrategy === "temporal_holdout" ? splitTemporalHoldout(rows, lateWindowRatio) : { fitRows: rows, holdoutRows: [] };
  const candidates = buildCandidateVariants(fitRows, market, maxDepth);

  let best:
    | {
        model: ModelVariant;
        selectionScore: ModelScore;
        fitScore: ModelScore;
      }
    | null = null;

  const selectionRows = holdoutRows.length ? holdoutRows : fitRows;
  for (const candidate of candidates) {
    const selectionScore = scoreVariant(candidate, selectionRows);
    const fitScore = scoreVariant(candidate, fitRows);
    if (isBetterModelCandidate({ model: candidate, selectionScore, fitScore }, best)) {
      best = { model: candidate, selectionScore, fitScore };
    }
  }

  const resolvedBest = best ?? {
    model: candidates[0],
    selectionScore: scoreVariant(candidates[0], holdoutRows.length ? holdoutRows : fitRows),
    fitScore: scoreVariant(candidates[0], fitRows),
  };
  const refitModel = refitVariant(resolvedBest.model, rows, market);
  const refitScore = scoreVariant(refitModel, rows);

  return {
    model: refitModel,
    score: refitScore,
    selectionTrainAccuracy: fitRows.length ? resolvedBest.fitScore.accuracy : null,
    selectionHoldoutAccuracy: holdoutRows.length ? resolvedBest.selectionScore.accuracy : null,
  };
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const rows = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: {
      id: true,
      fullName: true,
      position: true,
    },
  });

  return new Map(rows.map((row) => [row.id, row]));
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
    const archetype = summary ? classifyArchetype(summary) : "LOW_MINUTE_BENCH";
    const summaryMinutes = summary?.avgExpectedMinutes ?? row.expectedMinutes ?? 0;
    const summaryPoints = summary?.ptsProjectionAvg ?? 0;
    const summaryRebounds = summary?.rebProjectionAvg ?? 0;
    const summaryAssists = summary?.astProjectionAvg ?? 0;
    const summaryThrees = summary?.threesProjectionAvg ?? 0;
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
      openingSpreadAbs: row.openingTeamSpread == null ? null : round(Math.abs(row.openingTeamSpread), 3),
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
    };
  });
}

function baselineAccuracy(rows: EnrichedRow[], selector: (row: EnrichedRow) => Side): number {
  return scoreSide(rows, selector).accuracy;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap([...new Set(filteredRows.map((row) => row.playerId))]);
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
    "BENCH_GUARD",
    "BENCH_WING",
    "BENCH_SCORING_WING",
    "BENCH_LOW_USAGE_WING",
    "BENCH_MIDRANGE_SCORER",
    "BENCH_VOLUME_SCORER",
    "BENCH_CREATOR_SCORER",
    "BENCH_REBOUNDING_SCORER",
    "BENCH_SPACER_SCORER",
    "BENCH_BIG",
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
