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
import { meanProjection, rowProjectionOrSummary } from "./utils/trainingRowProjectionContext";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type WindowKey = "full" | "last30d" | "last14d";

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

type BucketSummary = ReturnType<typeof summarizeBucket>;

type WindowConfig = {
  key: WindowKey;
  label: string;
  days: number | null;
};

type Args = {
  input: string;
  out: string | null;
  archetype: string;
  minActualMinutes: number;
  minPlayerSamples: number;
  topPlayers: number;
};

const WINDOWS: WindowConfig[] = [
  { key: "full", label: "Full Sample", days: null },
  { key: "last30d", label: "Last 30 Days", days: 30 },
  { key: "last14d", label: "Last 14 Days", days: 14 },
];

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
  let archetype = "";
  let minActualMinutes = 15;
  let minPlayerSamples = 10;
  let topPlayers = 10;

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
    if ((token === "--archetype" || token === "-a") && next) {
      archetype = next.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--archetype=")) {
      archetype = token.slice("--archetype=".length).trim();
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
    if ((token === "--min-player-samples" || token === "-s") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minPlayerSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-player-samples=")) {
      const parsed = Number(token.slice("--min-player-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minPlayerSamples = Math.floor(parsed);
      continue;
    }
    if ((token === "--top-players" || token === "-t") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) topPlayers = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--top-players=")) {
      const parsed = Number(token.slice("--top-players=".length));
      if (Number.isFinite(parsed) && parsed > 0) topPlayers = Math.floor(parsed);
      continue;
    }
  }

  if (!archetype) throw new Error("Missing required --archetype argument.");
  return { input, out, archetype, minActualMinutes, minPlayerSamples, topPlayers };
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

function incrementMapCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
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
  } else {
    bucket.under += 1;
    if (predictedSide === row.actualSide) bucket.underCorrect += 1;
  }

  if (qualified.qualified) {
    bucket.qualifiedPicks += 1;
    if (predictedSide === row.actualSide) bucket.qualifiedCorrect += 1;
    if (predictedSide === "OVER") {
      bucket.qualifiedOver += 1;
      if (predictedSide === row.actualSide) bucket.qualifiedOverCorrect += 1;
    } else {
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

function ratioPercent(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return round((numerator / denominator) * 100, 2);
}

function summarizeBucket(bucket: AggregateBucket) {
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

function summarizeRowsIntoBucket(rows: AnalyzedRow[]): BucketSummary {
  const bucket = emptyBucket();
  rows.forEach((row) => applyDecisionToBucket(bucket, row));
  return summarizeBucket(bucket);
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

function withinWindow(value: string, config: WindowConfig, maxDateOnly: string): boolean {
  if (config.days == null) return true;
  return value >= shiftDateDays(maxDateOnly, config.days);
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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary.ptsProjectionAvg),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary.rebProjectionAvg),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary.astProjectionAvg),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary.threesProjectionAvg),
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

function summarizeRowsByMarket(rows: AnalyzedRow[]) {
  const byMarket = new Map<Market, AnalyzedRow[]>();
  rows.forEach((row) => {
    const bucket = byMarket.get(row.row.market) ?? [];
    bucket.push(row);
    byMarket.set(row.row.market, bucket);
  });

  return Object.fromEntries(
    [...byMarket.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([market, marketRows]) => [market, summarizeRowsIntoBucket(marketRows)]),
  ) as Partial<Record<Market, BucketSummary>>;
}

function summarizePositionSplit(rows: AnalyzedRow[]) {
  const groups = {
    missing_position: rows.filter((row) => !row.summary.position),
    known_position: rows.filter((row) => !!row.summary.position),
  };
  return {
    missing_position: {
      playerCount: new Set(groups.missing_position.map((row) => row.row.playerId)).size,
      summary: summarizeRowsIntoBucket(groups.missing_position),
    },
    known_position: {
      playerCount: new Set(groups.known_position.map((row) => row.row.playerId)).size,
      summary: summarizeRowsIntoBucket(groups.known_position),
    },
  };
}

function buildPlayerMarketLeaders(rows: AnalyzedRow[], minPlayerSamples: number, topPlayers: number) {
  const byPlayer = new Map<string, AnalyzedRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.row.playerId, bucket);
  });

  const players = [...byPlayer.entries()]
    .map(([playerId, playerRows]) => {
      const summary = summarizeRowsIntoBucket(playerRows);
      return {
        playerId,
        playerName: playerRows[0]?.row.playerName ?? playerId,
        position: playerRows[0]?.summary.position ?? null,
        samples: summary.samples,
        blendedAccuracy: summary.blendedAccuracy,
        baselineAccuracy: summary.baselineAccuracy,
        qualifiedAccuracy: summary.qualifiedAccuracy,
        qualifiedPicks: summary.qualifiedPicks,
        coveragePct: summary.coveragePct,
        deltaVsBaseline: summary.deltaVsBaseline,
      };
    })
    .filter((player) => player.samples >= minPlayerSamples)
    .sort((left, right) => {
      const deltaDiff = (left.deltaVsBaseline ?? 999) - (right.deltaVsBaseline ?? 999);
      if (deltaDiff !== 0) return deltaDiff;
      const blendedDiff = (left.blendedAccuracy ?? 999) - (right.blendedAccuracy ?? 999);
      if (blendedDiff !== 0) return blendedDiff;
      return right.samples - left.samples;
    });

  return {
    worstByDeltaVsBaseline: players.slice(0, topPlayers),
    bestByDeltaVsBaseline: [...players].reverse().slice(0, topPlayers),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(filteredRows);
  const summaries = summarizeRows(filteredRows, playerMetaMap);
  const analyzedRows = buildAnalyzedRows(filteredRows, summaries);
  const archetypeRows = analyzedRows.filter((row) => row.archetype === args.archetype);

  if (!archetypeRows.length) {
    throw new Error(`No analyzed rows found for archetype ${args.archetype}.`);
  }

  const maxDateOnly = archetypeRows.reduce((latest, row) => (row.gameDateOnly > latest ? row.gameDateOnly : latest), archetypeRows[0].gameDateOnly);

  const windows = Object.fromEntries(
    WINDOWS.map((windowConfig) => {
      const rows = archetypeRows.filter((row) => withinWindow(row.gameDateOnly, windowConfig, maxDateOnly));
      return [
        windowConfig.key,
        {
          label: windowConfig.label,
          overall: summarizeRowsIntoBucket(rows),
          byMarket: summarizeRowsByMarket(rows),
          positionSplit: summarizePositionSplit(rows),
        },
      ];
    }),
  );

  const fullByMarket = (windows.full as { byMarket: Partial<Record<Market, BucketSummary>> }).byMarket;
  const fullMarketRows = new Map<Market, AnalyzedRow[]>();
  archetypeRows.forEach((row) => {
    const bucket = fullMarketRows.get(row.row.market) ?? [];
    bucket.push(row);
    fullMarketRows.set(row.row.market, bucket);
  });

  const marketLeaders = Object.fromEntries(
    [...fullMarketRows.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([market, rows]) => [market, buildPlayerMarketLeaders(rows, args.minPlayerSamples, args.topPlayers)]),
  ) as Partial<
    Record<
      Market,
      {
        worstByDeltaVsBaseline: Array<{
          playerId: string;
          playerName: string;
          position: string | null;
          samples: number;
          blendedAccuracy: number | null;
          baselineAccuracy: number | null;
          qualifiedAccuracy: number | null;
          qualifiedPicks: number;
          coveragePct: number | null;
          deltaVsBaseline: number | null;
        }>;
        bestByDeltaVsBaseline: Array<{
          playerId: string;
          playerName: string;
          position: string | null;
          samples: number;
          blendedAccuracy: number | null;
          baselineAccuracy: number | null;
          qualifiedAccuracy: number | null;
          qualifiedPicks: number;
          coveragePct: number | null;
          deltaVsBaseline: number | null;
        }>;
      }
    >
  >;

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      maxGameDateEt: maxDateOnly,
      minActualMinutes: args.minActualMinutes,
    },
    archetype: args.archetype,
    config: {
      minPlayerSamples: args.minPlayerSamples,
      topPlayers: args.topPlayers,
    },
    overallPlayerCount: new Set(archetypeRows.map((row) => row.row.playerId)).size,
    windows,
    marketLeaders,
    marketRanking: Object.entries(fullByMarket)
      .map(([market, summary]) => ({
        market,
        samples: summary?.samples ?? 0,
        blendedAccuracy: summary?.blendedAccuracy ?? null,
        baselineAccuracy: summary?.baselineAccuracy ?? null,
        deltaVsBaseline: summary?.deltaVsBaseline ?? null,
        qualifiedAccuracy: summary?.qualifiedAccuracy ?? null,
        coveragePct: summary?.coveragePct ?? null,
      }))
      .sort((left, right) => {
        const deltaDiff = (left.deltaVsBaseline ?? 999) - (right.deltaVsBaseline ?? 999);
        if (deltaDiff !== 0) return deltaDiff;
        const blendedDiff = (left.blendedAccuracy ?? 999) - (right.blendedAccuracy ?? 999);
        if (blendedDiff !== 0) return blendedDiff;
        return right.samples - left.samples;
      }),
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
