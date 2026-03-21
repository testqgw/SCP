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
import { meanProjection, rowProjectionOrSummary } from "./utils/trainingRowProjectionContext";

type Side = "OVER" | "UNDER";
type Market = "PTS" | "REB" | "AST" | "THREES" | "PRA" | "PA" | "PR" | "RA";
type VariantKey =
  | "current"
  | "volume_scorer_max_0_75"
  | "volume_scorer_max_1_0"
  | "volume_scorer_max_1_25"
  | "wing_max_0_75"
  | "wing_max_1_0"
  | "wing_max_1_25";

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
  markets: Market[];
  samples: number;
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

type PlayerEvaluation = {
  overallBucket: AggregateBucket;
  marketBuckets: Map<Market, AggregateBucket>;
  effectiveArchetypeCounts: Map<string, number>;
  rowsTouched: number;
};

type VariantEvaluation = {
  qualifiesForVariant: boolean;
  evaluation: PlayerEvaluation;
};

type EvaluatedPlayer = {
  summary: PlayerSummary;
  dominantCurrentArchetype: string | null;
  currentArchetypeCounts: Array<{ archetype: string; count: number }>;
  variants: Record<VariantKey, VariantEvaluation>;
};

type VariantConfig = {
  key: VariantKey;
  forcedArchetype: Archetype | null;
  maxThrees: number | null;
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
  focusPlayer: string | null;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const LOW_THREES_MIN = 0.35;
const MAX_STARTER_RATE = 0.2;
const MIN_EXPECTED_MINUTES = 18;

const VARIANT_CONFIGS: VariantConfig[] = [
  { key: "current", forcedArchetype: null, maxThrees: null },
  { key: "volume_scorer_max_0_75", forcedArchetype: "BENCH_VOLUME_SCORER", maxThrees: 0.75 },
  { key: "volume_scorer_max_1_0", forcedArchetype: "BENCH_VOLUME_SCORER", maxThrees: 1.0 },
  { key: "volume_scorer_max_1_25", forcedArchetype: "BENCH_VOLUME_SCORER", maxThrees: 1.25 },
  { key: "wing_max_0_75", forcedArchetype: "BENCH_WING", maxThrees: 0.75 },
  { key: "wing_max_1_0", forcedArchetype: "BENCH_WING", maxThrees: 1.0 },
  { key: "wing_max_1_25", forcedArchetype: "BENCH_WING", maxThrees: 1.25 },
];

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
  let focusPlayer: string | null = null;

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
    if ((token === "--focus-player" || token === "-p") && next) {
      focusPlayer = next.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--focus-player=")) {
      focusPlayer = token.slice("--focus-player=".length).trim();
      continue;
    }
  }

  return { input, out, minActualMinutes, focusPlayer };
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

function cloneBucket(bucket: AggregateBucket): AggregateBucket {
  return { ...bucket };
}

function mergeBucket(target: AggregateBucket, source: AggregateBucket): void {
  target.samples += source.samples;
  target.rawCorrect += source.rawCorrect;
  target.baselineCorrect += source.baselineCorrect;
  target.blendedCorrect += source.blendedCorrect;
  target.qualifiedPicks += source.qualifiedPicks;
  target.qualifiedCorrect += source.qualifiedCorrect;
  target.disagreements += source.disagreements;
  target.qualifiedDisagreementWins += source.qualifiedDisagreementWins;
  target.qualifiedDisagreementLosses += source.qualifiedDisagreementLosses;
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
    pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary.ptsProjectionAvg),
    reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary.rebProjectionAvg),
    assistProjection: rowProjectionOrSummary(row, "assistProjection", summary.astProjectionAvg),
    threesProjection: rowProjectionOrSummary(row, "threesProjection", summary.threesProjectionAvg),
  };
}

function createEvaluation(): PlayerEvaluation {
  return {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
    rowsTouched: 0,
  };
}

function applyModelDecision(evaluation: PlayerEvaluation, row: TrainingRow, raw: ReturnType<typeof inspectLiveUniversalModelSide>) {
  const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
  const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
  evaluation.effectiveArchetypeCounts.set(
    raw.archetype ?? "UNKNOWN",
    (evaluation.effectiveArchetypeCounts.get(raw.archetype ?? "UNKNOWN") ?? 0) + 1,
  );
  applyDecisionToBucket(evaluation.overallBucket, row, predictedSide, qualified.qualified);
  const marketBucket = evaluation.marketBuckets.get(row.market) ?? emptyBucket();
  applyDecisionToBucket(marketBucket, row, predictedSide, qualified.qualified);
  evaluation.marketBuckets.set(row.market, marketBucket);
}

