import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPrecisionPick,
  buildShadowPrecisionRuleSet,
  comparePrecisionSignals,
  computeCoreThreeExpansionCalibration,
  computeCoreThreeExpansionSelectionScore,
  computeCoreThreeExpansionThreesV3SelectionScore,
  CORE_THREE_EXPANSION_V1,
  getCoreThreeExpansionPenalty,
  getThreesShadowV3VetoReason,
  type CoreThreeExpansionPenaltyBreakdown,
  type PrecisionMode,
  type PrecisionShadowMarketKey,
  type PrecisionShadowRejectionReason,
  type PrecisionRuleSet,
  type ShadowConfig,
} from "../lib/snapshot/precisionPickSystem";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { attachCurrentLineRecencyMetrics } from "../lib/snapshot/currentLineRecency";
import { round } from "../lib/utils";
import { loadPlayerMetaWithCache } from "./utils/playerMetaCache";

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
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
  l5CurrentLineDeltaAvg?: number | null;
  l5CurrentLineOverRate?: number | null;
  l5MinutesAvg?: number | null;
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
  position: string | null;
  avgExpectedMinutes: number | null;
  avgStarterRate: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistProjection: number | null;
  threesProjection: number | null;
};

type GameContext = {
  gameKey: string;
  teamKey: string;
  opponentTeamKey: string | null;
};

type CalibrationRecord = {
  market: PrecisionShadowMarketKey;
  probability: number;
  correct: boolean;
  gameDateEt: string;
};

type ShadowCandidateBase = {
  row: TrainingRow;
  signal: NonNullable<ReturnType<typeof buildPrecisionPick>>;
  gameKey: string;
  teamKey: string;
  opponentTeamKey: string | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  starterRateLast10: number | null;
};

type GatedCandidate = ShadowCandidateBase & {
  market: PrecisionShadowMarketKey;
  rawProbability: number;
};

type EnrichedCandidate = GatedCandidate & {
  plattProb: number;
  isotonicProb: number;
  calibratedProb: number;
  penalty: CoreThreeExpansionPenaltyBreakdown;
  selectionScore: number;
  exceptionSelected?: boolean;
};

type CandidateRejection = {
  date: string;
  playerId: string;
  playerName: string;
  market: PrecisionShadowMarketKey;
  reason: PrecisionShadowRejectionReason;
  reasons: PrecisionShadowRejectionReason[];
};

type ScoreDecile = {
  decile: number;
  picks: number;
  correct: number;
  accuracyPct: number | null;
  minScore: number | null;
  maxScore: number | null;
};

type SummaryStats = {
  picks: number;
  correct: number;
  accuracyPct: number | null;
  picksPerDay: number;
  coveragePct: number;
};

type MarketBreakdown = Record<
  string,
  {
    picks: number;
    correct: number;
    accuracyPct: number | null;
  }
>;

type SideBreakdown = Record<
  PrecisionShadowMarketKey,
  {
    OVER: { picks: number; correct: number; accuracyPct: number | null };
    UNDER: { picks: number; correct: number; accuracyPct: number | null };
  }
>;

type CalibrationBundleSummary = {
  market: PrecisionShadowMarketKey;
  version: string;
  calibrationMinSamples: number;
  historySamplesSeen: number;
};

