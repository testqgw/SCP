import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
  type LiveUniversalModelDecision,
  type RawLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
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

type PromotionMetrics = {
  samples: number;
  rawAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
};

type PromotionPayload = {
  generatedAt?: string;
  rowsFile?: string;
  winner?: {
    label?: string;
    modelFile?: string;
    calibrationFile?: string;
    metrics?: PromotionMetrics;
  };
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
  market: Market;
  bucketKey: string;
  archetype: string | null;
  actualSide: Side;
  finalSide: Side;
  rawDecision: RawLiveUniversalModelDecision;
  qualifiedDecision: LiveUniversalModelDecision;
  baselineCorrect: boolean;
  rawAvailable: boolean;
  rawCorrect: boolean;
  currentQualified: boolean;
  currentQualifiedCorrect: boolean;
  currentBlendedCorrect: boolean;
  rawWinsBaselineLoss: boolean;
  baselineWinsRawLoss: boolean;
  qualifiedLossBaselineWin: boolean;
  gatedUniversalWinBaselineLoss: boolean;
  qualifiedFlipWin: boolean;
};

type SummaryStats = {
  samples: number;
  baselineAccuracy: number;
  rawCoveragePct: number;
  rawAccuracyWhenAvailable: number | null;
  rawAccuracyAllRows: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  currentBlendedAccuracy: number;
  blendedMinusBaselinePct: number;
  rawWinsBaselineLossRows: number;
  rawWinsBaselineLossPct: number;
  baselineWinsRawLossRows: number;
  baselineWinsRawLossPct: number;
  rawNetUpliftRows: number;
  rawNetUpliftPct: number;
  routeToBaselineGainRows: number;
  routeToBaselineGainPct: number;
  openFurtherGainRows: number;
  openFurtherGainPct: number;
  flipGainRows: number;
  flipGainPct: number;
};

type BucketSummary = SummaryStats & {
  market: Market;
  archetype: string;
  bucketKey: string;
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  top: number;
};

const prisma = new PrismaClient();
const PROMOTION_FILE = resolveProjectPath(path.join("exports", "universal-live-promotion.json"));

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "universal-vs-baseline-uplift.json");
  let minActualMinutes = 15;
  let top = 20;

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
    if (token === "--top" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--top=")) {
      const parsed = Number(token.slice("--top=".length));
      if (Number.isFinite(parsed) && parsed > 0) top = Math.floor(parsed);
    }
  }

  return { input, out, minActualMinutes, top };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function oppositeSide(side: Side): Side {
  return side === "OVER" ? "UNDER" : "OVER";
}

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function loadPlayerMetaMap(rows: TrainingRow[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: rows.map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            position: true,
          },
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
    const qualifiedDecision = qualifyLiveUniversalModelDecision(rawDecision, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const rawAvailable = rawDecision.rawSide === "OVER" || rawDecision.rawSide === "UNDER";
    const rawCorrect = rawAvailable && rawDecision.rawSide === row.actualSide;
    const baselineCorrect = row.finalSide === row.actualSide;
    const currentQualified = qualifiedDecision.side === "OVER" || qualifiedDecision.side === "UNDER";
    const currentQualifiedCorrect = currentQualified && qualifiedDecision.side === row.actualSide;
    const currentBlendedSide = currentQualified ? qualifiedDecision.side : row.finalSide;
    const currentBlendedCorrect = currentBlendedSide === row.actualSide;
    const qualifiedFlipWin =
      currentQualified && !currentQualifiedCorrect && oppositeSide(qualifiedDecision.side as Side) === row.actualSide;
    const archetype = rawDecision.archetype ?? "UNCLASSIFIED";

    return {
      market: row.market,
      bucketKey: `${row.market}|${archetype}`,
      archetype: rawDecision.archetype,
      actualSide: row.actualSide,
      finalSide: row.finalSide,
      rawDecision,
      qualifiedDecision,
      baselineCorrect,
      rawAvailable,
      rawCorrect,
      currentQualified,
      currentQualifiedCorrect,
      currentBlendedCorrect,
      rawWinsBaselineLoss: rawAvailable && rawCorrect && !baselineCorrect,
      baselineWinsRawLoss: rawAvailable && !rawCorrect && baselineCorrect,
      qualifiedLossBaselineWin: currentQualified && !currentQualifiedCorrect && baselineCorrect,
      gatedUniversalWinBaselineLoss: !currentQualified && rawAvailable && rawCorrect && !baselineCorrect,
      qualifiedFlipWin,
    };
  });
}

