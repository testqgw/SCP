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
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  ptsProjectionAvg: number | null;
  rebProjectionAvg: number | null;
  astProjectionAvg: number | null;
  threesProjectionAvg: number | null;
};

type CohortPlayer = {
  playerId: string;
  playerName: string;
  position: string | null;
  dominantArchetype: string;
  rank: number;
  summary: PlayerSummary;
};

type CohortStudyFile = {
  generatedAt: string;
  input: string;
  targetPlayer: {
    player: string;
    playerId: string;
    dominantArchetype: string;
    summary: PlayerSummary;
    targetWeakMarkets: Market[];
  };
  sameArchetypeNearestPlayers: CohortPlayer[];
  crossArchetypeNearestPlayers: CohortPlayer[];
};

type Args = {
  input: string;
  cohort: string;
  out: string | null;
  minActualMinutes: number;
  sameTop: number;
  crossTop: number;
  archetypes: Archetype[];
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

type VariantEvaluation = {
  effectiveArchetypeCounts: Array<{ archetype: string; count: number }>;
  overallBucket: AggregateBucket;
  marketBuckets: Map<Market, AggregateBucket>;
};

type VariantSummary = {
  effectiveArchetypeCounts: Array<{ archetype: string; count: number }>;
  overall: BucketSummary;
  byMarket: Partial<Record<Market, BucketSummary>>;
};

type GroupMember = {
  playerId: string;
  playerName: string;
  dominantArchetype: string;
  position: string | null;
  source: "target" | "same_archetype" | "cross_archetype";
  rank: number;
  samples: number;
};

type GroupDefinition = {
  key: string;
  label: string;
  players: GroupMember[];
};

type BucketDeltaSummary = {
  currentBlendedAccuracy: number | null;
  variantBlendedAccuracy: number | null;
  blendedAccuracyChange: number | null;
  currentDeltaVsBaseline: number | null;
  variantDeltaVsBaseline: number | null;
  deltaVsBaselineChange: number | null;
  currentCoveragePct: number | null;
  variantCoveragePct: number | null;
  coveragePctChange: number | null;
  currentQualifiedAccuracy: number | null;
  variantQualifiedAccuracy: number | null;
  qualifiedAccuracyChange: number | null;
};

type PlayerOutcome = {
  playerId: string;
  playerName: string;
  dominantArchetype: string;
  source: GroupMember["source"];
  rank: number;
  overallBlendedAccuracyChange: number | null;
  overallDeltaVsBaselineChange: number | null;
  overallCoveragePctChange: number | null;
  targetWeakMarketAverageBlendedAccuracyChange: number | null;
  improvedWeakMarkets: Market[];
  worsenedWeakMarkets: Market[];
};

type VariantImpactSummary = {
  improvedPlayers: number;
  worsenedPlayers: number;
  unchangedPlayers: number;
  averageOverallBlendedAccuracyChange: number | null;
  medianOverallBlendedAccuracyChange: number | null;
  averageTargetWeakMarketBlendedAccuracyChange: number | null;
  topImprovers: PlayerOutcome[];
  topDecliners: PlayerOutcome[];
};

type GroupVariantComparison = {
  summary: VariantSummary;
  vsCurrentOverall: BucketDeltaSummary;
  vsCurrentTargetWeakMarkets: Partial<Record<Market, BucketDeltaSummary | null>>;
  playerImpact: VariantImpactSummary;
};

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let cohort = "";
  let out: string | null = null;
  let minActualMinutes = 15;
  let sameTop = 3;
  let crossTop = 10;
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
    if ((token === "--cohort" || token === "-c") && next) {
      cohort = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--cohort=")) {
      cohort = token.slice("--cohort=".length);
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
    if ((token === "--same-top" || token === "-s") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) sameTop = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--same-top=")) {
      const parsed = Number(token.slice("--same-top=".length));
      if (Number.isFinite(parsed) && parsed > 0) sameTop = Math.floor(parsed);
      continue;
    }
    if ((token === "--cross-top" || token === "-x") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) crossTop = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--cross-top=")) {
      const parsed = Number(token.slice("--cross-top=".length));
      if (Number.isFinite(parsed) && parsed > 0) crossTop = Math.floor(parsed);
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
    }
  }

  if (!cohort) {
    throw new Error("Missing required --cohort argument.");
  }

  return {
    input,
    cohort,
    out,
    minActualMinutes,
    sameTop,
    crossTop,
    archetypes,
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

function mergeBuckets(into: AggregateBucket, addition: AggregateBucket): AggregateBucket {
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

function incrementMapCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
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
): VariantEvaluation {
  const overallBucket = emptyBucket();
  const marketBuckets = new Map<Market, AggregateBucket>();
  const effectiveArchetypes = new Map<string, number>();

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
      pointsProjection: summary.ptsProjectionAvg,
      reboundsProjection: summary.rebProjectionAvg,
      assistProjection: summary.astProjectionAvg,
      threesProjection: summary.threesProjectionAvg,
    };
    const raw = forcedArchetype
      ? inspectLiveUniversalModelSideForArchetype(input, forcedArchetype)
      : inspectLiveUniversalModelSide(input);
    const qualified = qualifyLiveUniversalModelDecision(raw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const predictedSide = raw.rawSide === "NEUTRAL" ? row.finalSide : raw.rawSide;
    incrementMapCounter(effectiveArchetypes, raw.archetype ?? "UNKNOWN");

    applyDecisionToBucket(overallBucket, row, predictedSide, qualified.qualified);
    const marketBucket = marketBuckets.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(marketBucket, row, predictedSide, qualified.qualified);
    marketBuckets.set(row.market, marketBucket);
  });

  return {
    effectiveArchetypeCounts: [...effectiveArchetypes.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overallBucket,
    marketBuckets,
  };
}

