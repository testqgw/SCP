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

type Rule = {
  minMinutes: number;
  minPoints: number;
  minRebounds: number;
  minAssists: number;
  maxAssistsExclusive: number;
  maxThrees: number;
  requireReboundsAtLeastAssists: boolean;
};

type SweepResult = {
  ruleKey: string;
  rule: Rule;
  candidatePlayers: string[];
  candidatePlayerCount: number;
  candidateRowCount: number;
  overallVsCurrent: ReturnType<typeof compareSummaries>;
  candidateVsCurrent: ReturnType<typeof compareSummaries>;
  candidateWeakMarketChanges: Partial<Record<Market, ReturnType<typeof compareSummaries>>>;
  improvedCandidatePlayers: number;
  worsenedCandidatePlayers: number;
  unchangedCandidatePlayers: number;
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
  minCandidates: number;
  maxCandidates: number;
  top: number;
  grid: keyof typeof SWEEP_AXES;
};

const DEFAULT_PLAYER_META_CACHE_PATH = path.join(process.cwd(), "exports", "player-meta-cache.json");
const WEAK_MARKETS: Market[] = ["THREES", "PA", "RA"];
const TARGET_PLAYER = "Deni Avdija";

const SWEEP_AXES = {
  near: {
    minMinutes: [30, 31, 32],
    minPoints: [21, 22, 23],
    minRebounds: [6, 6.5, 7],
    minAssists: [4.5, 5, 5.5],
    maxAssistsExclusive: [6.4, 6.8, 7.2],
    maxThrees: [2.25, 2.5, 2.75],
    requireReboundsAtLeastAssists: [true, false],
  },
  expanded: {
    minMinutes: [29, 30, 31, 32],
    minPoints: [20, 21, 22, 23],
    minRebounds: [5.5, 6, 6.5, 7],
    minAssists: [4, 4.5, 5, 5.5],
    maxAssistsExclusive: [6.4, 6.8, 7.2, 7.6],
    maxThrees: [2.25, 2.5, 2.75, 3],
    requireReboundsAtLeastAssists: [true, false],
  },
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
  let minCandidates = 3;
  let maxCandidates = 8;
  let top = 20;
  let grid: keyof typeof SWEEP_AXES = "near";

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
    if ((token === "--min-candidates" || token === "-n") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minCandidates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-candidates=")) {
      const parsed = Number(token.slice("--min-candidates=".length));
      if (Number.isFinite(parsed) && parsed > 0) minCandidates = Math.floor(parsed);
      continue;
    }
    if ((token === "--max-candidates" || token === "-x") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) maxCandidates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-candidates=")) {
      const parsed = Number(token.slice("--max-candidates=".length));
      if (Number.isFinite(parsed) && parsed > 0) maxCandidates = Math.floor(parsed);
      continue;
    }
    if ((token === "--top" || token === "-t") && next) {
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
    if ((token === "--grid" || token === "-g") && next) {
      if (next === "near" || next === "expanded") grid = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--grid=")) {
      const parsed = token.slice("--grid=".length);
      if (parsed === "near" || parsed === "expanded") grid = parsed;
      continue;
    }
  }

  return { input, out, minActualMinutes, minCandidates, maxCandidates, top, grid };
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

function shouldApplyRule(summary: PlayerSummary, rule: Rule): boolean {
  const position = (summary.position ?? "").toUpperCase();
  const isGuard = position.includes("PG") || position.includes("SG") || position === "G";
  if (!isGuard || position.includes("C")) return false;

  const minutes = summary.avgExpectedMinutes ?? 0;
  const pts = summary.ptsProjectionAvg ?? 0;
  const reb = summary.rebProjectionAvg ?? 0;
  const ast = summary.astProjectionAvg ?? 0;
  const threes = summary.threesProjectionAvg ?? 0;

  if (minutes < rule.minMinutes) return false;
  if (pts < rule.minPoints) return false;
  if (reb < rule.minRebounds) return false;
  if (ast < rule.minAssists) return false;
  if (ast >= rule.maxAssistsExclusive) return false;
  if (threes > rule.maxThrees) return false;
  if (rule.requireReboundsAtLeastAssists && reb < ast) return false;
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

function evaluatePlayer(rows: TrainingRow[], summary: PlayerSummary) {
  const current: PlayerEvaluation = {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };
  const pointForward: PlayerEvaluation = {
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

    const pointForwardRaw =
      currentRaw.archetype === "SCORING_GUARD_CREATOR"
        ? inspectLiveUniversalModelSideForArchetype(input, "POINT_FORWARD")
        : currentRaw;
    const pointForwardQualified = qualifyLiveUniversalModelDecision(
      pointForwardRaw,
      DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
    );
    const pointForwardPredictedSide = pointForwardRaw.rawSide === "NEUTRAL" ? row.finalSide : pointForwardRaw.rawSide;
    pointForward.effectiveArchetypeCounts.set(
      pointForwardRaw.archetype ?? "UNKNOWN",
      (pointForward.effectiveArchetypeCounts.get(pointForwardRaw.archetype ?? "UNKNOWN") ?? 0) + 1,
    );
    applyDecisionToBucket(pointForward.overallBucket, row, pointForwardPredictedSide, pointForwardQualified.qualified);
    const pointForwardMarketBucket = pointForward.marketBuckets.get(row.market) ?? emptyBucket();
    applyDecisionToBucket(pointForwardMarketBucket, row, pointForwardPredictedSide, pointForwardQualified.qualified);
    pointForward.marketBuckets.set(row.market, pointForwardMarketBucket);
  });

  return { summary, current, pointForward };
}

