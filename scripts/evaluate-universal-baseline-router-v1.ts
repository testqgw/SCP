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
  maxDepth: number;
  minLeaf: number;
  featureMode: RouterFeatureMode;
  bucketKeys: string[];
  minVetoLeafAccuracy: number | null;
};

function parseBucketKeys(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

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

const prisma = new PrismaClient();

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let dataset = path.join("exports", "universal-baseline-router-dataset.jsonl");
  let out = path.join("exports", "universal-baseline-router-v1-eval.json");
  let modelOut = path.join("exports", "universal-baseline-router-live.json");
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
  let latestFolds = 2;
  let bucketSampleFloor = 50;
  let leafSampleFloor = 100;
  let maxDepth = 3;
  let minLeaf = 250;
  let featureMode: RouterFeatureMode = "core_relations";
  const bucketKeys = new Set<string>();
  let minVetoLeafAccuracy: number | null = null;

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
    else if (token === "--bucket-key" && next) {
      parseBucketKeys(next).forEach((bucketKey) => bucketKeys.add(bucketKey));
      index += 1;
    } else if (token.startsWith("--bucket-key=")) {
      parseBucketKeys(token.slice("--bucket-key=".length)).forEach((bucketKey) => bucketKeys.add(bucketKey));
    }
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
    } else if (token === "--max-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) maxDepth = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--max-depth=")) {
      const parsed = Number(token.slice("--max-depth=".length));
      if (Number.isFinite(parsed) && parsed > 0) maxDepth = Math.floor(parsed);
    } else if (token === "--min-leaf" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minLeaf = Math.floor(parsed);
      index += 1;
    } else if (token.startsWith("--min-leaf=")) {
      const parsed = Number(token.slice("--min-leaf=".length));
      if (Number.isFinite(parsed) && parsed > 0) minLeaf = Math.floor(parsed);
    } else if (token === "--min-veto-leaf-accuracy" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minVetoLeafAccuracy = parsed;
      index += 1;
    } else if (token.startsWith("--min-veto-leaf-accuracy=")) {
      const parsed = Number(token.slice("--min-veto-leaf-accuracy=".length));
      if (Number.isFinite(parsed) && parsed > 0) minVetoLeafAccuracy = parsed;
    } else if (token === "--feature-mode" && next) {
      if (next === "core" || next === "core_relations") featureMode = next;
      index += 1;
    } else if (token.startsWith("--feature-mode=")) {
      const value = token.slice("--feature-mode=".length);
      if (value === "core" || value === "core_relations") featureMode = value;
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
    maxDepth,
    minLeaf,
    featureMode,
    bucketKeys: [...bucketKeys],
    minVetoLeafAccuracy,
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
  predictions: Map<string, "KEEP_UNIVERSAL" | "VETO_BASELINE">,
  candidate: boolean,
): EvalMetrics {
  let qualifiedPicks = 0;
  let qualifiedCorrect = 0;
  let blendedCorrect = 0;
  rows.forEach((row) => {
    const controlUsesUniversal = row.qualifiedDecision.qualified && row.qualifiedDecision.side !== "NEUTRAL";
    const action = candidate ? predictions.get(row.rowKey) : undefined;
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

function comparison(rows: EvaluatedRow[], predictions: Map<string, "KEEP_UNIVERSAL" | "VETO_BASELINE">): Comparison {
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

function trainAndPredict(
  trainRows: RouterDatasetRow[],
  testRows: RouterDatasetRow[],
  config: { maxDepth: number; minLeaf: number; featureMode: RouterFeatureMode },
  minVetoLeafAccuracy: number | null,
): { model: UniversalBaselineRouterModel; predictions: Map<string, "KEEP_UNIVERSAL" | "VETO_BASELINE"> } {
  const model = trainUniversalBaselineRouter(trainRows, config);
  return {
    model,
    predictions: new Map(
      testRows.map((row) => {
        const prediction = predictUniversalBaselineRouter(model, row);
        if (prediction === "VETO_BASELINE" && minVetoLeafAccuracy != null) {
          const resolved = resolveRouterLeaf(model, row);
          if (resolved.leaf.accuracy < minVetoLeafAccuracy) {
            return [row.rowKey, "KEEP_UNIVERSAL" as const];
          }
        }
        return [row.rowKey, prediction];
      }),
    ),
  };
}

function summarizeDisagreementRows(
  disagreementRows: RouterDatasetRow[],
  predictions: Map<string, "KEEP_UNIVERSAL" | "VETO_BASELINE">,
): {
  samples: number;
  controlAccuracy: number;
  candidateAccuracy: number;
  vetoRows: number;
  vetoPct: number;
  vetoHitRate: number;
  keptUniversalHitRate: number;
} {
  const samples = disagreementRows.length;
  const controlCorrect = disagreementRows.filter((row) => row.universalCorrect).length;
  const candidateCorrect = disagreementRows.filter((row) => {
    const action = predictions.get(row.rowKey) ?? "KEEP_UNIVERSAL";
    return action === "VETO_BASELINE" ? row.baselineCorrect : row.universalCorrect;
  }).length;
  const vetoed = disagreementRows.filter((row) => (predictions.get(row.rowKey) ?? "KEEP_UNIVERSAL") === "VETO_BASELINE");
  const kept = disagreementRows.filter((row) => (predictions.get(row.rowKey) ?? "KEEP_UNIVERSAL") === "KEEP_UNIVERSAL");
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

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);
  const allDisagreementRows = readJsonl<RouterDatasetRow>(args.dataset).filter((row) => row.routerTarget != null);
  const bucketFilter = args.bucketKeys.length > 0 ? new Set(args.bucketKeys) : null;
  const datasetRows = allDisagreementRows.filter((row) => !bucketFilter || bucketFilter.has(row.bucketKey));
  const config = { maxDepth: args.maxDepth, minLeaf: args.minLeaf, featureMode: args.featureMode };

  const overallTrain = datasetRows;
  const overallPredict = datasetRows;
  const overallFit = trainAndPredict(overallTrain, overallPredict, config, args.minVetoLeafAccuracy);
  const maxDate = evaluatedRows.reduce((latest, row) => (row.row.gameDateEt > latest ? row.row.gameDateEt : latest), "");
  const cutoff14 = new Date(`${maxDate}T00:00:00Z`);
  cutoff14.setUTCDate(cutoff14.getUTCDate() - 13);
  const cutoff14Str = cutoff14.toISOString().slice(0, 10);
  const cutoff30 = new Date(`${maxDate}T00:00:00Z`);
  cutoff30.setUTCDate(cutoff30.getUTCDate() - 29);
  const cutoff30Str = cutoff30.toISOString().slice(0, 10);

  const train14 = datasetRows.filter((row) => row.gameDateEt < cutoff14Str);
  const test14 = datasetRows.filter((row) => row.gameDateEt >= cutoff14Str);
  const train30 = datasetRows.filter((row) => row.gameDateEt < cutoff30Str);
  const test30 = datasetRows.filter((row) => row.gameDateEt >= cutoff30Str);
  const rows14 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff14Str);
  const rows30 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff30Str);
  const fit14 = trainAndPredict(train14, test14, config, args.minVetoLeafAccuracy);
  const fit30 = trainAndPredict(train30, test30, config, args.minVetoLeafAccuracy);

  const uniqueDates = [...new Set(filteredRows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const walkDates = buildWalkDateSet(uniqueDates, args.minTrainDates, args.testDates, args.latestFolds);
  const walkPredictions = new Map<string, "KEEP_UNIVERSAL" | "VETO_BASELINE">();
  if (walkDates.size > 0) {
    const folds: string[][] = [];
    for (let trainDateCount = args.minTrainDates; trainDateCount < uniqueDates.length; trainDateCount += args.testDates) {
      const testDateSlice = uniqueDates.slice(trainDateCount, trainDateCount + args.testDates);
      if (testDateSlice.length === 0) break;
      folds.push(testDateSlice);
    }
    for (const testDateSlice of folds.slice(-args.latestFolds)) {
      const testSet = new Set(testDateSlice);
      const trainRows = datasetRows.filter((row) => row.gameDateEt < testDateSlice[0]);
      const testRows = datasetRows.filter((row) => testSet.has(row.gameDateEt));
      const fit = trainAndPredict(trainRows, testRows, config, args.minVetoLeafAccuracy);
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
  const disagreementSummary = summarizeDisagreementRows(datasetRows, overallFit.predictions);

  const leafBuckets = new Map<string, { decision: string; count: number; keepRate: number; trainAccuracy: number; universalWins: number; baselineWins: number; candidateWins: number; buckets: Map<string, number> }>();
  datasetRows.forEach((row) => {
    const resolved = resolveRouterLeaf(overallFit.model, row);
    const action = overallFit.predictions.get(row.rowKey) ?? "KEEP_UNIVERSAL";
    const candidateWin = action === "VETO_BASELINE" ? row.baselineCorrect : row.universalCorrect;
    const bucket = leafBuckets.get(resolved.path) ?? {
      decision: resolved.leaf.decision,
      count: 0,
      keepRate: resolved.leaf.keepRate,
      trainAccuracy: resolved.leaf.accuracy,
      universalWins: 0,
      baselineWins: 0,
      candidateWins: 0,
      buckets: new Map<string, number>(),
    };
    bucket.count += 1;
    if (row.universalCorrect) bucket.universalWins += 1;
    if (row.baselineCorrect) bucket.baselineWins += 1;
    if (candidateWin) bucket.candidateWins += 1;
    bucket.buckets.set(row.bucketKey, (bucket.buckets.get(row.bucketKey) ?? 0) + 1);
    leafBuckets.set(resolved.path, bucket);
  });

  const leafRows = [...leafBuckets.entries()].map(([leafPath, leaf]) => ({
    leafPath,
    decision: leaf.decision,
    samples: leaf.count,
    keepRate: leaf.keepRate,
    trainAccuracy: leaf.trainAccuracy,
    universalWinRate: round((leaf.universalWins / leaf.count) * 100, 2),
    baselineWinRate: round((leaf.baselineWins / leaf.count) * 100, 2),
    candidateAccuracy: round((leaf.candidateWins / leaf.count) * 100, 2),
    deltaVsControl: round(((leaf.candidateWins - leaf.universalWins) / leaf.count) * 100, 2),
    topBuckets: [...leaf.buckets.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([bucketKey, samples]) => ({ bucketKey, samples, pct: round((samples / leaf.count) * 100, 2) })),
  }));

  const byLeaf = {
    topBySample: leafRows
      .filter((row) => row.samples >= args.leafSampleFloor)
      .sort((left, right) => right.samples - left.samples)
      .slice(0, 12),
    topByLift: leafRows
      .filter((row) => row.samples >= args.leafSampleFloor && row.deltaVsControl > 0)
      .sort((left, right) => {
        if (right.deltaVsControl !== left.deltaVsControl) return right.deltaVsControl - left.deltaVsControl;
        return right.samples - left.samples;
      })
      .slice(0, 12),
  };

  const byBucket = (() => {
    const grouped = new Map<string, EvaluatedRow[]>();
    evaluatedRows.forEach((row) => {
      const bucketKey = `${row.row.market}|${row.rawDecision.archetype ?? "UNKNOWN"}`;
      const list = grouped.get(bucketKey) ?? [];
      list.push(row);
      grouped.set(bucketKey, list);
    });
    const deltas = [...grouped.entries()].map(([bucketKey, rows]) => {
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
    }).filter((row) => row.samples >= args.bucketSampleFloor);
    return {
      gains: deltas.filter((row) => row.deltaBlendedPct > 0).sort((a, b) => b.deltaBlendedPct - a.deltaBlendedPct).slice(0, 20),
      losses: deltas.filter((row) => row.deltaBlendedPct < 0).sort((a, b) => a.deltaBlendedPct - b.deltaBlendedPct).slice(0, 20),
    };
  })();

  const out = {
    generatedAt: new Date().toISOString(),
    controlDefinition: "canonical current live stack",
    candidateDefinition: `router-v1 shallow disagreement keep/veto tree depth=${args.maxDepth} minLeaf=${args.minLeaf} featureMode=${args.featureMode}${args.bucketKeys.length ? ` bucketKeys=${args.bucketKeys.join(",")}` : ""}${args.minVetoLeafAccuracy != null ? ` minVetoLeafAccuracy=${args.minVetoLeafAccuracy}` : ""}`,
    datasetSummary: {
      allRows: evaluatedRows.length,
      qualifiedRows: evaluatedRows.filter((row) => row.qualifiedDecision.qualified && row.qualifiedDecision.side !== "NEUTRAL").length,
      disagreementRows: allDisagreementRows.length,
      specialistDisagreementRows: datasetRows.length,
      trainableRows: datasetRows.length,
    },
    modelConfig: config,
    specialistBucketKeys: args.bucketKeys,
    minVetoLeafAccuracy: args.minVetoLeafAccuracy,
    overall,
    windows,
    disagreementRows: disagreementSummary,
    byLeaf,
    topBucketGains: byBucket.gains,
    topBucketLosses: byBucket.losses,
  };

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(path.resolve(args.out), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(path.resolve(args.modelOut)), { recursive: true });
  await writeFile(path.resolve(args.modelOut), `${JSON.stringify(overallFit.model, null, 2)}\n`, "utf8");
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