function summarizeVariant(variant: VariantEvaluation): VariantSummary {
  return {
    effectiveArchetypeCounts: variant.effectiveArchetypeCounts,
    overall: summarizeBucket(variant.overallBucket),
    byMarket: Object.fromEntries(
      [...variant.marketBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([market, bucket]) => [market, summarizeBucket(bucket)]),
    ) as Partial<Record<Market, BucketSummary>>,
  };
}

function compareBucketSummaries(current: BucketSummary | null | undefined, variant: BucketSummary | null | undefined) {
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
  } satisfies BucketDeltaSummary;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 2);
}

function median(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return round(valid[middle]!, 2);
  return round((valid[middle - 1]! + valid[middle]!) / 2, 2);
}

function takeTop<T>(items: T[], count: number): T[] {
  return items.slice(0, Math.min(count, items.length));
}

function dedupePlayers(players: GroupMember[]): GroupMember[] {
  const seen = new Set<string>();
  const deduped: GroupMember[] = [];
  for (const player of players) {
    if (seen.has(player.playerId)) continue;
    seen.add(player.playerId);
    deduped.push(player);
  }
  return deduped;
}

function buildGroups(cohort: CohortStudyFile, args: Args): GroupDefinition[] {
  const target: GroupMember = {
    playerId: cohort.targetPlayer.playerId,
    playerName: cohort.targetPlayer.player,
    dominantArchetype: cohort.targetPlayer.dominantArchetype,
    position: cohort.targetPlayer.summary.position,
    source: "target",
    rank: 0,
    samples: 0,
  };

  const samePlayers = takeTop(cohort.sameArchetypeNearestPlayers, args.sameTop).map((player) => ({
    playerId: player.playerId,
    playerName: player.playerName,
    dominantArchetype: player.dominantArchetype,
    position: player.position,
    source: "same_archetype" as const,
    rank: player.rank,
    samples: 0,
  }));

  const crossPlayers = takeTop(cohort.crossArchetypeNearestPlayers, args.crossTop).map((player) => ({
    playerId: player.playerId,
    playerName: player.playerName,
    dominantArchetype: player.dominantArchetype,
    position: player.position,
    source: "cross_archetype" as const,
    rank: player.rank,
    samples: 0,
  }));

  return [
    {
      key: "target_only",
      label: "Target only",
      players: [target],
    },
    {
      key: `same_archetype_top_${args.sameTop}`,
      label: `Same-archetype top ${args.sameTop}`,
      players: samePlayers,
    },
    {
      key: `cross_archetype_top_${args.crossTop}`,
      label: `Cross-archetype top ${args.crossTop}`,
      players: crossPlayers,
    },
    {
      key: `target_plus_same_top_${args.sameTop}`,
      label: `Target + same-archetype top ${args.sameTop}`,
      players: dedupePlayers([target, ...samePlayers]),
    },
    {
      key: `target_plus_cross_top_${args.crossTop}`,
      label: `Target + cross-archetype top ${args.crossTop}`,
      players: dedupePlayers([target, ...crossPlayers]),
    },
    {
      key: `target_plus_all_top_${args.sameTop}_${args.crossTop}`,
      label: `Target + all top peers (${args.sameTop} same, ${args.crossTop} cross)`,
      players: dedupePlayers([target, ...samePlayers, ...crossPlayers]),
    },
  ];
}