type Output = {
  generatedAt: string;
  mode: PrecisionMode;
  configVersion: string;
  input: string;
  from: string;
  to: string;
  config: ShadowConfig;
  calibrationBundles: CalibrationBundleSummary[];
  overall: {
    gated: SummaryStats;
    calibrated: SummaryStats;
    selected: SummaryStats;
  };
  byMarket: {
    gated: MarketBreakdown;
    selected: MarketBreakdown;
  };
  overUnderByMarket: SideBreakdown;
  scoreDeciles: {
    gated: ScoreDecile[];
    selected: ScoreDecile[];
  };
  rejectionReasonsByMarket: Record<string, Record<PrecisionShadowRejectionReason, number>>;
  selectedVsGatedDeltaByMarket: Record<
    string,
    {
      gatedAccuracyPct: number | null;
      selectedAccuracyPct: number | null;
      deltaPct: number | null;
      gatedPicks: number;
      selectedPicks: number;
    }
  >;
  portfolioDiagnostics: {
    maxPerPlayer: number;
    maxPerGame: number;
    maxPerMarket: number;
    targetPicks: number;
    minimumPicks: number;
    exceptionPickCount: number;
    exceptionPickAccuracyPct: number | null;
    normalPickAccuracyPct: number | null;
    dailyPickCounts: Array<{ date: string; picks: number }>;
    shortfallDays: number;
  };
  selectedPicks: Array<{
    gameDateEt: string;
    playerId: string;
    playerName: string;
    market: PrecisionShadowMarketKey;
    side: Side;
    actualSide: Side;
    selectionScore: number;
    calibratedProb: number;
    plattProb: number;
    isotonicProb: number;
    projectionPriceEdge: number | null;
    bucketRecentAccuracy: number | null;
    leafAccuracy: number | null;
    absLineGap: number | null;
    expectedMinutes: number | null;
    minutesVolatility: number | null;
    starterRateLast10: number | null;
    exceptionSelected: boolean;
  }>;
};

type Args = {
  input: string;
  out: string;
  metricsOut: string;
  minActualMinutes: number;
};

const prisma = new PrismaClient();
const MODE: PrecisionMode = "core_three_expansion_shadow";
const CONFIG_VERSION = "2026-03-31-core-three-expansion-v3-threes-simple-under";
const CALIBRATION_VERSION = "2026-03-31-core-three-expansion-market-calibration-v3";
const CORE_THREE_MARKETS = new Set<PrecisionShadowMarketKey>(["REB", "THREES", "PA"]);
const MARKET_CALIBRATION_MIN_SAMPLES: Record<PrecisionShadowMarketKey, number> = {
  PTS: 20,
  REB: 20,
  AST: 15,
  THREES: 20,
  PA: 8,
  PRA: 15,
  PR: 15,
  RA: 20,
};

function resolveDefaultInputPath(): string {
  try {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  } catch {
    return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
  }
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "precision-card-core-three-expansion-v3.json");
  let metricsOut = path.join("exports", "precision-card-core-three-expansion-v3-metrics.json");
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
    if (token === "--metrics-out" && next) {
      metricsOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--metrics-out=")) {
      metricsOut = token.slice("--metrics-out=".length);
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
    }
  }

  return { input, out, metricsOut, minActualMinutes };
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function clip(value: number, min = 0.001, max = 0.999): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function logit(value: number): number {
  const clipped = clip(value);
  return Math.log(clipped / (1 - clipped));
}

function fitPlatt(records: CalibrationRecord[]): ((probability: number) => number) | null {
  if (!records.length) return null;
  const positives = records.filter((record) => record.correct).length;
  if (positives === 0 || positives === records.length) {
    const constant = positives === records.length ? 0.99 : 0.01;
    return () => constant;
  }

  let a = 1;
  let b = 0;
  const samples = records.map((record) => ({
    x: logit(record.probability),
    y: record.correct ? 1 : 0,
  }));

  for (let index = 0; index < 250; index += 1) {
    let gradA = 0;
    let gradB = 0;
    for (const sample of samples) {
      const prediction = sigmoid(a * sample.x + b);
      const error = prediction - sample.y;
      gradA += error * sample.x;
      gradB += error;
    }
    gradA = gradA / samples.length + 0.001 * a;
    gradB /= samples.length;
    a -= 0.05 * gradA;
    b -= 0.05 * gradB;
  }

  return (probability: number) => clip(sigmoid(a * logit(probability) + b));
}

function fitIsotonic(records: CalibrationRecord[]): ((probability: number) => number) | null {
  if (!records.length) return null;

  const sorted = [...records]
    .map((record) => ({ probability: clip(record.probability), value: record.correct ? 1 : 0 }))
    .sort((left, right) => left.probability - right.probability);

  type Block = { sum: number; weight: number; max: number };
  const blocks: Block[] = [];

  for (const item of sorted) {
    blocks.push({ sum: item.value, weight: 1, max: item.probability });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.sum / left.weight <= right.sum / right.weight) break;
      blocks.splice(blocks.length - 2, 2, {
        sum: left.sum + right.sum,
        weight: left.weight + right.weight,
        max: right.max,
      });
    }
  }

  const thresholds: Array<{ max: number; value: number }> = [];
  for (const block of blocks) {
    thresholds.push({
      max: block.max,
      value: clip(block.sum / block.weight),
    });
  }

  return (probability: number) => {
    const clipped = clip(probability);
    for (const threshold of thresholds) {
      if (clipped <= threshold.max) return threshold.value;
    }
    return thresholds[thresholds.length - 1]?.value ?? clipped;
  };
}

