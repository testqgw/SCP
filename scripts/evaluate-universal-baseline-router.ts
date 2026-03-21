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

type RouterDatasetRow = {
  rowKey: string;
  gameDateEt: string;
  bucketKey: string;
  market: Market;
  archetype: string;
  qualifiedSide: Side;
  finalSide: Side;
  universalCorrect: boolean;
  baselineCorrect: boolean;
  routerTarget: 0 | 1 | null;
  routerV0Veto: boolean;
  routerV0Reasons: string[];
};

type Args = {
  input: string;
  dataset: string;
  out: string;
  minActualMinutes: number;
  minTrainDates: number;
  testDates: number;
  latestFolds: number;
  bucketSampleFloor: number;
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

type ByReasonRow = {
  reason: string;
  samples: number;
  vetoHitRate: number;
  deltaBlendedPct: number;
};

type BucketDeltaRow = {
  bucketKey: string;
  market: Market;
  archetype: string;
  samples: number;
  controlBlendedAccuracy: number;
  candidateBlendedAccuracy: number;
  deltaBlendedPct: number;
  controlCoveragePct: number;
  candidateCoveragePct: number;
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
  let out = path.join("exports", "universal-baseline-router-v0-eval.json");
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
  let latestFolds = 2;
  let bucketSampleFloor = 50;

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
    if (token === "--dataset" && next) {
      dataset = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--dataset=")) {
      dataset = token.slice("--dataset=".length);
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
    if (token === "--min-train-dates" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-train-dates=")) {
      const parsed = Number(token.slice("--min-train-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
      continue;
    }
    if (token === "--test-dates" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--test-dates=")) {
      const parsed = Number(token.slice("--test-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
      continue;
    }
    if (token === "--latest-folds" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--latest-folds=")) {
      const parsed = Number(token.slice("--latest-folds=".length));
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
      continue;
    }
    if (token === "--bucket-sample-floor" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) bucketSampleFloor = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--bucket-sample-floor=")) {
      const parsed = Number(token.slice("--bucket-sample-floor=".length));
      if (Number.isFinite(parsed) && parsed > 0) bucketSampleFloor = Math.floor(parsed);
      continue;
    }
  }

  return { input, dataset, out, minActualMinutes, minTrainDates, testDates, latestFolds, bucketSampleFloor };
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
    return {
      row,
      rowKey: buildRowKey(row),
      rawDecision,
      qualifiedDecision: qualifyLiveUniversalModelDecision(rawDecision),
    };
  });
}

function readJsonl<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) return [];
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function summarizeMetrics(rows: EvaluatedRow[], routerRows: Map<string, RouterDatasetRow>, candidate: boolean): EvalMetrics {
  let chosenUniversalPicks = 0;
  let chosenUniversalCorrect = 0;
  let blendedCorrect = 0;

  rows.forEach((evaluated) => {
    const controlUsesUniversal = evaluated.qualifiedDecision.qualified && evaluated.qualifiedDecision.side !== "NEUTRAL";
    const veto = candidate && routerRows.get(evaluated.rowKey)?.routerV0Veto === true;
    const candidateUsesUniversal = controlUsesUniversal && !veto;
    const chosenSide = candidateUsesUniversal ? (evaluated.qualifiedDecision.side as Side) : evaluated.row.finalSide;

    if (candidateUsesUniversal) {
      chosenUniversalPicks += 1;
      if (chosenSide === evaluated.row.actualSide) chosenUniversalCorrect += 1;
    }
    if (chosenSide === evaluated.row.actualSide) blendedCorrect += 1;
  });

  return {
    samples: rows.length,
    blendedAccuracy: rows.length > 0 ? round((blendedCorrect / rows.length) * 100, 2) : 0,
    qualifiedAccuracy: chosenUniversalPicks > 0 ? round((chosenUniversalCorrect / chosenUniversalPicks) * 100, 2) : null,
    qualifiedPicks: chosenUniversalPicks,
    coveragePct: rows.length > 0 ? round((chosenUniversalPicks / rows.length) * 100, 2) : 0,
  };
}

function buildComparison(rows: EvaluatedRow[], routerRows: Map<string, RouterDatasetRow>): Comparison {
  const control = summarizeMetrics(rows, routerRows, false);
  const candidate = summarizeMetrics(rows, routerRows, true);
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

function buildWalkRows(rows: EvaluatedRow[], minTrainDates: number, testDates: number, latestFolds: number): EvaluatedRow[] {
  const uniqueDates = [...new Set(rows.map((row) => row.row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  if (uniqueDates.length < minTrainDates + testDates) return [];
  const planned: string[][] = [];
  for (let trainDateCount = minTrainDates; trainDateCount < uniqueDates.length; trainDateCount += testDates) {
    const testDateSlice = uniqueDates.slice(trainDateCount, trainDateCount + testDates);
    if (testDateSlice.length === 0) break;
    planned.push(testDateSlice);
  }
  const selected = planned.slice(-latestFolds).flat();
  const selectedDates = new Set(selected);
  return rows.filter((row) => selectedDates.has(row.row.gameDateEt));
}

function summarizeDisagreementRows(routerDataset: RouterDatasetRow[]): {
  samples: number;
  controlAccuracy: number;
  candidateAccuracy: number;
  vetoRows: number;
  vetoPct: number;
  vetoHitRate: number;
  keptUniversalHitRate: number;
} {
  const samples = routerDataset.length;
  const controlCorrect = routerDataset.filter((row) => row.universalCorrect).length;
  const candidateCorrect = routerDataset.filter((row) => (row.routerV0Veto ? row.baselineCorrect : row.universalCorrect)).length;
  const vetoRows = routerDataset.filter((row) => row.routerV0Veto).length;
  const vetoHits = routerDataset.filter((row) => row.routerV0Veto && row.baselineCorrect && !row.universalCorrect).length;
  const keptRows = routerDataset.filter((row) => !row.routerV0Veto).length;
  const keptUniversalHits = routerDataset.filter((row) => !row.routerV0Veto && row.universalCorrect && !row.baselineCorrect).length;

  return {
    samples,
    controlAccuracy: samples > 0 ? round((controlCorrect / samples) * 100, 2) : 0,
    candidateAccuracy: samples > 0 ? round((candidateCorrect / samples) * 100, 2) : 0,
    vetoRows,
    vetoPct: samples > 0 ? round((vetoRows / samples) * 100, 2) : 0,
    vetoHitRate: vetoRows > 0 ? round((vetoHits / vetoRows) * 100, 2) : 0,
    keptUniversalHitRate: keptRows > 0 ? round((keptUniversalHits / keptRows) * 100, 2) : 0,
  };
}

function summarizeByReason(routerDataset: RouterDatasetRow[]): ByReasonRow[] {
  const buckets = new Map<string, RouterDatasetRow[]>();
  routerDataset
    .filter((row) => row.routerV0Veto)
    .forEach((row) => {
      row.routerV0Reasons.forEach((reason) => {
        const bucket = buckets.get(reason) ?? [];
        bucket.push(row);
        buckets.set(reason, bucket);
      });
    });

  return [...buckets.entries()]
    .map(([reason, rows]) => {
      const vetoHits = rows.filter((row) => row.baselineCorrect && !row.universalCorrect).length;
      const deltaBlended = rows.reduce((sum, row) => sum + ((row.baselineCorrect ? 1 : 0) - (row.universalCorrect ? 1 : 0)), 0);
      return {
        reason,
        samples: rows.length,
        vetoHitRate: rows.length > 0 ? round((vetoHits / rows.length) * 100, 2) : 0,
        deltaBlendedPct: rows.length > 0 ? round((deltaBlended / rows.length) * 100, 2) : 0,
      };
    })
    .sort((left, right) => {
      if (right.deltaBlendedPct !== left.deltaBlendedPct) return right.deltaBlendedPct - left.deltaBlendedPct;
      return right.samples - left.samples;
    });
}

function summarizeBucketDeltas(
  rows: EvaluatedRow[],
  routerRows: Map<string, RouterDatasetRow>,
  bucketSampleFloor: number,
): { gains: BucketDeltaRow[]; losses: BucketDeltaRow[] } {
  const byBucket = new Map<string, EvaluatedRow[]>();
  rows.forEach((row) => {
    const archetype = row.rawDecision.archetype ?? "UNKNOWN";
    const key = `${row.row.market}|${archetype}`;
    const bucket = byBucket.get(key) ?? [];
    bucket.push(row);
    byBucket.set(key, bucket);
  });

  const deltas = [...byBucket.entries()]
    .map(([bucketKey, bucketRows]) => {
      const control = summarizeMetrics(bucketRows, routerRows, false);
      const candidate = summarizeMetrics(bucketRows, routerRows, true);
      const [market, ...rest] = bucketKey.split("|");
      return {
        bucketKey,
        market: market as Market,
        archetype: rest.join("|"),
        samples: bucketRows.length,
        controlBlendedAccuracy: control.blendedAccuracy,
        candidateBlendedAccuracy: candidate.blendedAccuracy,
        deltaBlendedPct: round(candidate.blendedAccuracy - control.blendedAccuracy, 2),
        controlCoveragePct: control.coveragePct,
        candidateCoveragePct: candidate.coveragePct,
      };
    })
    .filter((row) => row.samples >= bucketSampleFloor);

  return {
    gains: deltas
      .filter((row) => row.deltaBlendedPct > 0)
      .sort((left, right) => {
        if (right.deltaBlendedPct !== left.deltaBlendedPct) return right.deltaBlendedPct - left.deltaBlendedPct;
        return right.samples - left.samples;
      })
      .slice(0, 20),
    losses: deltas
      .filter((row) => row.deltaBlendedPct < 0)
      .sort((left, right) => {
        if (left.deltaBlendedPct !== right.deltaBlendedPct) return left.deltaBlendedPct - right.deltaBlendedPct;
        return right.samples - left.samples;
      })
      .slice(0, 20),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  const datasetPath = path.resolve(args.dataset);
  const outPath = path.resolve(args.out);

  const payload = JSON.parse(await readFile(inputPath, "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);
  const routerDataset = readJsonl<RouterDatasetRow>(datasetPath);
  const routerRows = new Map(routerDataset.map((row) => [row.rowKey, row]));
  const qualifiedRows = evaluatedRows.filter((row) => row.qualifiedDecision.qualified && row.qualifiedDecision.side !== "NEUTRAL").length;
  const trainableRows = routerDataset.filter((row) => row.routerTarget != null).length;

  const overall = buildComparison(evaluatedRows, routerRows);
  const maxDate = evaluatedRows.reduce((latest, row) => (row.row.gameDateEt > latest ? row.row.gameDateEt : latest), "");
  const cutoff14 = new Date(`${maxDate}T00:00:00Z`);
  cutoff14.setUTCDate(cutoff14.getUTCDate() - 13);
  const cutoff30 = new Date(`${maxDate}T00:00:00Z`);
  cutoff30.setUTCDate(cutoff30.getUTCDate() - 29);
  const rows14 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff14.toISOString().slice(0, 10));
  const rows30 = evaluatedRows.filter((row) => row.row.gameDateEt >= cutoff30.toISOString().slice(0, 10));
  const walkRows = buildWalkRows(evaluatedRows, args.minTrainDates, args.testDates, args.latestFolds);
  const disagreementRows = summarizeDisagreementRows(routerDataset);
  const byReason = summarizeByReason(routerDataset);
  const bucketDeltas = summarizeBucketDeltas(evaluatedRows, routerRows, args.bucketSampleFloor);

  const output = {
    generatedAt: new Date().toISOString(),
    controlDefinition: "canonical current live stack",
    candidateDefinition:
      "router-v0-hard-veto-hitlist disagreement-only veto on PA|BENCH_WING, PRA|SCORING_GUARD_CREATOR, RA|TWO_WAY_MARKET_WING, PRA|POINT_FORWARD, PRA|SPOTUP_WING",
    datasetSummary: {
      allRows: evaluatedRows.length,
      qualifiedRows,
      disagreementRows: routerDataset.length,
      trainableRows,
    },
    overall,
    windows: {
      "14d": buildComparison(rows14, routerRows),
      "30d": buildComparison(rows30, routerRows),
      walk: buildComparison(walkRows, routerRows),
    },
    disagreementRows,
    byReason,
    reportSettings: {
      bucketSampleFloor: args.bucketSampleFloor,
      walk: {
        minTrainDates: args.minTrainDates,
        testDates: args.testDates,
        latestFolds: args.latestFolds,
      },
    },
    topBucketGains: bucketDeltas.gains,
    topBucketLosses: bucketDeltas.losses,
  };

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
