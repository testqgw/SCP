import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  inspectLiveUniversalModelSideForArchetype,
  qualifyLiveUniversalModelDecision,
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
  | "creator_all_markets"
  | "creator_combo_markets_only"
  | "creator_combo_plus_ast"
  | "creator_all_except_pa_threes";

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
};

type EvaluatedPlayer = {
  summary: PlayerSummary;
  qualifiesForRoleFix: boolean;
  evaluations: Record<VariantKey, PlayerEvaluation>;
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const CREATOR_COMBO_MARKETS: readonly Market[] = ["PTS", "PRA", "PR"];
const CREATOR_COMBO_PLUS_AST_MARKETS: readonly Market[] = ["PTS", "AST", "PRA", "PR"];
const CREATOR_ALL_EXCEPT_PA_THREES_MARKETS: readonly Market[] = ["PTS", "REB", "AST", "PRA", "PR", "RA"];

const ROLE_FIX_RULE = {
  minMinutes: 20,
  minStarterRate: 0.25,
  minPoints: 10,
  minAssists: 1.3,
  minThrees: 2.2,
  maxRebounds: 4.5,
} as const;

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

function cloneBucket(bucket?: AggregateBucket | null): AggregateBucket {
  return {
    samples: bucket?.samples ?? 0,
    rawCorrect: bucket?.rawCorrect ?? 0,
    baselineCorrect: bucket?.baselineCorrect ?? 0,
    blendedCorrect: bucket?.blendedCorrect ?? 0,
    qualifiedPicks: bucket?.qualifiedPicks ?? 0,
    qualifiedCorrect: bucket?.qualifiedCorrect ?? 0,
    disagreements: bucket?.disagreements ?? 0,
    qualifiedDisagreementWins: bucket?.qualifiedDisagreementWins ?? 0,
    qualifiedDisagreementLosses: bucket?.qualifiedDisagreementLosses ?? 0,
  };
}

function mergeBucket(into: AggregateBucket, addition: AggregateBucket): AggregateBucket {
  into.samples += addition.samples;
  into.rawCorrect += addition.rawCorrect;
  into.baselineCorrect += addition.baselineCorrect;
  into.blendedCorrect += addition.blendedCorrect;
  into.qualifiedPicks += addition.qualifiedPicks;
  into.qualifiedCorrect += addition.qualifiedCorrect;
  into.disagreements += addition.disagreements;
  into.qualifiedDisagreementWins += addition.qualifiedDisagreementWins;
  into.qualifiedDisagreementLosses += addition.qualifiedDisagreementLosses;
  return into;
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
    currentDeltaVsBaseline: current.deltaVsBaseline,
    variantDeltaVsBaseline: variant.deltaVsBaseline,
    deltaVsBaselineChange:
      current.deltaVsBaseline != null && variant.deltaVsBaseline != null
        ? round(variant.deltaVsBaseline - current.deltaVsBaseline, 2)
        : null,
    currentCoveragePct: current.coveragePct,
    variantCoveragePct: variant.coveragePct,
    coveragePctChange:
      current.coveragePct != null && variant.coveragePct != null ? round(variant.coveragePct - current.coveragePct, 2) : null,
    currentQualifiedAccuracy: current.qualifiedAccuracy,
    variantQualifiedAccuracy: variant.qualifiedAccuracy,
    qualifiedAccuracyChange:
      current.qualifiedAccuracy != null && variant.qualifiedAccuracy != null
        ? round(variant.qualifiedAccuracy - current.qualifiedAccuracy, 2)
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
    summaries.set(playerId, {
      playerId,
      playerName: playerRows[0]!.playerName,
      position: positionById.get(playerId) ?? null,
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

function shouldApplyRoleFix(summary: PlayerSummary): boolean {
  const position = (summary.position ?? "").toUpperCase();
  if (!position || position.includes("C")) return false;

  const minutes = summary.avgExpectedMinutes ?? 0;
  const starterRate = summary.avgStarterRate ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes < ROLE_FIX_RULE.minMinutes) return false;
  if (starterRate < ROLE_FIX_RULE.minStarterRate) return false;
  if (pts < ROLE_FIX_RULE.minPoints) return false;
  if (ast < ROLE_FIX_RULE.minAssists) return false;
  if (threes < ROLE_FIX_RULE.minThrees) return false;
  if (reb > ROLE_FIX_RULE.maxRebounds) return false;
  return true;
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
  };
}

function applyModelDecision(evaluation: PlayerEvaluation, row: TrainingRow, raw: ReturnType<typeof inspectLiveUniversalModelSide>) {
  const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
  const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
  evaluation.effectiveArchetypeCounts.set(raw.archetype ?? "UNKNOWN", (evaluation.effectiveArchetypeCounts.get(raw.archetype ?? "UNKNOWN") ?? 0) + 1);
  applyDecisionToBucket(evaluation.overallBucket, row, predictedSide, qualified.qualified);
  const marketBucket = evaluation.marketBuckets.get(row.market) ?? emptyBucket();
  applyDecisionToBucket(marketBucket, row, predictedSide, qualified.qualified);
  evaluation.marketBuckets.set(row.market, marketBucket);
}

function isIncludedMarket(row: TrainingRow, markets: readonly Market[]): boolean {
  return markets.includes(row.market);
}

function evaluatePlayer(rows: TrainingRow[], summary: PlayerSummary): EvaluatedPlayer {
  const summaryQualifiesForRoleFix = shouldApplyRoleFix(summary);
  let appliesRoleFixToAtLeastOneRow = false;
  const evaluations: Record<VariantKey, PlayerEvaluation> = {
    current: createEvaluation(),
    creator_all_markets: createEvaluation(),
    creator_combo_markets_only: createEvaluation(),
    creator_combo_plus_ast: createEvaluation(),
    creator_all_except_pa_threes: createEvaluation(),
  };

  rows.forEach((row) => {
    const baseInput = buildInput(row, summary);
    const currentRaw = inspectLiveUniversalModelSide(baseInput);
    applyModelDecision(evaluations.current, row, currentRaw);

    const canForce = summaryQualifiesForRoleFix && currentRaw.archetype === "BENCH_SPACER_SCORER";
    if (canForce) appliesRoleFixToAtLeastOneRow = true;
    const forcedAllMarketsRaw = canForce ? inspectLiveUniversalModelSideForArchetype(baseInput, "BENCH_CREATOR_SCORER") : currentRaw;
    applyModelDecision(evaluations.creator_all_markets, row, forcedAllMarketsRaw);

    const forcedComboMarketsRaw =
      canForce && isIncludedMarket(row, CREATOR_COMBO_MARKETS)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "BENCH_CREATOR_SCORER")
        : currentRaw;
    applyModelDecision(evaluations.creator_combo_markets_only, row, forcedComboMarketsRaw);

    const forcedComboPlusAstRaw =
      canForce && isIncludedMarket(row, CREATOR_COMBO_PLUS_AST_MARKETS)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "BENCH_CREATOR_SCORER")
        : currentRaw;
    applyModelDecision(evaluations.creator_combo_plus_ast, row, forcedComboPlusAstRaw);

    const forcedAllExceptPaThreesRaw =
      canForce && isIncludedMarket(row, CREATOR_ALL_EXCEPT_PA_THREES_MARKETS)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "BENCH_CREATOR_SCORER")
        : currentRaw;
    applyModelDecision(evaluations.creator_all_except_pa_threes, row, forcedAllExceptPaThreesRaw);
  });

  return { summary, qualifiesForRoleFix: appliesRoleFixToAtLeastOneRow, evaluations };
}