async function loadPlayerMetaMap(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
  const cached = await loadPlayerMetaWithCache({
    rows: playerIds.map((playerId) => ({ playerId })),
    fetcher: async (ids) =>
      (
        await prisma.player.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            position: true,
          },
        })
      ).map((row) => ({ ...row, fullName: null })),
  });

  return new Map([...cached.entries()].map(([id, meta]) => [id, { id, position: meta.position }]));
}

async function loadGameContextMap(rows: TrainingRow[]): Promise<Map<string, GameContext>> {
  const playerIds = [...new Set(rows.map((row) => row.playerId))];
  const dates = [...new Set(rows.map((row) => row.gameDateEt))];
  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { in: dates },
    },
    select: {
      playerId: true,
      gameDateEt: true,
      externalGameId: true,
      teamId: true,
      opponentTeamId: true,
    },
  });

  const map = new Map<string, GameContext>();
  logs.forEach((log) => {
    map.set(`${log.playerId}|${log.gameDateEt}`, {
      gameKey: log.externalGameId,
      teamKey: log.teamId ?? `team:${log.playerId}`,
      opponentTeamKey: log.opponentTeamId ?? null,
    });
  });

  return map;
}

function summarizeRows(rows: TrainingRow[], playerMetaMap: Map<string, PlayerMeta>): Map<string, PlayerSummary> {
  const byPlayer = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId) ?? [];
    bucket.push(row);
    byPlayer.set(row.playerId, bucket);
  });

  const summaries = new Map<string, PlayerSummary>();
  byPlayer.forEach((playerRows, playerId) => {
    summaries.set(playerId, {
      position: playerMetaMap.get(playerId)?.position ?? null,
      avgExpectedMinutes: mean(playerRows.map((row) => row.expectedMinutes)),
      avgStarterRate: mean(playerRows.map((row) => row.starterRateLast10)),
      pointsProjection: mean(playerRows.map((row) => row.pointsProjection)),
      reboundsProjection: mean(playerRows.map((row) => row.reboundsProjection)),
      assistProjection: mean(playerRows.map((row) => row.assistProjection)),
      threesProjection: mean(playerRows.map((row) => row.threesProjection)),
    });
  });

  return summaries;
}

function getShadowRejectionReason(
  market: Market,
  signal: ReturnType<typeof buildPrecisionPick>,
): CandidateRejection["reason"] {
  if (!CORE_THREE_MARKETS.has(market as PrecisionShadowMarketKey)) return "unsupported_market";
  const reason = signal?.reasons?.[0] ?? "";
  if (reason.includes("Bucket recent accuracy")) return "bucket_recent_accuracy";
  if (reason.includes("Tree leaf accuracy")) return "leaf_accuracy";
  if (reason.includes("Projection gap")) return "abs_line_gap";
  if (reason.includes("Projection win probability")) return "projection_win_probability";
  if (reason.includes("Projection price edge")) return "projection_price_edge";
  return "below_minimum_score";
}

