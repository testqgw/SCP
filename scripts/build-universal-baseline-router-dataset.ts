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
  playerId: string;
  playerName: string;
  gameDateEt: string;
  market: Market;
  bucketKey: string;
  archetype: string;
  modelKind: string | null;
  actualSide: Side;
  finalSide: Side;
  projectionSide: Side;
  rawSide: Side | "NEUTRAL";
  qualifiedSide: Side;
  projectedValue: number;
  actualValue: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  favoredSide: "OVER" | "UNDER" | "NEUTRAL" | null;
  priceLean: number | null;
  priceStrength: number | null;
  overProbability: number | null;
  underProbability: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
  benchBigRoleStability: number | null;
  lineGap: number;
  absLineGap: number;
  openingTeamSpread: number | null;
  absOpeningSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
  spreadResolved: boolean;
  bucketSamples: number | null;
  bucketModelAccuracy: number | null;
  bucketLateAccuracy: number | null;
  bucketRecentAccuracy: number | null;
  leafCount: number | null;
  leafAccuracy: number | null;
  projectionMarketAgreement: number | null;
  rejectionReasons: string[];
  resolvedOutcome: boolean;
  isQualifiedUniversalRow: boolean;
  isDisagreementRow: boolean;
  universalCorrect: boolean;
  baselineCorrect: boolean;
  routerTarget: 0 | 1 | null;
  strongOppositeJuice: boolean;
  weakBucketQuality: boolean;
  weakLeafQuality: boolean;
  smallEdge: boolean;
  lowAgreement: boolean;
  hitListBucket: boolean;
  vetoByOppositeJuice: boolean;
  vetoByWeakBucketSmallEdge: boolean;
  vetoByWeakLeafLowAgreement: boolean;
  routerV0Veto: boolean;
  routerV0Reasons: string[];
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
};

const prisma = new PrismaClient();
const ROUTER_V0_HIT_LIST = new Set([
  "PA|BENCH_WING",
  "PRA|SCORING_GUARD_CREATOR",
  "RA|TWO_WAY_MARKET_WING",
  "PRA|POINT_FORWARD",
  "PRA|SPOTUP_WING",
]);

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "universal-baseline-router-dataset.jsonl");
  let minActualMinutes = 15;

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
  }

  return { input, out, minActualMinutes };
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