function summarizeEvaluation(evaluation: PlayerEvaluation) {
  return {
    effectiveArchetypeCounts: [...evaluation.effectiveArchetypeCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overall: summarizeBucket(evaluation.overallBucket),
    byMarket: Object.fromEntries(
      [...evaluation.marketBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
  };
}

function aggregatePlayers(players: EvaluatedPlayer[], variant: VariantKey): PlayerEvaluation {
  const aggregate = createEvaluation();
  players.forEach((player) => {
    const evaluation = player.evaluations[variant];
    mergeBucket(aggregate.overallBucket, cloneBucket(evaluation.overallBucket));
    evaluation.marketBuckets.forEach((bucket, market) => {
      const existing = aggregate.marketBuckets.get(market) ?? emptyBucket();
      mergeBucket(existing, cloneBucket(bucket));
      aggregate.marketBuckets.set(market, existing);
    });
    evaluation.effectiveArchetypeCounts.forEach((count, archetype) => {
      aggregate.effectiveArchetypeCounts.set(archetype, (aggregate.effectiveArchetypeCounts.get(archetype) ?? 0) + count);
    });
  });
  return aggregate;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const summaries = buildPlayerSummaries(rows, positionById);
  const rowsByPlayerId = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const existing = rowsByPlayerId.get(row.playerId) ?? [];
    existing.push(row);
    rowsByPlayerId.set(row.playerId, existing);
  });

  const playersById = new Map<string, EvaluatedPlayer>();
  rowsByPlayerId.forEach((playerRows, playerId) => {
    const summary = summaries.get(playerId);
    if (!summary) return;
    playersById.set(playerId, evaluatePlayer(playerRows, summary));
  });

  const allPlayers = [...playersById.values()];
  const roleFixPlayers = allPlayers.filter((player) => player.qualifiesForRoleFix);
  const allCurrent = summarizeEvaluation(aggregatePlayers(allPlayers, "current"));
  const candidateCurrent = summarizeEvaluation(aggregatePlayers(roleFixPlayers, "current"));

  const variants: VariantKey[] = [
    "creator_all_markets",
    "creator_combo_markets_only",
    "creator_combo_plus_ast",
    "creator_all_except_pa_threes",
  ];

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      minActualMinutes: args.minActualMinutes,
    },
    roleFixRule: ROLE_FIX_RULE,
    marketSets: {
      creator_combo_markets_only: CREATOR_COMBO_MARKETS,
      creator_combo_plus_ast: CREATOR_COMBO_PLUS_AST_MARKETS,
      creator_all_except_pa_threes: CREATOR_ALL_EXCEPT_PA_THREES_MARKETS,
    },
    roleFixCandidates: {
      playerCount: roleFixPlayers.length,
      players: roleFixPlayers.map((player) => ({
        playerId: player.summary.playerId,
        playerName: player.summary.playerName,
        position: player.summary.position,
        summary: player.summary,
      })),
    },
    overall: {
      current: allCurrent,
      variants: Object.fromEntries(
        variants.map((variant) => {
          const summary = summarizeEvaluation(aggregatePlayers(allPlayers, variant));
          return [variant, { summary, vsCurrent: compareSummaries(allCurrent.overall, summary.overall) }];
        }),
      ),
    },
    candidateOnly: {
      current: candidateCurrent,
      variants: Object.fromEntries(
        variants.map((variant) => {
          const summary = summarizeEvaluation(aggregatePlayers(roleFixPlayers, variant));
          return [variant, { summary, vsCurrent: compareSummaries(candidateCurrent.overall, summary.overall) }];
        }),
      ),
    },
    playerImpact: roleFixPlayers.map((player) => {
      const current = summarizeEvaluation(player.evaluations.current);
      return {
        playerId: player.summary.playerId,
        playerName: player.summary.playerName,
        position: player.summary.position,
        current,
        variants: Object.fromEntries(
          variants.map((variant) => {
            const summary = summarizeEvaluation(player.evaluations[variant]);
            return [variant, { summary, vsCurrent: compareSummaries(current.overall, summary.overall) }];
          }),
        ),
      };
    }),
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