function buildShadowCandidate(
  row: TrainingRow,
  ruleSet: PrecisionRuleSet,
  summary: PlayerSummary | null,
  gameContext: GameContext | null,
): { candidate: GatedCandidate | null; rejection: CandidateRejection | null } {
  if (!CORE_THREE_MARKETS.has(row.market as PrecisionShadowMarketKey)) {
    return {
      candidate: null,
      rejection: {
        date: row.gameDateEt,
        playerId: row.playerId,
        playerName: row.playerName,
        market: row.market as PrecisionShadowMarketKey,
        reason: "unsupported_market",
        reasons: ["unsupported_market"],
      },
    };
  }

  const signal = buildPrecisionPick(
    {
      playerId: row.playerId,
      gameDateEt: row.gameDateEt,
      market: row.market,
      projectedValue: row.projectedValue,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      finalSide: row.finalSide,
      l5CurrentLineDeltaAvg: row.l5CurrentLineDeltaAvg ?? null,
      l5CurrentLineOverRate: row.l5CurrentLineOverRate ?? null,
      l5MinutesAvg: row.l5MinutesAvg ?? null,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      benchBigRoleStability: row.benchBigRoleStability ?? null,
      starterRateLast10: row.starterRateLast10,
      archetypeExpectedMinutes: summary?.avgExpectedMinutes ?? null,
      archetypeStarterRateLast10: summary?.avgStarterRate ?? null,
      openingTeamSpread: row.openingTeamSpread,
      openingTotal: row.openingTotal,
      lineupTimingConfidence: row.lineupTimingConfidence,
      completenessScore: row.completenessScore,
      playerPosition: summary?.position ?? null,
      pointsProjection: row.pointsProjection ?? summary?.pointsProjection ?? null,
      reboundsProjection: row.reboundsProjection ?? summary?.reboundsProjection ?? null,
      assistProjection: row.assistProjection ?? summary?.assistProjection ?? null,
      threesProjection: row.threesProjection ?? summary?.threesProjection ?? null,
    },
    ruleSet,
  );

  if (!signal?.qualified || signal.side === "NEUTRAL" || signal.projectionWinProbability == null) {
    const mapped = getShadowRejectionReason(row.market, signal);
    return {
      candidate: null,
      rejection: {
        date: row.gameDateEt,
        playerId: row.playerId,
        playerName: row.playerName,
        market: row.market as PrecisionShadowMarketKey,
        reason: mapped,
        reasons: [mapped],
      },
    };
  }

  return {
    candidate: {
      row,
      signal,
      market: row.market as PrecisionShadowMarketKey,
      rawProbability: signal.projectionWinProbability,
      gameKey: gameContext?.gameKey ?? `${row.gameDateEt}|${row.playerId}`,
      teamKey: gameContext?.teamKey ?? `team:${row.playerId}`,
      opponentTeamKey: gameContext?.opponentTeamKey ?? null,
      expectedMinutes: row.expectedMinutes,
      minutesVolatility: row.minutesVolatility,
      starterRateLast10: row.starterRateLast10,
    },
    rejection: null,
  };
}

function buildSummary(
  rows: TrainingRow[],
  picks: Array<GatedCandidate | EnrichedCandidate>,
): SummaryStats {
  const correct = picks.filter((pick) => pick.row.actualSide === pick.signal.side).length;
  const uniqueDates = new Set(rows.map((row) => row.gameDateEt));
  return {
    picks: picks.length,
    correct,
    accuracyPct: picks.length > 0 ? round((correct / picks.length) * 100, 2) : null,
    picksPerDay: uniqueDates.size > 0 ? round(picks.length / uniqueDates.size, 2) : 0,
    coveragePct: rows.length > 0 ? round((picks.length / rows.length) * 100, 2) : 0,
  };
}

function buildMarketBreakdown(
  picks: Array<GatedCandidate | EnrichedCandidate>,
): MarketBreakdown {
  const byMarket = new Map<string, { picks: number; correct: number }>();
  picks.forEach((pick) => {
    const bucket = byMarket.get(pick.market) ?? { picks: 0, correct: 0 };
    bucket.picks += 1;
    if (pick.row.actualSide === pick.signal.side) {
      bucket.correct += 1;
    }
    byMarket.set(pick.market, bucket);
  });

  return Object.fromEntries(
    [...byMarket.entries()].map(([market, stats]) => [
      market,
      {
        picks: stats.picks,
        correct: stats.correct,
        accuracyPct: stats.picks > 0 ? round((stats.correct / stats.picks) * 100, 2) : null,
      },
    ]),
  );
}