function aggregatePlayers(
  players: Array<ReturnType<typeof evaluatePlayer>>,
  variant: "current" | "pointForward",
): PlayerEvaluation {
  const aggregate: PlayerEvaluation = {
    overallBucket: emptyBucket(),
    marketBuckets: new Map<Market, AggregateBucket>(),
    effectiveArchetypeCounts: new Map<string, number>(),
  };

  players.forEach((player) => {
    const evaluation = player[variant];
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

function generateRules(axes: (typeof SWEEP_AXES)[keyof typeof SWEEP_AXES]): Rule[] {
  const rules: Rule[] = [];
  axes.minMinutes.forEach((minMinutes) => {
    axes.minPoints.forEach((minPoints) => {
      axes.minRebounds.forEach((minRebounds) => {
        axes.minAssists.forEach((minAssists) => {
          axes.maxAssistsExclusive.forEach((maxAssistsExclusive) => {
            if (maxAssistsExclusive <= minAssists) return;
            axes.maxThrees.forEach((maxThrees) => {
              axes.requireReboundsAtLeastAssists.forEach((requireReboundsAtLeastAssists) => {
                rules.push({
                  minMinutes,
                  minPoints,
                  minRebounds,
                  minAssists,
                  maxAssistsExclusive,
                  maxThrees,
                  requireReboundsAtLeastAssists,
                });
              });
            });
          });
        });
      });
    });
  });
  return rules;
}

function ruleKey(rule: Rule): string {
  return [
    `minM${rule.minMinutes}`,
    `minP${rule.minPoints}`,
    `minR${rule.minRebounds}`,
    `minA${rule.minAssists}`,
    `maxA${rule.maxAssistsExclusive}`,
    `maxT${rule.maxThrees}`,
    `rebGteAst${rule.requireReboundsAtLeastAssists ? 1 : 0}`,
  ].join("_");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const positionById = loadPlayerMetaCache(DEFAULT_PLAYER_META_CACHE_PATH);
  const summaries = buildPlayerSummaries(rows, positionById);
  const axes = SWEEP_AXES[args.grid];

  const rowsByPlayerId = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const existing = rowsByPlayerId.get(row.playerId) ?? [];
    existing.push(row);
    rowsByPlayerId.set(row.playerId, existing);
  });

  const evaluatedPlayers = [...rowsByPlayerId.entries()]
    .map(([playerId, playerRows]) => {
      const summary = summaries.get(playerId);
      if (!summary) return null;
      return evaluatePlayer(playerRows, summary);
    })
    .filter((value): value is ReturnType<typeof evaluatePlayer> => value != null);

  const currentAll = summarizeEvaluation(aggregatePlayers(evaluatedPlayers, "current"));
  const rules = generateRules(axes);
  const deniEvaluation = evaluatedPlayers.find((player) => player.summary.playerName === TARGET_PLAYER) ?? null;

  const results: SweepResult[] = rules.map((rule) => {
    const touchedPlayers = evaluatedPlayers.filter(
      (player) =>
        shouldApplyRule(player.summary, rule) &&
        (player.current.effectiveArchetypeCounts.get("SCORING_GUARD_CREATOR") ?? 0) > 0,
    );
    const untouchedPlayers = evaluatedPlayers.filter((player) => !touchedPlayers.includes(player));
    const selectedPlayers = [...touchedPlayers.map((player) => ({ player, variant: "pointForward" as const })), ...untouchedPlayers.map((player) => ({ player, variant: "current" as const }))];

    const overallAggregate: PlayerEvaluation = {
      overallBucket: emptyBucket(),
      marketBuckets: new Map<Market, AggregateBucket>(),
      effectiveArchetypeCounts: new Map<string, number>(),
    };
    selectedPlayers.forEach(({ player, variant }) => {
      const evaluation = player[variant];
      mergeBucket(overallAggregate.overallBucket, cloneBucket(evaluation.overallBucket));
      evaluation.marketBuckets.forEach((bucket, market) => {
        const existing = overallAggregate.marketBuckets.get(market) ?? emptyBucket();
        mergeBucket(existing, cloneBucket(bucket));
        overallAggregate.marketBuckets.set(market, existing);
      });
      evaluation.effectiveArchetypeCounts.forEach((count, archetype) => {
        overallAggregate.effectiveArchetypeCounts.set(archetype, (overallAggregate.effectiveArchetypeCounts.get(archetype) ?? 0) + count);
      });
    });

    const overallSummary = summarizeEvaluation(overallAggregate);
    const candidateCurrent = summarizeEvaluation(aggregatePlayers(touchedPlayers, "current"));
    const candidateVariant = summarizeEvaluation(aggregatePlayers(touchedPlayers, "pointForward"));
    const candidatePlayerImpact = touchedPlayers.map((player) => {
      const current = summarizeEvaluation(player.current);
      const variant = summarizeEvaluation(player.pointForward);
      const overallChange =
        current.overall.blendedAccuracy != null && variant.overall.blendedAccuracy != null
          ? round(variant.overall.blendedAccuracy - current.overall.blendedAccuracy, 2)
          : null;
      return {
        playerName: player.summary.playerName,
        overallChange,
      };
    });

    return {
      ruleKey: ruleKey(rule),
      rule,
      candidatePlayers: touchedPlayers.map((player) => player.summary.playerName).sort((left, right) => left.localeCompare(right)),
      candidatePlayerCount: touchedPlayers.length,
      candidateRowCount: touchedPlayers.reduce((sum, player) => sum + player.current.overallBucket.samples, 0),
      overallVsCurrent: compareSummaries(currentAll.overall, overallSummary.overall),
      candidateVsCurrent: compareSummaries(candidateCurrent.overall, candidateVariant.overall),
      candidateWeakMarketChanges: Object.fromEntries(
        WEAK_MARKETS.map((market) => [market, compareSummaries(candidateCurrent.byMarket[market], candidateVariant.byMarket[market])]),
      ) as Partial<Record<Market, ReturnType<typeof compareSummaries>>>,
      improvedCandidatePlayers: candidatePlayerImpact.filter((player) => (player.overallChange ?? 0) > 0).length,
      worsenedCandidatePlayers: candidatePlayerImpact.filter((player) => (player.overallChange ?? 0) < 0).length,
      unchangedCandidatePlayers: candidatePlayerImpact.filter((player) => player.overallChange === 0).length,
    };
  });

  const constrained = results
    .filter((result) => result.candidatePlayerCount >= args.minCandidates && result.candidatePlayerCount <= args.maxCandidates)
    .filter((result) => result.candidatePlayers.includes(TARGET_PLAYER))
    .filter((result) => (result.overallVsCurrent?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0)
    .filter((result) => (result.overallVsCurrent?.qualifiedAccuracyChange ?? Number.NEGATIVE_INFINITY) >= 0)
    .sort(
      (left, right) =>
        (right.overallVsCurrent?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.overallVsCurrent?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        (right.candidateVsCurrent?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.candidateVsCurrent?.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        left.ruleKey.localeCompare(right.ruleKey),
    );

  const nearMisses = results
    .filter((result) => result.candidatePlayers.includes(TARGET_PLAYER))
    .filter((result) => result.candidatePlayerCount >= args.minCandidates && result.candidatePlayerCount <= args.maxCandidates)
    .sort(
      (left, right) =>
        Math.abs((right.overallVsCurrent?.blendedAccuracyChange ?? 0)) - Math.abs((left.overallVsCurrent?.blendedAccuracyChange ?? 0)) ||
        left.ruleKey.localeCompare(right.ruleKey),
    )
    .slice(0, args.top);

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    datasetRange: {
      from: payload.from,
      to: payload.to,
      minActualMinutes: args.minActualMinutes,
    },
    sweepConfig: {
      grid: args.grid,
      minCandidates: args.minCandidates,
      maxCandidates: args.maxCandidates,
      top: args.top,
      searchedRuleCount: rules.length,
      targetPlayer: TARGET_PLAYER,
      axes,
    },
    baselineOverall: currentAll.overall,
    deniCurrent:
      deniEvaluation == null
        ? null
        : summarizeEvaluation(deniEvaluation.current).overall,
    bestRules: constrained.slice(0, args.top),
    nearMisses,
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
