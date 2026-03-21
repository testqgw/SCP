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

type CohortStudyFile = {
  targetPlayer: {
    player: string;
    playerId: string;
    dominantArchetype: string;
    targetWeakMarkets: Market[];
  };
  sameArchetypeNearestPlayers: Array<{
    playerId: string;
    playerName: string;
    dominantArchetype: string;
    position: string | null;
    rank: number;
  }>;
  crossArchetypeNearestPlayers: Array<{
    playerId: string;
    playerName: string;
    dominantArchetype: string;
    position: string | null;
    rank: number;
  }>;
};

type Args = {
  input: string;
  out: string | null;
  cohort: string | null;
  minActualMinutes: number;
  sameTop: number;
  crossTop: number;
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
  qualifiesForCrossover: boolean;
  current: PlayerEvaluation;
  crossover: PlayerEvaluation;
};

type GroupMember = {
  playerId: string;
  playerName: string;
  dominantArchetype: string;
  position: string | null;
  source: "target" | "same_archetype" | "cross_archetype";
  rank: number;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");

const POINT_FORWARD_GUARD_CROSSOVER_RULE = {
  minMinutes: 31,
  minPoints: 22,
  minRebounds: 6.5,
  minAssists: 5,
  maxAssistsExclusive: 6.4,
  maxThrees: 2.25,
  requireReboundsAtLeastAssists: true,
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
  let cohort: string | null = null;
  let minActualMinutes = 15;
  let sameTop = 3;
  let crossTop = 10;

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
    if ((token === "--cohort" || token === "-c") && next) {
      cohort = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--cohort=")) {
      cohort = token.slice("--cohort=".length);
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
  }

  return { input, out, cohort, minActualMinutes, sameTop, crossTop };
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

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
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

function shouldApplyPointForwardGuardCrossover(summary: PlayerSummary): boolean {
  const position = (summary.position ?? "").toUpperCase();
  const isGuard = position.includes("PG") || position.includes("SG") || position === "G";
  if (!isGuard || position.includes("C")) return false;

  const minutes = summary.avgExpectedMinutes ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes < POINT_FORWARD_GUARD_CROSSOVER_RULE.minMinutes) return false;
  if (pts < POINT_FORWARD_GUARD_CROSSOVER_RULE.minPoints) return false;
  if (reb < POINT_FORWARD_GUARD_CROSSOVER_RULE.minRebounds) return false;
  if (ast < POINT_FORWARD_GUARD_CROSSOVER_RULE.minAssists) return false;
  if (ast >= POINT_FORWARD_GUARD_CROSSOVER_RULE.maxAssistsExclusive) return false;
  if (threes > POINT_FORWARD_GUARD_CROSSOVER_RULE.maxThrees) return false;
  if (POINT_FORWARD_GUARD_CROSSOVER_RULE.requireReboundsAtLeastAssists && reb < ast) return false;
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

function evaluatePlayer(rows: TrainingRow[], summary: PlayerSummary): EvaluatedPlayer {
  const qualifiesForCrossover = shouldApplyPointForwardGuardCrossover(summary);
  const current: PlayerEvaluation = {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };
  const crossover: PlayerEvaluation = {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };

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

    const currentRaw = inspectLiveUniversalModelSide(input);
    const currentQualified = qualifyLiveUniversalModelDecision(currentRaw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const currentPredictedSide = currentRaw.rawSide === "NEUTRAL" ? row.finalSide : currentRaw.rawSide;

    current.effectiveArchetypeCounts.set(
      currentRaw.archetype ?? "UNKNOWN",
      (current.effectiveArchetypeCounts.get(currentRaw.archetype ?? "UNKNOWN") ?? 0) + 1,
    );
    applyDecisionToBucket(current.overallBucket, row, currentPredictedSide, currentQualified.qualified);
    const currentMarketBucket = current.marketBuckets.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(currentMarketBucket, row, currentPredictedSide, currentQualified.qualified);
    current.marketBuckets.set(row.market, currentMarketBucket);

    const crossoverRaw =
      qualifiesForCrossover && currentRaw.archetype === "SCORING_GUARD_CREATOR"
        ? inspectLiveUniversalModelSideForArchetype(input, "POINT_FORWARD")
        : currentRaw;
    const crossoverQualified = qualifyLiveUniversalModelDecision(
      crossoverRaw,
      DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
    );
    const crossoverPredictedSide = crossoverRaw.rawSide === "NEUTRAL" ? row.finalSide : crossoverRaw.rawSide;

    crossover.effectiveArchetypeCounts.set(
      crossoverRaw.archetype ?? "UNKNOWN",
      (crossover.effectiveArchetypeCounts.get(crossoverRaw.archetype ?? "UNKNOWN") ?? 0) + 1,
    );
    applyDecisionToBucket(crossover.overallBucket, row, crossoverPredictedSide, crossoverQualified.qualified);
    const crossoverMarketBucket = crossover.marketBuckets.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(crossoverMarketBucket, row, crossoverPredictedSide, crossoverQualified.qualified);
    crossover.marketBuckets.set(row.market, crossoverMarketBucket);
  });

  return { summary, qualifiesForCrossover, current, crossover };
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

function aggregatePlayers(evaluatedPlayers: EvaluatedPlayer[], variant: "current" | "crossover"): PlayerEvaluation {
  const aggregate: PlayerEvaluation = {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };

  evaluatedPlayers.forEach((player) => {
    const evaluation = player[variant];
    mergeBucket(aggregate.overallBucket, evaluation.overallBucket);
    evaluation.marketBuckets.forEach((bucket, market) => {
      const existing = aggregate.marketBuckets.get(market) ?? emptyBucket();
      mergeBucket(existing, bucket);
      aggregate.marketBuckets.set(market, existing);
    });
    evaluation.effectiveArchetypeCounts.forEach((count, archetype) => {
      aggregate.effectiveArchetypeCounts.set(archetype, (aggregate.effectiveArchetypeCounts.get(archetype) ?? 0) + count);
    });
  });

  return aggregate;
}

function dedupeMembers(members: GroupMember[]): GroupMember[] {
  const seen = new Set<string>();
  const deduped: GroupMember[] = [];
  members.forEach((member) => {
    if (seen.has(member.playerId)) return;
    seen.add(member.playerId);
    deduped.push(member);
  });
  return deduped;
}

function buildGroups(cohort: CohortStudyFile, sameTop: number, crossTop: number) {
  const target: GroupMember = {
    playerId: cohort.targetPlayer.playerId,
    playerName: cohort.targetPlayer.player,
    dominantArchetype: cohort.targetPlayer.dominantArchetype,
    position: null,
    source: "target",
    rank: 0,
  };
  const same = cohort.sameArchetypeNearestPlayers.slice(0, sameTop).map((player) => ({
    playerId: player.playerId,
    playerName: player.playerName,
    dominantArchetype: player.dominantArchetype,
    position: player.position,
    source: "same_archetype" as const,
    rank: player.rank,
  }));
  const cross = cohort.crossArchetypeNearestPlayers.slice(0, crossTop).map((player) => ({
    playerId: player.playerId,
    playerName: player.playerName,
    dominantArchetype: player.dominantArchetype,
    position: player.position,
    source: "cross_archetype" as const,
    rank: player.rank,
  }));

  return [
    { key: "target_only", label: "Target only", members: [target] },
    { key: `same_top_${sameTop}`, label: `Same-archetype top ${sameTop}`, members: same },
    { key: `cross_top_${crossTop}`, label: `Cross-archetype top ${crossTop}`, members: cross },
    { key: `target_plus_all_${sameTop}_${crossTop}`, label: `Target + all peers`, members: dedupeMembers([target, ...same, ...cross]) },
  ];
}

function summarizeGroup(
  evaluatedByPlayerId: Map<string, EvaluatedPlayer>,
  members: GroupMember[],
  targetWeakMarkets: Market[],
) {
  const evaluatedPlayers = members
    .map((member) => evaluatedByPlayerId.get(member.playerId))
    .filter((value): value is EvaluatedPlayer => value != null);

  const current = summarizeEvaluation(aggregatePlayers(evaluatedPlayers, "current"));
  const crossover = summarizeEvaluation(aggregatePlayers(evaluatedPlayers, "crossover"));

  const playerImpact = evaluatedPlayers
    .map((player) => {
      const currentSummary = summarizeEvaluation(player.current);
      const crossoverSummary = summarizeEvaluation(player.crossover);
      const overallChange =
        currentSummary.overall.blendedAccuracy != null && crossoverSummary.overall.blendedAccuracy != null
          ? round(crossoverSummary.overall.blendedAccuracy - currentSummary.overall.blendedAccuracy, 2)
          : null;
      const weakChanges = targetWeakMarkets
        .map((market) => {
          const currentMarket = currentSummary.byMarket[market];
          const crossoverMarket = crossoverSummary.byMarket[market];
          if (!currentMarket || !crossoverMarket) return null;
          if (currentMarket.blendedAccuracy == null || crossoverMarket.blendedAccuracy == null) return null;
          return round(crossoverMarket.blendedAccuracy - currentMarket.blendedAccuracy, 2);
        })
        .filter((value): value is number => value != null);
      return {
        playerId: player.summary.playerId,
        playerName: player.summary.playerName,
        qualifiesForCrossover: player.qualifiesForCrossover,
        overallBlendedAccuracyChange: overallChange,
        averageWeakMarketChange:
          weakChanges.length > 0 ? round(weakChanges.reduce((sum, value) => sum + value, 0) / weakChanges.length, 2) : null,
      };
    })
    .sort(
      (left, right) =>
        (right.overallBlendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.overallBlendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        left.playerName.localeCompare(right.playerName),
    );

  return {
    members,
    current,
    crossover,
    vsCurrentOverall: compareSummaries(current.overall, crossover.overall),
    vsCurrentTargetWeakMarkets: Object.fromEntries(
      targetWeakMarkets.map((market) => [market, compareSummaries(current.byMarket[market], crossover.byMarket[market])]),
    ) as Partial<Record<Market, ReturnType<typeof compareSummaries>>>,
    playerImpact: {
      improvedPlayers: playerImpact.filter((player) => (player.overallBlendedAccuracyChange ?? 0) > 0).length,
      worsenedPlayers: playerImpact.filter((player) => (player.overallBlendedAccuracyChange ?? 0) < 0).length,
      unchangedPlayers: playerImpact.filter((player) => player.overallBlendedAccuracyChange === 0).length,
      players: playerImpact,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rowsPayload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = rowsPayload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const summaries = buildPlayerSummaries(rows, positionById);
  const rowsByPlayerId = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const existing = rowsByPlayerId.get(row.playerId) ?? [];
    existing.push(row);
    rowsByPlayerId.set(row.playerId, existing);
  });

  const evaluatedByPlayerId = new Map<string, EvaluatedPlayer>();
  rowsByPlayerId.forEach((playerRows, playerId) => {
    const summary = summaries.get(playerId);
    if (!summary) return;
    evaluatedByPlayerId.set(playerId, evaluatePlayer(playerRows, summary));
  });

  const allPlayers = [...evaluatedByPlayerId.values()];
  const crossoverPlayers = allPlayers.filter((player) => player.qualifiesForCrossover);
  const nonCrossoverPlayers = allPlayers.filter((player) => !player.qualifiesForCrossover);

  const overallCurrent = summarizeEvaluation(aggregatePlayers(allPlayers, "current"));
  const overallCrossover = summarizeEvaluation(aggregatePlayers(allPlayers, "crossover"));
  const candidateCurrent = summarizeEvaluation(aggregatePlayers(crossoverPlayers, "current"));
  const candidateCrossover = summarizeEvaluation(aggregatePlayers(crossoverPlayers, "crossover"));
  const nonCandidateCurrent = summarizeEvaluation(aggregatePlayers(nonCrossoverPlayers, "current"));
  const nonCandidateCrossover = summarizeEvaluation(aggregatePlayers(nonCrossoverPlayers, "crossover"));

  const candidatePlayers = crossoverPlayers
    .map((player) => {
      const current = summarizeEvaluation(player.current);
      const crossover = summarizeEvaluation(player.crossover);
      return {
        playerId: player.summary.playerId,
        playerName: player.summary.playerName,
        position: player.summary.position,
        summary: player.summary,
        current,
        crossover,
        vsCurrentOverall: compareSummaries(current.overall, crossover.overall),
      };
    })
    .sort(
      (left, right) =>
        (right.vsCurrentOverall?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.vsCurrentOverall?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        left.playerName.localeCompare(right.playerName),
    );

  const output: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: rowsPayload.from,
      to: rowsPayload.to,
      minActualMinutes: args.minActualMinutes,
    },
    crossoverRule: POINT_FORWARD_GUARD_CROSSOVER_RULE,
    overall: {
      current: overallCurrent,
      crossover: overallCrossover,
      vsCurrent: compareSummaries(overallCurrent.overall, overallCrossover.overall),
    },
    crossoverCandidates: {
      playerCount: crossoverPlayers.length,
      rowCount: crossoverPlayers.reduce((sum, player) => sum + player.current.overallBucket.samples, 0),
      current: candidateCurrent,
      crossover: candidateCrossover,
      vsCurrent: compareSummaries(candidateCurrent.overall, candidateCrossover.overall),
      players: candidatePlayers,
    },
    nonCandidates: {
      playerCount: nonCrossoverPlayers.length,
      rowCount: nonCrossoverPlayers.reduce((sum, player) => sum + player.current.overallBucket.samples, 0),
      current: nonCandidateCurrent,
      crossover: nonCandidateCrossover,
      vsCurrent: compareSummaries(nonCandidateCurrent.overall, nonCandidateCrossover.overall),
    },
  };

  if (args.cohort) {
    const cohort = JSON.parse(await readFile(path.resolve(args.cohort), "utf8")) as CohortStudyFile;
    const targetWeakMarkets = cohort.targetPlayer.targetWeakMarkets ?? [];
    const groups = buildGroups(cohort, args.sameTop, args.crossTop);
    output.cohort = path.resolve(args.cohort);
    output.groupAnalysis = Object.fromEntries(
      groups.map((group) => [
        group.key,
        summarizeGroup(evaluatedByPlayerId, group.members, targetWeakMarkets),
      ]),
    );
  }

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