function buildOverUnderBreakdown(selected: EnrichedCandidate[]): SideBreakdown {
  const initBucket = () => ({
    OVER: { picks: 0, correct: 0, accuracyPct: null as number | null },
    UNDER: { picks: 0, correct: 0, accuracyPct: null as number | null },
  });

  const byMarket = {
    PTS: initBucket(),
    REB: initBucket(),
    AST: initBucket(),
    THREES: initBucket(),
    PA: initBucket(),
    PRA: initBucket(),
    PR: initBucket(),
    RA: initBucket(),
  } satisfies SideBreakdown;

  selected.forEach((pick) => {
    const sideBucket = byMarket[pick.market][pick.signal.side as Side];
    sideBucket.picks += 1;
    if (pick.row.actualSide === pick.signal.side) {
      sideBucket.correct += 1;
    }
  });

  (Object.keys(byMarket) as PrecisionShadowMarketKey[]).forEach((market) => {
    (["OVER", "UNDER"] as const).forEach((side) => {
      const bucket = byMarket[market][side];
      bucket.accuracyPct = bucket.picks > 0 ? round((bucket.correct / bucket.picks) * 100, 2) : null;
    });
  });

  return byMarket;
}

function buildScoreDeciles(
  picks: Array<EnrichedCandidate>,
): ScoreDecile[] {
  if (!picks.length) return [];
  const sorted = [...picks].sort((left, right) => right.selectionScore - left.selectionScore);
  const bucketSize = Math.max(1, Math.ceil(sorted.length / 10));
  const deciles: ScoreDecile[] = [];

  for (let index = 0; index < sorted.length; index += bucketSize) {
    const bucket = sorted.slice(index, index + bucketSize);
    const correct = bucket.filter((pick) => pick.row.actualSide === pick.signal.side).length;
    deciles.push({
      decile: deciles.length + 1,
      picks: bucket.length,
      correct,
      accuracyPct: bucket.length > 0 ? round((correct / bucket.length) * 100, 2) : null,
      minScore: bucket.length > 0 ? round(Math.min(...bucket.map((pick) => pick.selectionScore)), 4) : null,
      maxScore: bucket.length > 0 ? round(Math.max(...bucket.map((pick) => pick.selectionScore)), 4) : null,
    });
  }

  return deciles;
}

function canUseOppositeTeamException(
  candidate: EnrichedCandidate,
  existingGamePicks: EnrichedCandidate[],
  config: ShadowConfig,
): boolean {
  if (existingGamePicks.length !== 1) return false;
  const first = existingGamePicks[0];
  const oppositeTeam = first.teamKey !== candidate.teamKey;
  const closeEnough = Math.abs(first.selectionScore - candidate.selectionScore) <= config.oppositeTeamGameExceptionDelta;
  return oppositeTeam && closeEnough;
}

function buildSelectedVsGatedDelta(
  gated: MarketBreakdown,
  selected: MarketBreakdown,
): Output["selectedVsGatedDeltaByMarket"] {
  const markets = new Set([...Object.keys(gated), ...Object.keys(selected)]);
  return Object.fromEntries(
    [...markets].map((market) => {
      const gatedStats = gated[market] ?? { picks: 0, correct: 0, accuracyPct: null };
      const selectedStats = selected[market] ?? { picks: 0, correct: 0, accuracyPct: null };
      return [
        market,
        {
          gatedAccuracyPct: gatedStats.accuracyPct,
          selectedAccuracyPct: selectedStats.accuracyPct,
          deltaPct:
            gatedStats.accuracyPct != null && selectedStats.accuracyPct != null
              ? round(selectedStats.accuracyPct - gatedStats.accuracyPct, 2)
              : null,
          gatedPicks: gatedStats.picks,
          selectedPicks: selectedStats.picks,
        },
      ];
    }),
  );
}

