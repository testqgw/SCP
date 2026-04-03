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
type VariantKey =
  | "current"
  | "jumbo_weak_markets"
  | "score_first_weak_markets"
  | "table_setting_weak_markets"
  | "point_forward_weak_markets"
  | "jumbo_all_markets"
  | "score_first_all_markets"
  | "table_setting_all_markets"
  | "point_forward_all_markets";

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
};

type PortfolioEvaluation = {
  overallBucket: AggregateBucket;
  heliocentricBucket: AggregateBucket;
  marketBuckets: Map<Market, AggregateBucket>;
  heliocentricMarketBuckets: Map<Market, AggregateBucket>;
  effectiveArchetypeCounts: Map<string, number>;
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const HELIOCENTRIC_WEAK_MARKETS: readonly Market[] = ["PTS", "PRA", "PR", "PA", "RA"];
const TARGET_ARCHETYPES: readonly Archetype[] = [
  "JUMBO_CREATOR_GUARD",
  "SCORE_FIRST_LEAD_GUARD",
  "TABLE_SETTING_LEAD_GUARD",
  "POINT_FORWARD",
];

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out: string | null = path.join("exports", "player-studies", "heliocentric-split-audit-2026-03-20.json");
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

  return { input, out, minActualMinutes };
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

function compareSummaries(current: BucketSummary | null | undefined, variant: BucketSummary | null | undefined) {
  if (!current || !variant) return null;
  return {
    currentBlendedAccuracy: current.blendedAccuracy,
    variantBlendedAccuracy: variant.blendedAccuracy,
    blendedAccuracyChange:
      current.blendedAccuracy != null && variant.blendedAccuracy != null
        ? round(variant.blendedAccuracy - current.blendedAccuracy, 2)
        : null,
    currentQualifiedAccuracy: current.qualifiedAccuracy,
    variantQualifiedAccuracy: variant.qualifiedAccuracy,
    qualifiedAccuracyChange:
      current.qualifiedAccuracy != null && variant.qualifiedAccuracy != null
        ? round(variant.qualifiedAccuracy - current.qualifiedAccuracy, 2)
        : null,
    currentCoveragePct: current.coveragePct,
    variantCoveragePct: variant.coveragePct,
    coveragePctChange:
      current.coveragePct != null && variant.coveragePct != null ? round(variant.coveragePct - current.coveragePct, 2) : null,
    currentDeltaVsBaseline: current.deltaVsBaseline,
    variantDeltaVsBaseline: variant.deltaVsBaseline,
    deltaVsBaselineChange:
      current.deltaVsBaseline != null && variant.deltaVsBaseline != null
        ? round(variant.deltaVsBaseline - current.deltaVsBaseline, 2)
        : null,
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

function createEvaluation(): PortfolioEvaluation {
  return {
    overallBucket: emptyBucket(),
    heliocentricBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    heliocentricMarketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };
}

function applyModelDecision(
  evaluation: PortfolioEvaluation,
  row: TrainingRow,
  raw: ReturnType<typeof inspectLiveUniversalModelSide>,
  heliocentricRow: boolean,
) {
  const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
  const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
  evaluation.effectiveArchetypeCounts.set(raw.archetype ?? "UNKNOWN", (evaluation.effectiveArchetypeCounts.get(raw.archetype ?? "UNKNOWN") ?? 0) + 1);

  applyDecisionToBucket(evaluation.overallBucket, row, predictedSide, qualified.qualified);
  const overallMarketBucket = evaluation.marketBuckets.get(row.market) ?? emptyBucket();
  applyDecisionToBucket(overallMarketBucket, row, predictedSide, qualified.qualified);
  evaluation.marketBuckets.set(row.market, overallMarketBucket);

  if (!heliocentricRow) return;
  applyDecisionToBucket(evaluation.heliocentricBucket, row, predictedSide, qualified.qualified);
  const helioMarketBucket = evaluation.heliocentricMarketBuckets.get(row.market) ?? emptyBucket();
  applyDecisionToBucket(helioMarketBucket, row, predictedSide, qualified.qualified);
  evaluation.heliocentricMarketBuckets.set(row.market, helioMarketBucket);
}

function summarizeEvaluation(evaluation: PortfolioEvaluation) {
  return {
    effectiveArchetypeCounts: [...evaluation.effectiveArchetypeCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overall: summarizeBucket(evaluation.overallBucket),
    heliocentricOnly: summarizeBucket(evaluation.heliocentricBucket),
    byMarket: Object.fromEntries(
      [...evaluation.marketBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
    heliocentricByMarket: Object.fromEntries(
      [...evaluation.heliocentricMarketBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
  };
}

function variantArchetype(key: VariantKey): Archetype | null {
  switch (key) {
    case "jumbo_weak_markets":
    case "jumbo_all_markets":
      return "JUMBO_CREATOR_GUARD";
    case "score_first_weak_markets":
    case "score_first_all_markets":
      return "SCORE_FIRST_LEAD_GUARD";
    case "table_setting_weak_markets":
    case "table_setting_all_markets":
      return "TABLE_SETTING_LEAD_GUARD";
    case "point_forward_weak_markets":
    case "point_forward_all_markets":
      return "POINT_FORWARD";
    default:
      return null;
  }
}

function shouldForceWeakMarkets(variant: VariantKey): boolean {
  return variant.endsWith("weak_markets");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const summaries = buildPlayerSummaries(rows, positionById);

  const variants: VariantKey[] = [
    "current",
    "jumbo_weak_markets",
    "score_first_weak_markets",
    "table_setting_weak_markets",
    "point_forward_weak_markets",
    "jumbo_all_markets",
    "score_first_all_markets",
    "table_setting_all_markets",
    "point_forward_all_markets",
  ];

  const evaluations = Object.fromEntries(variants.map((variant) => [variant, createEvaluation()])) as Record<
    VariantKey,
    PortfolioEvaluation
  >;

  let heliocentricRows = 0;
  const heliocentricPlayers = new Set<string>();

  rows.forEach((row) => {
    const summary = summaries.get(row.playerId);
    if (!summary) return;
    const input = buildInput(row, summary);
    const currentRaw = inspectLiveUniversalModelSide(input);
    const heliocentricRow = currentRaw.archetype === "HELIOCENTRIC_GUARD";
    if (heliocentricRow) {
      heliocentricRows += 1;
      heliocentricPlayers.add(row.playerId);
    }
    applyModelDecision(evaluations.current, row, currentRaw, heliocentricRow);

    variants.slice(1).forEach((variant) => {
      const forcedArchetype = variantArchetype(variant);
      if (!forcedArchetype) return;
      const shouldForce =
        heliocentricRow &&
        (shouldForceWeakMarkets(variant) ? HELIOCENTRIC_WEAK_MARKETS.includes(row.market) : true);
      const raw = shouldForce ? inspectLiveUniversalModelSideForArchetype(input, forcedArchetype) : currentRaw;
      applyModelDecision(evaluations[variant], row, raw, heliocentricRow);
    });
  });

  const summarized = Object.fromEntries(
    variants.map((variant) => [variant, summarizeEvaluation(evaluations[variant])]),
  ) as Record<VariantKey, ReturnType<typeof summarizeEvaluation>>;

  const comparisons = Object.fromEntries(
    variants
      .filter((variant) => variant !== "current")
      .map((variant) => [
        variant,
        {
          overall: compareSummaries(summarized.current.overall, summarized[variant].overall),
          heliocentricOnly: compareSummaries(summarized.current.heliocentricOnly, summarized[variant].heliocentricOnly),
          byMarket: Object.fromEntries(
            HELIOCENTRIC_WEAK_MARKETS.map((market) => [
              market,
              compareSummaries(
                summarized.current.heliocentricByMarket[market],
                summarized[variant].heliocentricByMarket[market],
              ),
            ]),
          ),
        },
      ]),
  );

  const summary = {
    input: path.resolve(args.input),
    minActualMinutes: args.minActualMinutes,
    heliocentricRowCount: heliocentricRows,
    heliocentricPlayerCount: heliocentricPlayers.size,
    targetArchetypes: TARGET_ARCHETYPES,
    weakMarkets: HELIOCENTRIC_WEAK_MARKETS,
    evaluations: summarized,
    comparisons,
  };

  const output = args.out ? path.resolve(args.out) : null;
  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(summary, null, 2), "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
