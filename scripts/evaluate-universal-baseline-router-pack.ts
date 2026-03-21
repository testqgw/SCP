import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
  type LiveUniversalModelDecision,
  type RawLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  predictUniversalBaselineRouter,
  resolveRouterLeaf,
  trainUniversalBaselineRouter,
  type RouterDatasetRow,
  type RouterFeatureMode,
  type UniversalBaselineRouterModel,
} from "../lib/snapshot/universalBaselineRouter";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import type { SnapshotMarket } from "../lib/types/snapshot";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

type Side = "OVER" | "UNDER";
type Market = SnapshotMarket;
type RouterDecision = "KEEP_UNIVERSAL" | "VETO_BASELINE";

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
  from?: string;
  to?: string;
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

type EvaluatedRow = {
  row: TrainingRow;
  rowKey: string;
  rawDecision: RawLiveUniversalModelDecision;
  qualifiedDecision: LiveUniversalModelDecision;
};

type EvalMetrics = {
  samples: number;
  blendedAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
};

type Comparison = {
  control: EvalMetrics;
  candidate: EvalMetrics;
  delta: {
    blendedAccuracy: number;
    qualifiedAccuracy: number;
    qualifiedPicks: number;
    coveragePct: number;
  };
};

type SpecialistConfig = {
  id: string;
  bucketKey: string;
  maxDepth: number;
  minLeaf: number;
  featureMode: RouterFeatureMode;
};

type SpecialistPrediction = {
  action: RouterDecision;
  rawAction: RouterDecision;
  gateAllowed: boolean;
  specialistId: string;
  bucketKey: string;
  leafPath: string;
  leafSignature: string | null;
  leafAccuracy: number;
  oosFoldAppearances: number;
  oosVetoRows: number;
  oosPooledHitRate: number;
  oosWilsonLowerBound: number;
  oosLast2FoldDelta: number;
  oosWalkDelta: number;
};

type LeafMetadata = {
  leafPath: string;
  decision: RouterDecision;
  disagreementSamples: number;
  vetoHitRate: number;
  wilsonLowerBound: number;
  overallDelta: number;
  recent14dSamples: number;
  recent14dDelta: number;
  recent30dSamples: number;
  recent30dDelta: number;
  activeByTemporalGate: boolean;
};

type SignatureFoldStats = {
  foldId: string;
  vetoRows: number;
  vetoWins: number;
  controlWins: number;
};

type OosSignatureStats = {
  signature: string;
  specialistId: string;
  bucketKey: string;
  foldAppearances: number;
  oosVetoRows: number;
  oosVetoWins: number;
  pooledVetoHitRate: number;
  pooledWilsonLowerBound: number;
  last2FoldRows: number;
  last2FoldVetoWins: number;
  last2FoldDelta: number;
  walkRows: number;
  walkVetoWins: number;
  walkDelta: number;
  activeByOosGate: boolean;
  foldStats: SignatureFoldStats[];
};

