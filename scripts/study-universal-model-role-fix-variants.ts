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
type VariantKey =
  | "current"
  | "point_forward_all_markets"
  | "point_forward_weak_markets_only"
  | "point_forward_weak_markets_veto_underdog_8_plus"
  | "point_forward_weak_markets_veto_36_plus_minutes"
  | "point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes"
  | "forward_position_only"
  | "forward_position_weak_markets_only";

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

type GroupMember = {
  playerId: string;
  playerName: string;
  dominantArchetype: string;
  position: string | null;
  source: "target" | "same_archetype" | "cross_archetype";
  rank: number;
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
  cohort: string | null;
  minActualMinutes: number;
  sameTop: number;
  crossTop: number;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const DEFAULT_WEAK_MARKETS: Market[] = ["THREES", "PA", "RA"];
const FORWARD_POSITION_OVERRIDE = "F";

const ROLE_FIX_RULE = {
  minMinutes: 30,
  minPoints: 22,
  minRebounds: 6,
  minAssists: 4.5,
  maxAssistsExclusive: 6.8,
  maxThrees: 2.6,
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

function shouldApplyRoleFix(summary: PlayerSummary): boolean {
  const position = (summary.position ?? "").toUpperCase();
  const isGuard = position.includes("PG") || position.includes("SG") || position === "G";
  if (!isGuard || position.includes("C")) return false;

  const minutes = summary.avgExpectedMinutes ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes < ROLE_FIX_RULE.minMinutes) return false;
  if (pts < ROLE_FIX_RULE.minPoints) return false;
  if (reb < ROLE_FIX_RULE.minRebounds) return false;
  if (ast < ROLE_FIX_RULE.minAssists) return false;
  if (ast >= ROLE_FIX_RULE.maxAssistsExclusive) return false;
  if (threes > ROLE_FIX_RULE.maxThrees) return false;
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

function buildInput(row: TrainingRow, summary: PlayerSummary, positionOverride?: string | null) {
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
    playerPosition: positionOverride ?? summary.position,
    pointsProjection: summary.ptsProjectionAvg,
    reboundsProjection: summary.rebProjectionAvg,
    assistProjection: summary.astProjectionAvg,
    threesProjection: summary.threesProjectionAvg,
  };
}

function createEvaluation(): PlayerEvaluation {
  return {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };
}

function isWeakMarket(row: TrainingRow, weakMarkets: Market[]): boolean {
  return weakMarkets.includes(row.market);
}

function isUnderdogEightPlusContext(row: TrainingRow): boolean {
  return row.openingTeamSpread != null && Number.isFinite(row.openingTeamSpread) && row.openingTeamSpread >= 8;
}

function isThirtySixPlusExpectedMinutesContext(row: TrainingRow): boolean {
  return row.expectedMinutes != null && Number.isFinite(row.expectedMinutes) && row.expectedMinutes >= 36;
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

function evaluatePlayer(rows: TrainingRow[], summary: PlayerSummary, weakMarkets: Market[]): EvaluatedPlayer {
  const qualifiesForRoleFix = shouldApplyRoleFix(summary);
  const evaluations: Record<VariantKey, PlayerEvaluation> = {
    current: createEvaluation(),
    point_forward_all_markets: createEvaluation(),
    point_forward_weak_markets_only: createEvaluation(),
    point_forward_weak_markets_veto_underdog_8_plus: createEvaluation(),
    point_forward_weak_markets_veto_36_plus_minutes: createEvaluation(),
    point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes: createEvaluation(),
    forward_position_only: createEvaluation(),
    forward_position_weak_markets_only: createEvaluation(),
  };

  rows.forEach((row) => {
    const baseInput = buildInput(row, summary);
    const currentRaw = inspectLiveUniversalModelSide(baseInput);
    applyModelDecision(evaluations.current, row, currentRaw);

    const forcedPointForwardRaw =
      qualifiesForRoleFix && currentRaw.archetype === "SCORING_GUARD_CREATOR"
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "POINT_FORWARD")
        : currentRaw;
    applyModelDecision(evaluations.point_forward_all_markets, row, forcedPointForwardRaw);

    const forcedPointForwardWeakRaw =
      qualifiesForRoleFix && currentRaw.archetype === "SCORING_GUARD_CREATOR" && isWeakMarket(row, weakMarkets)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "POINT_FORWARD")
        : currentRaw;
    applyModelDecision(evaluations.point_forward_weak_markets_only, row, forcedPointForwardWeakRaw);

    const forcedPointForwardWeakUnderdogVetoRaw =
      qualifiesForRoleFix &&
      currentRaw.archetype === "SCORING_GUARD_CREATOR" &&
      isWeakMarket(row, weakMarkets) &&
      !isUnderdogEightPlusContext(row)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "POINT_FORWARD")
        : currentRaw;
    applyModelDecision(
      evaluations.point_forward_weak_markets_veto_underdog_8_plus,
      row,
      forcedPointForwardWeakUnderdogVetoRaw,
    );

    const forcedPointForwardWeakMinutesVetoRaw =
      qualifiesForRoleFix &&
      currentRaw.archetype === "SCORING_GUARD_CREATOR" &&
      isWeakMarket(row, weakMarkets) &&
      !isThirtySixPlusExpectedMinutesContext(row)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "POINT_FORWARD")
        : currentRaw;
    applyModelDecision(
      evaluations.point_forward_weak_markets_veto_36_plus_minutes,
      row,
      forcedPointForwardWeakMinutesVetoRaw,
    );

    const forcedPointForwardWeakCombinedVetoRaw =
      qualifiesForRoleFix &&
      currentRaw.archetype === "SCORING_GUARD_CREATOR" &&
      isWeakMarket(row, weakMarkets) &&
      !isUnderdogEightPlusContext(row) &&
      !isThirtySixPlusExpectedMinutesContext(row)
        ? inspectLiveUniversalModelSideForArchetype(baseInput, "POINT_FORWARD")
        : currentRaw;
    applyModelDecision(
      evaluations.point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes,
      row,
      forcedPointForwardWeakCombinedVetoRaw,
    );

    const forwardPositionRaw =
      qualifiesForRoleFix ? inspectLiveUniversalModelSide(buildInput(row, summary, FORWARD_POSITION_OVERRIDE)) : currentRaw;
    applyModelDecision(evaluations.forward_position_only, row, forwardPositionRaw);

    const forwardPositionWeakRaw =
      qualifiesForRoleFix && weakMarkets.includes(row.market)
        ? inspectLiveUniversalModelSide(buildInput(row, summary, FORWARD_POSITION_OVERRIDE))
        : currentRaw;
    applyModelDecision(evaluations.forward_position_weak_markets_only, row, forwardPositionWeakRaw);
  });

  return { summary, qualifiesForRoleFix, evaluations };
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
    { key: `target_plus_all_${sameTop}_${crossTop}`, label: "Target + all peers", members: dedupeMembers([target, ...same, ...cross]) },
  ];
}

