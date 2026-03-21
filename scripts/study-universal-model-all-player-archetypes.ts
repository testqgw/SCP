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

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type WindowKey = "full" | "last30d" | "last14d";

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
};

type CompactBucketSummary = Pick<
  BucketSummary,
  "samples" | "blendedAccuracy" | "qualifiedAccuracy" | "coveragePct" | "deltaVsBaseline"
>;

type SummaryDelta = {
  blendedAccuracyChange: number | null;
  qualifiedAccuracyChange: number | null;
  coveragePctChange: number | null;
  deltaVsBaselineChange: number | null;
};

type WindowSummary = {
  overall: BucketSummary;
  byMarket: Partial<Record<Market, BucketSummary>>;
};

type CompactWindowSummary = {
  overall: CompactBucketSummary;
};

type MarketDelta = {
  market: Market;
  blendedAccuracyChange: number | null;
  qualifiedAccuracyChange: number | null;
  coveragePctChange: number | null;
  deltaVsBaselineChange: number | null;
};

type AnalyzedRow = {
  row: TrainingRow;
  gameDateOnly: string;
  archetype: string;
  predictedSide: Side;
  blendedSide: Side;
  qualified: boolean;
};

type CandidateEvaluation = {
  forcedArchetype: Archetype;
  windows: Record<WindowKey, CompactWindowSummary>;
  deltasVsCurrent: Record<WindowKey, SummaryDelta>;
  topImprovedMarketsFull: MarketDelta[];
  topWorsenedMarketsFull: MarketDelta[];
  stability: "stable_positive" | "full_only_positive" | "conflicted_recent" | "not_improved";
  score: number;
};

type PlayerArchetypeAudit = {
  playerId: string;
  playerName: string;
  position: string | null;
  samples: number;
  currentArchetypeMix: Array<{ archetype: string; count: number }>;
  currentDominantArchetype: string | null;
  currentWindows: Record<WindowKey, CompactWindowSummary>;
  bestAlternative: CandidateEvaluation | null;
  bestPlausibleAlternative: CandidateEvaluation | null;
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
  minSamples: number;
  minRecentSamples: number;
  top: number;
};

type WindowConfig = {
  key: WindowKey;
  days: number | null;
};

