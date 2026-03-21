import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS,
  inspectLiveUniversalModelSide,
  inspectLiveUniversalModelSideForArchetype,
  qualifyLiveUniversalModelDecision,
  type Archetype,
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
type MarketSetKey = "PA_ONLY" | "PA_PR" | "PA_PR_RA" | "ALL_COMBOS";
type ActionKey = "force_low_usage_big" | "qualified_veto";

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

type PlayerMeta = {
  id: string;
  position: string | null;
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

type PreparedRow = {
  row: TrainingRow;
  summary: PlayerSummary;
  currentRaw: RawLiveUniversalModelDecision;
  currentQualified: LiveUniversalModelDecision;
  forcedRaw: RawLiveUniversalModelDecision;
  forcedQualified: LiveUniversalModelDecision;
};

type PlayerCurrentProfile = {
  summary: PlayerSummary;
  currentOverall: BucketSummary;
  dominantArchetype: string;
};

type RuleSpec = {
  key: string;
  action: ActionKey;
  marketSet: MarketSetKey;
  markets: Market[];
  maxExpectedMinutes: number;
  maxPoints: number;
  maxRebounds: number;
  maxThrees: number;
  maxStarterRate: number;
};

type PlayerImpact = {
  playerId: string;
  playerName: string;
  dominantArchetype: string;
  summary: {
    avgExpectedMinutes: number | null;
    avgStarterRate: number | null;
    ptsProjectionAvg: number | null;
    rebProjectionAvg: number | null;
    threesProjectionAvg: number | null;
  };
  current: BucketSummary;
  variant: BucketSummary;
  blendedAccuracyChange: number | null;
  qualifiedAccuracyChange: number | null;
  deltaVsBaselineChange: number | null;
};

type RuleResult = {
  key: string;
  action: ActionKey;
  marketSet: MarketSetKey;
  markets: Market[];
  thresholds: {
    maxExpectedMinutes: number;
    maxPoints: number;
    maxRebounds: number;
    maxThrees: number;
    maxStarterRate: number;
  };
  candidatePlayers: number;
  stableCandidatePlayers: number;
  clintIncluded: boolean;
  currentOverall: BucketSummary;
  variantOverall: BucketSummary;
  overallVsCurrent: {
    blendedAccuracyChange: number | null;
    qualifiedAccuracyChange: number | null;
    coveragePctChange: number | null;
    deltaVsBaselineChange: number | null;
  };
  currentCandidateCohort: BucketSummary;
  variantCandidateCohort: BucketSummary;
  candidateVsCurrent: {
    blendedAccuracyChange: number | null;
    qualifiedAccuracyChange: number | null;
    coveragePctChange: number | null;
    deltaVsBaselineChange: number | null;
  };
  improvedPlayers: number;
  worsenedPlayers: number;
  unchangedPlayers: number;
  playerImpacts: PlayerImpact[];
};

type Args = {
  input: string;
  out: string | null;
  minActualMinutes: number;
  minStablePlayerSamples: number;
  top: number;
};

const prisma = new PrismaClient();
const FORCED_ARCHETYPE: Archetype = "BENCH_LOW_USAGE_BIG";
const BENCH_TRADITIONAL_BIG: Archetype = "BENCH_TRADITIONAL_BIG";
const MARKET_SETS: Record<MarketSetKey, Market[]> = {
  PA_ONLY: ["PA"],
  PA_PR: ["PA", "PR"],
  PA_PR_RA: ["PA", "PR", "RA"],
  ALL_COMBOS: ["PRA", "PA", "PR", "RA"],
};

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
  let minStablePlayerSamples = 20;
  let top = 15;

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
    if (token === "--min-stable-player-samples" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) minStablePlayerSamples = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-stable-player-samples=")) {
      const parsed = Number(token.slice("--min-stable-player-samples=".length));
      if (Number.isFinite(parsed) && parsed > 0) minStablePlayerSamples = Math.floor(parsed);
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

  return { input, out, minActualMinutes, minStablePlayerSamples, top };
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

function diffMetric(next: number | null, current: number | null): number | null {
  if (next == null || current == null) return null;
  return round(next - current, 2);
}

function applyDecisionToBucket(
  bucket: AggregateBucket,
  row: TrainingRow,
  rawSide: Side,
  qualified: boolean,
): void {
  const disagreement = rawSide !== row.finalSide;
  const blendedSide = qualified ? rawSide : row.finalSide;

  bucket.samples += 1;
  if (rawSide === row.actualSide) bucket.rawCorrect += 1;
  if (row.finalSide === row.actualSide) bucket.baselineCorrect += 1;
  if (blendedSide === row.actualSide) bucket.blendedCorrect += 1;
  if (qualified) {
    bucket.qualifiedPicks += 1;
    if (rawSide === row.actualSide) bucket.qualifiedCorrect += 1;
  }
  if (disagreement) {
    bucket.disagreements += 1;
    if (qualified) {
      if (rawSide === row.actualSide) bucket.qualifiedDisagreementWins += 1;
      else bucket.qualifiedDisagreementLosses += 1;
    }
  }
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
  for (const row of rows) {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  }

  const summaries = new Map<string, PlayerSummary>();
  for (const [playerId, playerRows] of byPlayer.entries()) {
    summaries.set(playerId, {
      playerId,
      playerName: playerRows[0]!.playerName,
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      ptsProjectionAvg: meanProjection(playerRows, "pointsProjection", (value) => round(value, 4)),
      rebProjectionAvg: meanProjection(playerRows, "reboundsProjection", (value) => round(value, 4)),
      astProjectionAvg: meanProjection(playerRows, "assistProjection", (value) => round(value, 4)),
      threesProjectionAvg: meanProjection(playerRows, "threesProjection", (value) => round(value, 4)),
    });
  }

  return summaries;
}

function buildRuleGrid(): RuleSpec[] {
  const maxExpectedMinutes = [12.5, 14.5, 16.5, 99];
  const maxPoints = [4.5, 6.5, 99];
  const maxRebounds = [5.75, 6.75, 99];
  const maxThrees = [0.1, 0.5, 99];
  const maxStarterRate = [0.3, 1];
  const actions: ActionKey[] = ["force_low_usage_big", "qualified_veto"];
  const marketSets = Object.entries(MARKET_SETS) as Array<[MarketSetKey, Market[]]>;

  const rules: RuleSpec[] = [];
  for (const action of actions) {
    for (const [marketSet, markets] of marketSets) {
      for (const expectedMinutes of maxExpectedMinutes) {
        for (const points of maxPoints) {
          for (const rebounds of maxRebounds) {
            for (const threes of maxThrees) {
              for (const starterRate of maxStarterRate) {
                const key = [
                  action,
                  marketSet,
                  `em${expectedMinutes}`,
                  `pts${points}`,
                  `reb${rebounds}`,
                  `thr${threes}`,
                  `sr${starterRate}`,
                ].join("_");
                rules.push({
                  key,
                  action,
                  marketSet,
                  markets,
                  maxExpectedMinutes: expectedMinutes,
                  maxPoints: points,
                  maxRebounds: rebounds,
                  maxThrees: threes,
                  maxStarterRate: starterRate,
                });
              }
            }
          }
        }
      }
    }
  }
  return rules;
}

function qualifiesForRule(rule: RuleSpec, profile: PlayerCurrentProfile): boolean {
  if (profile.dominantArchetype !== BENCH_TRADITIONAL_BIG) return false;
  const { summary } = profile;
  const expectedMinutes = summary.avgExpectedMinutes ?? Number.POSITIVE_INFINITY;
  const points = summary.ptsProjectionAvg ?? Number.POSITIVE_INFINITY;
  const rebounds = summary.rebProjectionAvg ?? Number.POSITIVE_INFINITY;
  const threes = summary.threesProjectionAvg ?? Number.POSITIVE_INFINITY;
  const starterRate = summary.avgStarterRate ?? Number.POSITIVE_INFINITY;
  return (
    expectedMinutes <= rule.maxExpectedMinutes &&
    points <= rule.maxPoints &&
    rebounds <= rule.maxRebounds &&
    threes <= rule.maxThrees &&
    starterRate <= rule.maxStarterRate
  );
}

function prepareRows(
  rows: TrainingRow[],
  summaries: Map<string, PlayerSummary>,
): {
  preparedRows: PreparedRow[];
  currentProfiles: Map<string, PlayerCurrentProfile>;
  currentOverall: BucketSummary;
} {
  const preparedRows: PreparedRow[] = [];
  const playerBuckets = new Map<
    string,
    {
      overall: AggregateBucket;
      archetypeCounts: Map<string, number>;
    }
  >();
  const overall = emptyBucket();

  for (const row of rows) {
    const summary = summaries.get(row.playerId);
    if (!summary) continue;
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
      pointsProjection: rowProjectionOrSummary(row, "pointsProjection", summary.ptsProjectionAvg),
      reboundsProjection: rowProjectionOrSummary(row, "reboundsProjection", summary.rebProjectionAvg),
      assistProjection: rowProjectionOrSummary(row, "assistProjection", summary.astProjectionAvg),
      threesProjection: rowProjectionOrSummary(row, "threesProjection", summary.threesProjectionAvg),
    };

    const currentRaw = inspectLiveUniversalModelSide(input);
    const currentQualified = qualifyLiveUniversalModelDecision(currentRaw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);
    const forcedRaw = inspectLiveUniversalModelSideForArchetype(input, FORCED_ARCHETYPE);
    const forcedQualified = qualifyLiveUniversalModelDecision(forcedRaw, DEFAULT_LIVE_UNIVERSAL_QUALIFICATION_SETTINGS);

    preparedRows.push({
      row,
      summary,
      currentRaw,
      currentQualified,
      forcedRaw,
      forcedQualified,
    });

    const currentRawSide = currentRaw.rawSide === "NEUTRAL" ? row.finalSide : currentRaw.rawSide;
    applyDecisionToBucket(overall, row, currentRawSide, currentQualified.qualified);

    const playerBucket = playerBuckets.get(row.playerId) ?? {
      overall: emptyBucket(),
      archetypeCounts: new Map<string, number>(),
    };
    applyDecisionToBucket(playerBucket.overall, row, currentRawSide, currentQualified.qualified);
    const archetypeKey = currentRaw.archetype ?? "UNKNOWN";
    playerBucket.archetypeCounts.set(archetypeKey, (playerBucket.archetypeCounts.get(archetypeKey) ?? 0) + 1);
    playerBuckets.set(row.playerId, playerBucket);
  }

  const currentProfiles = new Map<string, PlayerCurrentProfile>();
  for (const [playerId, bucket] of playerBuckets.entries()) {
    const summary = summaries.get(playerId);
    if (!summary) continue;
    const dominantArchetype =
      [...bucket.archetypeCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
      "UNKNOWN";
    currentProfiles.set(playerId, {
      summary,
      currentOverall: summarizeBucket(bucket.overall),
      dominantArchetype,
    });
  }

  return {
    preparedRows,
    currentProfiles,
    currentOverall: summarizeBucket(overall),
  };
}

function evaluateRule(
  rule: RuleSpec,
  preparedRows: PreparedRow[],
  currentProfiles: Map<string, PlayerCurrentProfile>,
  currentOverall: BucketSummary,
  minStablePlayerSamples: number,
): RuleResult {
  const candidatePlayerIds = new Set<string>();
  for (const [playerId, profile] of currentProfiles.entries()) {
    if (qualifiesForRule(rule, profile)) candidatePlayerIds.add(playerId);
  }

  const variantOverall = emptyBucket();
  const currentCandidateCohort = emptyBucket();
  const variantCandidateCohort = emptyBucket();
  const variantPlayerBuckets = new Map<string, AggregateBucket>();

  for (const prepared of preparedRows) {
    const { row, currentRaw, currentQualified, forcedRaw, forcedQualified } = prepared;
    const currentRawSide = currentRaw.rawSide === "NEUTRAL" ? row.finalSide : currentRaw.rawSide;
    const affected =
      candidatePlayerIds.has(row.playerId) &&
      rule.markets.includes(row.market) &&
      currentRaw.archetype === BENCH_TRADITIONAL_BIG;

    let nextRawSide = currentRawSide;
    let nextQualified = currentQualified.qualified;

    if (affected && rule.action === "force_low_usage_big") {
      nextRawSide = forcedRaw.rawSide === "NEUTRAL" ? row.finalSide : forcedRaw.rawSide;
      nextQualified = forcedQualified.qualified;
    } else if (affected && rule.action === "qualified_veto") {
      nextQualified = false;
    }

    applyDecisionToBucket(variantOverall, row, nextRawSide, nextQualified);

    if (candidatePlayerIds.has(row.playerId)) {
      applyDecisionToBucket(currentCandidateCohort, row, currentRawSide, currentQualified.qualified);
      applyDecisionToBucket(variantCandidateCohort, row, nextRawSide, nextQualified);
      const playerBucket = variantPlayerBuckets.get(row.playerId) ?? emptyBucket();
      applyDecisionToBucket(playerBucket, row, nextRawSide, nextQualified);
      variantPlayerBuckets.set(row.playerId, playerBucket);
    }
  }

  const currentCandidateSummary = summarizeBucket(currentCandidateCohort);
  const variantCandidateSummary = summarizeBucket(variantCandidateCohort);
  const variantOverallSummary = summarizeBucket(variantOverall);

  const playerImpacts: PlayerImpact[] = [...candidatePlayerIds]
    .map((playerId) => {
      const profile = currentProfiles.get(playerId);
      const variant = variantPlayerBuckets.get(playerId);
      if (!profile || !variant) return null;
      const variantSummary = summarizeBucket(variant);
      return {
        playerId,
        playerName: profile.summary.playerName,
        dominantArchetype: profile.dominantArchetype,
        summary: {
          avgExpectedMinutes: profile.summary.avgExpectedMinutes,
          avgStarterRate: profile.summary.avgStarterRate,
          ptsProjectionAvg: profile.summary.ptsProjectionAvg,
          rebProjectionAvg: profile.summary.rebProjectionAvg,
          threesProjectionAvg: profile.summary.threesProjectionAvg,
        },
        current: profile.currentOverall,
        variant: variantSummary,
        blendedAccuracyChange: diffMetric(variantSummary.blendedAccuracy, profile.currentOverall.blendedAccuracy),
        qualifiedAccuracyChange: diffMetric(variantSummary.qualifiedAccuracy, profile.currentOverall.qualifiedAccuracy),
        deltaVsBaselineChange: diffMetric(variantSummary.deltaVsBaseline, profile.currentOverall.deltaVsBaseline),
      };
    })
    .filter((impact): impact is PlayerImpact => impact != null)
    .sort((left, right) => {
      return (
        (right.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        (right.variant.samples - left.variant.samples) ||
        left.playerName.localeCompare(right.playerName)
      );
    });

  let improvedPlayers = 0;
  let worsenedPlayers = 0;
  let unchangedPlayers = 0;
  let stableCandidatePlayers = 0;

  for (const impact of playerImpacts) {
    if (impact.current.samples >= minStablePlayerSamples) stableCandidatePlayers += 1;
    const blendedChange = impact.blendedAccuracyChange ?? 0;
    if (blendedChange > 0) improvedPlayers += 1;
    else if (blendedChange < 0) worsenedPlayers += 1;
    else unchangedPlayers += 1;
  }

  return {
    key: rule.key,
    action: rule.action,
    marketSet: rule.marketSet,
    markets: rule.markets,
    thresholds: {
      maxExpectedMinutes: rule.maxExpectedMinutes,
      maxPoints: rule.maxPoints,
      maxRebounds: rule.maxRebounds,
      maxThrees: rule.maxThrees,
      maxStarterRate: rule.maxStarterRate,
    },
    candidatePlayers: playerImpacts.length,
    stableCandidatePlayers,
    clintIncluded: playerImpacts.some((impact) => impact.playerName.toLowerCase() === "clint capela"),
    currentOverall,
    variantOverall: variantOverallSummary,
    overallVsCurrent: {
      blendedAccuracyChange: diffMetric(variantOverallSummary.blendedAccuracy, currentOverall.blendedAccuracy),
      qualifiedAccuracyChange: diffMetric(variantOverallSummary.qualifiedAccuracy, currentOverall.qualifiedAccuracy),
      coveragePctChange: diffMetric(variantOverallSummary.coveragePct, currentOverall.coveragePct),
      deltaVsBaselineChange: diffMetric(variantOverallSummary.deltaVsBaseline, currentOverall.deltaVsBaseline),
    },
    currentCandidateCohort: currentCandidateSummary,
    variantCandidateCohort: variantCandidateSummary,
    candidateVsCurrent: {
      blendedAccuracyChange: diffMetric(variantCandidateSummary.blendedAccuracy, currentCandidateSummary.blendedAccuracy),
      qualifiedAccuracyChange: diffMetric(variantCandidateSummary.qualifiedAccuracy, currentCandidateSummary.qualifiedAccuracy),
      coveragePctChange: diffMetric(variantCandidateSummary.coveragePct, currentCandidateSummary.coveragePct),
      deltaVsBaselineChange: diffMetric(variantCandidateSummary.deltaVsBaseline, currentCandidateSummary.deltaVsBaseline),
    },
    improvedPlayers,
    worsenedPlayers,
    unchangedPlayers,
    playerImpacts,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const playerMetaMap = await loadPlayerMetaMap(rows);
  const summaries = summarizeRows(rows, playerMetaMap);
  const { preparedRows, currentProfiles, currentOverall } = prepareRows(rows, summaries);

  const rules = buildRuleGrid();
  const ruleResults = rules.map((rule) =>
    evaluateRule(rule, preparedRows, currentProfiles, currentOverall, args.minStablePlayerSamples),
  );

  const generalizedPositiveRules = ruleResults
    .filter((result) => result.candidatePlayers >= 2 && result.candidatePlayers <= 10)
    .filter((result) => result.stableCandidatePlayers >= 2)
    .filter((result) => (result.overallVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) > 0)
    .filter((result) => (result.overallVsCurrent.qualifiedAccuracyChange ?? Number.NEGATIVE_INFINITY) >= 0)
    .filter((result) => result.improvedPlayers > result.worsenedPlayers)
    .sort((left, right) => {
      return (
        (right.overallVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.overallVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        (right.candidateVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.candidateVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        (right.improvedPlayers - left.improvedPlayers) ||
        (left.worsenedPlayers - right.worsenedPlayers) ||
        left.key.localeCompare(right.key)
      );
    });

  const clintBestRules = ruleResults
    .filter((result) => result.clintIncluded)
    .filter((result) => (result.playerImpacts.find((impact) => impact.playerName.toLowerCase() === "clint capela")?.blendedAccuracyChange ?? 0) > 0)
    .sort((left, right) => {
      const rightClint =
        right.playerImpacts.find((impact) => impact.playerName.toLowerCase() === "clint capela")?.blendedAccuracyChange ??
        Number.NEGATIVE_INFINITY;
      const leftClint =
        left.playerImpacts.find((impact) => impact.playerName.toLowerCase() === "clint capela")?.blendedAccuracyChange ??
        Number.NEGATIVE_INFINITY;
      return (
        rightClint - leftClint ||
        (right.overallVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) -
          (left.overallVsCurrent.blendedAccuracyChange ?? Number.NEGATIVE_INFINITY) ||
        left.key.localeCompare(right.key)
      );
    });

  const comboFamilyLeaders = generalizedPositiveRules.filter((result) => result.markets.includes("PA")).slice(0, args.top);

  const output = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(args.input),
    from: payload.from,
    to: payload.to,
    filters: {
      minActualMinutes: args.minActualMinutes,
      minStablePlayerSamples: args.minStablePlayerSamples,
    },
    currentOverall,
    currentBenchTraditionalBigPlayers: [...currentProfiles.values()]
      .filter((profile) => profile.dominantArchetype === BENCH_TRADITIONAL_BIG)
      .map((profile) => ({
        playerId: profile.summary.playerId,
        playerName: profile.summary.playerName,
        samples: profile.currentOverall.samples,
        avgExpectedMinutes: profile.summary.avgExpectedMinutes,
        avgStarterRate: profile.summary.avgStarterRate,
        ptsProjectionAvg: profile.summary.ptsProjectionAvg,
        rebProjectionAvg: profile.summary.rebProjectionAvg,
        threesProjectionAvg: profile.summary.threesProjectionAvg,
        blendedAccuracy: profile.currentOverall.blendedAccuracy,
        deltaVsBaseline: profile.currentOverall.deltaVsBaseline,
      }))
      .sort((left, right) => right.samples - left.samples || left.playerName.localeCompare(right.playerName)),
    generalizedPositiveRules: generalizedPositiveRules.slice(0, args.top),
    comboFamilyLeaders,
    clintBestRules: clintBestRules.slice(0, args.top),
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
