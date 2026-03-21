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

type WindowConfig = {
  key: WindowKey;
  label: string;
  days: number | null;
};

type Args = {
  input: string;
  out: string | null;
  player: string;
  minActualMinutes: number;
};

const prisma = new PrismaClient();

const WINDOWS: WindowConfig[] = [
  { key: "full", label: "Full Sample", days: null },
  { key: "last30d", label: "Last 30 Days", days: 30 },
  { key: "last14d", label: "Last 14 Days", days: 14 },
];
const STABILITY_MIN_SAMPLES = 10;

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
  } else if (predictedSide === "UNDER") {
    bucket.under += 1;
    if (predictedSide === row.actualSide) bucket.underCorrect += 1;
  } else {
    bucket.neutral += 1;
  }
  if (qualified.qualified) {
    bucket.qualifiedPicks += 1;
    if (predictedSide === row.actualSide) bucket.qualifiedCorrect += 1;
    if (predictedSide === "OVER") {
      bucket.qualifiedOver += 1;
      if (predictedSide === row.actualSide) bucket.qualifiedOverCorrect += 1;
    } else if (predictedSide === "UNDER") {
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

function summarizeRowsIntoBucket(rows: AnalyzedRow[]): ReturnType<typeof summarizeBucket> {
  const bucket = emptyBucket();
  rows.forEach((row) => applyDecisionToBucket(bucket, row));
  return summarizeBucket(bucket);
}

function summarizeRowsByMarket(rows: AnalyzedRow[]): Partial<Record<Market, ReturnType<typeof summarizeBucket>>> {
  const byMarket = new Map<Market, AggregateBucket>();
  rows.forEach((row) => {
    const bucket = byMarket.get(row.row.market) ?? emptyBucket();
    applyDecisionToBucket(bucket, row);
    byMarket.set(row.row.market, bucket);
  });
  return Object.fromEntries([...byMarket.entries()].map(([market, bucket]) => [market, summarizeBucket(bucket)]));
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

function sortCounter(counter: Map<string, number>) {
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function summarizeExampleRow(analyzed: AnalyzedRow) {
  return {
    gameDateEt: analyzed.row.gameDateEt,
    market: analyzed.row.market,
    rawSide: analyzed.raw.rawSide,
    finalSide: analyzed.row.finalSide,
    blendedSide: analyzed.blendedSide,
    actualSide: analyzed.row.actualSide,
    qualified: analyzed.qualified.qualified,
    projectedValue: round(analyzed.row.projectedValue, 2),
    line: round(analyzed.row.line, 2),
    actualValue: round(analyzed.row.actualValue, 2),
    priceLean: analyzed.row.priceLean,
    favoredSide: analyzed.row.favoredSide,
    expectedMinutes: analyzed.row.expectedMinutes,
    openingTeamSpread: analyzed.row.openingTeamSpread,
    openingTotal: analyzed.row.openingTotal,
    archetype: analyzed.archetype,
  };
}

function buildRecentDisagreementExamples(rows: AnalyzedRow[]) {
  const sorted = [...rows].sort((left, right) => right.gameDateOnly.localeCompare(left.gameDateOnly));
  const harmfulQualifiedDisagreements = sorted
    .filter(
      (row) =>
        row.qualified.qualified &&
        row.disagreement &&
        row.predictedSide !== row.row.actualSide &&
        row.row.finalSide === row.row.actualSide,
    )
    .slice(0, 10)
    .map(summarizeExampleRow);
  const helpfulQualifiedDisagreements = sorted
    .filter(
      (row) =>
        row.qualified.qualified &&
        row.disagreement &&
        row.predictedSide === row.row.actualSide &&
        row.row.finalSide !== row.row.actualSide,
    )
    .slice(0, 10)
    .map(summarizeExampleRow);

  return {
    harmfulQualifiedDisagreements,
    helpfulQualifiedDisagreements,
  };
}

function diagnoseMarket(
  playerStats: ReturnType<typeof summarizeBucket> | undefined,
  archetypeExPlayerStats: ReturnType<typeof summarizeBucket> | undefined,
): {
  diagnosis: string;
  highLiveRisk: boolean;
  stableTransferCandidate: boolean;
} {
  if (!playerStats || (playerStats.samples ?? 0) < 10) {
    return {
      diagnosis: "insufficient_sample",
      highLiveRisk: false,
      stableTransferCandidate: false,
    };
  }

  const playerDelta = playerStats.deltaVsBaseline ?? 0;
  const playerCoverage = playerStats.coveragePct ?? 0;
  const qualifiedDisagreementLosses = playerStats.qualifiedDisagreementLosses ?? 0;
  const qualifiedDisagreementWins = playerStats.qualifiedDisagreementWins ?? 0;

  if (playerDelta >= 0) {
    return {
      diagnosis: "not_a_current_drag",
      highLiveRisk: false,
      stableTransferCandidate: false,
    };
  }

  const archetypeDelta = archetypeExPlayerStats?.deltaVsBaseline ?? null;
  const highLiveRisk = playerCoverage >= 75 && playerDelta <= -5;

  if (playerCoverage < 50) {
    return {
      diagnosis: "already_mostly_gated",
      highLiveRisk,
      stableTransferCandidate: false,
    };
  }

  if (archetypeDelta != null && archetypeDelta >= 0) {
    return {
      diagnosis:
        qualifiedDisagreementLosses > qualifiedDisagreementWins
          ? "player_specific_harmful_override"
          : "player_specific_misfit",
      highLiveRisk,
      stableTransferCandidate: false,
    };
  }

  if (archetypeDelta != null && archetypeDelta < 0) {
    return {
      diagnosis: "transferable_bucket_issue",
      highLiveRisk,
      stableTransferCandidate: true,
    };
  }

  return {
    diagnosis: "unclear_player_specific_drag",
    highLiveRisk,
    stableTransferCandidate: false,
  };
}

function buildMarketDiagnostics(
  playerByMarket: Partial<Record<Market, ReturnType<typeof summarizeBucket>>>,
  archetypeByMarketExPlayer: Partial<Record<Market, ReturnType<typeof summarizeBucket>>>,
) {
  const markets = new Set<Market>([
    ...Object.keys(playerByMarket),
    ...Object.keys(archetypeByMarketExPlayer),
  ] as Market[]);

  return Object.fromEntries(
    [...markets]
      .sort()
      .map((market) => {
        const playerStats = playerByMarket[market];
        const archetypeStats = archetypeByMarketExPlayer[market];
        const diagnosis = diagnoseMarket(playerStats, archetypeStats);
        return [
          market,
          {
            player: playerStats ?? null,
            archetypeExPlayer: archetypeStats ?? null,
            ...diagnosis,
          },
        ];
      }),
  );
}

function negativeDeltaMarkets(
  markets: Partial<Record<Market, ReturnType<typeof summarizeBucket>>>,
  minSamples = STABILITY_MIN_SAMPLES,
): Partial<Record<Market, number>> {
  const result: Partial<Record<Market, number>> = {};
  for (const [market, summary] of Object.entries(markets) as Array<[Market, ReturnType<typeof summarizeBucket>]>) {
    if ((summary.samples ?? 0) >= minSamples && (summary.deltaVsBaseline ?? 0) < 0) {
      result[market] = summary.deltaVsBaseline ?? 0;
    }
  }
  return result;
}

function buildWindowStudy(
  config: WindowConfig,
  maxDateOnly: string,
  playerId: string,
  archetype: string,
  analyzedRows: AnalyzedRow[],
) {
  const windowRows = analyzedRows.filter((row) => withinWindow(row.gameDateOnly, config, maxDateOnly));
  const playerRows = windowRows.filter((row) => row.row.playerId === playerId);
  const archetypeRows = windowRows.filter((row) => row.archetype === archetype);
  const archetypeRowsExPlayer = archetypeRows.filter((row) => row.row.playerId !== playerId);

  const playerOverall = summarizeRowsIntoBucket(playerRows);
  const playerByMarket = summarizeRowsByMarket(playerRows);
  const archetypeOverall = summarizeRowsIntoBucket(archetypeRows);
  const archetypeOverallExPlayer = summarizeRowsIntoBucket(archetypeRowsExPlayer);
  const archetypeByMarket = summarizeRowsByMarket(archetypeRows);
  const archetypeByMarketExPlayer = summarizeRowsByMarket(archetypeRowsExPlayer);

  return {
    label: config.label,
    cutoffDate: config.days == null ? null : shiftDateDays(maxDateOnly, config.days),
    playerOverall,
    playerByMarket,
    archetypeOverall,
    archetypeOverallExPlayer,
    archetypeByMarket,
    archetypeByMarketExPlayer,
    playerNegativeMarkets: negativeDeltaMarkets(playerByMarket),
    archetypeExPlayerNegativeMarkets: negativeDeltaMarkets(archetypeByMarketExPlayer),
    marketDiagnostics: buildMarketDiagnostics(playerByMarket, archetypeByMarketExPlayer),
    recentExamples: buildRecentDisagreementExamples(playerRows),
  };
}

function buildStabilityStudy(
  windows: Record<WindowKey, ReturnType<typeof buildWindowStudy>>,
): {
  playerNegativeWindowsByMarket: Partial<Record<Market, WindowKey[]>>;
  archetypeExPlayerNegativeWindowsByMarket: Partial<Record<Market, WindowKey[]>>;
  stablePlayerSpecificIssues: Market[];
  stableTransferableIssues: Market[];
} {
  const playerNegativeWindowsByMarket: Partial<Record<Market, WindowKey[]>> = {};
  const archetypeExPlayerNegativeWindowsByMarket: Partial<Record<Market, WindowKey[]>> = {};

  for (const windowKey of Object.keys(windows) as WindowKey[]) {
    const window = windows[windowKey];
    for (const market of Object.keys(window.playerNegativeMarkets) as Market[]) {
      const bucket = playerNegativeWindowsByMarket[market] ?? [];
      bucket.push(windowKey);
      playerNegativeWindowsByMarket[market] = bucket;
    }
    for (const market of Object.keys(window.archetypeExPlayerNegativeMarkets) as Market[]) {
      const bucket = archetypeExPlayerNegativeWindowsByMarket[market] ?? [];
      bucket.push(windowKey);
      archetypeExPlayerNegativeWindowsByMarket[market] = bucket;
    }
  }

  const stablePlayerSpecificIssues = (Object.keys(playerNegativeWindowsByMarket) as Market[]).filter((market) => {
    const playerWindows = playerNegativeWindowsByMarket[market] ?? [];
    const archetypeWindows = archetypeExPlayerNegativeWindowsByMarket[market] ?? [];
    return playerWindows.length >= 2 && archetypeWindows.length === 0;
  });

  const stableTransferableIssues = (Object.keys(playerNegativeWindowsByMarket) as Market[]).filter((market) => {
    const playerWindows = playerNegativeWindowsByMarket[market] ?? [];
    const archetypeWindows = archetypeExPlayerNegativeWindowsByMarket[market] ?? [];
    return playerWindows.length >= 2 && archetypeWindows.length >= 2;
  });

  return {
    playerNegativeWindowsByMarket,
    archetypeExPlayerNegativeWindowsByMarket,
    stablePlayerSpecificIssues,
    stableTransferableIssues,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(rows);
  const summaries = summarizeRows(rows, playerMetaMap);
  const analyzedRows = buildAnalyzedRows(rows, summaries);

  const playerRows = analyzedRows.filter((row) => row.row.playerName.toLowerCase() === args.player.toLowerCase());
  if (!playerRows.length) {
    throw new Error(`No rows found for player "${args.player}".`);
  }

  const playerId = playerRows[0]!.row.playerId;
  const targetSummary = summaries.get(playerId);
  if (!targetSummary) {
    throw new Error(`Missing summary for player "${args.player}".`);
  }

  const archetypeCounter = new Map<string, number>();
  playerRows.forEach((row) => incrementMapCounter(archetypeCounter, row.archetype));
  const dominantArchetype = sortCounter(archetypeCounter)[0]?.key ?? "UNKNOWN";

  const maxDateOnly = analyzedRows.reduce(
    (latest, row) => (row.gameDateOnly > latest ? row.gameDateOnly : latest),
    gameDateOnly(payload.to),
  );

  const windows = Object.fromEntries(
    WINDOWS.map((config) => [config.key, buildWindowStudy(config, maxDateOnly, playerId, dominantArchetype, analyzedRows)]),
  ) as Record<WindowKey, ReturnType<typeof buildWindowStudy>>;

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      maxGameDateEt: maxDateOnly,
      minActualMinutes: args.minActualMinutes,
    },
    player: args.player,
    playerId,
    dominantArchetype,
    archetypeCounts: sortCounter(archetypeCounter),
    summary: {
      position: targetSummary.position,
      avgExpectedMinutes: round(targetSummary.avgExpectedMinutes ?? 0, 2),
      avgStarterRate: round(targetSummary.avgStarterRate ?? 0, 2),
      ptsProjectionAvg: round(targetSummary.ptsProjectionAvg ?? 0, 2),
      rebProjectionAvg: round(targetSummary.rebProjectionAvg ?? 0, 2),
      astProjectionAvg: round(targetSummary.astProjectionAvg ?? 0, 2),
      threesProjectionAvg: round(targetSummary.threesProjectionAvg ?? 0, 2),
    },
    windows,
    stability: buildStabilityStudy(windows),
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