function summarizeEvaluatedRows(rows: EvaluatedRow[]): SummaryStats {
  const samples = rows.length;
  const baselineCorrect = rows.filter((row) => row.baselineCorrect).length;
  const rawAvailable = rows.filter((row) => row.rawAvailable).length;
  const rawCorrect = rows.filter((row) => row.rawCorrect).length;
  const qualifiedRows = rows.filter((row) => row.currentQualified);
  const qualifiedCorrect = qualifiedRows.filter((row) => row.currentQualifiedCorrect).length;
  const blendedCorrect = rows.filter((row) => row.currentBlendedCorrect).length;
  const rawWinsBaselineLossRows = rows.filter((row) => row.rawWinsBaselineLoss).length;
  const baselineWinsRawLossRows = rows.filter((row) => row.baselineWinsRawLoss).length;
  const routeToBaselineGainRows = rows.filter((row) => row.qualifiedLossBaselineWin).length;
  const openFurtherGainRows = rows.filter((row) => row.gatedUniversalWinBaselineLoss).length;
  const flipGainRows = rows.filter((row) => row.qualifiedFlipWin).length;

  return {
    samples,
    baselineAccuracy: samples > 0 ? round((baselineCorrect / samples) * 100, 2) : 0,
    rawCoveragePct: samples > 0 ? round((rawAvailable / samples) * 100, 2) : 0,
    rawAccuracyWhenAvailable: rawAvailable > 0 ? round((rawCorrect / rawAvailable) * 100, 2) : null,
    rawAccuracyAllRows: samples > 0 ? round((rawCorrect / samples) * 100, 2) : 0,
    qualifiedAccuracy: qualifiedRows.length > 0 ? round((qualifiedCorrect / qualifiedRows.length) * 100, 2) : null,
    qualifiedPicks: qualifiedRows.length,
    coveragePct: samples > 0 ? round((qualifiedRows.length / samples) * 100, 2) : 0,
    currentBlendedAccuracy: samples > 0 ? round((blendedCorrect / samples) * 100, 2) : 0,
    blendedMinusBaselinePct: samples > 0 ? round(((blendedCorrect - baselineCorrect) / samples) * 100, 2) : 0,
    rawWinsBaselineLossRows,
    rawWinsBaselineLossPct: samples > 0 ? round((rawWinsBaselineLossRows / samples) * 100, 2) : 0,
    baselineWinsRawLossRows,
    baselineWinsRawLossPct: samples > 0 ? round((baselineWinsRawLossRows / samples) * 100, 2) : 0,
    rawNetUpliftRows: rawWinsBaselineLossRows - baselineWinsRawLossRows,
    rawNetUpliftPct: samples > 0 ? round(((rawWinsBaselineLossRows - baselineWinsRawLossRows) / samples) * 100, 2) : 0,
    routeToBaselineGainRows,
    routeToBaselineGainPct: samples > 0 ? round((routeToBaselineGainRows / samples) * 100, 2) : 0,
    openFurtherGainRows,
    openFurtherGainPct: samples > 0 ? round((openFurtherGainRows / samples) * 100, 2) : 0,
    flipGainRows,
    flipGainPct: samples > 0 ? round((flipGainRows / samples) * 100, 2) : 0,
  };
}

function summarizeBuckets(rows: EvaluatedRow[]): BucketSummary[] {
  const byBucket = new Map<string, EvaluatedRow[]>();
  rows.forEach((row) => {
    const bucket = byBucket.get(row.bucketKey) ?? [];
    bucket.push(row);
    byBucket.set(row.bucketKey, bucket);
  });

  return [...byBucket.entries()]
    .map(([bucketKey, bucketRows]) => ({
      bucketKey,
      market: bucketRows[0].market,
      archetype: bucketRows[0].archetype ?? "UNCLASSIFIED",
      ...summarizeEvaluatedRows(bucketRows),
    }))
    .sort((left, right) => right.samples - left.samples);
}

