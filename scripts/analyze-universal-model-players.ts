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
  avgActualMinutes: number | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

type PlayerStats = {
  playerId: string;
  playerName: string;
  samples: number;
  rawCorrect: number;
  baselineCorrect: number;
  blendedCorrect: number;
  qualifiedPicks: number;
  qualifiedCorrect: number;
  byMarket: Partial<Record<Market, { samples: number; blendedCorrect: number }>>;
};

type PlayerResult = {
  playerId: string;
  playerName: string;
  samples: number;
  avgActualMinutes: number | null;
  rawAccuracy: number;
  baselineAccuracy: number;
  blendedAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  deltaVsBaseline: number;
  worstMarket: Market | null;
  worstMarketAccuracy: number | null;
};

type EligiblePoolSummary = {
  players: number;
  samples: number;
  rawAccuracy: number;
  baselineAccuracy: number;
  blendedAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  deltaVsBaseline: number;
};

type Args = {
  input: string;
  out: string | null;
  top: number;
  minActualMinutes: number;
  minSamples: number;
  sortBy: "blended" | "delta" | "qualified";
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
  let top = 25;
  let minActualMinutes = 15;
  let minSamples = 40;
  let sortBy: "blended" | "delta" | "qualified" = "blended";

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
    if ((token === "--top" || token === "-n") && next) {
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
    if (token === "--sort-by" && next) {
      if (next === "blended" || next === "delta" || next === "qualified") sortBy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--sort-by=")) {
      const value = token.slice("--sort-by=".length);
      if (value === "blended" || value === "delta" || value === "qualified") sortBy = value;
      continue;
    }
  }

  return { input, out, top, minActualMinutes, minSamples, sortBy };
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
      avgActualMinutes: mean(playerRows.map((row) => row.actualMinutes)),
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

function buildResult(stats: PlayerStats, summary: PlayerSummary | undefined): PlayerResult {
  let worstMarket: Market | null = null;
  let worstMarketAccuracy: number | null = null;

  for (const [market, bucket] of Object.entries(stats.byMarket) as Array<[Market, { samples: number; blendedCorrect: number }]>) {
    const accuracy = round((bucket.blendedCorrect / bucket.samples) * 100, 2);
    if (worstMarketAccuracy == null || accuracy < worstMarketAccuracy) {
      worstMarket = market;
      worstMarketAccuracy = accuracy;
    }
  }

  const blendedAccuracy = round((stats.blendedCorrect / stats.samples) * 100, 2);
  const baselineAccuracy = round((stats.baselineCorrect / stats.samples) * 100, 2);
  return {
    playerId: stats.playerId,
    playerName: stats.playerName,
    samples: stats.samples,
    avgActualMinutes: summary?.avgActualMinutes ?? null,
    rawAccuracy: round((stats.rawCorrect / stats.samples) * 100, 2),
    baselineAccuracy,
    blendedAccuracy,
    qualifiedAccuracy: stats.qualifiedPicks > 0 ? round((stats.qualifiedCorrect / stats.qualifiedPicks) * 100, 2) : null,
    qualifiedPicks: stats.qualifiedPicks,
    coveragePct: round((stats.qualifiedPicks / stats.samples) * 100, 2),
    deltaVsBaseline: round(blendedAccuracy - baselineAccuracy, 2),
    worstMarket,
    worstMarketAccuracy,
  };
}

function buildEligiblePoolSummary(statsList: PlayerStats[]): EligiblePoolSummary {
  const totals = statsList.reduce(
    (accumulator, stats) => {
      accumulator.samples += stats.samples;
      accumulator.rawCorrect += stats.rawCorrect;
      accumulator.baselineCorrect += stats.baselineCorrect;
      accumulator.blendedCorrect += stats.blendedCorrect;
      accumulator.qualifiedPicks += stats.qualifiedPicks;
      accumulator.qualifiedCorrect += stats.qualifiedCorrect;
      return accumulator;
    },
    {
      samples: 0,
      rawCorrect: 0,
      baselineCorrect: 0,
      blendedCorrect: 0,
      qualifiedPicks: 0,
      qualifiedCorrect: 0,
    },
  );

  const rawAccuracy = totals.samples > 0 ? round((totals.rawCorrect / totals.samples) * 100, 2) : 0;
  const baselineAccuracy = totals.samples > 0 ? round((totals.baselineCorrect / totals.samples) * 100, 2) : 0;
  const blendedAccuracy = totals.samples > 0 ? round((totals.blendedCorrect / totals.samples) * 100, 2) : 0;

  return {
    players: statsList.length,
    samples: totals.samples,
    rawAccuracy,
    baselineAccuracy,
    blendedAccuracy,
    qualifiedAccuracy:
      totals.qualifiedPicks > 0 ? round((totals.qualifiedCorrect / totals.qualifiedPicks) * 100, 2) : null,
    qualifiedPicks: totals.qualifiedPicks,
    coveragePct: totals.samples > 0 ? round((totals.qualifiedPicks / totals.samples) * 100, 2) : 0,
    deltaVsBaseline: round(blendedAccuracy - baselineAccuracy, 2),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const settings = DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS;

  const statsMap = new Map<string, PlayerStats>();

  for (const row of filteredRows) {
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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary?.ptsProjectionAvg ?? null),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary?.rebProjectionAvg ?? null),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary?.astProjectionAvg ?? null),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary?.threesProjectionAvg ?? null),
    });
    const decision = qualifyLiveUniversalModelDecision(rawDecision, settings);
    const blendedSide = decision.side === "NEUTRAL" ? row.finalSide : decision.side;
    const playerStats = statsMap.get(row.playerId) ?? {
      playerId: row.playerId,
      playerName: row.playerName,
      samples: 0,
      rawCorrect: 0,
      baselineCorrect: 0,
      blendedCorrect: 0,
      qualifiedPicks: 0,
      qualifiedCorrect: 0,
      byMarket: {},
    };
    playerStats.samples += 1;
    if (rawDecision.rawSide === row.actualSide) playerStats.rawCorrect += 1;
    if (row.finalSide === row.actualSide) playerStats.baselineCorrect += 1;
    if (blendedSide === row.actualSide) playerStats.blendedCorrect += 1;
    if (decision.side !== "NEUTRAL") {
      playerStats.qualifiedPicks += 1;
      if (decision.side === row.actualSide) playerStats.qualifiedCorrect += 1;
    }
    const marketBucket = playerStats.byMarket[row.market] ?? { samples: 0, blendedCorrect: 0 };
    marketBucket.samples += 1;
    if (blendedSide === row.actualSide) marketBucket.blendedCorrect += 1;
    playerStats.byMarket[row.market] = marketBucket;
    statsMap.set(row.playerId, playerStats);
  }

  const allPlayers = [...statsMap.values()].map((stats) => buildResult(stats, summaries.get(stats.playerId)));
  const eligibleStats = [...statsMap.values()].filter((stats) => stats.samples >= args.minSamples);
  const filteredPlayers = eligibleStats
    .map((stats) => buildResult(stats, summaries.get(stats.playerId)))
    .sort((left, right) => {
      if (args.sortBy === "qualified") {
        const leftValue = left.qualifiedAccuracy ?? Infinity;
        const rightValue = right.qualifiedAccuracy ?? Infinity;
        if (leftValue !== rightValue) return leftValue - rightValue;
      } else if (args.sortBy === "delta") {
        if (left.deltaVsBaseline !== right.deltaVsBaseline) return left.deltaVsBaseline - right.deltaVsBaseline;
      } else if (left.blendedAccuracy !== right.blendedAccuracy) {
        return left.blendedAccuracy - right.blendedAccuracy;
      }
      if (left.samples !== right.samples) return right.samples - left.samples;
      return left.playerName.localeCompare(right.playerName);
    });

  const output = {
    input: path.resolve(args.input),
    minActualMinutes: args.minActualMinutes,
    minSamples: args.minSamples,
    sortBy: args.sortBy,
    totalPlayers: allPlayers.length,
    eligiblePlayers: filteredPlayers.length,
    eligiblePool: buildEligiblePoolSummary(eligibleStats),
    returnedPlayers: Math.min(args.top, filteredPlayers.length),
    players: filteredPlayers.slice(0, args.top),
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