function summarizeGroup(playersById: Map<string, EvaluatedPlayer>, members: GroupMember[], weakMarkets: Market[]) {
  const players = members
    .map((member) => playersById.get(member.playerId))
    .filter((value): value is EvaluatedPlayer => value != null);

  const current = summarizeEvaluation(aggregatePlayers(players, "current"));
  const variants = Object.fromEntries(
    ([
      "point_forward_all_markets",
      "point_forward_weak_markets_only",
      "point_forward_weak_markets_veto_underdog_8_plus",
      "point_forward_weak_markets_veto_36_plus_minutes",
      "point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes",
      "forward_position_only",
      "forward_position_weak_markets_only",
    ] as VariantKey[]).map((variant) => {
      const summary = summarizeEvaluation(aggregatePlayers(players, variant));
      return [
        variant,
        {
          summary,
          vsCurrentOverall: compareSummaries(current.overall, summary.overall),
          vsCurrentTargetWeakMarkets: Object.fromEntries(
            weakMarkets.map((market) => [market, compareSummaries(current.byMarket[market], summary.byMarket[market])]),
          ),
          playerImpact: players.map((player) => {
            const currentPlayer = summarizeEvaluation(player.evaluations.current);
            const variantPlayer = summarizeEvaluation(player.evaluations[variant]);
            return {
              playerId: player.summary.playerId,
              playerName: player.summary.playerName,
              qualifiesForRoleFix: player.qualifiesForRoleFix,
              overallBlendedAccuracyChange:
                currentPlayer.overall.blendedAccuracy != null && variantPlayer.overall.blendedAccuracy != null
                  ? round(variantPlayer.overall.blendedAccuracy - currentPlayer.overall.blendedAccuracy, 2)
                  : null,
            };
          }),
        },
      ];
    }),
  );

  return { members, current, variants };
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

  let weakMarkets = DEFAULT_WEAK_MARKETS;
  let cohort: CohortStudyFile | null = null;
  if (args.cohort) {
    cohort = JSON.parse(await readFile(path.resolve(args.cohort), "utf8")) as CohortStudyFile;
    weakMarkets = cohort.targetPlayer.targetWeakMarkets ?? DEFAULT_WEAK_MARKETS;
  }

  const playersById = new Map<string, EvaluatedPlayer>();
  rowsByPlayerId.forEach((playerRows, playerId) => {
    const summary = summaries.get(playerId);
    if (!summary) return;
    playersById.set(playerId, evaluatePlayer(playerRows, summary, weakMarkets));
  });

  const allPlayers = [...playersById.values()];
  const roleFixPlayers = allPlayers.filter((player) => player.qualifiesForRoleFix);
  const allCurrent = summarizeEvaluation(aggregatePlayers(allPlayers, "current"));

  const output: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      minActualMinutes: args.minActualMinutes,
    },
    roleFixRule: ROLE_FIX_RULE,
    weakMarkets,
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
        ([
          "point_forward_all_markets",
          "point_forward_weak_markets_only",
          "point_forward_weak_markets_veto_underdog_8_plus",
          "point_forward_weak_markets_veto_36_plus_minutes",
          "point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes",
          "forward_position_only",
          "forward_position_weak_markets_only",
        ] as VariantKey[]).map((variant) => {
          const summary = summarizeEvaluation(aggregatePlayers(allPlayers, variant));
          return [variant, { summary, vsCurrent: compareSummaries(allCurrent.overall, summary.overall) }];
        }),
      ),
    },
    candidateOnly: Object.fromEntries(
      ([
        "current",
        "point_forward_all_markets",
        "point_forward_weak_markets_only",
        "point_forward_weak_markets_veto_underdog_8_plus",
        "point_forward_weak_markets_veto_36_plus_minutes",
        "point_forward_weak_markets_veto_underdog_8_plus_or_36_plus_minutes",
        "forward_position_only",
        "forward_position_weak_markets_only",
      ] as VariantKey[]).map((variant) => [variant, summarizeEvaluation(aggregatePlayers(roleFixPlayers, variant))]),
    ),
  };

  if (cohort) {
    const groups = buildGroups(cohort, args.sameTop, args.crossTop);
    output.cohort = path.resolve(args.cohort!);
    output.groupAnalysis = Object.fromEntries(groups.map((group) => [group.key, summarizeGroup(playersById, group.members, weakMarkets)]));
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
