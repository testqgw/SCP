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

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";

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
  openingTeamSpread: number | null;
  openingTotal: number | null;
  lineupTimingConfidence: number | null;
  completenessScore: number | null;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: TrainingRow[];
};

type PlayerMetaCacheFile = {
  updatedAt: string;
  players: Array<{
    id: string;
    position: string | null;
    fullName: string | null;
  }>;
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

type AggregateBucket = {
  samples: number;
  rawCorrect: number;
  baselineCorrect: number;
  blendedCorrect: number;
  qualifiedPicks: number;
  qualifiedCorrect: number;
  disagreements: number;
  qualifiedDisagreementWins: number;
  qualifiedDisagreementLosses: number;
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
  disagreements: number;
  qualifiedDisagreementWins: number;
  qualifiedDisagreementLosses: number;
  qualifiedDisagreementWinRate: number | null;
};

type Args = {
  input: string;
  out: string | null;
  player: string;
  minActualMinutes: number;
  markets: Market[];
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const DEFAULT_MARKETS: Market[] = ["THREES", "PA", "RA"];

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
  let markets = DEFAULT_MARKETS;

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
    if ((token === "--markets" || token === "-k") && next) {
      markets = next.split(",").map((value) => value.trim()).filter(Boolean) as Market[];
      index += 1;
      continue;
    }
    if (token.startsWith("--markets=")) {
      markets = token.slice("--markets=".length).split(",").map((value) => value.trim()).filter(Boolean) as Market[];
      continue;
    }
    if ((token === "--min-actual-minutes" || token === "-m") && next) {
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

  return { input, out, player, minActualMinutes, markets };
}

function emptyBucket(): AggregateBucket {
  return {
    samples: 0,
    rawCorrect: 0,
    baselineCorrect: 0,
    blendedCorrect: 0,
    qualifiedPicks: 0,
    qualifiedCorrect: 0,
    disagreements: 0,
    qualifiedDisagreementWins: 0,
    qualifiedDisagreementLosses: 0,
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
    disagreements: bucket.disagreements,
    qualifiedDisagreementWins: bucket.qualifiedDisagreementWins,
    qualifiedDisagreementLosses: bucket.qualifiedDisagreementLosses,
    qualifiedDisagreementWinRate: ratioPercent(
      bucket.qualifiedDisagreementWins,
      bucket.qualifiedDisagreementWins + bucket.qualifiedDisagreementLosses,
    ),
  };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function loadPlayerMetaCache(cachePath: string): Map<string, string | null> {
  if (!fs.existsSync(cachePath)) return new Map();
  const payload = JSON.parse(fs.readFileSync(cachePath, "utf8")) as PlayerMetaCacheFile;
  return new Map((payload.players ?? []).map((player) => [player.id, player.position ?? null]));
}

function buildPlayerSummary(rows: TrainingRow[], positionById: Map<string, string | null>): PlayerSummary {
  const playerId = rows[0]!.playerId;
  const ptsRows = rows.filter((row) => row.market === "PTS");
  const rebRows = rows.filter((row) => row.market === "REB");
  const astRows = rows.filter((row) => row.market === "AST");
  const threesRows = rows.filter((row) => row.market === "THREES");
  return {
    playerId,
    playerName: rows[0]!.playerName,
    position: positionById.get(playerId) ?? null,
    avgExpectedMinutes: mean(rows.map((row) => row.expectedMinutes)),
    avgStarterRate: mean(rows.map((row) => row.starterRateLast10)),
    ptsProjectionAvg: mean(ptsRows.map((row) => row.projectedValue)),
    rebProjectionAvg: mean(rebRows.map((row) => row.projectedValue)),
    astProjectionAvg: mean(astRows.map((row) => row.projectedValue)),
    threesProjectionAvg: mean(threesRows.map((row) => row.projectedValue)),
  };
}

function applyDecisionToBucket(
  bucket: AggregateBucket,
  row: TrainingRow,
  summary: PlayerSummary,
): void {
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
  const disagreement = predictedSide !== row.finalSide;
  const blendedSide = qualified.qualified ? predictedSide : row.finalSide;

  bucket.samples += 1;
  if (predictedSide === row.actualSide) bucket.rawCorrect += 1;
  if (row.finalSide === row.actualSide) bucket.baselineCorrect += 1;
  if (blendedSide === row.actualSide) bucket.blendedCorrect += 1;
  if (qualified.qualified) {
    bucket.qualifiedPicks += 1;
    if (predictedSide === row.actualSide) bucket.qualifiedCorrect += 1;
  }
  if (disagreement) {
    bucket.disagreements += 1;
    if (qualified.qualified) {
      if (predictedSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
      else bucket.qualifiedDisagreementLosses += 1;
    }
  }
}

function bucketSpread(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value <= -8) return "favorite_8_plus";
  if (value <= -3) return "favorite_3_to_8";
  if (value < 3) return "close_game";
  if (value < 8) return "underdog_3_to_8";
  return "underdog_8_plus";
}

function bucketTotal(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value < 220) return "low_total";
  if (value < 235) return "mid_total";
  return "high_total";
}

function bucketConfidence(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value < 0.55) return "low";
  if (value < 0.8) return "mid";
  return "high";
}

function bucketCompleteness(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value < 0.7) return "low";
  if (value < 0.85) return "mid";
  return "high";
}