function aggregateVariant(
  members: GroupMember[],
  playerEvaluations: Map<string, Record<string, VariantEvaluation>>,
  variantKey: string,
): VariantEvaluation {
  const overallBucket = emptyBucket();
  const marketBuckets = new Map<Market, AggregateBucket>();
  const effectiveArchetypes = new Map<string, number>();

  members.forEach((member) => {
    const evaluation = playerEvaluations.get(member.playerId)?.[variantKey];
    if (!evaluation) return;
    mergeBuckets(overallBucket, cloneBucket(evaluation.overallBucket));
    evaluation.effectiveArchetypeCounts.forEach(({ archetype, count }) => {
      effectiveArchetypes.set(archetype, (effectiveArchetypes.get(archetype) ?? 0) + count);
    });
    evaluation.marketBuckets.forEach((bucket, market) => {
      const current = marketBuckets.get(market) ?? emptyBucket();
      mergeBuckets(current, cloneBucket(bucket));
      marketBuckets.set(market, current);
    });
  });

  return {
    effectiveArchetypeCounts: [...effectiveArchetypes.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([archetype, count]) => ({ archetype, count })),
    overallBucket,
    marketBuckets,
  };
}

function buildPlayerOutcome(
  member: GroupMember,
  playerEvaluations: Map<string, Record<string, VariantEvaluation>>,
  variantKey: string,
  targetWeakMarkets: Market[],
): PlayerOutcome | null {
  const evaluations = playerEvaluations.get(member.playerId);
  const current = evaluations?.current;
  const variant = evaluations?.[variantKey];
  if (!current || !variant) return null;

  const currentOverall = summarizeBucket(current.overallBucket);
  const variantOverall = summarizeBucket(variant.overallBucket);
  const overallBlendedAccuracyChange =
    currentOverall.blendedAccuracy != null && variantOverall.blendedAccuracy != null
      ? round(variantOverall.blendedAccuracy - currentOverall.blendedAccuracy, 2)
      : null;
  const overallDeltaVsBaselineChange =
    currentOverall.deltaVsBaseline != null && variantOverall.deltaVsBaseline != null
      ? round(variantOverall.deltaVsBaseline - currentOverall.deltaVsBaseline, 2)
      : null;
  const overallCoveragePctChange =
    currentOverall.coveragePct != null && variantOverall.coveragePct != null
      ? round(variantOverall.coveragePct - currentOverall.coveragePct, 2)
      : null;

  const improvedWeakMarkets: Market[] = [];
  const worsenedWeakMarkets: Market[] = [];
  const weakMarketChanges = targetWeakMarkets
    .map((market) => {
      const currentBucket = current.marketBuckets.get(market);
      const variantBucket = variant.marketBuckets.get(market);
      if (!currentBucket || !variantBucket) return null;
      const currentSummary = summarizeBucket(currentBucket);
      const variantSummary = summarizeBucket(variantBucket);
      if (currentSummary.blendedAccuracy == null || variantSummary.blendedAccuracy == null) return null;
      const change = round(variantSummary.blendedAccuracy - currentSummary.blendedAccuracy, 2);
      if (change > 0) improvedWeakMarkets.push(market);
      if (change < 0) worsenedWeakMarkets.push(market);
      return change;
    })
    .filter((value): value is number => value != null);

  return {
    playerId: member.playerId,
    playerName: member.playerName,
    dominantArchetype: member.dominantArchetype,
    source: member.source,
    rank: member.rank,
    overallBlendedAccuracyChange,
    overallDeltaVsBaselineChange,
    overallCoveragePctChange,
    targetWeakMarketAverageBlendedAccuracyChange: average(weakMarketChanges),
    improvedWeakMarkets,
    worsenedWeakMarkets,
  };
}

