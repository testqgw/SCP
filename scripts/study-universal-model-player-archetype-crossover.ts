import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  inspectLiveUniversalModelSideForArchetype,
  qualifyLiveUniversalModelDecision,
  type Archetype,
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

type PlayerSummary = {
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
};

type Args = {
  input: string;
  out: string | null;
  player: string;
  minActualMinutes: number;
  archetypes: Archetype[];
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
  let archetypes: Archetype[] = ["POINT_FORWARD", "TWO_WAY_MARKET_WING"];

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
    if ((token === "--archetypes" || token === "-a") && next) {
      archetypes = next
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as Archetype[];
      index += 1;
      continue;
    }
    if (token.startsWith("--archetypes=")) {
      archetypes = token
        .slice("--archetypes=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) as Archetype[];
      continue;
    }
  }

  if (!player) {
    throw new Error("Missing required --player argument.");
  }

  return { input, out, player, minActualMinutes, archetypes };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function incrementMapCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

async function loadPlayerSummary(rows: TrainingRow[]): Promise<PlayerSummary> {
  const playerId = rows[0]!.playerId;
  const cached = await loadPlayerMetaWithCache({
    rows: [{ playerId, playerName: rows[0]!.playerName }],
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: { id: true, position: true },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });
  const position = cached.get(playerId)?.position ?? null;
  return {
    position,
    avgExpectedMinutes: mean(rows.map((row) => row.expectedMinutes)),
    avgStarterRate: mean(rows.map((row) => row.starterRateLast10)),
    ptsProjectionAvg: meanProjection(rows, "pointsProjection", (value) => round(value, 4)),
    rebProjectionAvg: meanProjection(rows, "reboundsProjection", (value) => round(value, 4)),
    astProjectionAvg: meanProjection(rows, "assistProjection", (value) => round(value, 4)),
    threesProjectionAvg: meanProjection(rows, "threesProjection", (value) => round(value, 4)),
  };
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
  };
}

function applyDecisionToBucket(
  bucket: AggregateBucket,
  row: TrainingRow,
  predictedSide: Side,
  qualified: boolean,
): void {
  const disagreement = predictedSide !== row.finalSide;
  const blendedSide = qualified ? predictedSide : row.finalSide;

  bucket.samples += 1;
  if (predictedSide === row.actualSide) bucket.rawCorrect += 1;
  if (row.finalSide === row.actualSide) bucket.baselineCorrect += 1;
  if (blendedSide === row.actualSide) bucket.blendedCorrect += 1;
  if (qualified) {
    bucket.qualifiedPicks += 1;
    if (predictedSide === row.actualSide) bucket.qualifiedCorrect += 1;
  }
  if (disagreement) {
    bucket.disagreements += 1;
    if (qualified) {
      if (predictedSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
      else bucket.qualifiedDisagreementLosses += 1;
    }
  }
}

function evaluateVariant(
  rows: TrainingRow[],
  summary: PlayerSummary,
  forcedArchetype: Archetype | null,
) {
  const overall = emptyBucket();
  const byMarket = new Map<Market, AggregateBucket>();
  const archetypeCounter = new Map<string, number>();

  rows.forEach((row) => {
    const input = {
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
    };
    const raw = forcedArchetype
      ? inspectLiveUniversalModelSideForArchetype(input, forcedArchetype)
      : inspectLiveUniversalModelSide(input);
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
    incrementMapCounter(archetypeCounter, raw.archetype ?? "UNKNOWN");
    applyDecisionToBucket(overall, row, predictedSide, qualified.qualified);
    const marketBucket = byMarket.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(marketBucket, row, predictedSide, qualified.qualified);
    byMarket.set(row.market, marketBucket);
  });

  return {
    effectiveArchetypeCounts: [...archetypeCounter.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overall: summarizeBucket(overall),
    byMarket: Object.fromEntries([...byMarket.entries()].map(([market, bucket]) => [market, summarizeBucket(bucket)])),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const playerRows = payload.playerMarketRows.filter(
    (row) => row.playerName.toLowerCase() === args.player.toLowerCase() && row.actualMinutes >= args.minActualMinutes,
  );
  if (!playerRows.length) {
    throw new Error(`No rows found for player "${args.player}".`);
  }

  const summary = await loadPlayerSummary(playerRows);
  const current = evaluateVariant(playerRows, summary, null);
  const variants: Record<string, ReturnType<typeof evaluateVariant>> = { current };
  for (const archetype of args.archetypes) {
    variants[archetype] = evaluateVariant(playerRows, summary, archetype);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    player: args.player,
    playerId: playerRows[0]!.playerId,
    summary,
    variants,
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
