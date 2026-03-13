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
  | "underProbability";

type LeafNode = {
  kind: "leaf";
  side: Side;
};

type SplitNode = {
  kind: "split";
  feature: FeatureName;
  threshold: number;
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

type UniversalModelRecord = {
  market: Market;
  archetype: Archetype;
  samples: number;
  projectionBaselineAccuracy: number;
  finalBaselineAccuracy: number;
  modelAccuracy: number;
  lateWindowAccuracy: number | null;
  model: ModelVariant;
};

type UniversalModelFile = {
  input: string;
  from: string;
  to: string;
  filters?: {
    minActualMinutes?: number;
    lateWindowRatio?: number;
  };
  byMarket?: Array<{
    market: Market;
    samples: number;
    projectionBaselineAccuracy: number;
    finalBaselineAccuracy: number;
    universalModelAccuracy: number;
    lateWindowAccuracy: number | null;
    deltaVsFinalBaseline: number;
  }>;
  overall?: {
    samples: number;
    finalBaselineAccuracy: number;
    universalModelAccuracy: number;
    deltaVsFinalBaseline: number;
    correct: number;
    wrong: number;
  };
  archetypeDefinitions?: Record<string, string>;
  models?: UniversalModelRecord[];
};

type Score = {
  accuracy: number;
  correct: number;
  wrong: number;
};

type SelectionStrategy = "late_then_full" | "full_then_late";

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  lateWindowRatio: number;
  selectionStrategy: SelectionStrategy;
  candidates: string[];
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
  let out = path.join("exports", "universal-archetype-side-models-2025-10-23-to-2026-03-09-v8-hybrid.json");
  let minActualMinutes = 15;
  let lateWindowRatio = 0.3;
  let selectionStrategy: SelectionStrategy = "late_then_full";
  const candidates: string[] = [];

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
      if (next === "late_then_full" || next === "full_then_late") {
        selectionStrategy = next;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--selection-strategy=")) {
      const value = token.slice("--selection-strategy=".length);
      if (value === "late_then_full" || value === "full_then_late") {
        selectionStrategy = value;
      }
      continue;
    }
    if ((token === "--candidate" || token === "-c") && next) {
      candidates.push(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--candidate=")) {
      candidates.push(token.slice("--candidate=".length));
      continue;
    }
  }

  return { input, out, minActualMinutes, lateWindowRatio, selectionStrategy, candidates };
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
    return "BENCH_SCORING_WING";
  }
  if (position.includes("SG") || position.includes("SF") || position.includes("PF") || position === "F") {
    return "BENCH_WING";
  }
  if (pts >= 15 || threes >= 1.8) return "BENCH_SCORING_WING";
  if (ast >= reb && ast >= 3.5) return "BENCH_GUARD";
  if (reb >= pts && reb >= ast) return "BENCH_BIG";
  if (pts >= reb && pts >= ast) return "BENCH_SCORING_WING";
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

function isBetterCandidate(
  strategy: SelectionStrategy,
  candidate: { late: Score; full: Score },
  bestCandidate: { late: Score; full: Score } | null,
): boolean {
  if (!bestCandidate) return true;
  if (strategy === "full_then_late") {
    return (
      candidate.full.accuracy > bestCandidate.full.accuracy ||
      (candidate.full.accuracy === bestCandidate.full.accuracy && candidate.late.accuracy > bestCandidate.late.accuracy)
    );
  }

  return (
    candidate.late.accuracy > bestCandidate.late.accuracy ||
    (candidate.late.accuracy === bestCandidate.late.accuracy && candidate.full.accuracy > bestCandidate.full.accuracy)
  );
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
    default:
      return null;
  }
}

function predictTree(node: TreeNode, row: EnrichedRow): Side {
  if (node.kind === "leaf") return node.side;
  const value = getFeature(row, node.feature);
  if (value == null) {
    return node.left.kind === "leaf" ? node.left.side : predictTree(node.left, row);
  }
  return value <= node.threshold ? predictTree(node.left, row) : predictTree(node.right, row);
}

function predictVariant(model: ModelVariant, row: EnrichedRow): Side {
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

function scorePredicted(rows: Array<{ actualSide: Side; predicted: Side }>): Score {
  let correct = 0;
  let wrong = 0;
  rows.forEach((row) => {
    if (row.actualSide === row.predicted) correct += 1;
    else wrong += 1;
  });
  return {
    accuracy: correct + wrong > 0 ? round((correct / (correct + wrong)) * 100, 2) : 0,
    correct,
    wrong,
  };
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const rows = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, fullName: true, position: true },
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
      projectionMarketAgreement: row.favoredSide === "NEUTRAL" ? 0 : row.projectionSide === row.favoredSide ? 1 : -1,
      openingSpreadAbs: row.openingTeamSpread == null ? null : round(Math.abs(row.openingTeamSpread), 3),
      favoriteFlag: row.openingTeamSpread == null ? null : row.openingTeamSpread < 0 ? 1 : row.openingTeamSpread > 0 ? -1 : 0,
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
    };
  });
}