function buildPlayerImpactSummary(playerOutcomes: PlayerOutcome[]): VariantImpactSummary {
  const improvedPlayers = playerOutcomes.filter((player) => (player.overallBlendedAccuracyChange ?? 0) > 0);
  const worsenedPlayers = playerOutcomes.filter((player) => (player.overallBlendedAccuracyChange ?? 0) < 0);
  const unchangedPlayers = playerOutcomes.filter((player) => player.overallBlendedAccuracyChange === 0);
  const sorted = [...playerOutcomes].sort(
    (left, right) =>
      (right.overallBlendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
        (left.overallBlendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
      left.playerName.localeCompare(right.playerName),
  );
  return {
    improvedPlayers: improvedPlayers.length,
    worsenedPlayers: worsenedPlayers.length,
    unchangedPlayers: unchangedPlayers.length,
    averageOverallBlendedAccuracyChange: average(playerOutcomes.map((player) => player.overallBlendedAccuracyChange)),
    medianOverallBlendedAccuracyChange: median(playerOutcomes.map((player) => player.overallBlendedAccuracyChange)),
    averageTargetWeakMarketBlendedAccuracyChange: average(
      playerOutcomes.map((player) => player.targetWeakMarketAverageBlendedAccuracyChange),
    ),
    topImprovers: sorted.filter((player) => (player.overallBlendedAccuracyChange ?? 0) > 0).slice(0, 5),
    topDecliners: [...sorted]
      .reverse()
      .filter((player) => (player.overallBlendedAccuracyChange ?? 0) < 0)
      .slice(0, 5),
  };
}

function buildGroupVariantComparison(
  group: GroupDefinition,
  playerEvaluations: Map<string, Record<string, VariantEvaluation>>,
  variantKey: string,
  targetWeakMarkets: Market[],
): GroupVariantComparison {
  const currentSummary = summarizeVariant(aggregateVariant(group.players, playerEvaluations, "current"));
  const variantSummary = summarizeVariant(aggregateVariant(group.players, playerEvaluations, variantKey));
  const playerOutcomes = group.players
    .map((member) => buildPlayerOutcome(member, playerEvaluations, variantKey, targetWeakMarkets))
    .filter((value): value is PlayerOutcome => value != null);

  return {
    summary: variantSummary,
    vsCurrentOverall: compareBucketSummaries(currentSummary.overall, variantSummary.overall)!,
    vsCurrentTargetWeakMarkets: Object.fromEntries(
      targetWeakMarkets.map((market) => [
        market,
        compareBucketSummaries(currentSummary.byMarket[market], variantSummary.byMarket[market]),
      ]),
    ) as Partial<Record<Market, BucketDeltaSummary | null>>,
    playerImpact: buildPlayerImpactSummary(playerOutcomes),
  };
}

function countSamples(rows: TrainingRow[]): number {
  return rows.length;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rowsPayload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const cohort = JSON.parse(await readFile(path.resolve(args.cohort), "utf8")) as CohortStudyFile;
  const targetWeakMarkets = cohort.targetPlayer.targetWeakMarkets ?? [];
  const groups = buildGroups(cohort, args);

  const rowsByPlayer = new Map<string, TrainingRow[]>();
  rowsPayload.playerMarketRows
    .filter((row) => row.actualMinutes >= args.minActualMinutes)
    .forEach((row) => {
      const existing = rowsByPlayer.get(row.playerId) ?? [];
      existing.push(row);
      rowsByPlayer.set(row.playerId, existing);
    });

  const summaryByPlayer = new Map<string, PlayerSummary>();
  summaryByPlayer.set(cohort.targetPlayer.playerId, cohort.targetPlayer.summary);
  cohort.sameArchetypeNearestPlayers.forEach((player) => summaryByPlayer.set(player.playerId, player.summary));
  cohort.crossArchetypeNearestPlayers.forEach((player) => summaryByPlayer.set(player.playerId, player.summary));

  const uniquePlayers = dedupePlayers(groups.flatMap((group) => group.players));
  const playerEvaluations = new Map<string, Record<string, VariantEvaluation>>();
  const missingPlayers: GroupMember[] = [];

  uniquePlayers.forEach((member) => {
    const rows = rowsByPlayer.get(member.playerId) ?? [];
    const summary = summaryByPlayer.get(member.playerId);
    if (!rows.length || !summary) {
      missingPlayers.push(member);
      return;
    }
    member.samples = countSamples(rows);
    const evaluations: Record<string, VariantEvaluation> = {
      current: evaluateVariant(rows, summary, null),
    };
    args.archetypes.forEach((archetype) => {
      evaluations[archetype] = evaluateVariant(rows, summary, archetype);
    });
    playerEvaluations.set(member.playerId, evaluations);
  });

  const hydratedGroups = groups.map((group) => ({
    ...group,
    players: group.players
      .map((member) => {
        const rows = rowsByPlayer.get(member.playerId) ?? [];
        return { ...member, samples: countSamples(rows) };
      })
      .filter((member) => member.samples > 0),
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    cohort: path.resolve(args.cohort),
    targetPlayer: {
      player: cohort.targetPlayer.player,
      playerId: cohort.targetPlayer.playerId,
      dominantArchetype: cohort.targetPlayer.dominantArchetype,
    },
    config: {
      minActualMinutes: args.minActualMinutes,
      sameTop: args.sameTop,
      crossTop: args.crossTop,
      archetypes: args.archetypes,
      targetWeakMarkets,
    },
    missingPlayers,
    groups: Object.fromEntries(
      hydratedGroups.map((group) => {
        const currentSummary = summarizeVariant(aggregateVariant(group.players, playerEvaluations, "current"));
        const variantComparisons = Object.fromEntries(
          args.archetypes.map((archetype) => [
            archetype,
            buildGroupVariantComparison(group, playerEvaluations, archetype, targetWeakMarkets),
          ]),
        );
        return [
          group.key,
          {
            label: group.label,
            members: group.players,
            current: currentSummary,
            variants: variantComparisons,
          },
        ];
      }),
    ),
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