type Args = {
  input: string;
  dataset: string;
  out: string;
  modelOut: string;
  minActualMinutes: number;
  minTrainDates: number;
  testDates: number;
  latestFolds: number;
  bucketSampleFloor: number;
  leafSampleFloor: number;
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

const prisma = new PrismaClient();

const SPECIALIST_PACK_V1: SpecialistConfig[] = [
  {
    id: "PA_BENCH_WING",
    bucketKey: "PA|BENCH_WING",
    maxDepth: 3,
    minLeaf: 30,
    featureMode: "core_relations",
  },
  {
    id: "PRA_SPOTUP_WING",
    bucketKey: "PRA|SPOTUP_WING",
    maxDepth: 3,
    minLeaf: 25,
    featureMode: "core",
  },
  {
    id: "PRA_POINT_FORWARD",
    bucketKey: "PRA|POINT_FORWARD",
    maxDepth: 2,
    minLeaf: 15,
    featureMode: "core",
  },
  {
    id: "PRA_SCORING_GUARD_CREATOR",
    bucketKey: "PRA|SCORING_GUARD_CREATOR",
    maxDepth: 2,
    minLeaf: 15,
    featureMode: "core",
  },
];

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let dataset = path.join("exports", "universal-baseline-router-dataset.jsonl");
  let out = path.join("exports", "universal-baseline-router-pack-v1-eval.json");
  let modelOut = path.join("exports", "universal-baseline-router-pack-v1-models.json");
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
  let latestFolds = 2;
  let bucketSampleFloor = 50;
  let leafSampleFloor = 25;
  let minVetoLeafAccuracy: number | null = null;
  let minLeafDisagreementSamples = 30;
  let minLeafWilsonLowerBound = 54;
  let minLeafRecent14dDelta = 0;
  let minLeafRecent30dDelta = 0;
  let minFoldAppearances = 2;
  let recurrenceFolds = 3;
  let minOosVetoRows = 25;
  let minOosVetoHitRate = 58;
  let minOosWilson = 52;
  let minLast2FoldDelta = 0;
  let minWalkDelta = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) input = token.slice("--input=".length);
    else if (token === "--dataset" && next) {
      dataset = next;
      index += 1;
    } else if (token.startsWith("--dataset=")) dataset = token.slice("--dataset=".length);
    else if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
    } else if (token.startsWith("--out=")) out = token.slice("--out=".length);
    else if (token === "--model-out" && next) {
      modelOut = next;
      index += 1;
    } else if (token.startsWith("--model-out=")) modelOut = token.slice("--model-out=".length);
    else if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
    } else if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
    } else if (token === "--min-train-dates" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--min-train-dates=")) {
      const parsed = Number(token.slice("--min-train-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
    } else if (token === "--test-dates" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--test-dates=")) {
      const parsed = Number(token.slice("--test-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
    } else if (token === "--latest-folds" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--latest-folds=")) {
      const parsed = Number(token.slice("--latest-folds=".length));
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
    } else if (token === "--bucket-sample-floor" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) bucketSampleFloor = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--bucket-sample-floor=")) {
      const parsed = Number(token.slice("--bucket-sample-floor=".length));
      if (Number.isFinite(parsed) && parsed > 0) bucketSampleFloor = Math.floor(parsed);
    } else if (token === "--leaf-sample-floor" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) leafSampleFloor = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--leaf-sample-floor=")) {
      const parsed = Number(token.slice("--leaf-sample-floor=".length));
      if (Number.isFinite(parsed) && parsed > 0) leafSampleFloor = Math.floor(parsed);
    } else if (token === "--min-veto-leaf-accuracy" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minVetoLeafAccuracy = parsed > 0 ? parsed : null;
      index += 1;
    } else if (token.startsWith("--min-veto-leaf-accuracy=")) {
      const parsed = Number(token.slice("--min-veto-leaf-accuracy=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minVetoLeafAccuracy = parsed > 0 ? parsed : null;
    } else if (token === "--min-leaf-disagreement-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minLeafDisagreementSamples = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--min-leaf-disagreement-samples=")) {
      const parsed = Number(token.slice("--min-leaf-disagreement-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minLeafDisagreementSamples = Math.floor(parsed);
    } else if (token === "--min-leaf-wilson-lower-bound" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minLeafWilsonLowerBound = parsed;
      index += 1;
    } else if (token.startsWith("--min-leaf-wilson-lower-bound=")) {
      const parsed = Number(token.slice("--min-leaf-wilson-lower-bound=".length));
      if (Number.isFinite(parsed)) minLeafWilsonLowerBound = parsed;
    } else if (token === "--min-leaf-recent-14d-delta" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minLeafRecent14dDelta = parsed;
      index += 1;
    } else if (token.startsWith("--min-leaf-recent-14d-delta=")) {
      const parsed = Number(token.slice("--min-leaf-recent-14d-delta=".length));
      if (Number.isFinite(parsed)) minLeafRecent14dDelta = parsed;
    } else if (token === "--min-leaf-recent-30d-delta" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minLeafRecent30dDelta = parsed;
      index += 1;
    } else if (token.startsWith("--min-leaf-recent-30d-delta=")) {
      const parsed = Number(token.slice("--min-leaf-recent-30d-delta=".length));
      if (Number.isFinite(parsed)) minLeafRecent30dDelta = parsed;
    } else if (token === "--min-fold-appearances" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minFoldAppearances = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--min-fold-appearances=")) {
      const parsed = Number(token.slice("--min-fold-appearances=".length));
      if (Number.isFinite(parsed) && parsed > 0) minFoldAppearances = Math.floor(parsed);
    } else if (token === "--recurrence-folds" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) recurrenceFolds = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--recurrence-folds=")) {
      const parsed = Number(token.slice("--recurrence-folds=".length));
      if (Number.isFinite(parsed) && parsed > 0) recurrenceFolds = Math.floor(parsed);
    } else if (token === "--min-oos-veto-rows" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minOosVetoRows = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--min-oos-veto-rows=")) {
      const parsed = Number(token.slice("--min-oos-veto-rows=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minOosVetoRows = Math.floor(parsed);
    } else if (token === "--min-oos-veto-hit-rate" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minOosVetoHitRate = parsed;
      index += 1;
    } else if (token.startsWith("--min-oos-veto-hit-rate=")) {
      const parsed = Number(token.slice("--min-oos-veto-hit-rate=".length));
      if (Number.isFinite(parsed)) minOosVetoHitRate = parsed;
    } else if (token === "--min-oos-wilson" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minOosWilson = parsed;
      index += 1;
    } else if (token.startsWith("--min-oos-wilson=")) {
      const parsed = Number(token.slice("--min-oos-wilson=".length));
      if (Number.isFinite(parsed)) minOosWilson = parsed;
    } else if (token === "--min-last2-fold-delta" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minLast2FoldDelta = parsed;
      index += 1;
    } else if (token.startsWith("--min-last2-fold-delta=")) {
      const parsed = Number(token.slice("--min-last2-fold-delta=".length));
      if (Number.isFinite(parsed)) minLast2FoldDelta = parsed;
    } else if (token === "--min-walk-delta" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) minWalkDelta = parsed;
      index += 1;
    } else if (token.startsWith("--min-walk-delta=")) {
      const parsed = Number(token.slice("--min-walk-delta=".length));
      if (Number.isFinite(parsed)) minWalkDelta = parsed;
    }
  }

  return {
    input,
    dataset,
    out,
    modelOut,
    minActualMinutes,
    minTrainDates,
    testDates,
    latestFolds,
    bucketSampleFloor,
    leafSampleFloor,
    minVetoLeafAccuracy,
    minLeafDisagreementSamples,
    minLeafWilsonLowerBound,
    minLeafRecent14dDelta,
    minLeafRecent30dDelta,
    minFoldAppearances,
    recurrenceFolds,
    minOosVetoRows,
    minOosVetoHitRate,
    minOosWilson,
    minLast2FoldDelta,
    minWalkDelta,
  };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function buildRowKey(row: TrainingRow): string {
  return [row.playerId, row.gameDateEt, row.market].join("|");
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

function evaluateRows(rows: TrainingRow[], summaries: Map<string, PlayerSummary>): EvaluatedRow[] {
  return rows.map((row) => {
    const summary = summaries.get(row.playerId);
    const rawDecision = inspectLiveUniversalModelSide({
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
      archetypeExpectedMinutes: summary?.avgExpectedMinutes ?? null,
      archetypeStarterRateLast10: summary?.avgStarterRate ?? null,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
      lineupTimingConfidence: row.lineupTimingConfidence,
      completenessScore: row.completenessScore,
      playerPosition: summary?.position ?? null,
      pointsProjection: summary?.ptsProjectionAvg ?? null,
      reboundsProjection: summary?.rebProjectionAvg ?? null,
      assistProjection: summary?.astProjectionAvg ?? null,
      threesProjection: summary?.threesProjectionAvg ?? null,
    });
    return { row, rowKey: buildRowKey(row), rawDecision, qualifiedDecision: qualifyLiveUniversalModelDecision(rawDecision) };
  });
}

function readJsonl<T>(filePath: string): T[] {
  const content = fs.readFileSync(path.resolve(filePath), "utf8").trim();
  if (!content) return [];
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function summarizeMetrics(
  rows: EvaluatedRow[],
  predictions: Map<string, SpecialistPrediction>,
  candidate: boolean,
): EvalMetrics {
  let qualifiedPicks = 0;
  let qualifiedCorrect = 0;
  let blendedCorrect = 0;
  rows.forEach((row) => {
    const controlUsesUniversal = row.qualifiedDecision.qualified && row.qualifiedDecision.side !== "NEUTRAL";
    const action = candidate ? predictions.get(row.rowKey)?.action : undefined;
    const candidateUsesUniversal = controlUsesUniversal && action !== "VETO_BASELINE";
    const chosenSide = candidateUsesUniversal ? (row.qualifiedDecision.side as Side) : row.row.finalSide;
    if (candidateUsesUniversal) {
      qualifiedPicks += 1;
      if (chosenSide === row.row.actualSide) qualifiedCorrect += 1;
    }
    if (chosenSide === row.row.actualSide) blendedCorrect += 1;
  });
  return {
    samples: rows.length,
    blendedAccuracy: rows.length > 0 ? round((blendedCorrect / rows.length) * 100, 2) : 0,
    qualifiedAccuracy: qualifiedPicks > 0 ? round((qualifiedCorrect / qualifiedPicks) * 100, 2) : null,
    qualifiedPicks,
    coveragePct: rows.length > 0 ? round((qualifiedPicks / rows.length) * 100, 2) : 0,
  };
}

function comparison(rows: EvaluatedRow[], predictions: Map<string, SpecialistPrediction>): Comparison {
  const control = summarizeMetrics(rows, predictions, false);
  const candidate = summarizeMetrics(rows, predictions, true);
  return {
    control,
    candidate,
    delta: {
      blendedAccuracy: round(candidate.blendedAccuracy - control.blendedAccuracy, 2),
      qualifiedAccuracy: round((candidate.qualifiedAccuracy ?? 0) - (control.qualifiedAccuracy ?? 0), 2),
      qualifiedPicks: candidate.qualifiedPicks - control.qualifiedPicks,
      coveragePct: round(candidate.coveragePct - control.coveragePct, 2),
    },
  };
}

function buildWalkDateSet(dates: string[], minTrainDates: number, testDates: number, latestFolds: number): Set<string> {
  if (dates.length < minTrainDates + testDates) return new Set();
  const folds: string[][] = [];
  for (let trainDateCount = minTrainDates; trainDateCount < dates.length; trainDateCount += testDates) {
    const testDateSlice = dates.slice(trainDateCount, trainDateCount + testDates);
    if (testDateSlice.length === 0) break;
    folds.push(testDateSlice);
  }
  return new Set(folds.slice(-latestFolds).flat());
}

type FoldSlice = {
  foldId: string;
  testDates: string[];
};

function buildRecentFoldSlices(
  dates: string[],
  minTrainDates: number,
  testDates: number,
  latestFolds: number,
): FoldSlice[] {
  if (dates.length < minTrainDates + testDates) return [];
  const folds: FoldSlice[] = [];
  for (let trainDateCount = minTrainDates; trainDateCount < dates.length; trainDateCount += testDates) {
    const testDateSlice = dates.slice(trainDateCount, trainDateCount + testDates);
    if (testDateSlice.length === 0) break;
    folds.push({
      foldId: `${testDateSlice[0]}..${testDateSlice[testDateSlice.length - 1]}`,
      testDates: testDateSlice,
    });
  }
  return folds.slice(-latestFolds);
}

function roundToStep(value: number, step: number): number {
  return round(Math.round(value / step) * step, 4);
}

function normalizeLeafThreshold(feature: string, threshold: number): string {
  if (feature.includes("=")) return threshold.toString();
  if (["smallEdge", "verySmallEdge", "weakBucket", "weakLeaf", "spreadResolvedFlag"].includes(feature)) {
    return threshold.toString();
  }
  const step = (() => {
    if (["absLineGap", "lineGap"].includes(feature)) return 0.25;
    if (["priceLean"].includes(feature)) return 0.02;
    if (["priceStrength", "projectionMarketAgreement", "overProbability", "underProbability"].includes(feature)) return 0.01;
    if (["overPrice", "underPrice"].includes(feature)) return 5;
    if (["openingTeamSpread", "absOpeningSpread", "signedSpreadFromFavoritePerspective"].includes(feature)) return 0.5;
    if (["openingTotal", "expectedMinutes"].includes(feature)) return 1;
    if (["minutesVolatility", "starterRateLast10", "lineupTimingConfidence", "completenessScore"].includes(feature)) return 0.1;
    return 0.1;
  })();
  const normalized = roundToStep(threshold, step);
  return Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
}

function normalizeLeafSignature(specialist: SpecialistConfig, leafPath: string): string {
  if (!leafPath || leafPath === "ROOT") return `${specialist.bucketKey} :: ROOT`;
  const normalizedSegments = leafPath
    .split(" -> ")
    .map((segment) => {
      const match = segment.match(/^(.*?)(<=|>)(-?\d+(?:\.\d+)?)$/);
      if (!match) return segment;
      const [, feature, operator, thresholdRaw] = match;
      const threshold = Number(thresholdRaw);
      if (!Number.isFinite(threshold)) return segment;
      return `${feature}${operator}${normalizeLeafThreshold(feature, threshold)}`;
    })
    .sort((left, right) => left.localeCompare(right));
  return `${specialist.bucketKey} :: ${normalizedSegments.join(" & ")}`;
}

type PackGateConfig = {
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

function computeWilsonLowerBound(successes: number, samples: number): number {
  if (samples <= 0) return 0;
  const z = 1.96;
  const phat = successes / samples;
  const denom = 1 + (z * z) / samples;
  const center = phat + (z * z) / (2 * samples);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * samples)) / samples);
  return round(((center - margin) / denom) * 100, 2);
}

function addDays(dateEt: string, days: number): string {
  const date = new Date(`${dateEt}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function summarizeLeafDelta(rows: RouterDatasetRow[], decision: RouterDecision): {
  samples: number;
  vetoHitRate: number;
  delta: number;
} {
  const samples = rows.length;
  if (!samples) {
    return { samples: 0, vetoHitRate: 0, delta: 0 };
  }
  const baselineWins = rows.filter((row) => row.baselineCorrect).length;
  const universalWins = rows.filter((row) => row.universalCorrect).length;
  const candidateWins = decision === "VETO_BASELINE" ? baselineWins : universalWins;
  return {
    samples,
    vetoHitRate: round((baselineWins / samples) * 100, 2),
    delta: round(((candidateWins - universalWins) / samples) * 100, 2),
  };
}

function buildLeafMetadataMap(
  model: UniversalBaselineRouterModel,
  rows: RouterDatasetRow[],
  gate: PackGateConfig,
): Map<string, LeafMetadata> {
  const maxDate = rows.reduce((latest, row) => (row.gameDateEt > latest ? row.gameDateEt : latest), "");
  const cutoff14 = maxDate ? addDays(maxDate, -13) : "";
  const cutoff30 = maxDate ? addDays(maxDate, -29) : "";
  const byLeaf = new Map<string, { decision: RouterDecision; rows: RouterDatasetRow[] }>();

  rows.forEach((row) => {
    const resolved = resolveRouterLeaf(model, row);
    const entry = byLeaf.get(resolved.path) ?? { decision: resolved.leaf.decision, rows: [] };
    entry.rows.push(row);
    byLeaf.set(resolved.path, entry);
  });

  const metadata = new Map<string, LeafMetadata>();
  byLeaf.forEach((entry, leafPath) => {
    const overall = summarizeLeafDelta(entry.rows, entry.decision);
    const recent14 = summarizeLeafDelta(
      cutoff14 ? entry.rows.filter((row) => row.gameDateEt >= cutoff14) : [],
      entry.decision,
    );
    const recent30 = summarizeLeafDelta(
      cutoff30 ? entry.rows.filter((row) => row.gameDateEt >= cutoff30) : [],
      entry.decision,
    );
    const baselineWins = entry.rows.filter((row) => row.baselineCorrect).length;
    const wilsonLowerBound = computeWilsonLowerBound(baselineWins, entry.rows.length);
    const activeByTemporalGate =
      entry.decision === "VETO_BASELINE" &&
      entry.rows.length >= gate.minLeafDisagreementSamples &&
      wilsonLowerBound >= gate.minLeafWilsonLowerBound &&
      recent14.delta >= gate.minLeafRecent14dDelta &&
      recent30.delta >= gate.minLeafRecent30dDelta;

    metadata.set(leafPath, {
      leafPath,
      decision: entry.decision,
      disagreementSamples: entry.rows.length,
      vetoHitRate: overall.vetoHitRate,
      wilsonLowerBound,
      overallDelta: overall.delta,
      recent14dSamples: recent14.samples,
      recent14dDelta: recent14.delta,
      recent30dSamples: recent30.samples,
      recent30dDelta: recent30.delta,
      activeByTemporalGate,
    });
  });

  return metadata;
}

function buildOosSignatureStats(
  specialist: SpecialistConfig,
  trainRows: RouterDatasetRow[],
  gate: PackGateConfig,
  minTrainDates: number,
  testDates: number,
): Map<string, OosSignatureStats> {
  const scopedRows = trainRows.filter((row) => row.bucketKey === specialist.bucketKey);
  const uniqueDates = [...new Set(scopedRows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const folds = buildRecentFoldSlices(uniqueDates, minTrainDates, testDates, gate.recurrenceFolds);
  const bySignature = new Map<
    string,
    {
      specialistId: string;
      bucketKey: string;
      foldStats: Map<string, SignatureFoldStats>;
    }
  >();

  folds.forEach((fold) => {
    const testSet = new Set(fold.testDates);
    const foldTrainRows = scopedRows.filter((row) => row.gameDateEt < fold.testDates[0]);
    const foldTestRows = scopedRows.filter((row) => testSet.has(row.gameDateEt));
    if (foldTrainRows.length < specialist.minLeaf * 2 || foldTestRows.length === 0) return;
    const model = trainUniversalBaselineRouter(foldTrainRows, {
      maxDepth: specialist.maxDepth,
      minLeaf: specialist.minLeaf,
      featureMode: specialist.featureMode,
    });
    foldTestRows.forEach((row) => {
      const rawAction = predictUniversalBaselineRouter(model, row);
      if (rawAction !== "VETO_BASELINE") return;
      const resolved = resolveRouterLeaf(model, row);
      const signature = normalizeLeafSignature(specialist, resolved.path);
      const entry = bySignature.get(signature) ?? {
        specialistId: specialist.id,
        bucketKey: specialist.bucketKey,
        foldStats: new Map<string, SignatureFoldStats>(),
      };
      const foldEntry = entry.foldStats.get(fold.foldId) ?? {
        foldId: fold.foldId,
        vetoRows: 0,
        vetoWins: 0,
        controlWins: 0,
      };
      foldEntry.vetoRows += 1;
      if (row.baselineCorrect && !row.universalCorrect) foldEntry.vetoWins += 1;
      if (row.universalCorrect && !row.baselineCorrect) foldEntry.controlWins += 1;
      entry.foldStats.set(fold.foldId, foldEntry);
      bySignature.set(signature, entry);
    });
  });

  const foldOrder = folds.map((fold) => fold.foldId);
  const last2FoldIds = new Set(foldOrder.slice(-2));
  const walkFoldIds = new Set(foldOrder);

  return new Map(
    [...bySignature.entries()].map(([signature, entry]) => {
      const foldStats = [...entry.foldStats.values()].sort(
        (left, right) => foldOrder.indexOf(left.foldId) - foldOrder.indexOf(right.foldId),
      );
      const foldAppearances = foldStats.filter((fold) => fold.vetoRows > 0).length;
      const oosVetoRows = foldStats.reduce((sum, fold) => sum + fold.vetoRows, 0);
      const oosVetoWins = foldStats.reduce((sum, fold) => sum + fold.vetoWins, 0);
      const pooledVetoHitRate = oosVetoRows > 0 ? round((oosVetoWins / oosVetoRows) * 100, 2) : 0;
      const pooledWilsonLowerBound = computeWilsonLowerBound(oosVetoWins, oosVetoRows);
      const last2FoldStats = foldStats.filter((fold) => last2FoldIds.has(fold.foldId));
      const last2FoldRows = last2FoldStats.reduce((sum, fold) => sum + fold.vetoRows, 0);
      const last2FoldVetoWins = last2FoldStats.reduce((sum, fold) => sum + fold.vetoWins, 0);
      const last2FoldControlWins = last2FoldStats.reduce((sum, fold) => sum + fold.controlWins, 0);
      const last2FoldDelta =
        last2FoldRows > 0 ? round(((last2FoldVetoWins - last2FoldControlWins) / last2FoldRows) * 100, 2) : -999;
      const walkStats = foldStats.filter((fold) => walkFoldIds.has(fold.foldId));
      const walkRows = walkStats.reduce((sum, fold) => sum + fold.vetoRows, 0);
      const walkVetoWins = walkStats.reduce((sum, fold) => sum + fold.vetoWins, 0);
      const walkControlWins = walkStats.reduce((sum, fold) => sum + fold.controlWins, 0);
      const walkDelta = walkRows > 0 ? round(((walkVetoWins - walkControlWins) / walkRows) * 100, 2) : -999;
      const stats: OosSignatureStats = {
        signature,
        specialistId: entry.specialistId,
        bucketKey: entry.bucketKey,
        foldAppearances,
        oosVetoRows,
        oosVetoWins,
        pooledVetoHitRate,
        pooledWilsonLowerBound,
        last2FoldRows,
        last2FoldVetoWins,
        last2FoldDelta,
        walkRows,
        walkVetoWins,
        walkDelta,
        activeByOosGate:
          foldAppearances >= gate.minFoldAppearances &&
          oosVetoRows >= gate.minOosVetoRows &&
          pooledVetoHitRate >= gate.minOosVetoHitRate &&
          pooledWilsonLowerBound >= gate.minOosWilson &&
          last2FoldDelta >= gate.minLast2FoldDelta &&
          walkDelta >= gate.minWalkDelta,
        foldStats,
      };
      return [signature, stats];
    }),
  );
}

type SpecialistFit = {
  specialist: SpecialistConfig;
  model: UniversalBaselineRouterModel | null;
  leafMetadata: Map<string, LeafMetadata>;
  oosSignatureStats: Map<string, OosSignatureStats>;
  predictions: Map<string, SpecialistPrediction>;
};

function fitSpecialist(
  specialist: SpecialistConfig,
  trainRows: RouterDatasetRow[],
  testRows: RouterDatasetRow[],
  gate: PackGateConfig,
  minTrainDates: number,
  testDates: number,
): SpecialistFit {
  const scopedTrain = trainRows.filter((row) => row.bucketKey === specialist.bucketKey);
  const scopedTest = testRows.filter((row) => row.bucketKey === specialist.bucketKey);
  const oosSignatureStats = buildOosSignatureStats(specialist, trainRows, gate, minTrainDates, testDates);
  if (scopedTest.length === 0 || scopedTrain.length === 0) {
    return {
      specialist,
      model: null,
      leafMetadata: new Map(),
      oosSignatureStats,
      predictions: new Map(),
    };
  }
  const model = trainUniversalBaselineRouter(scopedTrain, {
    maxDepth: specialist.maxDepth,
    minLeaf: specialist.minLeaf,
    featureMode: specialist.featureMode,
  });
  const leafMetadata = buildLeafMetadataMap(model, scopedTrain, gate);
  const predictions = new Map<string, SpecialistPrediction>();
  scopedTest.forEach((row) => {
    const rawAction = predictUniversalBaselineRouter(model, row);
    const resolved = resolveRouterLeaf(model, row);
    const leafSignature = normalizeLeafSignature(specialist, resolved.path);
    const oosStats = oosSignatureStats.get(leafSignature);
    const passesAccuracyGate =
      gate.minVetoLeafAccuracy == null || resolved.leaf.accuracy >= gate.minVetoLeafAccuracy;
    const passesOosGate = oosStats?.activeByOosGate ?? false;
    const gateAllowed = rawAction !== "VETO_BASELINE" ? true : passesAccuracyGate && passesOosGate;
    const gatedAction = rawAction === "VETO_BASELINE" && !gateAllowed ? "KEEP_UNIVERSAL" : rawAction;
    predictions.set(row.rowKey, {
      action: gatedAction,
      rawAction,
      gateAllowed,
      specialistId: specialist.id,
      bucketKey: specialist.bucketKey,
      leafPath: resolved.path,
      leafSignature,
      leafAccuracy: resolved.leaf.accuracy,
      oosFoldAppearances: oosStats?.foldAppearances ?? 0,
      oosVetoRows: oosStats?.oosVetoRows ?? 0,
      oosPooledHitRate: oosStats?.pooledVetoHitRate ?? 0,
      oosWilsonLowerBound: oosStats?.pooledWilsonLowerBound ?? 0,
      oosLast2FoldDelta: oosStats?.last2FoldDelta ?? 0,
      oosWalkDelta: oosStats?.walkDelta ?? 0,
    });
  });
  return {
    specialist,
    model,
    leafMetadata,
    oosSignatureStats,
    predictions,
  };
}

function fitPack(
  trainRows: RouterDatasetRow[],
  testRows: RouterDatasetRow[],
  gate: PackGateConfig,
  minTrainDates: number,
  testDates: number,
): { fits: SpecialistFit[]; predictions: Map<string, SpecialistPrediction> } {
  const fits = SPECIALIST_PACK_V1.map((specialist) =>
    fitSpecialist(specialist, trainRows, testRows, gate, minTrainDates, testDates),
  );
  const predictions = new Map<string, SpecialistPrediction>();
  fits.forEach((fit) => fit.predictions.forEach((value, key) => predictions.set(key, value)));
  return { fits, predictions };
}

function summarizePackDisagreementRows(
  packRows: RouterDatasetRow[],
  predictions: Map<string, SpecialistPrediction>,
): {
  samples: number;
  controlAccuracy: number;
  candidateAccuracy: number;
  vetoRows: number;
  vetoPct: number;
  vetoHitRate: number;
  keptUniversalHitRate: number;
} {
  const samples = packRows.length;
  const controlCorrect = packRows.filter((row) => row.universalCorrect).length;
  const candidateCorrect = packRows.filter((row) => {
    const action = predictions.get(row.rowKey)?.action ?? "KEEP_UNIVERSAL";
    return action === "VETO_BASELINE" ? row.baselineCorrect : row.universalCorrect;
  }).length;
  const vetoed = packRows.filter((row) => (predictions.get(row.rowKey)?.action ?? "KEEP_UNIVERSAL") === "VETO_BASELINE");
  const kept = packRows.filter((row) => (predictions.get(row.rowKey)?.action ?? "KEEP_UNIVERSAL") === "KEEP_UNIVERSAL");
  const vetoHits = vetoed.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
  const keptHits = kept.filter((row) => row.universalCorrect && !row.baselineCorrect).length;
  return {
    samples,
    controlAccuracy: samples > 0 ? round((controlCorrect / samples) * 100, 2) : 0,
    candidateAccuracy: samples > 0 ? round((candidateCorrect / samples) * 100, 2) : 0,
    vetoRows: vetoed.length,
    vetoPct: samples > 0 ? round((vetoed.length / samples) * 100, 2) : 0,
    vetoHitRate: vetoed.length > 0 ? round((vetoHits / vetoed.length) * 100, 2) : 0,
    keptUniversalHitRate: kept.length > 0 ? round((keptHits / kept.length) * 100, 2) : 0,
  };
}

function summarizeGateActionRows(
  rows: RouterDatasetRow[],
  predictions: Map<string, SpecialistPrediction>,
): {
  rawVetoRows: number;
  blockedVetoRows: number;
  blockedVetoHitRate: number;
  allowedVetoRows: number;
  allowedVetoHitRate: number;
} {
  const rawVetoRows = rows.filter((row) => (predictions.get(row.rowKey)?.rawAction ?? "KEEP_UNIVERSAL") === "VETO_BASELINE");
  const blockedVetoRows = rawVetoRows.filter((row) => !(predictions.get(row.rowKey)?.gateAllowed ?? true));
  const allowedVetoRows = rawVetoRows.filter((row) => predictions.get(row.rowKey)?.gateAllowed ?? false);
  const blockedHits = blockedVetoRows.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
  const allowedHits = allowedVetoRows.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
  return {
    rawVetoRows: rawVetoRows.length,
    blockedVetoRows: blockedVetoRows.length,
    blockedVetoHitRate: blockedVetoRows.length > 0 ? round((blockedHits / blockedVetoRows.length) * 100, 2) : 0,
    allowedVetoRows: allowedVetoRows.length,
    allowedVetoHitRate: allowedVetoRows.length > 0 ? round((allowedHits / allowedVetoRows.length) * 100, 2) : 0,
  };
}

function summarizeSpecialistRows(
  bucketKey: string,
  packRows: RouterDatasetRow[],
  predictions: Map<string, SpecialistPrediction>,
  evaluatedRows: EvaluatedRow[],
): {
  bucketKey: string;
  disagreementRows: number;
  controlAccuracy: number;
  candidateAccuracy: number;
  rawVetoRows: number;
  blockedVetoRows: number;
  blockedVetoHitRate: number;
  allowedVetoRows: number;
  allowedVetoHitRate: number;
  vetoRows: number;
  vetoPct: number;
  vetoHitRate: number;
  keptUniversalHitRate: number;
  controlBlendedAccuracy: number;
  candidateBlendedAccuracy: number;
  deltaBlendedPct: number;
  controlCoveragePct: number;
  candidateCoveragePct: number;
} {
  const scopedPackRows = packRows.filter((row) => row.bucketKey === bucketKey);
  const scopedEvaluatedRows = evaluatedRows.filter((row) => `${row.row.market}|${row.rawDecision.archetype ?? "UNKNOWN"}` === bucketKey);
  const disagreement = summarizePackDisagreementRows(scopedPackRows, predictions);
  const control = summarizeMetrics(scopedEvaluatedRows, predictions, false);
  const candidate = summarizeMetrics(scopedEvaluatedRows, predictions, true);
  const rawVetoRows = scopedPackRows.filter((row) => (predictions.get(row.rowKey)?.rawAction ?? "KEEP_UNIVERSAL") === "VETO_BASELINE");
  const blockedVetoRows = rawVetoRows.filter((row) => !(predictions.get(row.rowKey)?.gateAllowed ?? true));
  const allowedVetoRows = rawVetoRows.filter((row) => predictions.get(row.rowKey)?.gateAllowed ?? false);
  const blockedHits = blockedVetoRows.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
  const allowedHits = allowedVetoRows.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
  return {
    bucketKey,
    disagreementRows: scopedPackRows.length,
    controlAccuracy: disagreement.controlAccuracy,
    candidateAccuracy: disagreement.candidateAccuracy,
    rawVetoRows: rawVetoRows.length,
    blockedVetoRows: blockedVetoRows.length,
    blockedVetoHitRate: blockedVetoRows.length > 0 ? round((blockedHits / blockedVetoRows.length) * 100, 2) : 0,
    allowedVetoRows: allowedVetoRows.length,
    allowedVetoHitRate: allowedVetoRows.length > 0 ? round((allowedHits / allowedVetoRows.length) * 100, 2) : 0,
    vetoRows: disagreement.vetoRows,
    vetoPct: disagreement.vetoPct,
    vetoHitRate: disagreement.vetoHitRate,
    keptUniversalHitRate: disagreement.keptUniversalHitRate,
    controlBlendedAccuracy: control.blendedAccuracy,
    candidateBlendedAccuracy: candidate.blendedAccuracy,
    deltaBlendedPct: round(candidate.blendedAccuracy - control.blendedAccuracy, 2),
    controlCoveragePct: control.coveragePct,
    candidateCoveragePct: candidate.coveragePct,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);

  const allDisagreementRows = readJsonl<RouterDatasetRow>(args.dataset).filter((row) => row.routerTarget != null);
  const packBucketSet = new Set(SPECIALIST_PACK_V1.map((specialist) => specialist.bucketKey));
  const packRows = allDisagreementRows.filter((row) => packBucketSet.has(row.bucketKey));
  const gate: PackGateConfig = {
    minVetoLeafAccuracy: args.minVetoLeafAccuracy,
    minLeafDisagreementSamples: args.minLeafDisagreementSamples,
    minLeafWilsonLowerBound: args.minLeafWilsonLowerBound,
    minLeafRecent14dDelta: args.minLeafRecent14dDelta,
    minLeafRecent30dDelta: args.minLeafRecent30dDelta,
    minFoldAppearances: args.minFoldAppearances,
    recurrenceFolds: args.recurrenceFolds,
    minOosVetoRows: args.minOosVetoRows,
    minOosVetoHitRate: args.minOosVetoHitRate,
    minOosWilson: args.minOosWilson,
    minLast2FoldDelta: args.minLast2FoldDelta,
    minWalkDelta: args.minWalkDelta,
  };

  const overallFit = fitPack(packRows, packRows, gate, args.minTrainDates, args.testDates);

  const maxDate = evaluatedRows.reduce((latest, row) => (row.row.gameDateEt > latest ? row.row.gameDateEt : latest), "");
  const cutoff14 = new Date(`${maxDate}T00:00:00Z`);
  cutoff14.setUTCDate(cutoff14.getUTCDate() - 13);
  const cutoff14Str = cutoff14.toISOString().slice(0, 10);
  const cutoff30 = new Date(`${maxDate}T00:00:00Z`);
  cutoff30.setUTCDate(cutoff30.getUTCDate() - 29);
  const cutoff30Str = cutoff30.toISOString().slice(0, 10);

  const rows14 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff14Str);
  const rows30 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff30Str);
  const train14 = packRows.filter((row) => row.gameDateEt < cutoff14Str);
  const test14 = packRows.filter((row) => row.gameDateEt >= cutoff14Str);
  const train30 = packRows.filter((row) => row.gameDateEt < cutoff30Str);
  const test30 = packRows.filter((row) => row.gameDateEt >= cutoff30Str);
  const fit14 = fitPack(train14, test14, gate, args.minTrainDates, args.testDates);
  const fit30 = fitPack(train30, test30, gate, args.minTrainDates, args.testDates);

  const uniqueDates = [...new Set(filteredRows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const walkDates = buildWalkDateSet(uniqueDates, args.minTrainDates, args.testDates, args.latestFolds);
  const walkPredictions = new Map<string, SpecialistPrediction>();
  if (walkDates.size > 0) {
    const walkFolds = buildRecentFoldSlices(uniqueDates, args.minTrainDates, args.testDates, args.latestFolds);
    for (const fold of walkFolds) {
      const testSet = new Set(fold.testDates);
      const trainRows = packRows.filter((row) => row.gameDateEt < fold.testDates[0]);
      const testRows = packRows.filter((row) => testSet.has(row.gameDateEt));
      const fit = fitPack(trainRows, testRows, gate, args.minTrainDates, args.testDates);
      fit.predictions.forEach((value, key) => walkPredictions.set(key, value));
    }
  }
  const walkRows = evaluatedRows.filter((row) => walkDates.has(row.row.gameDateEt));

  const overall = comparison(evaluatedRows, overallFit.predictions);
  const windows = {
    "14d": comparison(rows14, fit14.predictions),
    "30d": comparison(rows30, fit30.predictions),
    walk: comparison(walkRows, walkPredictions),
  };

  const overlapCounts = new Map<string, number>();
  packRows.forEach((row) => {
    const matches = SPECIALIST_PACK_V1.filter((specialist) => specialist.bucketKey === row.bucketKey).length;
    overlapCounts.set(row.rowKey, matches);
  });
  const overlapCount = [...overlapCounts.values()].filter((count) => count > 1).length;

  const specialistSummaries = SPECIALIST_PACK_V1.map((specialist) =>
    summarizeSpecialistRows(specialist.bucketKey, packRows, overallFit.predictions, evaluatedRows),
  );
  const specialistWindowSummaries = {
    "14d": SPECIALIST_PACK_V1.map((specialist) =>
      summarizeSpecialistRows(specialist.bucketKey, test14, fit14.predictions, rows14),
    ),
    "30d": SPECIALIST_PACK_V1.map((specialist) =>
      summarizeSpecialistRows(specialist.bucketKey, test30, fit30.predictions, rows30),
    ),
    walk: SPECIALIST_PACK_V1.map((specialist) => {
      const walkPackRows = packRows.filter((row) => walkDates.has(row.gameDateEt));
      return summarizeSpecialistRows(specialist.bucketKey, walkPackRows, walkPredictions, walkRows);
    }),
  };

  const leafSummaries = overallFit.fits.map((fit) => {
    const predictions = fit.predictions;
    const scopedRows = packRows.filter((row) => row.bucketKey === fit.specialist.bucketKey);
    const leafBuckets = new Map<
      string,
      {
        decision: RouterDecision;
        count: number;
        leafAccuracy: number;
        universalWins: number;
        baselineWins: number;
        candidateWins: number;
      }
    >();
    if (fit.model != null) {
      scopedRows.forEach((row) => {
        const resolved = resolveRouterLeaf(fit.model!, row);
        const prediction = predictions.get(row.rowKey);
        const action = prediction?.action ?? "KEEP_UNIVERSAL";
        const candidateWin = action === "VETO_BASELINE" ? row.baselineCorrect : row.universalCorrect;
        const entry = leafBuckets.get(resolved.path) ?? {
          decision: resolved.leaf.decision,
          count: 0,
          leafAccuracy: resolved.leaf.accuracy,
          universalWins: 0,
          baselineWins: 0,
          candidateWins: 0,
        };
        entry.count += 1;
        if (row.universalCorrect) entry.universalWins += 1;
        if (row.baselineCorrect) entry.baselineWins += 1;
        if (candidateWin) entry.candidateWins += 1;
        leafBuckets.set(resolved.path, entry);
      });
    }
    return {
      specialistId: fit.specialist.id,
      bucketKey: fit.specialist.bucketKey,
      topLeaves: [...leafBuckets.entries()]
        .map(([leafPath, leaf]) => {
          const meta = fit.leafMetadata.get(leafPath);
          const signature = normalizeLeafSignature(fit.specialist, leafPath);
          const oosStats = fit.oosSignatureStats.get(signature);
          return {
          leafPath,
          signature,
          decision: leaf.decision,
          samples: leaf.count,
          leafAccuracy: leaf.leafAccuracy,
          gateAllowed: oosStats?.activeByOosGate ?? false,
          disagreementSamples: meta?.disagreementSamples ?? leaf.count,
          vetoHitRate: meta?.vetoHitRate ?? 0,
          wilsonLowerBound: meta?.wilsonLowerBound ?? 0,
          overallDelta: meta?.overallDelta ?? 0,
          recent14dSamples: meta?.recent14dSamples ?? 0,
          recent14dDelta: meta?.recent14dDelta ?? 0,
          recent30dSamples: meta?.recent30dSamples ?? 0,
          recent30dDelta: meta?.recent30dDelta ?? 0,
          oosFoldAppearances: oosStats?.foldAppearances ?? 0,
          oosVetoRows: oosStats?.oosVetoRows ?? 0,
          oosPooledHitRate: oosStats?.pooledVetoHitRate ?? 0,
          oosWilsonLowerBound: oosStats?.pooledWilsonLowerBound ?? 0,
          oosLast2FoldDelta: oosStats?.last2FoldDelta ?? 0,
          oosWalkDelta: oosStats?.walkDelta ?? 0,
          universalWinRate: round((leaf.universalWins / leaf.count) * 100, 2),
          baselineWinRate: round((leaf.baselineWins / leaf.count) * 100, 2),
          candidateAccuracy: round((leaf.candidateWins / leaf.count) * 100, 2),
          deltaVsControl: round(((leaf.candidateWins - leaf.universalWins) / leaf.count) * 100, 2),
          };
        })
        .filter((leaf) => leaf.samples >= args.leafSampleFloor)
        .sort((left, right) => {
          if (right.deltaVsControl !== left.deltaVsControl) return right.deltaVsControl - left.deltaVsControl;
          return right.samples - left.samples;
        })
        .slice(0, 6),
    };
  });

  const byBucket = (() => {
    const grouped = new Map<string, EvaluatedRow[]>();
    evaluatedRows.forEach((row) => {
      const bucketKey = `${row.row.market}|${row.rawDecision.archetype ?? "UNKNOWN"}`;
      const list = grouped.get(bucketKey) ?? [];
      list.push(row);
      grouped.set(bucketKey, list);
    });
    const deltas = [...grouped.entries()]
      .map(([bucketKey, rows]) => {
        const control = summarizeMetrics(rows, overallFit.predictions, false);
        const candidate = summarizeMetrics(rows, overallFit.predictions, true);
        const [market, ...rest] = bucketKey.split("|");
        return {
          bucketKey,
          market: market as Market,
          archetype: rest.join("|"),
          samples: rows.length,
          controlBlendedAccuracy: control.blendedAccuracy,
          candidateBlendedAccuracy: candidate.blendedAccuracy,
          deltaBlendedPct: round(candidate.blendedAccuracy - control.blendedAccuracy, 2),
          controlCoveragePct: control.coveragePct,
          candidateCoveragePct: candidate.coveragePct,
        };
      })
      .filter((row) => row.samples >= args.bucketSampleFloor);
    return {
      gains: deltas.filter((row) => row.deltaBlendedPct > 0).sort((a, b) => b.deltaBlendedPct - a.deltaBlendedPct).slice(0, 20),
      losses: deltas.filter((row) => row.deltaBlendedPct < 0).sort((a, b) => a.deltaBlendedPct - b.deltaBlendedPct).slice(0, 20),
    };
  })();

  const modelManifest = {
    generatedAt: new Date().toISOString(),
    packName: "specialist-router-pack-v3",
    gate,
    specialists: overallFit.fits.map((fit) => ({
      specialistId: fit.specialist.id,
      bucketKey: fit.specialist.bucketKey,
      config: fit.specialist,
      model: fit.model,
      leafMetadata: [...fit.leafMetadata.values()],
      oosSignatureStats: [...fit.oosSignatureStats.values()],
    })),
  };

  const out = {
    generatedAt: new Date().toISOString(),
    controlDefinition: "canonical current live stack",
    candidateDefinition: `specialist-router-pack-v3 oos-recurring-leaf-signatures minVetoLeafAccuracy=${args.minVetoLeafAccuracy ?? 0} minFoldAppearances=${args.minFoldAppearances}/${args.recurrenceFolds} minOosVetoRows=${args.minOosVetoRows} minOosVetoHitRate=${args.minOosVetoHitRate} minOosWilson=${args.minOosWilson} minLast2FoldDelta=${args.minLast2FoldDelta} minWalkDelta=${args.minWalkDelta}`,
    packSpecialists: SPECIALIST_PACK_V1,
    gate,
    datasetSummary: {
      allRows: evaluatedRows.length,
      qualifiedRows: evaluatedRows.filter((row) => row.qualifiedDecision.qualified && row.qualifiedDecision.side !== "NEUTRAL").length,
      disagreementRows: allDisagreementRows.length,
      packDisagreementRows: packRows.length,
      overlapCount,
    },
    overall,
    windows,
    disagreementRows: summarizePackDisagreementRows(packRows, overallFit.predictions),
    gateStats: summarizeGateActionRows(packRows, overallFit.predictions),
    perSpecialist: specialistSummaries,
    perSpecialistWindows: specialistWindowSummaries,
    specialistLeaves: leafSummaries,
    topBucketGains: byBucket.gains,
    topBucketLosses: byBucket.losses,
  };

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(path.resolve(args.out), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(path.resolve(args.modelOut)), { recursive: true });
  await writeFile(path.resolve(args.modelOut), `${JSON.stringify(modelManifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