function defaultCandidateFiles(): string[] {
  return [
    path.join("exports", "universal-archetype-side-models-2025-10-23-to-2026-03-09-v5-luka.json"),
    path.join("exports", "universal-archetype-side-models-2025-10-23-to-2026-03-09-v6-wemby.json"),
    path.join("exports", "universal-archetype-side-models-2025-10-23-to-2026-03-09-v7-ant.json"),
  ];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const candidatePaths = (args.candidates.length ? args.candidates : defaultCandidateFiles()).map((filePath) =>
    path.resolve(filePath),
  );

  const rowsPayload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = rowsPayload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap([...new Set(filteredRows.map((row) => row.playerId))]);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const rows = enrichRows(filteredRows, summaries).sort((left, right) => left.gameDateEt.localeCompare(right.gameDateEt));

  const candidateFiles = await Promise.all(
    candidatePaths.map(async (filePath) => ({
      filePath,
      payload: JSON.parse(await readFile(filePath, "utf8")) as UniversalModelFile,
    })),
  );

  const selectedModels: UniversalModelRecord[] = [];
  const chosenFrom = new Map<string, string>();
  const chosenMap = new Map<string, ModelVariant>();

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

  for (const market of markets) {
    for (const archetype of archetypes) {
      const bucket = rows.filter((row) => row.market === market && row.archetype === archetype);
      if (bucket.length === 0) continue;
      const splitIndex = bucket.length < 8 ? bucket.length : Math.max(1, Math.floor(bucket.length * (1 - args.lateWindowRatio)));
      const lateRows = bucket.slice(splitIndex);

      let bestCandidate:
        | {
            filePath: string;
            record: UniversalModelRecord;
            late: Score;
            full: Score;
          }
        | null = null;

      for (const candidateFile of candidateFiles) {
        const record = (candidateFile.payload.models ?? []).find(
          (entry) => entry.market === market && entry.archetype === archetype,
        );
        if (!record) continue;
        const late = scorePredicted(lateRows.map((row) => ({ actualSide: row.actualSide, predicted: predictVariant(record.model, row) })));
        const full = scorePredicted(bucket.map((row) => ({ actualSide: row.actualSide, predicted: predictVariant(record.model, row) })));

        if (isBetterCandidate(args.selectionStrategy, { late, full }, bestCandidate)) {
          bestCandidate = {
            filePath: candidateFile.filePath,
            record,
            late,
            full,
          };
        }
      }

      if (!bestCandidate) continue;

      selectedModels.push({
        ...bestCandidate.record,
        samples: bucket.length,
        modelAccuracy: bestCandidate.full.accuracy,
        lateWindowAccuracy: bestCandidate.late.accuracy,
      });
      chosenFrom.set(`${market}|${archetype}`, path.basename(bestCandidate.filePath));
      chosenMap.set(`${market}|${archetype}`, bestCandidate.record.model);
    }
  }

  const byMarket = markets.map((market) => {
    const marketRows = rows.filter((row) => row.market === market);
    const resolved = marketRows.map((row) => ({
      actualSide: row.actualSide,
      predicted: predictVariant(chosenMap.get(`${row.market}|${row.archetype}`) ?? { kind: "finalOverride" }, row),
      row,
    }));
    const fullScore = scorePredicted(resolved.map((entry) => ({ actualSide: entry.actualSide, predicted: entry.predicted })));
    const splitIndex =
      resolved.length < 8 ? resolved.length : Math.max(1, Math.floor(resolved.length * (1 - args.lateWindowRatio)));
    const lateScore = scorePredicted(
      resolved.slice(splitIndex).map((entry) => ({ actualSide: entry.actualSide, predicted: entry.predicted })),
    );
    const finalBaseline = scorePredicted(
      marketRows.map((row) => ({ actualSide: row.actualSide, predicted: row.finalSide })),
    ).accuracy;
    const projectionBaseline = scorePredicted(
      marketRows.map((row) => ({ actualSide: row.actualSide, predicted: row.projectionSide })),
    ).accuracy;
    return {
      market,
      samples: resolved.length,
      projectionBaselineAccuracy: projectionBaseline,
      finalBaselineAccuracy: finalBaseline,
      universalModelAccuracy: fullScore.accuracy,
      lateWindowAccuracy: lateScore.accuracy,
      deltaVsFinalBaseline: round(fullScore.accuracy - finalBaseline, 2),
    };
  });

  const overallFull = scorePredicted(
    rows.map((row) => ({
      actualSide: row.actualSide,
      predicted: predictVariant(chosenMap.get(`${row.market}|${row.archetype}`) ?? { kind: "finalOverride" }, row),
    })),
  );
  const overallFinal = scorePredicted(
    rows.map((row) => ({ actualSide: row.actualSide, predicted: row.finalSide })),
  ).accuracy;

  const output = {
    input: args.input,
    from: rowsPayload.from,
    to: rowsPayload.to,
    filters: {
      minActualMinutes: args.minActualMinutes,
      lateWindowRatio: args.lateWindowRatio,
    },
    candidateFiles: candidatePaths.map((filePath) => path.basename(filePath)),
    selectionStrategy: args.selectionStrategy,
    overall: {
      samples: rows.length,
      finalBaselineAccuracy: overallFinal,
      universalModelAccuracy: overallFull.accuracy,
      deltaVsFinalBaseline: round(overallFull.accuracy - overallFinal, 2),
      correct: overallFull.correct,
      wrong: overallFull.wrong,
    },
    byMarket,
    chosenFrom: Object.fromEntries([...chosenFrom.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
    models: selectedModels,
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
