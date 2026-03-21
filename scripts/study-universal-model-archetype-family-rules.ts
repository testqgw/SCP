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

type FamilyAuditPlayer = {
  playerId: string;
  playerName: string;
  position: string | null;
  samples: number;
  currentDominantArchetype: string | null;
  bestPlausibleAlternative: {
    forcedArchetype: Archetype;
    deltasVsCurrent: Record<WindowKey, SummaryDelta>;
    stability: "stable_positive" | "full_only_positive" | "conflicted_recent" | "not_improved";
  } | null;
};

type FamilyAuditFile = {
  generatedAt: string;
  input: string;
  datasetRange: {
    from: string;
    to: string;
    minActualMinutes: number;
  };
  summary: {
    analyzedPlayers: number;
    plausibleImprovedPlayers: number;
    plausibleStableImprovedPlayers: number;
  };
  stablePlausibleCandidates: FamilyAuditPlayer[];
  players: FamilyAuditPlayer[];
};

type Args = {
  input: string;
  audit: string;
  out: string | null;
  minActualMinutes: number;
  minStableMembers: number;
  minExpandedMembers: number;
  minRecentSamples: number;
  top: number;
};

type WindowConfig = {
  key: WindowKey;
  days: number | null;
};

type AnalyzedRow = {
  row: TrainingRow;
  gameDateOnly: string;
  predictedSide: Side;
  qualified: boolean;
};

type EvaluatedVariant = {
  windows: Record<WindowKey, WindowSummary>;
};

type FamilyEvaluation = {
  current: Record<WindowKey, CompactWindowSummary>;
  forced: Record<WindowKey, CompactWindowSummary>;
  deltas: Record<WindowKey, SummaryDelta>;
  topImprovedMarketsFull: MarketDelta[];
  topWorsenedMarketsFull: MarketDelta[];
  stability: "stable_positive" | "full_only_positive" | "conflicted_recent" | "not_improved";
};

type FamilyResult = {
  familyKey: string;
  sourceArchetype: string;
  targetArchetype: Archetype;
  stableMemberCount: number;
  expandedMemberCount: number;
  stableMembers: Array<{
    playerId: string;
    playerName: string;
    position: string | null;
    samples: number;
    deltaBlendedFull: number | null;
    deltaBlended30d: number | null;
    deltaBlended14d: number | null;
  }>;
  expandedMembers: Array<{
    playerId: string;
    playerName: string;
    position: string | null;
    samples: number;
    stability: string | null;
    deltaBlendedFull: number | null;
  }>;
  stableEvaluation: FamilyEvaluation;
  expandedEvaluation: FamilyEvaluation;
  recommendation: "promising" | "watch" | "reject";
};