function summarizeEvaluation(variant: VariantEvaluation) {
  return {
    qualifiesForVariant: variant.qualifiesForVariant,
    rowsTouched: variant.evaluation.rowsTouched,
    effectiveArchetypeCounts: [...variant.evaluation.effectiveArchetypeCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overall: summarizeBucket(variant.evaluation.overallBucket),
    byMarket: Object.fromEntries(
      [...variant.evaluation.marketBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
  };
}

function aggregatePlayers(players: EvaluatedPlayer[], variantKey: VariantKey): PlayerEvaluation {
  const aggregate = createEvaluation();
  players.forEach((player) => {
    const evaluation = player.variants[variantKey].evaluation;
    mergeBucket(aggregate.overallBucket, cloneBucket(evaluation.overallBucket));
    evaluation.marketBuckets.forEach((bucket, market) => {
      const existing = aggregate.marketBuckets.get(market) ?? emptyBucket();
      mergeBucket(existing, cloneBucket(bucket));
      aggregate.marketBuckets.set(market, existing);
    });
    evaluation.effectiveArchetypeCounts.forEach((count, archetype) => {
      aggregate.effectiveArchetypeCounts.set(archetype, (aggregate.effectiveArchetypeCounts.get(archetype) ?? 0) + count);
    });
    aggregate.rowsTouched += evaluation.rowsTouched;
  });
  return aggregate;
}

function shouldQualifyForFallback(summary: PlayerSummary, currentDominantArchetype: string | null, maxThrees: number): boolean {
  const onlyThreesRows = summary.markets.length === 1 && summary.markets[0] === "THREES";
  if (!onlyThreesRows) return false;
  if (summary.position != null) return false;
  if (currentDominantArchetype !== "BENCH_STRETCH_BIG") return false;
  if (summary.ptsProjectionAvg != null || summary.rebProjectionAvg != null || summary.astProjectionAvg != null) return false;
  if (summary.avgExpectedMinutes == null || summary.avgExpectedMinutes < MIN_EXPECTED_MINUTES) return false;
  if (summary.avgStarterRate != null && summary.avgStarterRate > MAX_STARTER_RATE) return false;
  if (summary.threesProjectionAvg == null) return false;
  if (summary.threesProjectionAvg < LOW_THREES_MIN || summary.threesProjectionAvg > maxThrees) return false;
  return true;
}

function resolveVariantRawDecision(
  row: TrainingRow,
  currentRaw: ReturnType<typeof inspectLiveUniversalModelSide>,
  summary: PlayerSummary,
  currentDominantArchetype: string | null,
  config: VariantConfig,
): { raw: ReturnType<typeof inspectLiveUniversalModelSide>; qualifies: boolean; touched: boolean } {
  if (config.forcedArchetype == null || config.maxThrees == null) {
    return { raw: currentRaw, qualifies: false, touched: false };
  }
  const qualifies = shouldQualifyForFallback(summary, currentDominantArchetype, config.maxThrees);
  const touched = qualifies && row.market === "THREES" && currentRaw.archetype === "BENCH_STRETCH_BIG";
  if (!touched) {
    return { raw: currentRaw, qualifies, touched: false };
  }
  return { raw: inspectLiveUniversalModelSideForArchetype(buildInput(row, summary), config.forcedArchetype), qualifies, touched: true };
}

function buildPlayerSummary(rows: TrainingRow[], position: string | null): PlayerSummary {
  return {
    playerId: rows[0]!.playerId,
    playerName: rows[0]!.playerName,
    position,
    markets: [...new Set(rows.map((row) => row.market))].sort(),
    samples: rows.length,
    avgExpectedMinutes: mean(rows.map((row) => row.expectedMinutes)),
    avgStarterRate: mean(rows.map((row) => row.starterRateLast10)),
    ptsProjectionAvg: meanProjection(rows, "pointsProjection", (value) => round(value, 4)),
    rebProjectionAvg: meanProjection(rows, "reboundsProjection", (value) => round(value, 4)),
    astProjectionAvg: meanProjection(rows, "assistProjection", (value) => round(value, 4)),
    threesProjectionAvg: meanProjection(rows, "threesProjection", (value) => round(value, 4)),
  };
}

function evaluatePlayer(rows: TrainingRow[], summary: PlayerSummary): EvaluatedPlayer {
  const currentEvaluation = createEvaluation();
  const currentArchetypeCounts = new Map<string, number>();

  rows.forEach((row) => {
    const currentRaw = inspectLiveUniversalModelSide(buildInput(row, summary));
    currentArchetypeCounts.set(currentRaw.archetype ?? "UNKNOWN", (currentArchetypeCounts.get(currentRaw.archetype ?? "UNKNOWN") ?? 0) + 1);
    applyModelDecision(currentEvaluation, row, currentRaw);
  });

  const sortedCurrentArchetypes = [...currentArchetypeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([archetype, count]) => ({ archetype, count }));
  const dominantCurrentArchetype = sortedCurrentArchetypes[0]?.archetype ?? null;

  const variants = Object.fromEntries(
    VARIANT_CONFIGS.map((config) => [
      config.key,
      {
        qualifiesForVariant: false,
        evaluation: createEvaluation(),
      } satisfies VariantEvaluation,
    ]),
  ) as Record<VariantKey, VariantEvaluation>;

  variants.current = {
    qualifiesForVariant: false,
    evaluation: currentEvaluation,
  };

  rows.forEach((row) => {
    const currentRaw = inspectLiveUniversalModelSide(buildInput(row, summary));
    VARIANT_CONFIGS.forEach((config) => {
      if (config.key === "current") return;
      const variant = variants[config.key];
      const resolved = resolveVariantRawDecision(row, currentRaw, summary, dominantCurrentArchetype, config);
      if (resolved.qualifies) variant.qualifiesForVariant = true;
      if (resolved.touched) variant.evaluation.rowsTouched += 1;
      applyModelDecision(variant.evaluation, row, resolved.raw);
    });
  });

  return {
    summary,
    dominantCurrentArchetype,
    currentArchetypeCounts: sortedCurrentArchetypes,
    variants,
  };
}

async function main() {
  const args = parseArgs();
  const raw = await readFile(path.resolve(args.input), "utf8");
  const parsed = JSON.parse(raw) as BacktestRowsFile;
  const metaRaw = await readFile(DEFAULT_PLAYER_META_CACHE_PATH, "utf8");
  const playerMeta = JSON.parse(metaRaw) as PlayerMetaCacheFile;
  const positionMap = new Map(playerMeta.players.map((player) => [player.id, player.position]));

  const eligibleRows = parsed.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const rowsByPlayer = new Map<string, TrainingRow[]>();
  eligibleRows.forEach((row) => {
    const existing = rowsByPlayer.get(row.playerId);
    if (existing) existing.push(row);
    else rowsByPlayer.set(row.playerId, [row]);
  });

  const evaluatedPlayers = [...rowsByPlayer.values()]
    .map((rows) => evaluatePlayer(rows, buildPlayerSummary(rows, positionMap.get(rows[0]!.playerId) ?? null)))
    .sort((left, right) => right.summary.samples - left.summary.samples || left.summary.playerName.localeCompare(right.summary.playerName));

  const focusedPlayers = args.focusPlayer
    ? evaluatedPlayers.filter((player) => player.summary.playerName.toLowerCase() === args.focusPlayer!.toLowerCase())
    : evaluatedPlayers;
  const cohortPlayers = evaluatedPlayers.filter((player) =>
    VARIANT_CONFIGS.some(
      (config) =>
        config.key !== "current" && player.variants[config.key].qualifiesForVariant,
    ),
  );

  const overallCurrent = aggregatePlayers(evaluatedPlayers, "current");
  const overallVariants = Object.fromEntries(
    VARIANT_CONFIGS.map((config) => [config.key, aggregatePlayers(evaluatedPlayers, config.key)]),
  ) as Record<VariantKey, PlayerEvaluation>;
  const cohortVariants = Object.fromEntries(
    VARIANT_CONFIGS.map((config) => [config.key, aggregatePlayers(cohortPlayers, config.key)]),
  ) as Record<VariantKey, PlayerEvaluation>;

  const variantLeaderboard = VARIANT_CONFIGS.filter((config) => config.key !== "current")
    .map((config) => {
      const overall = summarizeBucket(overallVariants[config.key].overallBucket);
      const current = summarizeBucket(overallCurrent.overallBucket);
      const cohort = summarizeBucket(cohortVariants[config.key].overallBucket);
      const currentCohort = summarizeBucket(cohortVariants.current.overallBucket);
      const qualifyingPlayers = cohortPlayers.filter((player) => player.variants[config.key].qualifiesForVariant);
      const improvedPlayers = qualifyingPlayers.filter((player) => {
        const variantDelta = player.variants[config.key].evaluation.overallBucket.blendedCorrect - player.variants.current.evaluation.overallBucket.blendedCorrect;
        return variantDelta > 0;
      });
      const worsenedPlayers = qualifyingPlayers.filter((player) => {
        const variantDelta = player.variants[config.key].evaluation.overallBucket.blendedCorrect - player.variants.current.evaluation.overallBucket.blendedCorrect;
        return variantDelta < 0;
      });
      return {
        variant: config.key,
        forcedArchetype: config.forcedArchetype,
        maxThrees: config.maxThrees,
        qualifyingPlayers: qualifyingPlayers.length,
        rowsTouched: overallVariants[config.key].rowsTouched,
        overallDeltaVsCurrent:
          overall.blendedAccuracy != null && current.blendedAccuracy != null
            ? round(overall.blendedAccuracy - current.blendedAccuracy, 2)
            : null,
        overallQualifiedDeltaVsCurrent:
          overall.qualifiedAccuracy != null && current.qualifiedAccuracy != null
            ? round(overall.qualifiedAccuracy - current.qualifiedAccuracy, 2)
            : null,
        cohortDeltaVsCurrent:
          cohort.blendedAccuracy != null && currentCohort.blendedAccuracy != null
            ? round(cohort.blendedAccuracy - currentCohort.blendedAccuracy, 2)
            : null,
        cohortQualifiedDeltaVsCurrent:
          cohort.qualifiedAccuracy != null && currentCohort.qualifiedAccuracy != null
            ? round(cohort.qualifiedAccuracy - currentCohort.qualifiedAccuracy, 2)
            : null,
        improvedPlayers: improvedPlayers.length,
        worsenedPlayers: worsenedPlayers.length,
        qualifyingPlayerNames: qualifyingPlayers.map((player) => player.summary.playerName),
      };
    })
    .sort(
      (left, right) =>
        (right.cohortDeltaVsCurrent ?? Number.NEGATIVE_INFINITY) - (left.cohortDeltaVsCurrent ?? Number.NEGATIVE_INFINITY) ||
        (right.overallDeltaVsCurrent ?? Number.NEGATIVE_INFINITY) - (left.overallDeltaVsCurrent ?? Number.NEGATIVE_INFINITY),
    );

  const report = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: parsed.from,
      to: parsed.to,
      minActualMinutes: args.minActualMinutes,
    },
    focusPlayer: args.focusPlayer,
    ruleDefinition: {
      description:
        "Missing-position THREES-only low-three-volume players currently falling into BENCH_STRETCH_BIG because non-THREES projections are absent.",
      lowThreesMin: LOW_THREES_MIN,
      maxStarterRate: MAX_STARTER_RATE,
      minExpectedMinutes: MIN_EXPECTED_MINUTES,
      variants: VARIANT_CONFIGS,
    },
    cohortPlayers: cohortPlayers.map((player) => ({
      player: player.summary.playerName,
      playerId: player.summary.playerId,
      dominantCurrentArchetype: player.dominantCurrentArchetype,
      currentArchetypeCounts: player.currentArchetypeCounts,
      summary: player.summary,
      qualifiesFor: VARIANT_CONFIGS.filter((config) => config.key !== "current" && player.variants[config.key].qualifiesForVariant).map(
        (config) => config.key,
      ),
    })),
    overallCurrent: summarizeEvaluation({ qualifiesForVariant: false, evaluation: overallCurrent }),
    overallVariants: Object.fromEntries(
      VARIANT_CONFIGS.map((config) => [
        config.key,
        summarizeEvaluation({
          qualifiesForVariant: config.key !== "current",
          evaluation: overallVariants[config.key],
        }),
      ]),
    ) as Record<VariantKey, ReturnType<typeof summarizeEvaluation>>,
    cohortCurrent: summarizeEvaluation({ qualifiesForVariant: false, evaluation: cohortVariants.current }),
    cohortVariants: Object.fromEntries(
      VARIANT_CONFIGS.map((config) => [
        config.key,
        summarizeEvaluation({
          qualifiesForVariant: config.key !== "current",
          evaluation: cohortVariants[config.key],
        }),
      ]),
    ) as Record<VariantKey, ReturnType<typeof summarizeEvaluation>>,
    variantLeaderboard,
    focusedPlayers: focusedPlayers.map((player) => ({
      player: player.summary.playerName,
      playerId: player.summary.playerId,
      dominantCurrentArchetype: player.dominantCurrentArchetype,
      currentArchetypeCounts: player.currentArchetypeCounts,
      summary: player.summary,
      variants: Object.fromEntries(
        VARIANT_CONFIGS.map((config) => [config.key, summarizeEvaluation(player.variants[config.key])]),
      ) as Record<VariantKey, ReturnType<typeof summarizeEvaluation>>,
    })),
  };

  const output = JSON.stringify(report, null, 2);
  if (args.out) {
    const outputPath = path.resolve(args.out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${output}\n`, "utf8");
    console.log(`Wrote report to ${outputPath}`);
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