function buildRouterDatasetRow(evaluated: EvaluatedRow): RouterDatasetRow | null {
  const { row, rowKey, rawDecision, qualifiedDecision } = evaluated;
  const resolvedOutcome = row.actualValue !== row.line;
  const qualifiedSide = qualifiedDecision.side;
  const isQualifiedUniversalRow = qualifiedDecision.qualified && (qualifiedSide === "OVER" || qualifiedSide === "UNDER");
  const isDisagreementRow =
    isQualifiedUniversalRow &&
    qualifiedSide !== row.finalSide &&
    resolvedOutcome;

  if (!isDisagreementRow) return null;

  const universalCorrect = qualifiedSide === row.actualSide;
  const baselineCorrect = row.finalSide === row.actualSide;
  const routerTarget = universalCorrect && !baselineCorrect ? 1 : baselineCorrect && !universalCorrect ? 0 : null;
  const archetype = rawDecision.archetype ?? "UNKNOWN";
  const bucketKey = `${row.market}|${archetype}`;
  const bucketRecentAccuracy = rawDecision.bucketLateAccuracy ?? rawDecision.bucketModelAccuracy;
  const strongOppositeJuice =
    rawDecision.favoredSide === row.finalSide &&
    rawDecision.favoredSide !== qualifiedSide &&
    rawDecision.priceStrength != null &&
    rawDecision.priceStrength >= 0.59;
  const weakBucketQuality = rawDecision.bucketLateAccuracy != null && rawDecision.bucketLateAccuracy <= 62;
  const weakLeafQuality = rawDecision.leafAccuracy != null && rawDecision.leafAccuracy <= 56;
  const smallEdge = row.absLineGap <= 1.0;
  const lowAgreement = rawDecision.projectionMarketAgreement != null && rawDecision.projectionMarketAgreement <= 0.54;
  const hitListBucket = ROUTER_V0_HIT_LIST.has(bucketKey);
  const vetoByOppositeJuice = hitListBucket && strongOppositeJuice;
  const vetoByWeakBucketSmallEdge = hitListBucket && weakBucketQuality && smallEdge;
  const vetoByWeakLeafLowAgreement = hitListBucket && weakLeafQuality && lowAgreement;
  const routerV0Veto = vetoByOppositeJuice || vetoByWeakBucketSmallEdge || vetoByWeakLeafLowAgreement;
  const routerV0Reasons = [
    vetoByOppositeJuice ? "hitListBucket+strongOppositeJuice" : null,
    vetoByWeakBucketSmallEdge ? "hitListBucket+weakBucketQuality+smallEdge" : null,
    vetoByWeakLeafLowAgreement ? "hitListBucket+weakLeafQuality+lowAgreement" : null,
  ].filter((value): value is string => value != null);

  return {
    rowKey,
    playerId: row.playerId,
    playerName: row.playerName,
    gameDateEt: row.gameDateEt,
    market: row.market,
    bucketKey,
    archetype,
    modelKind: rawDecision.modelKind,
    actualSide: row.actualSide,
    finalSide: row.finalSide,
    projectionSide: row.projectionSide,
    rawSide: rawDecision.rawSide,
    qualifiedSide,
    projectedValue: row.projectedValue,
    actualValue: row.actualValue,
    line: row.line,
    overPrice: row.overPrice,
    underPrice: row.underPrice,
    favoredSide: rawDecision.favoredSide,
    priceLean: rawDecision.priceLean,
    priceStrength: rawDecision.priceStrength,
    overProbability: rawDecision.overProbability,
    underProbability: rawDecision.underProbability,
    expectedMinutes: row.expectedMinutes,
    minutesVolatility: row.minutesVolatility,
    starterRateLast10: row.starterRateLast10,
    benchBigRoleStability: row.benchBigRoleStability ?? null,
    lineGap: row.lineGap,
    absLineGap: row.absLineGap,
    openingTeamSpread: row.openingTeamSpread,
    absOpeningSpread: row.openingTeamSpread == null ? null : round(Math.abs(row.openingTeamSpread), 3),
    openingTotal: row.openingTotal,
    lineupTimingConfidence: row.lineupTimingConfidence,
    completenessScore: row.completenessScore,
    spreadResolved: row.spreadResolved,
    bucketSamples: rawDecision.bucketSamples,
    bucketModelAccuracy: rawDecision.bucketModelAccuracy,
    bucketLateAccuracy: rawDecision.bucketLateAccuracy,
    bucketRecentAccuracy,
    leafCount: rawDecision.leafCount,
    leafAccuracy: rawDecision.leafAccuracy,
    projectionMarketAgreement: rawDecision.projectionMarketAgreement,
    rejectionReasons: qualifiedDecision.rejectionReasons,
    resolvedOutcome,
    isQualifiedUniversalRow,
    isDisagreementRow,
    universalCorrect,
    baselineCorrect,
    routerTarget,
    strongOppositeJuice,
    weakBucketQuality,
    weakLeafQuality,
    smallEdge,
    lowAgreement,
    hitListBucket,
    vetoByOppositeJuice,
    vetoByWeakBucketSmallEdge,
    vetoByWeakLeafLowAgreement,
    routerV0Veto,
    routerV0Reasons,
  };
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
  const datasetRows = evaluatedRows
    .map((row) => buildRouterDatasetRow(row))
    .filter((row): row is RouterDatasetRow => row != null);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${datasetRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        input: inputPath,
        out: outPath,
        filters: { minActualMinutes: args.minActualMinutes },
        rowWindow: { from: payload.from ?? null, to: payload.to ?? null },
        counts: {
          filteredRows: filteredRows.length,
          disagreementRows: datasetRows.length,
          trainableRows: datasetRows.filter((row) => row.routerTarget != null).length,
          vetoRows: datasetRows.filter((row) => row.routerV0Veto).length,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