const WINDOWS: WindowConfig[] = [
  { key: "full", days: null },
  { key: "last30d", days: 30 },
  { key: "last14d", days: 14 },
];
const DEFAULT_AUDIT_PATH = path.join(process.cwd(), "exports", "player-studies", "universal-all-player-archetype-audit.json");

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let audit = DEFAULT_AUDIT_PATH;
  let out: string | null = null;
  let minActualMinutes = 15;
  let minStableMembers = 2;
  let minExpandedMembers = 2;
  let minRecentSamples = 10;
  let top = 25;

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
    if ((token === "--audit" || token === "-a") && next) {
      audit = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--audit=")) {
      audit = token.slice("--audit=".length);
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
    if ((token === "--min-stable-members" || token === "-s") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minStableMembers = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-stable-members=")) {
      const parsed = Number(token.slice("--min-stable-members=".length));
      if (Number.isFinite(parsed) && parsed > 0) minStableMembers = Math.floor(parsed);
      continue;
    }
    if ((token === "--min-expanded-members" || token === "-e") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minExpandedMembers = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-expanded-members=")) {
      const parsed = Number(token.slice("--min-expanded-members=".length));
      if (Number.isFinite(parsed) && parsed > 0) minExpandedMembers = Math.floor(parsed);
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

  return {
    input,
    audit,
    out,
    minActualMinutes,
    minStableMembers,
    minExpandedMembers,
    minRecentSamples,
    top,
  };
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
  if (disagreement) {
    bucket.disagreements += 1;
    if (qualified) {
      if (predictedSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
      else bucket.qualifiedDisagreementLosses += 1;
    }
  }
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

function evaluateVariant(
  rows: TrainingRow[],
  summaries: Map<string, PlayerSummary>,
  maxDateOnly: string,
  forcedArchetype?: Archetype,
): EvaluatedVariant {
  const analyzedRows: AnalyzedRow[] = [];
  rows.forEach((row) => {
    const summary = summaries.get(row.playerId);
    if (!summary) return;
    const input = buildInput(row, summary);
    const raw = forcedArchetype
      ? inspectLiveUniversalModelSideForArchetype(input, forcedArchetype)
      : inspectLiveUniversalModelSide(input);
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
    analyzedRows.push({
      row,
      gameDateOnly: gameDateOnly(row.gameDateEt),
      predictedSide,
      qualified: qualified.qualified,
    });
  });

  const windows = Object.fromEntries(
    WINDOWS.map((window) => {
      const windowRows = analyzedRows.filter((row) => withinWindow(row.gameDateOnly, window, maxDateOnly));
      return [window.key, summarizeAnalyzedRows(windowRows)];
    }),
  ) as Record<WindowKey, WindowSummary>;

  return { windows };
}

function compactWindows(windows: Record<WindowKey, WindowSummary>): Record<WindowKey, CompactWindowSummary> {
  return {
    full: { overall: compactBucketSummary(windows.full.overall) },
    last30d: { overall: compactBucketSummary(windows.last30d.overall) },
    last14d: { overall: compactBucketSummary(windows.last14d.overall) },
  };
}

function buildMarketDeltas(
  current: WindowSummary,
  forced: WindowSummary,
): { improved: MarketDelta[]; worsened: MarketDelta[] } {
  const markets = new Set<Market>([
    ...Object.keys(current.byMarket),
    ...Object.keys(forced.byMarket),
  ] as Market[]);

  const deltas = [...markets]
    .sort()
    .map((market) => {
      const currentMarket = current.byMarket[market];
      const forcedMarket = forced.byMarket[market];
      if (!currentMarket || !forcedMarket) return null;
      const delta = compareBucketSummaries(currentMarket, forcedMarket);
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
  deltas: Record<WindowKey, SummaryDelta>,
  currentWindows: Record<WindowKey, WindowSummary>,
  minRecentSamples: number,
): FamilyEvaluation["stability"] {
  const fullDelta = deltas.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
  if (fullDelta <= 0) return "not_improved";

  const recentSignals = (["last30d", "last14d"] as WindowKey[])
    .filter((key) => currentWindows[key].overall.samples >= minRecentSamples)
    .map((key) => deltas[key].blendedAccuracyChange ?? Number.NEGATIVE_INFINITY);

  if (!recentSignals.length) return "full_only_positive";
  if (recentSignals.every((value) => value > 0)) return "stable_positive";
  return "conflicted_recent";
}

function evaluateFamilyRows(
  rows: TrainingRow[],
  summaries: Map<string, PlayerSummary>,
  forcedArchetype: Archetype,
  maxDateOnly: string,
  minRecentSamples: number,
): FamilyEvaluation {
  const current = evaluateVariant(rows, summaries, maxDateOnly);
  const forced = evaluateVariant(rows, summaries, maxDateOnly, forcedArchetype);
  const deltas = {
    full: compareBucketSummaries(current.windows.full.overall, forced.windows.full.overall),
    last30d: compareBucketSummaries(current.windows.last30d.overall, forced.windows.last30d.overall),
    last14d: compareBucketSummaries(current.windows.last14d.overall, forced.windows.last14d.overall),
  } satisfies Record<WindowKey, SummaryDelta>;
  const marketDeltas = buildMarketDeltas(current.windows.full, forced.windows.full);
  return {
    current: compactWindows(current.windows),
    forced: compactWindows(forced.windows),
    deltas,
    topImprovedMarketsFull: marketDeltas.improved,
    topWorsenedMarketsFull: marketDeltas.worsened,
    stability: classifyStability(deltas, current.windows, minRecentSamples),
  };
}

function recommendationFromEvaluation(evaluation: FamilyEvaluation): FamilyResult["recommendation"] {
  if (evaluation.stability === "stable_positive") return "promising";
  if (evaluation.stability === "full_only_positive" || evaluation.stability === "conflicted_recent") return "watch";
  return "reject";
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rowsPayload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const audit = JSON.parse(await readFile(path.resolve(args.audit), "utf8")) as FamilyAuditFile;
  const filteredRows = rowsPayload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const maxDateOnly = filteredRows.reduce(
    (current, row) => {
      const next = gameDateOnly(row.gameDateEt);
      return next > current ? next : current;
    },
    "0000-00-00",
  );
  const positionById = new Map(audit.players.map((player) => [player.playerId, player.position ?? null]));
  const summaries = buildPlayerSummaries(filteredRows, positionById);
  const rowsByPlayerId = new Map<string, TrainingRow[]>();
  filteredRows.forEach((row) => {
    const existing = rowsByPlayerId.get(row.playerId) ?? [];
    existing.push(row);
    rowsByPlayerId.set(row.playerId, existing);
  });

  const stableFamilies = new Map<string, FamilyAuditPlayer[]>();
  audit.stablePlausibleCandidates.forEach((player) => {
    const source = player.currentDominantArchetype;
    const target = player.bestPlausibleAlternative?.forcedArchetype;
    if (!source || !target) return;
    const key = `${source} -> ${target}`;
    const existing = stableFamilies.get(key) ?? [];
    existing.push(player);
    stableFamilies.set(key, existing);
  });

  const positivePlausiblePlayers = audit.players.filter(
    (player) => (player.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0,
  );

  const families: FamilyResult[] = [];
  stableFamilies.forEach((stableMembers, familyKey) => {
    if (stableMembers.length < args.minStableMembers) return;
    const [sourceArchetype, targetArchetypeRaw] = familyKey.split(" -> ");
    const targetArchetype = targetArchetypeRaw as Archetype;
    const expandedMembers = positivePlausiblePlayers.filter(
      (player) =>
        player.currentDominantArchetype === sourceArchetype &&
        player.bestPlausibleAlternative?.forcedArchetype === targetArchetype,
    );
    if (expandedMembers.length < args.minExpandedMembers) return;

    const stableRows = stableMembers.flatMap((player) => rowsByPlayerId.get(player.playerId) ?? []);
    const expandedRows = expandedMembers.flatMap((player) => rowsByPlayerId.get(player.playerId) ?? []);
    if (!stableRows.length || !expandedRows.length) return;

    const stableEvaluation = evaluateFamilyRows(
      stableRows,
      summaries,
      targetArchetype,
      maxDateOnly,
      args.minRecentSamples,
    );
    const expandedEvaluation = evaluateFamilyRows(
      expandedRows,
      summaries,
      targetArchetype,
      maxDateOnly,
      args.minRecentSamples,
    );

    families.push({
      familyKey,
      sourceArchetype,
      targetArchetype,
      stableMemberCount: stableMembers.length,
      expandedMemberCount: expandedMembers.length,
      stableMembers: stableMembers.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
        position: player.position,
        samples: player.samples,
        deltaBlendedFull: player.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? null,
        deltaBlended30d: player.bestPlausibleAlternative?.deltasVsCurrent.last30d.blendedAccuracyChange ?? null,
        deltaBlended14d: player.bestPlausibleAlternative?.deltasVsCurrent.last14d.blendedAccuracyChange ?? null,
      })),
      expandedMembers: expandedMembers.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
        position: player.position,
        samples: player.samples,
        stability: player.bestPlausibleAlternative?.stability ?? null,
        deltaBlendedFull: player.bestPlausibleAlternative?.deltasVsCurrent.full.blendedAccuracyChange ?? null,
      })),
      stableEvaluation,
      expandedEvaluation,
      recommendation: recommendationFromEvaluation(expandedEvaluation),
    });
  });

  const sortedFamilies = [...families].sort((left, right) => {
    const rank = (value: FamilyResult["recommendation"]) =>
      value === "promising" ? 0 : value === "watch" ? 1 : 2;
    const leftRank = rank(left.recommendation);
    const rightRank = rank(right.recommendation);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftDelta = left.expandedEvaluation.deltas.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    const rightDelta = right.expandedEvaluation.deltas.full.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY;
    if (rightDelta !== leftDelta) return rightDelta - leftDelta;
    return left.familyKey.localeCompare(right.familyKey);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    audit: path.resolve(args.audit),
    datasetRange: {
      from: rowsPayload.from,
      to: rowsPayload.to,
      minActualMinutes: args.minActualMinutes,
    },
    guardrails: {
      minStableMembers: args.minStableMembers,
      minExpandedMembers: args.minExpandedMembers,
      minRecentSamples: args.minRecentSamples,
    },
    summary: {
      candidateStableFamilies: stableFamilies.size,
      evaluatedFamilies: sortedFamilies.length,
      promisingFamilies: sortedFamilies.filter((family) => family.recommendation === "promising").length,
      watchFamilies: sortedFamilies.filter((family) => family.recommendation === "watch").length,
      rejectFamilies: sortedFamilies.filter((family) => family.recommendation === "reject").length,
    },
    topFamilies: sortedFamilies.slice(0, args.top),
    families: sortedFamilies,
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
