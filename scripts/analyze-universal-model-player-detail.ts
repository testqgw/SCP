import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  qualifyLiveUniversalModelDecision,
} from "../lib/snapshot/liveUniversalSideModels";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";
import { meanProjection, rowProjectionOrSummary } from "./utils/trainingRowProjectionContext";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

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
  under: number;
  neutral: number;
  avgGapSum: number;
};

type Args = {
  input: string;
  out: string | null;
  player: string;
  minActualMinutes: number;
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
  let out: string | null = null;
  let player = "";
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
  }

  if (!player) {
    throw new Error("Missing required --player argument.");
  }

  return { input, out, player, minActualMinutes };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
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
    summaries.set(playerId, {
      playerId,
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: meanProjection(playerRows, "pointsProjection", (value) => round(value, 4)),
      rebProjectionAvg: meanProjection(playerRows, "reboundsProjection", (value) => round(value, 4)),
      astProjectionAvg: meanProjection(playerRows, "assistProjection", (value) => round(value, 4)),
      threesProjectionAvg: meanProjection(playerRows, "threesProjection", (value) => round(value, 4)),
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
    under: 0,
    neutral: 0,
    avgGapSum: 0,
  };
}

function summarizeBucket(bucket: AggregateBucket) {
  return {
    samples: bucket.samples,
    rawAccuracy: round((bucket.rawCorrect / bucket.samples) * 100, 2),
    baselineAccuracy: round((bucket.baselineCorrect / bucket.samples) * 100, 2),
    blendedAccuracy: round((bucket.blendedCorrect / bucket.samples) * 100, 2),
    qualifiedAccuracy: bucket.qualifiedPicks ? round((bucket.qualifiedCorrect / bucket.qualifiedPicks) * 100, 2) : null,
    qualifiedPicks: bucket.qualifiedPicks,
    coveragePct: round((bucket.qualifiedPicks / bucket.samples) * 100, 2),
    deltaVsBaseline: round(((bucket.blendedCorrect - bucket.baselineCorrect) / bucket.samples) * 100, 2),
    over: bucket.over,
    under: bucket.under,
    neutral: bucket.neutral,
    avgGap: round(bucket.avgGapSum / bucket.samples, 2),
  };
}

function applyDecisionToBucket(bucket: AggregateBucket, row: TrainingRow, rawSide: Side | "NEUTRAL", qualified: boolean): void {
  const predicted = rawSide === "NEUTRAL" ? row.finalSide : rawSide;
  const blendedSide = qualified ? predicted : row.finalSide;

  bucket.samples += 1;
  if (predicted === row.actualSide) bucket.rawCorrect += 1;
  if (row.finalSide === row.actualSide) bucket.baselineCorrect += 1;
  if (blendedSide === row.actualSide) bucket.blendedCorrect += 1;
  if (qualified) {
    bucket.qualifiedPicks += 1;
    if (predicted === row.actualSide) bucket.qualifiedCorrect += 1;
  }
  if (predicted === "OVER") bucket.over += 1;
  else if (predicted === "UNDER") bucket.under += 1;
  else bucket.neutral += 1;
  bucket.avgGapSum += row.projectedValue - row.line;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(rows);
  const summaries = summarizeRows(rows, playerMetaMap);

  const playerRows = rows.filter((row) => row.playerName.toLowerCase() === args.player.toLowerCase());
  if (!playerRows.length) {
    throw new Error(`No rows found for player "${args.player}".`);
  }

  const targetSummary = summaries.get(playerRows[0]!.playerId);
  if (!targetSummary) {
    throw new Error(`Missing summary for player "${args.player}".`);
  }

  const targetArchetypes = new Map<string, number>();
  const playerByMarket = new Map<Market, AggregateBucket>();
  const rowArchetypeByKey = new Map<string, string>();

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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary.ptsProjectionAvg),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary.rebProjectionAvg),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary.astProjectionAvg),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary.threesProjectionAvg),
    });
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    rowArchetypeByKey.set(`${row.playerId}|${row.market}|${row.gameDateEt}`, raw.archetype ?? "UNKNOWN");

    if (row.playerId === playerRows[0]!.playerId) {
      const archetype = raw.archetype ?? "UNKNOWN";
      targetArchetypes.set(archetype, (targetArchetypes.get(archetype) ?? 0) + 1);
      const bucket = playerByMarket.get(row.market) ?? emptyBucket();
      applyDecisionToBucket(bucket, row, raw.rawSide, qualified.qualified);
      playerByMarket.set(row.market, bucket);
    }
  }

  const archetype = [...targetArchetypes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "UNKNOWN";
  const archetypeByMarket = new Map<Market, AggregateBucket>();
  for (const row of rows) {
    if (rowArchetypeByKey.get(`${row.playerId}|${row.market}|${row.gameDateEt}`) !== archetype) continue;
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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary.ptsProjectionAvg),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary.rebProjectionAvg),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary.astProjectionAvg),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary.threesProjectionAvg),
    });
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const bucket = archetypeByMarket.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(bucket, row, raw.rawSide, qualified.qualified);
    archetypeByMarket.set(row.market, bucket);
  }

  const output = {
    input: path.resolve(args.input),
    player: args.player,
    playerId: playerRows[0]!.playerId,
    archetype,
    summary: {
      position: targetSummary.position,
      avgExpectedMinutes: round(targetSummary.avgExpectedMinutes ?? 0, 2),
      avgStarterRate: round(targetSummary.avgStarterRate ?? 0, 2),
      ptsProjectionAvg: round(targetSummary.ptsProjectionAvg ?? 0, 2),
      rebProjectionAvg: round(targetSummary.rebProjectionAvg ?? 0, 2),
      astProjectionAvg: round(targetSummary.astProjectionAvg ?? 0, 2),
      threesProjectionAvg: round(targetSummary.threesProjectionAvg ?? 0, 2),
    },
    playerByMarket: Object.fromEntries([...playerByMarket.entries()].map(([market, bucket]) => [market, summarizeBucket(bucket)])),
    archetypeByMarket: Object.fromEntries([...archetypeByMarket.entries()].map(([market, bucket]) => [market, summarizeBucket(bucket)])),
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