function summarizeMarkets(rows: EvaluatedRow[]): Record<Market, SummaryStats> {
  const markets: Market[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
  return Object.fromEntries(
    markets.map((market) => [market, summarizeEvaluatedRows(rows.filter((row) => row.market === market))]),
  ) as Record<Market, SummaryStats>;
}

function sortByScore<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .slice()
    .sort((left, right) => {
      const delta = score(right) - score(left);
      if (delta !== 0) return delta;
      return 0;
    });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const evaluatedRows = evaluateRows(filteredRows, summaries);
  const overall = summarizeEvaluatedRows(evaluatedRows);
  const byMarket = summarizeMarkets(evaluatedRows);
  const byBucket = summarizeBuckets(evaluatedRows);
  const promotion = await loadJsonFile<PromotionPayload>(PROMOTION_FILE);
  const promotionMetrics = promotion?.winner?.metrics ?? null;

  const topRouteToBaseline = sortByScore(
    byBucket.filter((bucket) => bucket.routeToBaselineGainRows > 0),
    (bucket) => bucket.routeToBaselineGainPct * 100000 + bucket.samples,
  ).slice(0, args.top);
  const topOpenFurther = sortByScore(
    byBucket.filter((bucket) => bucket.openFurtherGainRows > 0),
    (bucket) => bucket.openFurtherGainPct * 100000 + bucket.samples,
  ).slice(0, args.top);
  const topFlipCandidates = sortByScore(
    byBucket.filter((bucket) => bucket.flipGainRows > 0),
    (bucket) => bucket.flipGainPct * 100000 + bucket.samples,
  ).slice(0, args.top);
  const topOverOpenedLosers = sortByScore(
    byBucket.filter((bucket) => bucket.coveragePct >= 80 && bucket.currentBlendedAccuracy < bucket.baselineAccuracy),
    (bucket) => bucket.routeToBaselineGainPct * 100000 + bucket.samples,
  ).slice(0, args.top);
  const topRawPositiveUplift = sortByScore(
    byBucket.filter((bucket) => bucket.rawNetUpliftRows > 0),
    (bucket) => bucket.rawNetUpliftPct * 100000 + bucket.samples,
  ).slice(0, args.top);
  const topRawNegativeUplift = byBucket
    .filter((bucket) => bucket.rawNetUpliftRows < 0)
    .slice()
    .sort((left, right) => {
      if (left.rawNetUpliftPct !== right.rawNetUpliftPct) return left.rawNetUpliftPct - right.rawNetUpliftPct;
      return right.samples - left.samples;
    })
    .slice(0, args.top);

  const output = {
    generatedAt: new Date().toISOString(),
    canonicalScoreboard: {
      definition:
        "Current live universal model + current live calibration + current live rows + default live qualification settings.",
      rowsFile: inputPath,
      modelFile: resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH),
      calibrationFile: resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH),
      promotionFile: PROMOTION_FILE,
      rowWindow: {
        from: payload.from ?? null,
        to: payload.to ?? null,
      },
      filters: {
        minActualMinutes: args.minActualMinutes,
      },
      qualificationSettings: DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
      measuredNow: overall,
      promotionReference: promotionMetrics,
      driftVsPromotion:
        promotionMetrics == null
          ? null
          : {
              rawAccuracy: round(overall.rawAccuracyAllRows - promotionMetrics.rawAccuracy, 2),
              qualifiedAccuracy: round((overall.qualifiedAccuracy ?? 0) - (promotionMetrics.qualifiedAccuracy ?? 0), 2),
              qualifiedPicks: overall.qualifiedPicks - promotionMetrics.qualifiedPicks,
              coveragePct: round(overall.coveragePct - promotionMetrics.coveragePct, 2),
              blendedAccuracy: round(overall.currentBlendedAccuracy - promotionMetrics.blendedAccuracy, 2),
              samples: overall.samples - promotionMetrics.samples,
            },
    },
    opportunitySummary: {
      topRouteToBaseline,
      topOpenFurther,
      topFlipCandidates,
      topOverOpenedLosers,
      topRawPositiveUplift,
      topRawNegativeUplift,
    },
    byMarket,
    byBucket,
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