type PlayerMetaCacheFile = {
  updatedAt?: string;
  players?: Array<{
    id: string;
    position: string | null;
  }>;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const WINDOWS: WindowConfig[] = [
  { key: "full", days: null },
  { key: "last30d", days: 30 },
  { key: "last14d", days: 14 },
];
const ALL_ARCHETYPES: Archetype[] = [
  "LEAD_GUARD",
  "TABLE_SETTING_LEAD_GUARD",
  "SCORE_FIRST_LEAD_GUARD",
  "HELIOCENTRIC_GUARD",
  "ELITE_SHOOTING_GUARD",
  "SCORING_GUARD_CREATOR",
  "JUMBO_CREATOR_GUARD",
  "WING",
  "CONNECTOR_WING",
  "SPOTUP_WING",
  "BENCH_SHOOTING_GUARD",
  "BENCH_PASS_FIRST_GUARD",
  "BENCH_LOW_USAGE_GUARD",
  "BENCH_TRADITIONAL_GUARD",
  "BENCH_WING",
  "BENCH_LOW_USAGE_WING",
  "BENCH_MIDRANGE_SCORER",
  "BENCH_VOLUME_SCORER",
  "BENCH_CREATOR_SCORER",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_SPACER_SCORER",
  "BENCH_STRETCH_BIG",
  "BENCH_LOW_USAGE_BIG",
  "BENCH_TRADITIONAL_BIG",
  "TWO_WAY_MARKET_WING",
  "SCORER_CREATOR_WING",
  "SHOT_CREATING_WING",
  "MARKET_SHAPED_SCORING_WING",
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "POINT_FORWARD",
  "LOW_MINUTE_BENCH",
];
const GUARD_ARCHETYPES = new Set<Archetype>([
  "LEAD_GUARD",
  "TABLE_SETTING_LEAD_GUARD",
  "SCORE_FIRST_LEAD_GUARD",
  "HELIOCENTRIC_GUARD",
  "ELITE_SHOOTING_GUARD",
  "SCORING_GUARD_CREATOR",
  "JUMBO_CREATOR_GUARD",
  "CONNECTOR_WING",
  "SPOTUP_WING",
  "TWO_WAY_MARKET_WING",
  "SCORER_CREATOR_WING",
  "SHOT_CREATING_WING",
  "MARKET_SHAPED_SCORING_WING",
  "POINT_FORWARD",
  "BENCH_SHOOTING_GUARD",
  "BENCH_PASS_FIRST_GUARD",
  "BENCH_LOW_USAGE_GUARD",
  "BENCH_TRADITIONAL_GUARD",
  "BENCH_WING",
  "BENCH_LOW_USAGE_WING",
  "BENCH_MIDRANGE_SCORER",
  "BENCH_VOLUME_SCORER",
  "BENCH_CREATOR_SCORER",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_SPACER_SCORER",
  "LOW_MINUTE_BENCH",
]);
const FORWARD_ARCHETYPES = new Set<Archetype>([
  "WING",
  "CONNECTOR_WING",
  "SPOTUP_WING",
  "TWO_WAY_MARKET_WING",
  "SCORER_CREATOR_WING",
  "SHOT_CREATING_WING",
  "MARKET_SHAPED_SCORING_WING",
  "POINT_FORWARD",
  "BENCH_WING",
  "BENCH_LOW_USAGE_WING",
  "BENCH_MIDRANGE_SCORER",
  "BENCH_VOLUME_SCORER",
  "BENCH_CREATOR_SCORER",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_SPACER_SCORER",
  "BENCH_STRETCH_BIG",
  "BENCH_TRADITIONAL_BIG",
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "LOW_MINUTE_BENCH",
]);
const BIG_ARCHETYPES = new Set<Archetype>([
  "CENTER",
  "STRETCH_RIM_PROTECTOR_CENTER",
  "POINT_FORWARD",
  "BENCH_REBOUNDING_SCORER",
  "BENCH_STRETCH_BIG",
  "BENCH_LOW_USAGE_BIG",
  "BENCH_TRADITIONAL_BIG",
  "LOW_MINUTE_BENCH",
]);

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out: string | null = null;
  let minActualMinutes = 15;
  let minSamples = 40;
  let minRecentSamples = 10;
  let top = 50;

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
    if ((token === "--min-actual-minutes" || token === "-m") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = Math.floor(parsed);
      continue;
    }
    if ((token === "--min-samples" || token === "-s") && next) {
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
    if ((token === "--min-recent-samples" || token === "-r") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minRecentSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-recent-samples=")) {
      const parsed = Number(token.slice("--min-recent-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minRecentSamples = Math.floor(parsed);
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
  }

  return { input, out, minActualMinutes, minSamples, minRecentSamples, top };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
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

function compactBucketSummary(summary: BucketSummary): CompactBucketSummary {
  return {
    samples: summary.samples,
    blendedAccuracy: summary.blendedAccuracy,
    qualifiedAccuracy: summary.qualifiedAccuracy,
    coveragePct: summary.coveragePct,
    deltaVsBaseline: summary.deltaVsBaseline,
  };
}

function compareBucketSummaries(current: BucketSummary, variant: BucketSummary): SummaryDelta {
  return {
    blendedAccuracyChange:
      current.blendedAccuracy != null && variant.blendedAccuracy != null
        ? round(variant.blendedAccuracy - current.blendedAccuracy, 2)
        : null,
    qualifiedAccuracyChange:
      current.qualifiedAccuracy != null && variant.qualifiedAccuracy != null
        ? round(variant.qualifiedAccuracy - current.qualifiedAccuracy, 2)
        : null,
    coveragePctChange:
      current.coveragePct != null && variant.coveragePct != null
        ? round(variant.coveragePct - current.coveragePct, 2)
        : null,
    deltaVsBaselineChange:
      current.deltaVsBaseline != null && variant.deltaVsBaseline != null
        ? round(variant.deltaVsBaseline - current.deltaVsBaseline, 2)
        : null,
  };
}

function loadPlayerMetaCache(cachePath: string): Map<string, string | null> {
  if (!fs.existsSync(cachePath)) return new Map();
  const payload = JSON.parse(fs.readFileSync(cachePath, "utf8")) as PlayerMetaCacheFile;
  return new Map((payload.players ?? []).map((player) => [player.id, player.position ?? null]));
}

function isPlausibleForcedArchetype(position: string | null, archetype: Archetype): boolean {
  if (!position) return false;
  const normalized = position.toUpperCase();
  const isGuard = normalized.includes("PG") || normalized.includes("SG") || normalized === "G";
  const isForward = normalized.includes("SF") || normalized.includes("PF") || normalized === "F";
  const isCenter = normalized.includes("C");

  if (isGuard && GUARD_ARCHETYPES.has(archetype)) return true;
  if (isForward && FORWARD_ARCHETYPES.has(archetype)) return true;
  if (isCenter && BIG_ARCHETYPES.has(archetype)) return true;

  if (isGuard && isForward && (GUARD_ARCHETYPES.has(archetype) || FORWARD_ARCHETYPES.has(archetype))) return true;
  if (isForward && isCenter && (FORWARD_ARCHETYPES.has(archetype) || BIG_ARCHETYPES.has(archetype))) return true;
  if (isGuard && isCenter && (GUARD_ARCHETYPES.has(archetype) || BIG_ARCHETYPES.has(archetype))) return true;
  return false;
}

function buildPlayerSummaries(rows: TrainingRow[], positionById: Map<string, string | null>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const existing = byPlayer.get(row.playerId) ?? [];
    existing.push(row);
    byPlayer.set(row.playerId, existing);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    const ptsRows = playerRows.filter((row) => row.market === "PTS");
    const rebRows = playerRows.filter((row) => row.market === "REB");
    const astRows = playerRows.filter((row) => row.market === "AST");
    const threesRows = playerRows.filter((row) => row.market === "THREES");
    summaries.set(playerId, {
      playerId,
      playerName: playerRows[0]!.playerName,
      position: positionById.get(playerId) ?? null,
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

function buildInput(row: TrainingRow, summary: PlayerSummary) {
  return {
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
  };
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

function withinWindow(value: string, window: WindowConfig, maxDateOnly: string): boolean {
  if (window.days == null) return true;
  return value >= shiftDateDays(maxDateOnly, window.days);
}

function applyDecisionToBucket(bucket: AggregateBucket, row: TrainingRow, predictedSide: Side, qualified: boolean): void {
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
  if (disagreement && qualified) {
    if (predictedSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
    else bucket.qualifiedDisagreementLosses += 1;
  }
  if (disagreement) bucket.disagreements += 1;
}

function summarizeAnalyzedRows(rows: AnalyzedRow[]): WindowSummary {
  const overall = emptyBucket();
  const byMarket = new Map<Market, AggregateBucket>();

  rows.forEach((analyzed) => {
    applyDecisionToBucket(overall, analyzed.row, analyzed.predictedSide, analyzed.qualified);
    const marketBucket = byMarket.get(analyzed.row.market) ?? emptyBucket();
    applyDecisionToBucket(marketBucket, analyzed.row, analyzed.predictedSide, analyzed.qualified);
    byMarket.set(analyzed.row.market, marketBucket);
  });

  return {
    overall: summarizeBucket(overall),
    byMarket: Object.fromEntries(
      [...byMarket.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
  };
}

function analyzePlayerRows(
  rows: TrainingRow[],
  summary: PlayerSummary,
  forcedArchetype?: Archetype,
): {
  analyzedRows: AnalyzedRow[];
  effectiveArchetypeCounts: Array<{ archetype: string; count: number }>;
} {
  const counts = new Map<string, number>();
  const analyzedRows: AnalyzedRow[] = [];

  rows.forEach((row) => {
    const input = buildInput(row, summary);
    const raw = forcedArchetype
      ? inspectLiveUniversalModelSideForArchetype(input, forcedArchetype)
      : inspectLiveUniversalModelSide(input);
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
    const archetype = raw.archetype ?? "UNKNOWN";
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
    analyzedRows.push({
      row,
      gameDateOnly: gameDateOnly(row.gameDateEt),
      archetype,
      predictedSide,
      blendedSide: qualified.qualified ? predictedSide : row.finalSide,
      qualified: qualified.qualified,
    });
  });

  return {
    analyzedRows,
    effectiveArchetypeCounts: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
  };
}

function buildWindowSummaries(analyzedRows: AnalyzedRow[], maxDateOnly: string): Record<WindowKey, WindowSummary> {
  return Object.fromEntries(
    WINDOWS.map((window) => {
      const windowRows = analyzedRows.filter((row) => withinWindow(row.gameDateOnly, window, maxDateOnly));
      return [window.key, summarizeAnalyzedRows(windowRows)];
    }),
  ) as Record<WindowKey, WindowSummary>;
}

function compactWindowSummaries(windows: Record<WindowKey, WindowSummary>): Record<WindowKey, CompactWindowSummary> {
  return {
    full: { overall: compactBucketSummary(windows.full.overall) },
    last30d: { overall: compactBucketSummary(windows.last30d.overall) },
    last14d: { overall: compactBucketSummary(windows.last14d.overall) },
  };
}

function buildMarketDeltas(
  current: WindowSummary,
  candidate: WindowSummary,
): { improved: MarketDelta[]; worsened: MarketDelta[] } {
  const markets = new Set<Market>([
    ...Object.keys(current.byMarket),
    ...Object.keys(candidate.byMarket),
  ] as Market[]);

  const deltas = [...markets]
    .sort()
    .map((market) => {
      const currentMarket = current.byMarket[market];
      const candidateMarket = candidate.byMarket[market];
      if (!currentMarket || !candidateMarket) return null;
      const delta = compareBucketSummaries(currentMarket, candidateMarket);
      return {
        market,
        blendedAccuracyChange: delta.blendedAccuracyChange,
        qualifiedAccuracyChange: delta.qualifiedAccuracyChange,
        coveragePctChange: delta.coveragePctChange,
        deltaVsBaselineChange: delta.deltaVsBaselineChange,
      } satisfies MarketDelta;
    })
    .filter((value): value is MarketDelta => value != null);

  const improved = [...deltas]
    .filter((delta) => (delta.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0)
    .sort(
      (left, right) =>
        (right.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        left.market.localeCompare(right.market),
    )
    .slice(0, 3);
  const worsened = [...deltas]
    .filter((delta) => (delta.blendedAccuracyChange ?? Number.POSITIVE_INFINITY) < 0)
    .sort(
      (left, right) =>
        (left.blendedAccuracyChange ?? Number.POSITIVE_INFINITY) -
          (right.blendedAccuracyChange ?? Number.POSITIVE_INFINITY) ||
        left.market.localeCompare(right.market),
    )
    .slice(0, 3);

  return { improved, worsened };
}

function classifyStability(
  deltasVsCurrent: Record<WindowKey, SummaryDelta>,
  currentWindows: Record<WindowKey, WindowSummary>,
  minRecentSamples: number,
): CandidateEvaluation["stability"] {
  const fullDelta = deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
  if (fullDelta <= 0) return "not_improved";

  const recentSignals = (["last30d", "last14d"] as WindowKey[])
    .filter((key) => currentWindows[key].overall.samples >= minRecentSamples)
    .map((key) => deltasVsCurrent[key].blendedAccuracyChange ?? Number.NEGATIVE_INFINITY);

  if (!recentSignals.length) return "full_only_positive";
  if (recentSignals.every((value) => value > 0)) return "stable_positive";
  return "conflicted_recent";
}

function candidateScore(
  deltasVsCurrent: Record<WindowKey, SummaryDelta>,
  stability: CandidateEvaluation["stability"],
): number {
  const full = deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
  const last30 = deltasVsCurrent.last30d.blendedAccuracyChange ?? 0;
  const last14 = deltasVsCurrent.last14d.blendedAccuracyChange ?? 0;
  const deltaVsBaseline = deltasVsCurrent.full.deltaVsBaselineChange ?? 0;
  const stabilityBonus =
    stability === "stable_positive" ? 1000 : stability === "full_only_positive" ? 100 : stability === "conflicted_recent" ? 10 : 0;
  return stabilityBonus + full * 10 + deltaVsBaseline + last30 * 0.5 + last14 * 0.25;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const maxDateOnly = filteredRows.reduce(
    (current, row) => {
      const next = gameDateOnly(row.gameDateEt);
      return next > current ? next : current;
    },
    "0000-00-00",
  );
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const summaries = buildPlayerSummaries(filteredRows, positionById);
  const rowsByPlayerId = new Map<string, TrainingRow[]>();
  filteredRows.forEach((row) => {
    const existing = rowsByPlayerId.get(row.playerId) ?? [];
    existing.push(row);
    rowsByPlayerId.set(row.playerId, existing);
  });

  const players: PlayerArchetypeAudit[] = [];

  rowsByPlayerId.forEach((playerRows, playerId) => {
    if (playerRows.length < args.minSamples) return;
    const summary = summaries.get(playerId);
    if (!summary) return;

    const current = analyzePlayerRows(playerRows, summary);
    const currentWindows = buildWindowSummaries(current.analyzedRows, maxDateOnly);
    const currentCompact = compactWindowSummaries(currentWindows);
    const currentDominantArchetype = current.effectiveArchetypeCounts[0]?.archetype ?? null;

    let bestAlternative: CandidateEvaluation | null = null;
    let bestPlausibleAlternative: CandidateEvaluation | null = null;

    ALL_ARCHETYPES.forEach((forcedArchetype) => {
      const candidate = analyzePlayerRows(playerRows, summary, forcedArchetype);
      const candidateWindows = buildWindowSummaries(candidate.analyzedRows, maxDateOnly);
      const deltasVsCurrent = {
        full: compareBucketSummaries(currentWindows.full.overall, candidateWindows.full.overall),
        last30d: compareBucketSummaries(currentWindows.last30d.overall, candidateWindows.last30d.overall),
        last14d: compareBucketSummaries(currentWindows.last14d.overall, candidateWindows.last14d.overall),
      } satisfies Record<WindowKey, SummaryDelta>;
      const stability = classifyStability(deltasVsCurrent, currentWindows, args.minRecentSamples);
      const score = candidateScore(deltasVsCurrent, stability);
      const marketDeltas = buildMarketDeltas(currentWindows.full, candidateWindows.full);
      const evaluation: CandidateEvaluation = {
        forcedArchetype,
        windows: compactWindowSummaries(candidateWindows),
        deltasVsCurrent,
        topImprovedMarketsFull: marketDeltas.improved,
        topWorsenedMarketsFull: marketDeltas.worsened,
        stability,
        score,
      };
      if (!bestAlternative || evaluation.score > bestAlternative.score) {
        bestAlternative = evaluation;
      }
      if (isPlausibleForcedArchetype(summary.position, forcedArchetype)) {
        if (!bestPlausibleAlternative || evaluation.score > bestPlausibleAlternative.score) {
          bestPlausibleAlternative = evaluation;
        }
      }
    });

    players.push({
      playerId,
      playerName: summary.playerName,
      position: summary.position,
      samples: playerRows.length,
      currentArchetypeMix: current.effectiveArchetypeCounts.slice(0, 5),
      currentDominantArchetype,
      currentWindows: currentCompact,
      bestAlternative,
      bestPlausibleAlternative,
    });
  });

  const sortedPlayers = [...players].sort((left, right) => {
    const leftDelta = left.bestAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    const rightDelta = right.bestAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    if (rightDelta !== leftDelta) return rightDelta - leftDelta;
    if (right.samples !== left.samples) return right.samples - left.samples;
    return left.playerName.localeCompare(right.playerName);
  });
  const sortedPlausiblePlayers = [...players].sort((left, right) => {
    const leftDelta = left.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    const rightDelta = right.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    if (rightDelta !== leftDelta) return rightDelta - leftDelta;
    if (right.samples !== left.samples) return right.samples - left.samples;
    return left.playerName.localeCompare(right.playerName);
  });

  const improvedPlayers = sortedPlayers.filter(
    (player) => (player.bestAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0,
  );
  const stablePlayers = improvedPlayers.filter((player) => player.bestAlternative?.stability === "stable_positive");
  const plausibleImprovedPlayers = sortedPlausiblePlayers.filter(
    (player) => (player.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0,
  );
  const plausibleStablePlayers = plausibleImprovedPlayers.filter(
    (player) => player.bestPlausibleAlternative?.stability === "stable_positive",
  );
  const positiveByArchetype = new Map<
    Archetype,
    { players: number; stablePlayers: number; blendedDeltaSum: number; deltaVsBaselineSum: number }
  >();
  improvedPlayers.forEach((player) => {
    const best = player.bestAlternative;
    if (!best) return;
    const bucket = positiveByArchetype.get(best.forcedArchetype) ?? {
      players: 0,
      stablePlayers: 0,
      blendedDeltaSum: 0,
      deltaVsBaselineSum: 0,
    };
    bucket.players += 1;
    if (best.stability === "stable_positive") bucket.stablePlayers += 1;
    bucket.blendedDeltaSum += best.deltasVsCurrent.full.blendedAccuracyChange ?? 0;
    bucket.deltaVsBaselineSum += best.deltasVsCurrent.full.deltaVsBaselineChange ?? 0;
    positiveByArchetype.set(best.forcedArchetype, bucket);
  });
  const plausiblePositiveByArchetype = new Map<
    Archetype,
    { players: number; stablePlayers: number; blendedDeltaSum: number; deltaVsBaselineSum: number }
  >();
  plausibleImprovedPlayers.forEach((player) => {
    const best = player.bestPlausibleAlternative;
    if (!best) return;
    const bucket = plausiblePositiveByArchetype.get(best.forcedArchetype) ?? {
      players: 0,
      stablePlayers: 0,
      blendedDeltaSum: 0,
      deltaVsBaselineSum: 0,
    };
    bucket.players += 1;
    if (best.stability === "stable_positive") bucket.stablePlayers += 1;
    bucket.blendedDeltaSum += best.deltasVsCurrent.full.blendedAccuracyChange ?? 0;
    bucket.deltaVsBaselineSum += best.deltasVsCurrent.full.deltaVsBaselineChange ?? 0;
    plausiblePositiveByArchetype.set(best.forcedArchetype, bucket);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      minActualMinutes: args.minActualMinutes,
    },
    guardrails: {
      minSamples: args.minSamples,
      minRecentSamples: args.minRecentSamples,
      windows: WINDOWS,
      candidateArchetypes: ALL_ARCHETYPES,
    },
    summary: {
      analyzedPlayers: sortedPlayers.length,
      improvedPlayers: improvedPlayers.length,
      stableImprovedPlayers: stablePlayers.length,
      plausibleImprovedPlayers: plausibleImprovedPlayers.length,
      plausibleStableImprovedPlayers: plausibleStablePlayers.length,
      conflictedRecentPlayers: improvedPlayers.filter((player) => player.bestAlternative?.stability === "conflicted_recent").length,
      fullOnlyPlayers: improvedPlayers.filter((player) => player.bestAlternative?.stability === "full_only_positive").length,
      topRequested: args.top,
    },
    positiveAlternativeArchetypes: [...positiveByArchetype.entries()]
      .sort((left, right) => right[1].players - left[1].players || left[0].localeCompare(right[0]))
      .map(([archetype, bucket]) => ({
        archetype,
        players: bucket.players,
        stablePlayers: bucket.stablePlayers,
        avgFullBlendedAccuracyChange: round(bucket.blendedDeltaSum / bucket.players, 2),
        avgFullDeltaVsBaselineChange: round(bucket.deltaVsBaselineSum / bucket.players, 2),
      })),
    plausiblePositiveAlternativeArchetypes: [...plausiblePositiveByArchetype.entries()]
      .sort((left, right) => right[1].players - left[1].players || left[0].localeCompare(right[0]))
      .map(([archetype, bucket]) => ({
        archetype,
        players: bucket.players,
        stablePlayers: bucket.stablePlayers,
        avgFullBlendedAccuracyChange: round(bucket.blendedDeltaSum / bucket.players, 2),
        avgFullDeltaVsBaselineChange: round(bucket.deltaVsBaselineSum / bucket.players, 2),
      })),
    topCandidates: sortedPlayers.slice(0, args.top),
    stableCandidates: stablePlayers.slice(0, args.top),
    topPlausibleCandidates: sortedPlausiblePlayers.slice(0, args.top),
    stablePlausibleCandidates: plausibleStablePlayers.slice(0, args.top),
    players: sortedPlayers,
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
