import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
  type LiveUniversalModelDecision,
  type RawLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type ShapeFeature =
  | "avgExpectedMinutes"
  | "avgStarterRate"
  | "ptsProjectionAvg"
  | "rebProjectionAvg"
  | "astProjectionAvg"
  | "threesProjectionAvg";

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
  benchBigRoleStability?: number | null;
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
  position: string | null;
};

type PlayerSummary = {
  playerId: string;
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

type AggregateBucket = {
  samples: number;
  rawCorrect: number;
  baselineCorrect: number;
  blendedCorrect: number;
  qualifiedPicks: number;
  qualifiedCorrect: number;
  over: number;
  overCorrect: number;
  under: number;
  underCorrect: number;
  neutral: number;
  qualifiedOver: number;
  qualifiedOverCorrect: number;
  qualifiedUnder: number;
  qualifiedUnderCorrect: number;
  avgGapSum: number;
  allDisagreements: number;
  allDisagreementRawWins: number;
  allDisagreementBaselineWins: number;
  qualifiedDisagreements: number;
  qualifiedDisagreementWins: number;
  qualifiedDisagreementLosses: number;
  rejectionReasons: Map<string, number>;
};

type BucketSummary = {
  samples: number;
  rawAccuracy: number | null;
  baselineAccuracy: number | null;
  blendedAccuracy: number | null;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number | null;
  deltaVsBaseline: number | null;
  avgGap: number | null;
  predictedOver: number;
  predictedOverAccuracy: number | null;
  predictedUnder: number;
  predictedUnderAccuracy: number | null;
  neutral: number;
  qualifiedOver: number;
  qualifiedOverAccuracy: number | null;
  qualifiedUnder: number;
  qualifiedUnderAccuracy: number | null;
  disagreements: number;
  disagreementRatePct: number | null;
  disagreementRawAccuracy: number | null;
  disagreementBaselineAccuracy: number | null;
  qualifiedDisagreements: number;
  qualifiedDisagreementWinRate: number | null;
  qualifiedDisagreementWins: number;
  qualifiedDisagreementLosses: number;
  topRejectionReasons: Array<{ reason: string; count: number }>;
};

type AnalyzedRow = {
  row: TrainingRow;
  summary: PlayerSummary;
  raw: RawLiveUniversalModelDecision;
  qualified: LiveUniversalModelDecision;
  archetype: string;
  predictedSide: Side;
  blendedSide: Side;
  gameDateOnly: string;
  disagreement: boolean;
};

type PlayerAggregate = {
  playerId: string;
  playerName: string;
  summary: PlayerSummary;
  dominantArchetype: string;
  archetypeCounts: Array<{ key: string; count: number }>;
  fullOverall: BucketSummary;
  fullByMarket: Partial<Record<Market, BucketSummary>>;
  last30Overall: BucketSummary;
};

type ShapeDistanceBreakdown = {
  feature: ShapeFeature;
  target: number | null;
  candidate: number | null;
  normalizedDiff: number | null;
};

type CohortPlayer = {
  rank: number;
  playerId: string;
  playerName: string;
  position: string | null;
  dominantArchetype: string;
  samples: number;
  similarityScore: number;
  shapeDistanceBreakdown: ShapeDistanceBreakdown[];
  fullOverall: BucketSummary;
  last30Overall: BucketSummary;
  fullNegativeMarkets: Partial<Record<Market, number>>;
  sharedTargetWeakMarkets: Market[];
  targetWeakMarketMatchCount: number;
  harmfulQualifiedOverrideNetAcrossTargetWeakMarkets: number;
  targetMarketComparisons: Partial<Record<Market, BucketSummary | null>>;
  summary: {
    avgExpectedMinutes: number | null;
    avgStarterRate: number | null;
    ptsProjectionAvg: number | null;
    rebProjectionAvg: number | null;
    astProjectionAvg: number | null;
    threesProjectionAvg: number | null;
  };
};

type Args = {
  input: string;
  out: string | null;
  player: string;
  minActualMinutes: number;
  minSamples: number;
  top: number;
};

const prisma = new PrismaClient();

const SHAPE_FEATURES: ShapeFeature[] = [
  "avgExpectedMinutes",
  "avgStarterRate",
  "ptsProjectionAvg",
  "rebProjectionAvg",
  "astProjectionAvg",
  "threesProjectionAvg",
];

const SHAPE_WEIGHTS: Record<ShapeFeature, number> = {
  avgExpectedMinutes: 1,
  avgStarterRate: 0.75,
  ptsProjectionAvg: 1.2,
  rebProjectionAvg: 1.25,
  astProjectionAvg: 1.25,
  threesProjectionAvg: 1,
};

const MIN_SHAPE_SCALE: Record<ShapeFeature, number> = {
  avgExpectedMinutes: 1.5,
  avgStarterRate: 0.08,
  ptsProjectionAvg: 1.5,
  rebProjectionAvg: 0.9,
  astProjectionAvg: 0.8,
  threesProjectionAvg: 0.3,
};
const CROSS_ARCHETYPE_SHAPE_WINDOW = {
  avgExpectedMinutes: 4.5,
  ptsProjectionAvg: 4.5,
  rebProjectionAvg: 3,
  astProjectionAvg: 2.5,
  threesProjectionAvg: 1.25,
};

const TARGET_WEAK_MARKET_MIN_SAMPLES = 10;
const TARGET_WEAK_MARKET_MIN_COVERAGE = 50;
const TARGET_WEAK_MARKET_MIN_NEGATIVE_DELTA = -5;

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out: string | null = null;
  let player = "";
  let minActualMinutes = 15;
  let minSamples = 40;
  let top = 10;

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
    if ((token === "--player" || token === "-p") && next) {
      player = next.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--player=")) {
      player = token.slice("--player=".length).trim();
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
    if (token === "--min-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-samples=")) {
      const parsed = Number(token.slice("--min-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minSamples = Math.floor(parsed);
      continue;
    }
    if (token === "--top" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--top=")) {
      const parsed = Number(token.slice("--top=".length));
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
      continue;
    }
  }

  if (!player) {
    throw new Error("Missing required --player argument.");
  }

  return { input, out, player, minActualMinutes, minSamples, top };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function gameDateOnly(gameDateEt: string): string {
  return gameDateEt.slice(0, 10);
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function shiftDateDays(value: string, days: number): string {
  const shifted = parseDateOnly(value);
  shifted.setUTCDate(shifted.getUTCDate() - (days - 1));
  return shifted.toISOString().slice(0, 10);
}

function incrementMapCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function sortCounter(counter: Map<string, number>) {
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

async function loadPlayerMetaMap(rows: TrainingRow[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: rows.map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: { id: true, position: true },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });
  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

function summarizeRows(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    const ptsRows = playerRows.filter((row) => row.market === "PTS");
    const rebRows = playerRows.filter((row) => row.market === "REB");
    const astRows = playerRows.filter((row) => row.market === "AST");
    const threesRows = playerRows.filter((row) => row.market === "THREES");
    summaries.set(playerId, {
      playerId,
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: mean(ptsRows.map((row) => row.projectedValue)),
      rebProjectionAvg: mean(rebRows.map((row) => row.projectedValue)),
      astProjectionAvg: mean(astRows.map((row) => row.projectedValue)),
      threesProjectionAvg: mean(threesRows.map((row) => row.projectedValue)),
    });
  });

  return summaries;
}

function emptyBucket(): AggregateBucket {
  return {
    samples: 0,
    rawCorrect: 0,
    baselineCorrect: 0,
    blendedCorrect: 0,
    qualifiedPicks: 0,
    qualifiedCorrect: 0,
    over: 0,
    overCorrect: 0,
    under: 0,
    underCorrect: 0,
    neutral: 0,
    qualifiedOver: 0,
    qualifiedOverCorrect: 0,
    qualifiedUnder: 0,
    qualifiedUnderCorrect: 0,
    avgGapSum: 0,
    allDisagreements: 0,
    allDisagreementRawWins: 0,
    allDisagreementBaselineWins: 0,
    qualifiedDisagreements: 0,
    qualifiedDisagreementWins: 0,
    qualifiedDisagreementLosses: 0,
    rejectionReasons: new Map<string, number>(),
  };
}

function ratioPercent(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return round((numerator / denominator) * 100, 2);
}

function summarizeBucket(bucket: AggregateBucket): BucketSummary {
  return {
    samples: bucket.samples,
    rawAccuracy: ratioPercent(bucket.rawCorrect, bucket.samples),
    baselineAccuracy: ratioPercent(bucket.baselineCorrect, bucket.samples),
    blendedAccuracy: ratioPercent(bucket.blendedCorrect, bucket.samples),
    qualifiedAccuracy: ratioPercent(bucket.qualifiedCorrect, bucket.qualifiedPicks),
    qualifiedPicks: bucket.qualifiedPicks,
    coveragePct: ratioPercent(bucket.qualifiedPicks, bucket.samples),
    deltaVsBaseline:
      bucket.samples > 0 ? round(((bucket.blendedCorrect - bucket.baselineCorrect) / bucket.samples) * 100, 2) : null,
    avgGap: bucket.samples > 0 ? round(bucket.avgGapSum / bucket.samples, 2) : null,
    predictedOver: bucket.over,
    predictedOverAccuracy: ratioPercent(bucket.overCorrect, bucket.over),
    predictedUnder: bucket.under,
    predictedUnderAccuracy: ratioPercent(bucket.underCorrect, bucket.under),
    neutral: bucket.neutral,
    qualifiedOver: bucket.qualifiedOver,
    qualifiedOverAccuracy: ratioPercent(bucket.qualifiedOverCorrect, bucket.qualifiedOver),
    qualifiedUnder: bucket.qualifiedUnder,
    qualifiedUnderAccuracy: ratioPercent(bucket.qualifiedUnderCorrect, bucket.qualifiedUnder),
    disagreements: bucket.allDisagreements,
    disagreementRatePct: ratioPercent(bucket.allDisagreements, bucket.samples),
    disagreementRawAccuracy: ratioPercent(bucket.allDisagreementRawWins, bucket.allDisagreements),
    disagreementBaselineAccuracy: ratioPercent(bucket.allDisagreementBaselineWins, bucket.allDisagreements),
    qualifiedDisagreements: bucket.qualifiedDisagreements,
    qualifiedDisagreementWinRate: ratioPercent(bucket.qualifiedDisagreementWins, bucket.qualifiedDisagreements),
    qualifiedDisagreementWins: bucket.qualifiedDisagreementWins,
    qualifiedDisagreementLosses: bucket.qualifiedDisagreementLosses,
    topRejectionReasons: [...bucket.rejectionReasons.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
  };
}

function applyDecisionToBucket(bucket: AggregateBucket, analyzed: AnalyzedRow): void {
  const { row, predictedSide, disagreement, qualified } = analyzed;

  bucket.samples += 1;
  if (predictedSide === row.actualSide) bucket.rawCorrect += 1;
  if (row.finalSide === row.actualSide) bucket.baselineCorrect += 1;
  if (analyzed.blendedSide === row.actualSide) bucket.blendedCorrect += 1;

  if (predictedSide === "OVER") {
    bucket.over += 1;
    if (predictedSide === row.actualSide) bucket.overCorrect += 1;
  } else if (predictedSide === "UNDER") {
    bucket.under += 1;
    if (predictedSide === row.actualSide) bucket.underCorrect += 1;
  } else {
    bucket.neutral += 1;
  }

  if (qualified.qualified) {
    bucket.qualifiedPicks += 1;
    if (predictedSide === row.actualSide) bucket.qualifiedCorrect += 1;
    if (predictedSide === "OVER") {
      bucket.qualifiedOver += 1;
      if (predictedSide === row.actualSide) bucket.qualifiedOverCorrect += 1;
    } else if (predictedSide === "UNDER") {
      bucket.qualifiedUnder += 1;
      if (predictedSide === row.actualSide) bucket.qualifiedUnderCorrect += 1;
    }
  } else {
    qualified.rejectionReasons.forEach((reason) => incrementMapCounter(bucket.rejectionReasons, reason));
  }

  if (disagreement) {
    bucket.allDisagreements += 1;
    if (predictedSide === row.actualSide) bucket.allDisagreementRawWins += 1;
    if (row.finalSide === row.actualSide) bucket.allDisagreementBaselineWins += 1;
    if (qualified.qualified) {
      bucket.qualifiedDisagreements += 1;
      if (predictedSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
      else bucket.qualifiedDisagreementLosses += 1;
    }
  }

  bucket.avgGapSum += row.projectedValue - row.line;
}

function summarizeRowsIntoBucket(rows: AnalyzedRow[]): BucketSummary {
  const bucket = emptyBucket();
  rows.forEach((row) => applyDecisionToBucket(bucket, row));
  return summarizeBucket(bucket);
}

function summarizeRowsByMarket(rows: AnalyzedRow[]): Partial<Record<Market, BucketSummary>> {
  const byMarket = new Map<Market, AggregateBucket>();
  rows.forEach((row) => {
    const bucket = byMarket.get(row.row.market) ?? emptyBucket();
    applyDecisionToBucket(bucket, row);
    byMarket.set(row.row.market, bucket);
  });
  return Object.fromEntries([...byMarket.entries()].map(([market, bucket]) => [market, summarizeBucket(bucket)]));
}

function buildAnalyzedRows(rows: TrainingRow[], summaries: Map<string, PlayerSummary>): AnalyzedRow[] {
  const analyzedRows: AnalyzedRow[] = [];

  for (const row of rows) {
    const summary = summaries.get(row.playerId);
    if (!summary) continue;

    const raw = inspectLiveUniversalModelSide({
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      benchBigRoleStability: row.benchBigRoleStability ?? null,
      starterRateLast10: row.starterRateLast10,
      archetypeExpectedMinutes: summary.avgExpectedMinutes,
      archetypeStarterRateLast10: summary.avgStarterRate,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
      lineupTimingConfidence: row.lineupTimingConfidence,
      completenessScore: row.completenessScore,
      playerPosition: summary.position,
      pointsProjection: summary.ptsProjectionAvg,
      reboundsProjection: summary.rebProjectionAvg,
      assistProjection: summary.astProjectionAvg,
      threesProjection: summary.threesProjectionAvg,
    });
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
    analyzedRows.push({
      row,
      summary,
      raw,
      qualified,
      archetype: raw.archetype ?? "UNKNOWN",
      predictedSide,
      blendedSide: qualified.qualified ? predictedSide : row.finalSide,
      gameDateOnly: gameDateOnly(row.gameDateEt),
      disagreement: raw.rawSide !== "NEUTRAL" && raw.rawSide !== row.finalSide,
    });
  }

  return analyzedRows;
}

function buildPlayerAggregates(analyzedRows: AnalyzedRow[], maxDateOnly: string): PlayerAggregate[] {
  const byPlayer = new Map<string, AnalyzedRow[]>();
  analyzedRows.forEach((row) => {
    const bucket = byPlayer.get(row.row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.row.playerId, bucket);
  });

  const last30Cutoff = shiftDateDays(maxDateOnly, 30);
  const players: PlayerAggregate[] = [];
  byPlayer.forEach((playerRows, playerId) => {
    const archetypeCounter = new Map<string, number>();
    playerRows.forEach((row) => incrementMapCounter(archetypeCounter, row.archetype));
    const archetypeCounts = sortCounter(archetypeCounter);
    players.push({
      playerId,
      playerName: playerRows[0]!.row.playerName,
      summary: playerRows[0]!.summary,
      dominantArchetype: archetypeCounts[0]?.key ?? "UNKNOWN",
      archetypeCounts,
      fullOverall: summarizeRowsIntoBucket(playerRows),
      fullByMarket: summarizeRowsByMarket(playerRows),
      last30Overall: summarizeRowsIntoBucket(playerRows.filter((row) => row.gameDateOnly >= last30Cutoff)),
    });
  });

  return players;
}

function negativeMarkets(byMarket: Partial<Record<Market, BucketSummary>>): Partial<Record<Market, number>> {
  const result: Partial<Record<Market, number>> = {};
  for (const [market, summary] of Object.entries(byMarket) as Array<[Market, BucketSummary]>) {
    if ((summary.deltaVsBaseline ?? 0) < 0) {
      result[market] = summary.deltaVsBaseline ?? 0;
    }
  }
  return result;
}

function identifyTargetWeakMarkets(byMarket: Partial<Record<Market, BucketSummary>>): Market[] {
  return (Object.entries(byMarket) as Array<[Market, BucketSummary]>)
    .filter(
      ([, summary]) =>
        summary.samples >= TARGET_WEAK_MARKET_MIN_SAMPLES &&
        (summary.coveragePct ?? 0) >= TARGET_WEAK_MARKET_MIN_COVERAGE &&
        (summary.deltaVsBaseline ?? 0) <= TARGET_WEAK_MARKET_MIN_NEGATIVE_DELTA,
    )
    .sort((left, right) => (left[1].deltaVsBaseline ?? 0) - (right[1].deltaVsBaseline ?? 0))
    .map(([market]) => market);
}

function buildShapeScales(players: PlayerAggregate[]): Record<ShapeFeature, number> {
  const scales = {} as Record<ShapeFeature, number>;
  SHAPE_FEATURES.forEach((feature) => {
    const values = players
      .map((player) => player.summary[feature])
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length <= 1) {
      scales[feature] = MIN_SHAPE_SCALE[feature];
      return;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
    scales[feature] = Math.max(Math.sqrt(variance), MIN_SHAPE_SCALE[feature]);
  });
  return scales;
}

function buildShapeDistanceBreakdown(
  target: PlayerSummary,
  candidate: PlayerSummary,
  scales: Record<ShapeFeature, number>,
): ShapeDistanceBreakdown[] {
  return SHAPE_FEATURES.map((feature) => {
    const targetValue = target[feature];
    const candidateValue = candidate[feature];
    if (targetValue == null || candidateValue == null) {
      return { feature, target: targetValue, candidate: candidateValue, normalizedDiff: null };
    }
    return {
      feature,
      target: round(targetValue, 4),
      candidate: round(candidateValue, 4),
      normalizedDiff: round(Math.abs(candidateValue - targetValue) / scales[feature], 3),
    };
  });
}

function shapeDistance(
  target: PlayerSummary,
  candidate: PlayerSummary,
  scales: Record<ShapeFeature, number>,
): number {
  let total = 0;
  SHAPE_FEATURES.forEach((feature) => {
    const targetValue = target[feature];
    const candidateValue = candidate[feature];
    if (targetValue == null || candidateValue == null) return;
    total += (Math.abs(candidateValue - targetValue) / scales[feature]) * SHAPE_WEIGHTS[feature];
  });
  return round(total, 4);
}

function isCrossArchetypeShapeWindowMatch(target: PlayerSummary, candidate: PlayerSummary): boolean {
  const minutes = target.avgExpectedMinutes;
  const targetPts = target.ptsProjectionAvg;
  const targetReb = target.rebProjectionAvg;
  const targetAst = target.astProjectionAvg;
  const targetThrees = target.threesProjectionAvg;
  const candidateMinutes = candidate.avgExpectedMinutes;
  const candidatePts = candidate.ptsProjectionAvg;
  const candidateReb = candidate.rebProjectionAvg;
  const candidateAst = candidate.astProjectionAvg;
  const candidateThrees = candidate.threesProjectionAvg;

  if (
    minutes == null ||
    targetPts == null ||
    targetReb == null ||
    targetAst == null ||
    targetThrees == null ||
    candidateMinutes == null ||
    candidatePts == null ||
    candidateReb == null ||
    candidateAst == null ||
    candidateThrees == null
  ) {
    return false;
  }

  return (
    Math.abs(candidateMinutes - minutes) <= CROSS_ARCHETYPE_SHAPE_WINDOW.avgExpectedMinutes &&
    Math.abs(candidatePts - targetPts) <= CROSS_ARCHETYPE_SHAPE_WINDOW.ptsProjectionAvg &&
    Math.abs(candidateReb - targetReb) <= CROSS_ARCHETYPE_SHAPE_WINDOW.rebProjectionAvg &&
    Math.abs(candidateAst - targetAst) <= CROSS_ARCHETYPE_SHAPE_WINDOW.astProjectionAvg &&
    Math.abs(candidateThrees - targetThrees) <= CROSS_ARCHETYPE_SHAPE_WINDOW.threesProjectionAvg
  );
}

function buildTargetMarketComparisons(
  candidate: PlayerAggregate,
  targetWeakMarkets: Market[],
): Partial<Record<Market, BucketSummary | null>> {
  const result: Partial<Record<Market, BucketSummary | null>> = {};
  targetWeakMarkets.forEach((market) => {
    result[market] = candidate.fullByMarket[market] ?? null;
  });
  return result;
}

function sharedTargetWeakMarkets(candidate: PlayerAggregate, targetWeakMarkets: Market[]): Market[] {
  return targetWeakMarkets.filter((market) => {
    const marketSummary = candidate.fullByMarket[market];
    return (
      marketSummary != null &&
      marketSummary.samples >= TARGET_WEAK_MARKET_MIN_SAMPLES &&
      (marketSummary.coveragePct ?? 0) >= TARGET_WEAK_MARKET_MIN_COVERAGE &&
      (marketSummary.deltaVsBaseline ?? 0) <= TARGET_WEAK_MARKET_MIN_NEGATIVE_DELTA
    );
  });
}

function harmfulQualifiedOverrideNet(candidate: PlayerAggregate, targetWeakMarkets: Market[]): number {
  return targetWeakMarkets.reduce((sum, market) => {
    const marketSummary = candidate.fullByMarket[market];
    if (!marketSummary) return sum;
    return sum + marketSummary.qualifiedDisagreementLosses - marketSummary.qualifiedDisagreementWins;
  }, 0);
}

function buildCohortPlayers(
  candidates: PlayerAggregate[],
  target: PlayerAggregate,
  targetWeakMarkets: Market[],
  top: number,
  scales: Record<ShapeFeature, number>,
): CohortPlayer[] {
  return candidates
    .map((candidate) => {
      const similarityScore = shapeDistance(target.summary, candidate.summary, scales);
      const sharedWeakMarkets = sharedTargetWeakMarkets(candidate, targetWeakMarkets);
      return {
        playerId: candidate.playerId,
        playerName: candidate.playerName,
        position: candidate.summary.position,
        dominantArchetype: candidate.dominantArchetype,
        samples: candidate.fullOverall.samples,
        similarityScore,
        shapeDistanceBreakdown: buildShapeDistanceBreakdown(target.summary, candidate.summary, scales),
        fullOverall: candidate.fullOverall,
        last30Overall: candidate.last30Overall,
        fullNegativeMarkets: negativeMarkets(candidate.fullByMarket),
        sharedTargetWeakMarkets: sharedWeakMarkets,
        targetWeakMarketMatchCount: sharedWeakMarkets.length,
        harmfulQualifiedOverrideNetAcrossTargetWeakMarkets: harmfulQualifiedOverrideNet(candidate, targetWeakMarkets),
        targetMarketComparisons: buildTargetMarketComparisons(candidate, targetWeakMarkets),
        summary: {
          avgExpectedMinutes: candidate.summary.avgExpectedMinutes,
          avgStarterRate: candidate.summary.avgStarterRate,
          ptsProjectionAvg: candidate.summary.ptsProjectionAvg,
          rebProjectionAvg: candidate.summary.rebProjectionAvg,
          astProjectionAvg: candidate.summary.astProjectionAvg,
          threesProjectionAvg: candidate.summary.threesProjectionAvg,
        },
      };
    })
    .sort((left, right) => left.similarityScore - right.similarityScore || right.samples - left.samples)
    .slice(0, top)
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function buildCohortSignals(players: CohortPlayer[], targetWeakMarkets: Market[]) {
  const sharedTargetWeakMarketCounts = Object.fromEntries(
    targetWeakMarkets.map((market) => [market, players.filter((player) => player.sharedTargetWeakMarkets.includes(market)).length]),
  ) as Partial<Record<Market, number>>;

  const averageTargetWeakMarketDelta = Object.fromEntries(
    targetWeakMarkets.map((market) => {
      const deltas = players
        .map((player) => player.targetMarketComparisons[market]?.deltaVsBaseline)
        .filter((value): value is number => value != null && Number.isFinite(value));
      return [market, average(deltas)];
    }),
  ) as Partial<Record<Market, number | null>>;

  return {
    playerCount: players.length,
    playersSharingTwoOrMoreTargetWeakMarkets: players
      .filter((player) => player.targetWeakMarketMatchCount >= 2)
      .map((player) => player.playerName),
    playersWithPositiveNetHarmfulOverrides: players
      .filter((player) => player.harmfulQualifiedOverrideNetAcrossTargetWeakMarkets > 0)
      .map((player) => ({
        playerName: player.playerName,
        netHarmfulOverrides: player.harmfulQualifiedOverrideNetAcrossTargetWeakMarkets,
      })),
    sharedTargetWeakMarketCounts,
    averageTargetWeakMarketDelta,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(rows);
  const summaries = summarizeRows(rows, playerMetaMap);
  const analyzedRows = buildAnalyzedRows(rows, summaries);
  const maxDateOnly = analyzedRows.reduce(
    (latest, row) => (row.gameDateOnly > latest ? row.gameDateOnly : latest),
    gameDateOnly(payload.to),
  );
  const playerAggregates = buildPlayerAggregates(analyzedRows, maxDateOnly);

  const target = playerAggregates.find((player) => player.playerName.toLowerCase() === args.player.toLowerCase());
  if (!target) {
    throw new Error(`No rows found for player "${args.player}".`);
  }

  const targetWeakMarkets = identifyTargetWeakMarkets(target.fullByMarket);
  const eligiblePlayers = playerAggregates.filter(
    (player) => player.playerId !== target.playerId && player.fullOverall.samples >= args.minSamples,
  );
  const sameArchetypePlayers = eligiblePlayers.filter((player) => player.dominantArchetype === target.dominantArchetype);
  const crossArchetypePlayers = eligiblePlayers.filter((player) => player.dominantArchetype !== target.dominantArchetype);
  const crossArchetypeShapeWindowPlayers = crossArchetypePlayers.filter((player) =>
    isCrossArchetypeShapeWindowMatch(target.summary, player.summary),
  );
  const crossArchetypeCandidatePool =
    crossArchetypeShapeWindowPlayers.length > 0 ? crossArchetypeShapeWindowPlayers : crossArchetypePlayers;

  const sameArchetypeScales = buildShapeScales([target, ...sameArchetypePlayers]);
  const globalScales = buildShapeScales([target, ...eligiblePlayers]);

  const sameArchetypeNearestPlayers = buildCohortPlayers(
    sameArchetypePlayers,
    target,
    targetWeakMarkets,
    args.top,
    sameArchetypeScales,
  );
  const crossArchetypeNearestPlayers = buildCohortPlayers(
    crossArchetypeCandidatePool,
    target,
    targetWeakMarkets,
    args.top,
    globalScales,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      maxGameDateEt: maxDateOnly,
      minActualMinutes: args.minActualMinutes,
    },
    comparisonConfig: {
      minSamples: args.minSamples,
      top: args.top,
      targetWeakMarketMinSamples: TARGET_WEAK_MARKET_MIN_SAMPLES,
      targetWeakMarketMinCoverage: TARGET_WEAK_MARKET_MIN_COVERAGE,
      targetWeakMarketMaxDeltaVsBaseline: TARGET_WEAK_MARKET_MIN_NEGATIVE_DELTA,
      last30CutoffDate: shiftDateDays(maxDateOnly, 30),
    },
    targetPlayer: {
      player: target.playerName,
      playerId: target.playerId,
      dominantArchetype: target.dominantArchetype,
      archetypeCounts: target.archetypeCounts,
      summary: {
        position: target.summary.position,
        avgExpectedMinutes: target.summary.avgExpectedMinutes,
        avgStarterRate: target.summary.avgStarterRate,
        ptsProjectionAvg: target.summary.ptsProjectionAvg,
        rebProjectionAvg: target.summary.rebProjectionAvg,
        astProjectionAvg: target.summary.astProjectionAvg,
        threesProjectionAvg: target.summary.threesProjectionAvg,
      },
      fullOverall: target.fullOverall,
      last30Overall: target.last30Overall,
      targetWeakMarkets,
      targetWeakMarketComparisons: buildTargetMarketComparisons(target, targetWeakMarkets),
    },
    candidatePoolSizes: {
      eligiblePlayers: eligiblePlayers.length,
      sameArchetypePlayers: sameArchetypePlayers.length,
      crossArchetypePlayers: crossArchetypePlayers.length,
      crossArchetypeShapeWindowPlayers: crossArchetypeShapeWindowPlayers.length,
    },
    sameArchetypeNearestPlayers,
    sameArchetypeSignals: buildCohortSignals(sameArchetypeNearestPlayers, targetWeakMarkets),
    crossArchetypeNearestPlayers,
    crossArchetypeSignals: buildCohortSignals(crossArchetypeNearestPlayers, targetWeakMarkets),
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

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