function bucketMinutesVolatility(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value < 2) return "low";
  if (value < 4) return "mid";
  return "high";
}

function bucketExpectedMinutes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "missing";
  if (value < 30) return "under_30";
  if (value < 33) return "30_to_33";
  if (value < 36) return "33_to_36";
  return "36_plus";
}

function summarizeDimension(rows: TrainingRow[], summary: PlayerSummary, bucketer: (row: TrainingRow) => string) {
  const byBucket = new Map<string, AggregateBucket>();
  rows.forEach((row) => {
    const key = bucketer(row);
    const bucket = byBucket.get(key) ?? emptyBucket();
    applyDecisionToBucket(bucket, row, summary);
    byBucket.set(key, bucket);
  });
  return Object.fromEntries(
    [...byBucket.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [key, summarizeBucket(bucket)]),
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const playerRows = payload.playerMarketRows.filter(
    (row) =>
      row.playerName.toLowerCase() === args.player.toLowerCase() &&
      row.actualMinutes >= args.minActualMinutes &&
      args.markets.includes(row.market),
  );
  if (!playerRows.length) {
    throw new Error(`No rows found for ${args.player} in markets ${args.markets.join(", ")}.`);
  }

  const summary = buildPlayerSummary(
    payload.playerMarketRows.filter(
      (row) => row.playerName.toLowerCase() === args.player.toLowerCase() && row.actualMinutes >= args.minActualMinutes,
    ),
    positionById,
  );

  const overall = emptyBucket();
  playerRows.forEach((row) => applyDecisionToBucket(overall, row, summary));

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    player: args.player,
    markets: args.markets,
    summary,
    overall: summarizeBucket(overall),
    byDimension: {
      spreadBucket: summarizeDimension(playerRows, summary, (row) => bucketSpread(row.openingTeamSpread)),
      totalBucket: summarizeDimension(playerRows, summary, (row) => bucketTotal(row.openingTotal)),
      lineupTimingConfidenceBucket: summarizeDimension(playerRows, summary, (row) => bucketConfidence(row.lineupTimingConfidence)),
      completenessBucket: summarizeDimension(playerRows, summary, (row) => bucketCompleteness(row.completenessScore)),
      minutesVolatilityBucket: summarizeDimension(playerRows, summary, (row) => bucketMinutesVolatility(row.minutesVolatility)),
      expectedMinutesBucket: summarizeDimension(playerRows, summary, (row) => bucketExpectedMinutes(row.expectedMinutes)),
    },
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