function emptyRejectionMatrix(): Record<string, Record<PrecisionShadowRejectionReason, number>> {
  const empty = {
    unsupported_market: 0,
    bucket_recent_accuracy: 0,
    leaf_accuracy: 0,
    abs_line_gap: 0,
    projection_win_probability: 0,
    projection_price_edge: 0,
    missing_calibration: 0,
    threes_over_side: 0,
    threes_starter_high: 0,
    threes_expected_minutes: 0,
    threes_minutes_volatility: 0,
    threes_starter_rate: 0,
    threes_calibration_disagreement: 0,
    portfolio_player_cap: 0,
    portfolio_game_cap: 0,
    portfolio_market_cap: 0,
    below_minimum_score: 0,
  } satisfies Record<PrecisionShadowRejectionReason, number>;

  return {
    REB: { ...empty },
    THREES: { ...empty },
    PA: { ...empty },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8")) as BacktestRowsFile;
  const rows = attachCurrentLineRecencyMetrics(
    payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes),
  );
  const playerMetaMap = await loadPlayerMetaMap([...new Set(rows.map((row) => row.playerId))]);
  const summaries = summarizeRows(rows, playerMetaMap);
  const gameContextMap = await loadGameContextMap(rows);
  const ruleSet = buildShadowPrecisionRuleSet(CORE_THREE_EXPANSION_V1);

  const byDate = new Map<string, TrainingRow[]>();
  rows.forEach((row) => {
    const bucket = byDate.get(row.gameDateEt) ?? [];
    bucket.push(row);
    byDate.set(row.gameDateEt, bucket);
  });

  const historyByMarket = new Map<PrecisionShadowMarketKey, CalibrationRecord[]>();
  const gatedCandidates: GatedCandidate[] = [];
  const calibratedCandidates: EnrichedCandidate[] = [];
  const selectedCandidates: EnrichedCandidate[] = [];
  const rejections: CandidateRejection[] = [];
  const dailyPickCounts: Array<{ date: string; picks: number }> = [];

  const dates = [...new Set(rows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));

  for (const date of dates) {
    const rowsForDate = byDate.get(date) ?? [];
    const gatedForDate: GatedCandidate[] = [];

    rowsForDate.forEach((row) => {
      if (!CORE_THREE_MARKETS.has(row.market as PrecisionShadowMarketKey)) return;
      const summary = summaries.get(row.playerId) ?? null;
      const gameContext = gameContextMap.get(`${row.playerId}|${row.gameDateEt}`) ?? null;
      const { candidate, rejection } = buildShadowCandidate(row, ruleSet, summary, gameContext);
      if (candidate) {
        gatedForDate.push(candidate);
      } else if (rejection) {
        rejections.push(rejection);
      }
    });

    gatedCandidates.push(...gatedForDate);

    const enrichedForDate: EnrichedCandidate[] = [];
    for (const candidate of gatedForDate) {
      const history = historyByMarket.get(candidate.market) ?? [];
      const minSamples = MARKET_CALIBRATION_MIN_SAMPLES[candidate.market];
      if (history.length < minSamples) {
        rejections.push({
          date,
          playerId: candidate.row.playerId,
          playerName: candidate.row.playerName,
          market: candidate.market,
          reason: "missing_calibration",
          reasons: ["missing_calibration"],
        });
        continue;
      }

      const platt = fitPlatt(history);
      const isotonic = fitIsotonic(history);
      if (!platt || !isotonic) {
        rejections.push({
          date,
          playerId: candidate.row.playerId,
          playerName: candidate.row.playerName,
          market: candidate.market,
          reason: "missing_calibration",
          reasons: ["missing_calibration"],
        });
        continue;
      }

      const calibration = computeCoreThreeExpansionCalibration(
        round(platt(candidate.rawProbability), 4),
        round(isotonic(candidate.rawProbability), 4),
      );
      const isThrees = candidate.market === "THREES";
      if (candidate.market === "THREES") {
        const vetoReason = getThreesShadowV3VetoReason({
          side: candidate.signal.side,
          starterRateLast10: candidate.starterRateLast10,
        });
        if (vetoReason) {
          rejections.push({
            date,
            playerId: candidate.row.playerId,
            playerName: candidate.row.playerName,
            market: candidate.market,
            reason: vetoReason,
            reasons: [vetoReason],
          });
          continue;
        }
      }
      const penalty = isThrees
        ? {
            volatilityPenalty: 0,
            rolePenalty: 0,
            totalPenalty: 0,
          }
        : getCoreThreeExpansionPenalty(candidate.market, {
            expectedMinutes: candidate.expectedMinutes,
            minutesVolatility: candidate.minutesVolatility,
            starterRateLast10: candidate.starterRateLast10,
          });
      const selectionScore = round(
        isThrees
          ? computeCoreThreeExpansionThreesV3SelectionScore({
              leafAccuracy: candidate.signal.leafAccuracy,
              absLineGap: candidate.signal.absLineGap,
              isotonicProb: calibration.isotonicProb,
            })
          : computeCoreThreeExpansionSelectionScore({
              market: candidate.market,
              ...calibration,
              projectionPriceEdge: candidate.signal.projectionPriceEdge ?? null,
              volatilityPenalty: penalty.volatilityPenalty,
              rolePenalty: penalty.rolePenalty,
            }),
        4,
      );

      enrichedForDate.push({
        ...candidate,
        ...calibration,
        penalty,
        selectionScore,
      });
    }

    calibratedCandidates.push(...enrichedForDate);

    const ranked = [...enrichedForDate].sort(
      (left, right) =>
        right.selectionScore - left.selectionScore ||
        right.calibratedProb - left.calibratedProb ||
        comparePrecisionSignals(left.signal, right.signal),
    );

    const usedPlayers = new Map<string, number>();
    const marketCounts = new Map<PrecisionShadowMarketKey, number>();
    const gameToPicks = new Map<string, EnrichedCandidate[]>();
    const selectedForDate: EnrichedCandidate[] = [];

    for (const candidate of ranked) {
      const playerCount = usedPlayers.get(candidate.row.playerId) ?? 0;
      if (playerCount >= CORE_THREE_EXPANSION_V1.maxPerPlayer) {
        rejections.push({
          date,
          playerId: candidate.row.playerId,
          playerName: candidate.row.playerName,
          market: candidate.market,
          reason: "portfolio_player_cap",
          reasons: ["portfolio_player_cap"],
        });
        continue;
      }

      const currentMarketCount = marketCounts.get(candidate.market) ?? 0;
      if (currentMarketCount >= CORE_THREE_EXPANSION_V1.maxPerMarket) {
        rejections.push({
          date,
          playerId: candidate.row.playerId,
          playerName: candidate.row.playerName,
          market: candidate.market,
          reason: "portfolio_market_cap",
          reasons: ["portfolio_market_cap"],
        });
        continue;
      }

      const existingGamePicks = gameToPicks.get(candidate.gameKey) ?? [];
      let exceptionSelected = false;
      if (existingGamePicks.length >= CORE_THREE_EXPANSION_V1.maxPerGame) {
        if (canUseOppositeTeamException(candidate, existingGamePicks, CORE_THREE_EXPANSION_V1)) {
          exceptionSelected = true;
        } else {
          rejections.push({
            date,
            playerId: candidate.row.playerId,
            playerName: candidate.row.playerName,
            market: candidate.market,
            reason: "portfolio_game_cap",
            reasons: ["portfolio_game_cap"],
          });
          continue;
        }
      }

      selectedForDate.push({
        ...candidate,
        exceptionSelected,
      });
      usedPlayers.set(candidate.row.playerId, playerCount + 1);
      marketCounts.set(candidate.market, currentMarketCount + 1);
      gameToPicks.set(candidate.gameKey, [...existingGamePicks, candidate]);

      if (selectedForDate.length >= CORE_THREE_EXPANSION_V1.targetPicks) {
        break;
      }
    }

    dailyPickCounts.push({ date, picks: selectedForDate.length });
    selectedCandidates.push(...selectedForDate);

    gatedForDate.forEach((candidate) => {
      const history = historyByMarket.get(candidate.market) ?? [];
      history.push({
        market: candidate.market,
        probability: candidate.rawProbability,
        correct: candidate.row.actualSide === candidate.signal.side,
        gameDateEt: candidate.row.gameDateEt,
      });
      historyByMarket.set(candidate.market, history);
    });
  }

  const gatedSummary = buildSummary(rows, gatedCandidates);
  const calibratedSummary = buildSummary(rows, calibratedCandidates);
  const selectedSummary = buildSummary(rows, selectedCandidates);
  const gatedBreakdown = buildMarketBreakdown(gatedCandidates);
  const selectedBreakdown = buildMarketBreakdown(selectedCandidates);
  const rejectionMatrix = emptyRejectionMatrix();

  rejections.forEach((rejection) => {
    const marketBucket = rejectionMatrix[rejection.market];
    if (!marketBucket) return;
    marketBucket[rejection.reason] += 1;
  });

  const exceptionPicks = selectedCandidates.filter((candidate) => candidate.exceptionSelected);
  const exceptionCorrect = exceptionPicks.filter((candidate) => candidate.row.actualSide === candidate.signal.side).length;
  const normalPicks = selectedCandidates.filter((candidate) => !candidate.exceptionSelected);
  const normalCorrect = normalPicks.filter((candidate) => candidate.row.actualSide === candidate.signal.side).length;

  const output: Output = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    configVersion: CONFIG_VERSION,
    input: args.input,
    from: payload.from,
    to: payload.to,
    config: CORE_THREE_EXPANSION_V1,
    calibrationBundles: (["REB", "THREES", "PA"] as const).map((market) => ({
      market,
      version: CALIBRATION_VERSION,
      calibrationMinSamples: MARKET_CALIBRATION_MIN_SAMPLES[market],
      historySamplesSeen: historyByMarket.get(market)?.length ?? 0,
    })),
    overall: {
      gated: gatedSummary,
      calibrated: calibratedSummary,
      selected: selectedSummary,
    },
    byMarket: {
      gated: gatedBreakdown,
      selected: selectedBreakdown,
    },
    overUnderByMarket: buildOverUnderBreakdown(selectedCandidates),
    scoreDeciles: {
      gated: buildScoreDeciles(calibratedCandidates),
      selected: buildScoreDeciles(selectedCandidates),
    },
    rejectionReasonsByMarket: rejectionMatrix,
    selectedVsGatedDeltaByMarket: buildSelectedVsGatedDelta(gatedBreakdown, selectedBreakdown),
    portfolioDiagnostics: {
      maxPerPlayer: CORE_THREE_EXPANSION_V1.maxPerPlayer,
      maxPerGame: CORE_THREE_EXPANSION_V1.maxPerGame,
      maxPerMarket: CORE_THREE_EXPANSION_V1.maxPerMarket,
      targetPicks: CORE_THREE_EXPANSION_V1.targetPicks,
      minimumPicks: CORE_THREE_EXPANSION_V1.minimumPicks,
      exceptionPickCount: exceptionPicks.length,
      exceptionPickAccuracyPct: exceptionPicks.length > 0 ? round((exceptionCorrect / exceptionPicks.length) * 100, 2) : null,
      normalPickAccuracyPct: normalPicks.length > 0 ? round((normalCorrect / normalPicks.length) * 100, 2) : null,
      dailyPickCounts,
      shortfallDays: dailyPickCounts.filter((entry) => entry.picks < CORE_THREE_EXPANSION_V1.minimumPicks).length,
    },
    selectedPicks: selectedCandidates.map((pick) => ({
      gameDateEt: pick.row.gameDateEt,
      playerId: pick.row.playerId,
      playerName: pick.row.playerName,
      market: pick.market,
      side: pick.signal.side as Side,
      actualSide: pick.row.actualSide,
      selectionScore: pick.selectionScore,
      calibratedProb: pick.calibratedProb,
      plattProb: pick.plattProb,
      isotonicProb: pick.isotonicProb,
      projectionPriceEdge: pick.signal.projectionPriceEdge ?? null,
      bucketRecentAccuracy: pick.signal.bucketRecentAccuracy,
      leafAccuracy: pick.signal.leafAccuracy,
      absLineGap: pick.signal.absLineGap,
      expectedMinutes: pick.expectedMinutes,
      minutesVolatility: pick.minutesVolatility,
      starterRateLast10: pick.starterRateLast10,
      exceptionSelected: pick.exceptionSelected ?? false,
    })),
  };

  const metricsOutput = {
    generatedAt: output.generatedAt,
    mode: output.mode,
    configVersion: output.configVersion,
    selected: output.overall.selected,
    byMarket: output.byMarket.selected,
    selectedVsGatedDeltaByMarket: output.selectedVsGatedDeltaByMarket,
    portfolioDiagnostics: output.portfolioDiagnostics,
  };

  const outPath = path.resolve(args.out);
  const metricsPath = path.resolve(args.metricsOut);
  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(path.dirname(metricsPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(metricsPath, `${JSON.stringify(metricsOutput, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(metricsOutput, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
