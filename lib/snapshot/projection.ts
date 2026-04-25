import { round } from "@/lib/utils";
import type { SnapshotMarket, SnapshotMetricRecord } from "@/lib/types/snapshot";
import {
  applyPairwiseTeammateSynergyAdjustments,
  type PairwiseTeammateSynergyInput,
} from "@/lib/snapshot/pairwiseTeammateSynergy";

export const SNAPSHOT_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

type PersonalMarketModel = {
  slope: number;
  intercept: number;
  confidence: number;
  samples: number;
  mae: number;
};

export type PlayerPersonalModels = Record<SnapshotMarket, PersonalMarketModel | null>;

type MarketProjectionConfig = {
  alpha: number;
  weights: {
    ewma: number;
    last3: number;
    last10: number;
    season: number;
    homeAway: number;
    opponentAllowance: number;
  };
  minuteImpact: number;
  minuteCap: number;
  opponentDeltaImpact: number;
  opponentCap: number;
  trendImpact: number;
  trendCap: number;
};

const CONFIG_BY_MARKET: Record<SnapshotMarket, MarketProjectionConfig> = {
  PTS: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 3.6,
    opponentDeltaImpact: 0.2,
    opponentCap: 2.8,
    trendImpact: 0.24,
    trendCap: 2.6,
  },
  REB: {
    alpha: 0.39,
    weights: { ewma: 0.2, last3: 0.14, last10: 0.34, season: 0.22, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.62,
    minuteCap: 2.4,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.8,
    trendImpact: 0.2,
    trendCap: 1.8,
  },
  AST: {
    alpha: 0.42,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.68,
    minuteCap: 2.3,
    opponentDeltaImpact: 0.17,
    opponentCap: 1.9,
    trendImpact: 0.21,
    trendCap: 1.9,
  },
  THREES: {
    alpha: 0.5,
    weights: { ewma: 0.31, last3: 0.2, last10: 0.24, season: 0.15, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.58,
    minuteCap: 1.4,
    opponentDeltaImpact: 0.12,
    opponentCap: 1.0,
    trendImpact: 0.19,
    trendCap: 1.1,
  },
  PRA: {
    alpha: 0.43,
    weights: { ewma: 0.23, last3: 0.17, last10: 0.31, season: 0.19, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.72,
    minuteCap: 4.8,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.4,
    trendImpact: 0.24,
    trendCap: 3.4,
  },
  PA: {
    alpha: 0.44,
    weights: { ewma: 0.24, last3: 0.18, last10: 0.3, season: 0.18, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.71,
    minuteCap: 4.2,
    opponentDeltaImpact: 0.2,
    opponentCap: 3.0,
    trendImpact: 0.24,
    trendCap: 3.0,
  },
  PR: {
    alpha: 0.42,
    weights: { ewma: 0.22, last3: 0.16, last10: 0.32, season: 0.2, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.69,
    minuteCap: 4.4,
    opponentDeltaImpact: 0.19,
    opponentCap: 3.1,
    trendImpact: 0.23,
    trendCap: 3.2,
  },
  RA: {
    alpha: 0.4,
    weights: { ewma: 0.21, last3: 0.15, last10: 0.33, season: 0.21, homeAway: 0.06, opponentAllowance: 0.04 },
    minuteImpact: 0.65,
    minuteCap: 2.9,
    opponentDeltaImpact: 0.16,
    opponentCap: 2.0,
    trendImpact: 0.2,
    trendCap: 2.1,
  },
};

const PLAYER_SPECIFIC_MINUTES_THRESHOLD = (() => {
  const parsed = Number(process.env.SNAPSHOT_PLAYER_SPECIFIC_MINUTES_MIN);
  if (!Number.isFinite(parsed) || parsed <= 0) return 15;
  return clamp(Math.floor(parsed), 8, 24);
})();

const PLAYER_SPECIFIC_MODEL_MIN_SAMPLES = (() => {
  const parsed = Number(process.env.SNAPSHOT_PLAYER_MODEL_MIN_SAMPLES);
  if (!Number.isFinite(parsed) || parsed <= 0) return 18;
  return clamp(Math.floor(parsed), 10, 34);
})();

const COMBO_SUM_WEIGHT = (() => {
  const parsed = Number(process.env.SNAPSHOT_COMBO_SUM_WEIGHT);
  if (!Number.isFinite(parsed)) return 0.88;
  return clamp(parsed, 0, 1);
})();

const COMBO_DIRECT_WEIGHT = (() => {
  const parsed = Number(process.env.SNAPSHOT_COMBO_DIRECT_WEIGHT);
  if (!Number.isFinite(parsed)) return 0.12;
  return clamp(parsed, 0, 1);
})();

const SCORE_FIRST_LEAD_GUARD_THREES_FACTOR = (() => {
  const parsed = Number(process.env.SNAPSHOT_SCORE_FIRST_LEAD_GUARD_THREES_FACTOR);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0.85, 1.15);
})();

// 2026-03-17: default-off late-stage scoring penalty for heavy-favorite score-first guards.
const FAVORITE_SCORING_PENALTY_FACTOR = (() => {
  const parsed = Number(process.env.SNAPSHOT_FAVORITE_SCORING_PENALTY_FACTOR);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0.7, 1);
})();

// 2026-03-18: default-off B2B scoring efficiency drag.
// In this stack, consecutive-game fatigue shows up as restDays <= 1.
const B2B_EFFICIENCY_DRAG = (() => {
  const parsed = Number(process.env.SNAPSHOT_B2B_EFFICIENCY_DRAG);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0.85, 1);
})();

// 2026-03-18: only apply B2B scoring drag to true heavy-workload players.
const B2B_MINUTES_THRESHOLD = (() => {
  const parsed = Number(process.env.SNAPSHOT_B2B_MINUTES_THRESHOLD);
  if (!Number.isFinite(parsed)) return 32;
  return clamp(parsed, 24, 40);
})();

// 2026-03-18: default-off asymmetric road tax for vulnerable bench/spot-up roles.
const ROAD_BENCH_DRAG = (() => {
  const parsed = Number(process.env.SNAPSHOT_ROAD_BENCH_DRAG);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0.82, 1);
})();

// 2026-03-18: default-off spot-up-wing road volatility factor.
const SPOTUP_WING_ROAD_VOLATILITY_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_SPOTUP_WING_ROAD_VOLATILITY_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.5);
})();

// 2026-03-16: whole-model game-environment factor using live/historical opening totals.
const OPENING_TOTAL_ENV_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_OPENING_TOTAL_ENV_STRENGTH);
  if (!Number.isFinite(parsed)) return 0.0025;
  return clamp(parsed, -0.01, 0.01);
})();

const OPENING_TOTAL_ENV_BASELINE = (() => {
  const parsed = Number(process.env.SNAPSHOT_OPENING_TOTAL_ENV_BASELINE);
  if (!Number.isFinite(parsed)) return 228;
  return clamp(parsed, 210, 250);
})();

// 2026-03-16: asymmetric spread hooks for big-role game script.
// Promoted winner: favorite-center penalty only.
const FAVORITE_CENTER_PENALTY_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_FAVORITE_CENTER_PENALTY_STRENGTH);
  if (!Number.isFinite(parsed)) return 1;
  return clamp(parsed, 0, 2);
})();

// 2026-03-17: default-off guard blowout penalty sweep for favorite lead guards.
const FAVORITE_GUARD_PENALTY_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_FAVORITE_GUARD_PENALTY_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 2);
})();

const UNDERDOG_BENCH_BIG_BOOST_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_UNDERDOG_BENCH_BIG_BOOST_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 2);
})();

const BIG_ROLE_SPREAD_ABS_THRESHOLD = (() => {
  const parsed = Number(process.env.SNAPSHOT_BIG_ROLE_SPREAD_ABS_THRESHOLD);
  if (!Number.isFinite(parsed)) return 10;
  return clamp(parsed, 6, 18);
})();

// 2026-03-16: whole-model frontcourt rebound-opportunity factor, kept env-gated for fast sweeps.
const BIGMAN_REB_FACTOR_STRENGTH = (() => {
  const parsed = Number(process.env.BIGMAN_REB_FACTOR_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.25);
})();

const BIGMAN_REB_FACTOR_BASELINE = (() => {
  const parsed = Number(process.env.BIGMAN_REB_FACTOR_BASELINE);
  if (!Number.isFinite(parsed)) return 220;
  return clamp(parsed, 210, 250);
})();

// 2026-03-16: whole-model bench-big minutes sensitivity, kept env-gated for sweeps.
const BENCH_BIG_MINUTES_SENSITIVITY = (() => {
  const parsed = Number(process.env.BENCH_BIG_MINUTES_SENSITIVITY);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.25);
})();

const BENCH_BIG_MINUTES_BASELINE = (() => {
  const parsed = Number(process.env.BENCH_BIG_MINUTES_BASELINE);
  if (!Number.isFinite(parsed)) return 220;
  return clamp(parsed, 210, 250);
})();

// 2026-03-16: whole-model role-volatility factor for big roles, kept env-gated for sweeps.
const ROLE_VOLATILITY_STRENGTH = (() => {
  const parsed = Number(process.env.ROLE_VOLATILITY_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.25);
})();

const ROLE_VOLATILITY_BASELINE = (() => {
  const parsed = Number(process.env.ROLE_VOLATILITY_BASELINE);
  if (!Number.isFinite(parsed)) return 4.5;
  return clamp(parsed, 2.5, 8);
})();

// 2026-03-16: pace-adjusted opponent-defense proxy for big roles.
// True oppDefRtg isn't in the snapshot stack, so this uses pace-normalized opponent allowance deltas.
const OPP_DEF_RTG_STRENGTH = (() => {
  const parsed = Number(process.env.OPP_DEF_RTG_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.1);
})();

// 2026-03-16: whole-model injury + teammate-absence minutes multiplier for bigs.
const INJURY_TEAMMATE_MINUTES_STRENGTH = (() => {
  const parsed = Number(process.env.INJURY_TEAMMATE_MINUTES_STRENGTH);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 1.4);
})();

const OPENING_TOTAL_ENV_MARKET_WEIGHT: Record<SnapshotMarket, number> = {
  PTS: 1,
  REB: 0.84,
  AST: 1.06,
  THREES: 1,
  PRA: 1,
  PA: 1.02,
  PR: 0.93,
  RA: 0.92,
};

const BIGMAN_REB_OPPORTUNITY_MARKET_WEIGHT: Partial<Record<SnapshotMarket, number>> = {
  PTS: 0.92,
  REB: 1,
  PRA: 1.06,
  PR: 1.09,
  RA: 1.14,
};

const BENCH_BIG_MINUTES_MARKET_WEIGHT: Partial<Record<SnapshotMarket, number>> = {
  PTS: 0.95,
  REB: 1.08,
  PA: 1.05,
  PRA: 1.04,
  PR: 1.03,
  RA: 1.02,
};

const BIG_ROLE_VOLATILITY_MARKET_WEIGHT: Partial<Record<SnapshotMarket, number>> = {
  PTS: 0.94,
  REB: 1.12,
  PA: 1.06,
  PRA: 1.09,
  PR: 1.15,
  RA: 1.18,
};

const BIG_ROLE_OPP_DEF_MARKET_WEIGHT: Partial<Record<SnapshotMarket, number>> = {
  PTS: 0.96,
  REB: 1.22,
  PA: 1.09,
  PRA: 1.12,
  PR: 1.18,
  RA: 1.28,
};

const BIG_ROLE_OPP_DEF_MARKET_SCALE: Partial<Record<SnapshotMarket, number>> = {
  PTS: 5.5,
  REB: 2.2,
  PA: 5.2,
  PRA: 7.2,
  PR: 5.8,
  RA: 3.0,
};

const BIG_ROLE_INJURY_TEAMMATE_MARKET_WEIGHT: Partial<Record<SnapshotMarket, number>> = {
  PTS: 0.93,
  REB: 1.14,
  AST: 1.02,
  PRA: 1.11,
  PA: 1.07,
  PR: 1.16,
  RA: 1.19,
};

const SAME_OPPONENT_SIGNAL_ENABLED = (() => {
  const raw = process.env.SNAPSHOT_SAME_OPPONENT_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
})();

const SAME_OPPONENT_MIN_SAMPLES = (() => {
  const parsed = Number(process.env.SNAPSHOT_SAME_OPPONENT_MIN_SAMPLES);
  if (!Number.isFinite(parsed)) return 2;
  return clamp(Math.floor(parsed), 1, 5);
})();

const SAME_OPPONENT_MAX_GAMES = (() => {
  const parsed = Number(process.env.SNAPSHOT_SAME_OPPONENT_MAX_GAMES);
  if (!Number.isFinite(parsed)) return 4;
  return clamp(Math.floor(parsed), 2, 8);
})();

const SAME_OPPONENT_STRENGTH = (() => {
  const parsed = Number(process.env.SNAPSHOT_SAME_OPPONENT_STRENGTH);
  if (!Number.isFinite(parsed)) return 0.1;
  return clamp(parsed, 0, 0.35);
})();

const SAME_OPPONENT_MINUTES_TOLERANCE = (() => {
  const parsed = Number(process.env.SNAPSHOT_SAME_OPPONENT_MINUTES_TOLERANCE);
  if (!Number.isFinite(parsed)) return 8;
  return clamp(parsed, 3, 14);
})();

const SAME_OPPONENT_MARKET_WEIGHT: Record<SnapshotMarket, number> = {
  PTS: 1,
  REB: 0.96,
  AST: 0.98,
  THREES: 0.82,
  PRA: 1.03,
  PA: 1,
  PR: 1.02,
  RA: 0.97,
};

const SAME_OPPONENT_MARKET_CAP: Record<SnapshotMarket, number> = {
  PTS: 0.9,
  REB: 0.55,
  AST: 0.55,
  THREES: 0.28,
  PRA: 1.15,
  PA: 0.95,
  PR: 1,
  RA: 0.72,
};

type ProjectMarketInput = {
  market: SnapshotMarket;
  last3Average: number | null;
  last10Average: number | null;
  seasonAverage: number | null;
  homeAwayAverage: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  last10Values: number[];
  sampleSize: number;
  minutesProfile: MinutesProjectionProfile;
  personalModel: PersonalMarketModel | null;
  minutesSeasonAvg: number | null;
  historyValues: number[];
  historyMinutes: number[];
  sameOpponentValues: number[];
  sameOpponentMinutes: number[];
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesVolatility: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
};

export type ProjectTonightInput = {
  last3Average: SnapshotMetricRecord;
  last10Average: SnapshotMetricRecord;
  seasonAverage: SnapshotMetricRecord;
  homeAwayAverage: SnapshotMetricRecord;
  opponentAllowance: SnapshotMetricRecord;
  opponentAllowanceDelta: SnapshotMetricRecord;
  opponentPaceAdjustedDelta?: SnapshotMetricRecord | null;
  last10ByMarket: Record<SnapshotMarket, number[]>;
  historyByMarket: Record<SnapshotMarket, number[]>;
  historyMinutes: number[];
  sameOpponentByMarket?: Record<SnapshotMarket, number[]>;
  sameOpponentMinutes?: number[];
  sampleSize: number;
  personalModels?: PlayerPersonalModels | null;
  minutesSeasonAvg?: number | null;
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesVolatility: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
  isHome?: boolean | null;
  playerPosition?: string | null;
  restDays?: number | null;
  openingTotal?: number | null;
  openingTeamSpread?: number | null;
  availabilitySeverity?: number | null;
  teammateSynergy?: TeamSynergyInput | null;
  pairwiseTeammateSynergy?: PairwiseTeammateSynergyInput | null;
  opponentAvailability?: OpponentAvailabilityInput | null;
};

export type TeamSynergyInput = {
  activeCoreAverage: SnapshotMetricRecord;
  missingCoreAverage: SnapshotMetricRecord;
  activeCoreCount: number;
  missingCoreCount: number;
};

export type OpponentAvailabilityInput = {
  activeCoreAverage: SnapshotMetricRecord;
  missingCoreAverage: SnapshotMetricRecord;
  activeCoreCount: number;
  missingCoreCount: number;
  activeCoreStocksPer36: number | null;
  missingCoreStocksPer36: number | null;
  missingFrontcourtRebLoad: number | null;
  missingFrontcourtRebShare: number | null;
  missingGuardWingAstLoad: number | null;
  missingGuardWingDisruptionLoad: number | null;
  missingGuardWingDisruptionShare: number | null;
  missingBigBlocksPer36Load: number | null;
  missingBigStocksPer36Load: number | null;
  missingRimProtectionShare: number | null;
};

export type MinutesProjectionInput = {
  minutesLast3Avg: number | null;
  minutesLast10Avg: number | null;
  minutesHomeAwayAvg: number | null;
  minutesCurrentTeamLast5Avg: number | null;
  minutesCurrentTeamGames: number;
  lineupStarter: boolean | null;
  starterRateLast10: number | null;
};

export type MinutesProjectionProfile = {
  expected: number | null;
  floor: number | null;
  ceiling: number | null;
};

export type BuildPlayerPersonalModelsInput = {
  historyByMarket: Record<SnapshotMarket, number[]>;
  minutesSeasonAvg: number | null;
  minSamples?: number;
};

export type SameOpponentProjectionSignal = {
  average: number | null;
  weightedAverage: number | null;
  sample: number;
  minutesAverage: number | null;
  minutesSimilarity: number | null;
  deltaVsAnchor: number | null;
  adjustment: number;
};

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round((sorted[middle - 1] + sorted[middle]) / 2, 2);
  }
  return round(sorted[middle], 2);
}

function createEmptyPlayerPersonalModels(): PlayerPersonalModels {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function buildPersonalSignal(values: number[]): number | null {
  if (values.length === 0) return null;
  const last3 = average(values.slice(-3));
  const last10 = average(values.slice(-10));
  const season = average(values);
  return weightedBlend([
    { value: last3, weight: 0.4 },
    { value: last10, weight: 0.4 },
    { value: season, weight: 0.2 },
  ]);
}

function buildPersonalMarketModel(valuesChronological: number[], minSamples: number): PersonalMarketModel | null {
  if (valuesChronological.length < Math.max(14, minSamples)) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 10; index < valuesChronological.length; index += 1) {
    const history = valuesChronological.slice(0, index);
    const signal = buildPersonalSignal(history);
    const actual = valuesChronological[index];
    if (signal == null || !Number.isFinite(actual)) continue;
    xs.push(signal);
    ys.push(actual);
  }

  if (xs.length < minSamples) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  if (meanX == null || meanY == null) return null;

  let sumCov = 0;
  let sumVarX = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sumCov += dx * dy;
    sumVarX += dx * dx;
  }

  const ridge = 0.8;
  const rawSlope = sumCov / Math.max(0.0001, sumVarX + ridge);
  const slope = clamp(rawSlope, 0.25, 1.75);
  const rawIntercept = meanY - slope * meanX;
  const interceptCap = Math.max(2.5, Math.abs(meanY) * 0.75 + 3);
  const intercept = clamp(rawIntercept, -interceptCap, interceptCap);

  let maeAcc = 0;
  let sst = 0;
  let sse = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const predicted = intercept + slope * xs[i];
    const error = predicted - ys[i];
    maeAcc += Math.abs(error);
    sse += error * error;
    const centered = ys[i] - meanY;
    sst += centered * centered;
  }

  const mae = maeAcc / xs.length;
  const r2 = sst <= 0 ? 0 : clamp(1 - sse / sst, -1, 1);
  const sampleScore = clamp((xs.length - minSamples) / 42, 0, 1);
  const fitScore = clamp(1 - mae / (Math.abs(meanY) + 1.25), 0, 1);
  const r2Score = clamp((r2 + 1) / 2, 0, 1);
  const confidence = clamp(0.18 + sampleScore * 0.42 + fitScore * 0.25 + r2Score * 0.15, 0.18, 0.95);

  return {
    slope: round(slope, 4),
    intercept: round(intercept, 3),
    confidence: round(confidence, 3),
    samples: xs.length,
    mae: round(mae, 3),
  };
}

function minutesConditionedEstimate(
  historyValuesRecentFirst: number[],
  historyMinutesRecentFirst: number[],
  expectedMinutes: number,
): { value: number | null; median: number | null; sample: number } {
  if (historyValuesRecentFirst.length === 0 || historyMinutesRecentFirst.length === 0) {
    return { value: null, median: null, sample: 0 };
  }

  const pairs = historyValuesRecentFirst
    .map((value, index) => ({
      value,
      minutes: historyMinutesRecentFirst[index] ?? 0,
    }))
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.minutes) && item.minutes > 0);

  if (pairs.length === 0) return { value: null, median: null, sample: 0 };

  const weighted = (
    items: Array<{ value: number; minutes: number }>,
    decay: number,
  ): { value: number | null; median: number | null; sample: number } => {
    if (items.length === 0) return { value: null, median: null, sample: 0 };
    let totalWeight = 0;
    let weightedSum = 0;
    items.forEach((item) => {
      const weight = Math.exp(-Math.abs(item.minutes - expectedMinutes) / decay);
      totalWeight += weight;
      weightedSum += item.value * weight;
    });
    const values = items.map((item) => item.value);
    const med = median(values);
    if (totalWeight <= 0) return { value: null, median: med, sample: items.length };
    return { value: round(weightedSum / totalWeight, 2), median: med, sample: items.length };
  };

  const near = pairs.filter((item) => Math.abs(item.minutes - expectedMinutes) <= 3).slice(0, 32);
  if (near.length >= 7) {
    return weighted(near, 2.3);
  }

  const medium = pairs.filter((item) => Math.abs(item.minutes - expectedMinutes) <= 5).slice(0, 40);
  if (medium.length >= 9) {
    return weighted(medium, 3.2);
  }

  return weighted(pairs.slice(0, 40), 4.6);
}

export function buildPlayerPersonalModels(input: BuildPlayerPersonalModelsInput): PlayerPersonalModels {
  const result = createEmptyPlayerPersonalModels();
  if (input.minutesSeasonAvg == null || input.minutesSeasonAvg < PLAYER_SPECIFIC_MINUTES_THRESHOLD) {
    return result;
  }

  const minSamples = clamp(Math.floor(input.minSamples ?? PLAYER_SPECIFIC_MODEL_MIN_SAMPLES), 10, 40);
  SNAPSHOT_MARKETS.forEach((market) => {
    const series = input.historyByMarket[market] ?? [];
    result[market] = buildPersonalMarketModel(series, minSamples);
  });
  return result;
}

function weightedBlend(parts: Array<{ value: number | null; weight: number }>): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  parts.forEach((part) => {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) return;
    weightedTotal += part.value * part.weight;
    totalWeight += part.weight;
  });
  if (totalWeight <= 0) return null;
  return round(weightedTotal / totalWeight, 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildSameOpponentProjectionSignal(input: {
  market: SnapshotMarket;
  sameOpponentValues: number[];
  sameOpponentMinutes: number[];
  expectedMinutes: number | null;
  anchorValue: number | null;
}): SameOpponentProjectionSignal {
  const pairs = input.sameOpponentValues
    .map((value, index) => ({
      value,
      minutes: input.sameOpponentMinutes[index] ?? null,
    }))
    .filter((item) => Number.isFinite(item.value))
    .slice(0, SAME_OPPONENT_MAX_GAMES);
  const values = pairs.map((item) => item.value);
  const sample = values.length;
  const averageValue = average(values);
  const weightedAverage =
    weightedBlend([
      { value: ewmaRecentFirst(values, 0.58), weight: 0.62 },
      { value: averageValue, weight: 0.38 },
    ]) ?? averageValue;
  const validMinutes = pairs
    .map((item) => item.minutes)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const minutesAverage = average(validMinutes);
  const minutesSimilarity =
    input.expectedMinutes == null || input.expectedMinutes <= 0 || minutesAverage == null
      ? null
      : round(
          clamp(1 - Math.abs(minutesAverage - input.expectedMinutes) / SAME_OPPONENT_MINUTES_TOLERANCE, 0.35, 1),
          3,
        );
  const deltaVsAnchor =
    weightedAverage == null || input.anchorValue == null ? null : round(weightedAverage - input.anchorValue, 2);
  if (
    !SAME_OPPONENT_SIGNAL_ENABLED ||
    weightedAverage == null ||
    input.anchorValue == null ||
    sample < SAME_OPPONENT_MIN_SAMPLES ||
    SAME_OPPONENT_STRENGTH <= 0
  ) {
    return {
      average: averageValue,
      weightedAverage,
      sample,
      minutesAverage,
      minutesSimilarity,
      deltaVsAnchor,
      adjustment: 0,
    };
  }

  const confidenceDenom = Math.max(1, SAME_OPPONENT_MAX_GAMES - SAME_OPPONENT_MIN_SAMPLES + 1);
  const sampleConfidence = clamp((sample - SAME_OPPONENT_MIN_SAMPLES + 1) / confidenceDenom, 0.24, 1);
  const minuteWeight = minutesSimilarity ?? 0.78;
  const marketWeight = SAME_OPPONENT_MARKET_WEIGHT[input.market] ?? 1;
  const cap = SAME_OPPONENT_MARKET_CAP[input.market] ?? 0.8;
  const rawAdjustment = (deltaVsAnchor ?? 0) * SAME_OPPONENT_STRENGTH * marketWeight * sampleConfidence * minuteWeight;
  const adjustment = round(clamp(rawAdjustment, -cap, cap), 2);
  return {
    average: averageValue,
    weightedAverage,
    sample,
    minutesAverage,
    minutesSimilarity,
    deltaVsAnchor,
    adjustment,
  };
}

function applyOpeningTotalEnvironmentAdjustment(
  value: number | null,
  market: SnapshotMarket,
  openingTotal: number | null | undefined,
): number | null {
  if (value == null || openingTotal == null || !Number.isFinite(openingTotal) || OPENING_TOTAL_ENV_STRENGTH === 0) {
    return value;
  }

  const envLift = clamp((openingTotal - OPENING_TOTAL_ENV_BASELINE) * OPENING_TOTAL_ENV_STRENGTH, -0.06, 0.06);
  const weightedLift = envLift * OPENING_TOTAL_ENV_MARKET_WEIGHT[market];
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function isFrontcourtReboundOpportunityProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistsProjection: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const guardLike = position.includes("PG") || position.includes("SG") || position === "G";
  const explicitFrontcourt =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";
  const statShapeFrontcourt = reb >= 6.2 && ast <= 4.6;

  if (minutes < 14) return false;
  if (guardLike && !statShapeFrontcourt) return false;
  if (!explicitFrontcourt && !statShapeFrontcourt) return false;
  return reb >= 5.4 || pts >= 10;
}

function isBenchBigMinutesProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistsProjection: number | null;
  threesProjection: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";
  const benchLikeMinutes = minutes >= 10 && minutes <= 27.5;
  const reserveLikeRole = starterRate < 0.45 || minutes < 23.5;
  const traditionalBenchBig = reb >= 5.5 && ast <= 4.1 && threes <= 1.3;
  const stretchBenchBig = reb >= 4.8 && threes >= 0.9 && ast <= 4.3;

  if (!benchLikeMinutes || !reserveLikeRole) return false;
  if (explicitBig && (traditionalBenchBig || stretchBenchBig)) return true;
  return !position.includes("G") && (traditionalBenchBig || stretchBenchBig);
}

function isCenterSpreadProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";

  return explicitBig && minutes >= 24 && starterRate >= 0.55;
}

function isBenchBigSpreadProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";

  return explicitBig && minutes >= 10 && minutes <= 28 && starterRate < 0.5;
}

function isFavoriteGuardSpreadProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  last10Average: SnapshotMetricRecord;
  seasonAverage: SnapshotMetricRecord;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase();
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.last10Average.PTS ?? input.seasonAverage.PTS ?? 0;
  const ast = input.last10Average.AST ?? input.seasonAverage.AST ?? 0;
  const threes = input.last10Average.THREES ?? input.seasonAverage.THREES ?? 0;
  const guardLike = position.includes("PG") || position === "G" || position.includes("SG") || ast >= 5;

  if (!guardLike || position.includes("C")) return false;
  if (minutes < 28 || starterRate < 0.35) return false;

  // Exclude pure table-setters; this is aimed at score-first / generic lead-guard blowout risk.
  if (ast >= 6.8 && pts <= 22 && threes <= 2.6) return false;
  return true;
}

function resolveBigRoleSpreadMinutesAdjustment(input: {
  openingTeamSpread: number | null | undefined;
  centerProfile: boolean;
  benchBigProfile: boolean;
}): number {
  if (input.openingTeamSpread == null || !Number.isFinite(input.openingTeamSpread)) {
    return 1;
  }

  if (input.centerProfile && FAVORITE_CENTER_PENALTY_STRENGTH > 0 && input.openingTeamSpread <= -BIG_ROLE_SPREAD_ABS_THRESHOLD) {
    const excessSpread = Math.abs(input.openingTeamSpread) - BIG_ROLE_SPREAD_ABS_THRESHOLD;
    if (excessSpread > 0) {
      return clamp(1 - excessSpread * FAVORITE_CENTER_PENALTY_STRENGTH * 0.008, 0.82, 1);
    }
  }

  if (
    input.benchBigProfile &&
    UNDERDOG_BENCH_BIG_BOOST_STRENGTH > 0 &&
    input.openingTeamSpread >= BIG_ROLE_SPREAD_ABS_THRESHOLD
  ) {
    const excessSpread = input.openingTeamSpread - BIG_ROLE_SPREAD_ABS_THRESHOLD;
    if (excessSpread > 0) {
      return clamp(1 + excessSpread * UNDERDOG_BENCH_BIG_BOOST_STRENGTH * 0.007, 1, 1.18);
    }
  }

  return 1;
}

function resolveFavoriteGuardSpreadMinutesAdjustment(input: {
  openingTeamSpread: number | null | undefined;
  guardProfile: boolean;
}): number {
  if (input.openingTeamSpread == null || !Number.isFinite(input.openingTeamSpread)) {
    return 1;
  }

  if (
    input.guardProfile &&
    FAVORITE_GUARD_PENALTY_STRENGTH > 0 &&
    input.openingTeamSpread <= -BIG_ROLE_SPREAD_ABS_THRESHOLD
  ) {
    const excessSpread = Math.abs(input.openingTeamSpread) - BIG_ROLE_SPREAD_ABS_THRESHOLD;
    if (excessSpread > 0) {
      return clamp(1 - excessSpread * FAVORITE_GUARD_PENALTY_STRENGTH * 0.008, 0.84, 1);
    }
  }

  return 1;
}

function isBigRoleVolatilityProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  last10Average: SnapshotMetricRecord;
  seasonAverage: SnapshotMetricRecord;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const reb = input.last10Average.REB ?? input.seasonAverage.REB ?? 0;
  const ast = input.last10Average.AST ?? input.seasonAverage.AST ?? 0;
  const threes = input.last10Average.THREES ?? input.seasonAverage.THREES ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";
  const frontcourtShape = reb >= 4.8 && ast <= 4.8;
  const benchBigLike = minutes <= 28.5 && (starterRate < 0.55 || minutes < 24);
  const centerLike = explicitBig && minutes >= 18;
  const stretchBigLike = frontcourtShape && threes >= 0.8 && minutes <= 30;

  if (minutes < 12) return false;
  if (position.includes("PG") || position.includes("SG") || position === "G") return false;
  return centerLike || (benchBigLike && frontcourtShape) || stretchBigLike;
}

function resolveMissingFrontcourtLoad(synergy: TeamSynergyInput | null | undefined): number {
  if (!synergy) return 0;
  const missing = synergy.missingCoreAverage;
  const rebLoad = (missing.REB ?? 0) / 7.5;
  const raLoad = (missing.RA ?? 0) / 8.5;
  const prLoad = (missing.PR ?? 0) / 18;
  const ptsLoad = (missing.PTS ?? 0) / 22;
  return clamp(rebLoad * 0.42 + raLoad * 0.28 + prLoad * 0.2 + ptsLoad * 0.1, 0, 1.6);
}

function resolveBigRoleMinutesAdjustment(input: {
  enabled: boolean;
  availabilitySeverity: number | null | undefined;
  missingFrontcourtLoad: number;
}): number {
  if (!input.enabled || INJURY_TEAMMATE_MINUTES_STRENGTH === 0) return 1;

  const availabilitySeverity = clamp(input.availabilitySeverity ?? 0, 0, 1);
  let multiplier = 1 + input.missingFrontcourtLoad * 0.095 * INJURY_TEAMMATE_MINUTES_STRENGTH;
  if (availabilitySeverity > 0.3) {
    multiplier *= 1 - availabilitySeverity * INJURY_TEAMMATE_MINUTES_STRENGTH * 0.72;
  } else if (availabilitySeverity > 0) {
    multiplier *= 1 - availabilitySeverity * INJURY_TEAMMATE_MINUTES_STRENGTH * 0.28;
  }
  return clamp(multiplier, 0.38, 1.45);
}

function applyMinutesAdjustmentToProfile(profile: MinutesProjectionProfile, multiplier: number): MinutesProjectionProfile {
  if (multiplier === 1) return profile;

  const scale = (value: number | null, floor: number): number | null =>
    value == null ? null : round(Math.max(floor, value * multiplier), 2);

  return {
    expected: scale(profile.expected, 10),
    floor: scale(profile.floor, 8),
    ceiling: scale(profile.ceiling, 12),
  };
}

function applyBigmanReboundOpportunityAdjustment(
  value: number | null,
  market: SnapshotMarket,
  openingTotal: number | null | undefined,
  enabled: boolean,
): number | null {
  if (
    !enabled ||
    value == null ||
    openingTotal == null ||
    !Number.isFinite(openingTotal) ||
    BIGMAN_REB_FACTOR_STRENGTH === 0
  ) {
    return value;
  }

  const marketWeight = BIGMAN_REB_OPPORTUNITY_MARKET_WEIGHT[market];
  if (marketWeight == null) return value;

  const rawLift = (openingTotal - BIGMAN_REB_FACTOR_BASELINE) * BIGMAN_REB_FACTOR_STRENGTH * 0.0012;
  const weightedLift = clamp(rawLift * marketWeight, -0.08, 0.08);
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function applyBenchBigMinutesSensitivityAdjustment(
  value: number | null,
  market: SnapshotMarket,
  openingTotal: number | null | undefined,
  enabled: boolean,
): number | null {
  if (
    !enabled ||
    value == null ||
    openingTotal == null ||
    !Number.isFinite(openingTotal) ||
    BENCH_BIG_MINUTES_SENSITIVITY === 0
  ) {
    return value;
  }

  const marketWeight = BENCH_BIG_MINUTES_MARKET_WEIGHT[market];
  if (marketWeight == null) return value;

  const rawLift = (openingTotal - BENCH_BIG_MINUTES_BASELINE) * BENCH_BIG_MINUTES_SENSITIVITY * 0.0008;
  const weightedLift = clamp(rawLift * marketWeight, -0.06, 0.06);
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function resolveBigRoleVolatilityMinutesAdjustment(input: {
  enabled: boolean;
  minutesVolatility: number | null | undefined;
}): number {
  if (!input.enabled || input.minutesVolatility == null || ROLE_VOLATILITY_STRENGTH === 0) return 1;

  const volatilityDelta = input.minutesVolatility - ROLE_VOLATILITY_BASELINE;
  const rawFactor = 1 - volatilityDelta * ROLE_VOLATILITY_STRENGTH * 0.018;
  return clamp(rawFactor, 0.82, 1.12);
}

function applyBigRoleVolatilityAdjustment(
  value: number | null,
  market: SnapshotMarket,
  volatilityAdjustment: number,
  enabled: boolean,
): number | null {
  if (!enabled || value == null || ROLE_VOLATILITY_STRENGTH === 0 || volatilityAdjustment === 1) {
    return value;
  }

  const marketWeight = BIG_ROLE_VOLATILITY_MARKET_WEIGHT[market];
  if (marketWeight == null) return value;

  const weightedLift = clamp((volatilityAdjustment - 1) * marketWeight, -0.22, 0.12);
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function applyBigRoleOpponentDefenseAdjustment(
  value: number | null,
  market: SnapshotMarket,
  delta: SnapshotMetricRecord | null | undefined,
  enabled: boolean,
): number | null {
  if (!enabled || value == null || !delta || OPP_DEF_RTG_STRENGTH === 0) return value;

  const marketDelta = delta[market];
  const marketWeight = BIG_ROLE_OPP_DEF_MARKET_WEIGHT[market];
  const scale = BIG_ROLE_OPP_DEF_MARKET_SCALE[market];
  if (marketDelta == null || marketWeight == null || scale == null) return value;

  const normalized = clamp(marketDelta / scale, -1.5, 1.5);
  const weightedLift = clamp(normalized * OPP_DEF_RTG_STRENGTH * 0.08 * marketWeight, -0.14, 0.14);
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function applyBigRoleInjuryTeammateAdjustment(
  value: number | null,
  market: SnapshotMarket,
  minutesAdjustment: number,
  enabled: boolean,
): number | null {
  if (!enabled || value == null || INJURY_TEAMMATE_MINUTES_STRENGTH === 0 || minutesAdjustment === 1) {
    return value;
  }

  const marketWeight = BIG_ROLE_INJURY_TEAMMATE_MARKET_WEIGHT[market];
  if (marketWeight == null) return value;

  const weightedLift = clamp((minutesAdjustment - 1) * marketWeight, -0.18, 0.18);
  return round(Math.max(0, value * (1 + weightedLift)), 2);
}

function roleScale(primary: number | null, fallback: number | null, baseline: number, min = 0.22, max = 1.2): number {
  const reference = primary ?? fallback ?? 0;
  return clamp(reference / baseline, min, max);
}

function isScoreFirstLeadGuardProjectionProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  assistsProjection: number | null;
  threesProjection: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase();
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.pointsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const threes = input.threesProjection ?? 0;
  const guardLike = position.includes("PG") || position.includes("SG") || position === "G" || ast >= 5;

  if (!guardLike || position.includes("C")) return false;
  if (minutes < 30 || starterRate < 0.35) return false;
  if (ast >= 6.8 && pts <= 22 && threes <= 2.6) return false;
  return pts >= 19 || threes >= 2.4;
}

function isFavoriteGuardScoringPenaltyProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  assistsProjection: number | null;
  openingTeamSpread?: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase();
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.pointsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const spread = input.openingTeamSpread ?? null;
  const guardLike =
    position.includes("PG") ||
    position === "G" ||
    (position.includes("SG") && ast >= 4.5) ||
    ast >= 5.5;
  const scoreToAstRatio = pts / Math.max(ast, 0.75);

  if (spread == null || !Number.isFinite(spread) || spread > -BIG_ROLE_SPREAD_ABS_THRESHOLD) return false;
  if (!guardLike || position.includes("C")) return false;
  if (minutes < 28 || starterRate < 0.35) return false;
  if (pts <= 18) return false;
  return scoreToAstRatio > 2.5;
}

function applyFavoriteGuardScoringPenalty(
  value: number | null,
  market: SnapshotMarket,
  enabled: boolean,
): number | null {
  if (!enabled || value == null || FAVORITE_SCORING_PENALTY_FACTOR >= 1) return value;

  const marketWeight: Partial<Record<SnapshotMarket, number>> = {
    PTS: 1,
    THREES: 1,
    PA: 0.9,
    PRA: 0.72,
  };
  const weight = marketWeight[market];
  if (weight == null) return value;

  const weightedFactor = 1 - (1 - FAVORITE_SCORING_PENALTY_FACTOR) * weight;
  const floor = market === "THREES" ? 0.5 : 0;
  return round(Math.max(floor, value * weightedFactor), 2);
}

function isBackToBackRestDay(restDays: number | null | undefined): boolean {
  return restDays != null && restDays <= 1;
}

function applyB2BEfficiencyDrag(
  value: number | null,
  market: SnapshotMarket,
  restDays: number | null | undefined,
  expectedMinutes: number | null | undefined,
): number | null {
  if (value == null || B2B_EFFICIENCY_DRAG >= 1) return value;
  if (!isBackToBackRestDay(restDays)) return value;
  if ((expectedMinutes ?? 0) < B2B_MINUTES_THRESHOLD) return value;
  if (market !== "PTS" && market !== "THREES") return value;

  const floor = market === "THREES" ? 0.5 : 0;
  return round(Math.max(floor, value * B2B_EFFICIENCY_DRAG), 2);
}

function isRoadBenchDragProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistsProjection: number | null;
  threesProjection: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";
  const guardLike = position.includes("PG") || position.includes("SG") || position === "G";
  const wingLike = !guardLike && !explicitBig;

  const benchWingLike =
    wingLike &&
    minutes >= 10 &&
    minutes <= 27.5 &&
    starterRate < 0.45 &&
    ast <= 4.2 &&
    (threes >= 0.7 || pts >= 8);

  const spotupWingLike =
    wingLike &&
    minutes >= 24 &&
    starterRate >= 0.3 &&
    ast <= 4.4 &&
    reb <= 6 &&
    (threes >= 1.6 || pts >= 15);

  const benchStretchBigLike =
    explicitBig &&
    minutes >= 10 &&
    minutes <= 27 &&
    starterRate < 0.45 &&
    reb >= 4.5 &&
    ast <= 4.3 &&
    threes >= 0.9;

  return benchWingLike || spotupWingLike || benchStretchBigLike;
}

function isSpotupWingRoadVolatilityProfile(input: {
  playerPosition?: string | null;
  expectedMinutes: number | null;
  starterRateLast10: number | null;
  pointsProjection: number | null;
  reboundsProjection: number | null;
  assistsProjection: number | null;
  threesProjection: number | null;
}): boolean {
  const position = (input.playerPosition ?? "").toUpperCase().replace(/\s+/g, "");
  const minutes = input.expectedMinutes ?? 0;
  const starterRate = input.starterRateLast10 ?? 0;
  const pts = input.pointsProjection ?? 0;
  const reb = input.reboundsProjection ?? 0;
  const ast = input.assistsProjection ?? 0;
  const threes = input.threesProjection ?? 0;

  const explicitBig =
    position.includes("C") ||
    position.includes("PF") ||
    position === "F" ||
    position === "FC" ||
    position === "CF" ||
    position === "F-C" ||
    position === "C-F";
  const guardLike = position.includes("PG") || position.includes("SG") || position === "G";
  const wingLike = !guardLike && !explicitBig;

  return (
    wingLike &&
    minutes >= 24 &&
    minutes <= 38 &&
    starterRate >= 0.3 &&
    ast <= 4.4 &&
    reb <= 6 &&
    (threes >= 1.6 || pts >= 15)
  );
}

function applyRoadBenchDrag(
  value: number | null,
  market: SnapshotMarket,
  isHome: boolean | null | undefined,
  enabled: boolean,
): number | null {
  if (!enabled || value == null || ROAD_BENCH_DRAG >= 1) return value;
  if (isHome !== false) return value;
  if (market !== "PTS" && market !== "THREES") return value;

  const floor = market === "THREES" ? 0.5 : 0;
  return round(Math.max(floor, value * ROAD_BENCH_DRAG), 2);
}

function applySpotupWingRoadVolatilityFactor(
  value: number | null,
  market: SnapshotMarket,
  isHome: boolean | null | undefined,
  enabled: boolean,
  minutesVolatilityRatio: number,
): number | null {
  if (!enabled || value == null || SPOTUP_WING_ROAD_VOLATILITY_STRENGTH <= 0) return value;
  if (isHome !== false) return value;
  if (market !== "PTS" && market !== "THREES") return value;

  const baseFactor = 1 + SPOTUP_WING_ROAD_VOLATILITY_STRENGTH * minutesVolatilityRatio;
  const factor = market === "THREES" ? baseFactor * 0.92 : baseFactor;
  const floor = market === "THREES" ? 0.5 : 0;
  return round(Math.max(floor, value * factor), 2);
}

function applyTeammateSynergyAdjustments(
  result: SnapshotMetricRecord,
  last10Average: SnapshotMetricRecord,
  synergy: TeamSynergyInput | null | undefined,
): void {
  if (!synergy) return;

  const active = synergy.activeCoreAverage;
  const missing = synergy.missingCoreAverage;

  if (result.PTS != null) {
    const scorerRole = roleScale(result.PTS, last10Average.PTS, 20, 0.24, 1.18);
    const creatorSupport = (active.AST ?? 0) * scorerRole * 0.04;
    const spacingSupport = (active.THREES ?? 0) * scorerRole * 0.025;
    const scorerCompetition = (active.PTS ?? 0) * (1 - clamp(scorerRole / 1.18, 0.18, 0.92)) * 0.03;
    const missingBoost = (missing.PTS ?? 0) * scorerRole * 0.085 + (missing.THREES ?? 0) * scorerRole * 0.04;
    result.PTS = round(Math.max(0, result.PTS + clamp(creatorSupport + spacingSupport + missingBoost - scorerCompetition, -1.4, 2.6)), 2);
  }

  if (result.REB != null) {
    const boardRole = roleScale(result.REB, last10Average.REB, 8, 0.24, 1.15);
    const boardCompetition = (active.REB ?? 0) * (1 - clamp(boardRole / 1.15, 0.18, 0.92)) * 0.045;
    const missingBoost = (missing.REB ?? 0) * boardRole * 0.085;
    result.REB = round(Math.max(0, result.REB + clamp(missingBoost - boardCompetition, -0.8, 1.6)), 2);
  }

  if (result.AST != null) {
    const creatorRole = roleScale(result.AST, last10Average.AST, 6, 0.24, 1.2);
    const finisherSupport = (active.PTS ?? 0) * creatorRole * 0.02 + (active.THREES ?? 0) * creatorRole * 0.05;
    const creatorCompetition = (active.AST ?? 0) * (1 - clamp(creatorRole / 1.2, 0.18, 0.92)) * 0.05;
    const missingBoost = (missing.AST ?? 0) * creatorRole * 0.09;
    result.AST = round(Math.max(0, result.AST + clamp(finisherSupport + missingBoost - creatorCompetition, -0.9, 1.8)), 2);
  }

  if (result.THREES != null) {
    const spacingRole = roleScale(result.THREES, last10Average.THREES, 2.4, 0.24, 1.2);
    const creatorSupport = (active.AST ?? 0) * spacingRole * 0.028;
    const spacingCompetition = (active.THREES ?? 0) * (1 - clamp(spacingRole / 1.2, 0.18, 0.92)) * 0.04;
    const missingBoost = (missing.THREES ?? 0) * spacingRole * 0.11;
    result.THREES = round(Math.max(0, result.THREES + clamp(creatorSupport + missingBoost - spacingCompetition, -0.35, 0.95)), 2);
  }
}

function averageStocksPerCore(context: OpponentAvailabilityInput, side: "active" | "missing"): number {
  const total =
    side === "active"
      ? (context.activeCoreStocksPer36 ?? 0) * context.activeCoreCount
      : (context.missingCoreStocksPer36 ?? 0) * context.missingCoreCount;
  return round(total, 2);
}

function applyOpponentAvailabilityAdjustments(
  result: SnapshotMetricRecord,
  last10Average: SnapshotMetricRecord,
  context: OpponentAvailabilityInput | null | undefined,
): void {
  if (!context || context.missingCoreCount <= 0) return;

  const missing = context.missingCoreAverage;
  const missingStocks = averageStocksPerCore(context, "missing");
  const activeStocks = averageStocksPerCore(context, "active");
  const defensiveRelief = clamp((missingStocks - activeStocks * 0.2) / 4.8, 0, 1.35);
  const glassRelief = clamp(((missing.REB ?? 0) * context.missingCoreCount) / 15, 0, 1.35);

  if (result.PTS != null) {
    const scorerRole = roleScale(result.PTS, last10Average.PTS, 20, 0.24, 1.18);
    const reliefBoost = defensiveRelief * scorerRole * 0.72 + glassRelief * scorerRole * 0.18;
    result.PTS = round(Math.max(0, result.PTS + clamp(reliefBoost, 0, 1.15)), 2);
  }

  if (result.REB != null) {
    const boardRole = roleScale(result.REB, last10Average.REB, 8, 0.24, 1.15);
    const glassBoost = glassRelief * boardRole * 0.9 + defensiveRelief * boardRole * 0.14;
    result.REB = round(Math.max(0, result.REB + clamp(glassBoost, 0, 1.2)), 2);
  }

  if (result.AST != null) {
    const creatorRole = roleScale(result.AST, last10Average.AST, 6, 0.24, 1.2);
    const reliefBoost = defensiveRelief * creatorRole * 0.48;
    result.AST = round(Math.max(0, result.AST + clamp(reliefBoost, 0, 0.85)), 2);
  }

  if (result.THREES != null) {
    const spacingRole = roleScale(result.THREES, last10Average.THREES, 2.4, 0.24, 1.2);
    const reliefBoost = defensiveRelief * spacingRole * 0.24;
    result.THREES = round(Math.max(0, result.THREES + clamp(reliefBoost, 0, 0.4)), 2);
  }
}

function lineupMinutesDelta(lineupStarter: boolean | null, starterRateLast10: number | null): number {
  if (lineupStarter == null) {
    return 0;
  }
  if (lineupStarter) {
    return clamp((1 - (starterRateLast10 ?? 0.5)) * 2.4 + 0.35, 0.7, 2.8);
  }
  return -clamp((starterRateLast10 ?? 0.5) * 2.2 + 0.35, 0.7, 2.8);
}

export function projectMinutesProfile(input: MinutesProjectionInput): MinutesProjectionProfile {
  const baseline = weightedBlend([
    { value: input.minutesLast3Avg, weight: 0.52 },
    { value: input.minutesLast10Avg, weight: 0.38 },
    { value: input.minutesHomeAwayAvg, weight: 0.1 },
  ]);

  let roleAdjusted = baseline;
  if (baseline != null && input.minutesCurrentTeamLast5Avg != null && input.minutesCurrentTeamGames >= 2) {
    const teamWeight = clamp(0.22 + input.minutesCurrentTeamGames * 0.09, 0.28, 0.78);
    roleAdjusted =
      weightedBlend([
        { value: baseline, weight: 1 - teamWeight },
        { value: input.minutesCurrentTeamLast5Avg, weight: teamWeight },
      ]) ?? baseline;
  }

  const withLineup =
    roleAdjusted == null
      ? null
      : round(Math.max(0, roleAdjusted + lineupMinutesDelta(input.lineupStarter, input.starterRateLast10)), 2);

  const referenceValues = [
    input.minutesLast3Avg,
    input.minutesLast10Avg,
    input.minutesHomeAwayAvg,
    input.minutesCurrentTeamLast5Avg,
  ].filter((value): value is number => value != null && Number.isFinite(value));
  const spread = standardDeviation(referenceValues) ?? 2.4;
  const floorBuffer = clamp(spread * 1.15 + 1.1, 2.2, 8.2);
  const ceilingBuffer = clamp(spread * 1.2 + 1.7, 2.8, 9.4);

  return {
    expected: withLineup,
    floor: withLineup == null ? null : round(Math.max(0, withLineup - floorBuffer), 2),
    ceiling: withLineup == null ? null : round(withLineup + ceilingBuffer, 2),
  };
}

function ewmaRecentFirst(valuesRecentFirst: number[], alpha: number): number | null {
  if (valuesRecentFirst.length === 0) return null;
  const ordered = valuesRecentFirst.slice().reverse();
  let ema = ordered[0];
  for (let i = 1; i < ordered.length; i += 1) {
    ema = alpha * ordered[i] + (1 - alpha) * ema;
  }
  return round(ema, 2);
}

function projectMarket(input: ProjectMarketInput): number | null {
  const config = CONFIG_BY_MARKET[input.market];
  const isVolumeMarket =
    input.market === "PTS" || input.market === "PRA" || input.market === "PA" || input.market === "PR";
  const ewma = ewmaRecentFirst(input.last10Values, config.alpha);
  const base = weightedBlend([
    { value: ewma, weight: config.weights.ewma },
    { value: input.last3Average, weight: config.weights.last3 },
    { value: input.last10Average, weight: config.weights.last10 },
    { value: input.seasonAverage, weight: config.weights.season },
    { value: input.homeAwayAverage, weight: config.weights.homeAway },
    { value: input.opponentAllowance, weight: config.weights.opponentAllowance },
  ]);
  if (base == null) return null;

  const seasonAnchor = input.seasonAverage ?? input.last10Average ?? ewma ?? base;
  const last10Volatility = standardDeviation(input.last10Values) ?? 0;
  const volatilityDenom = Math.max(1, Math.abs(input.last10Average ?? seasonAnchor) + 1.5);
  const volatilityShrink = clamp(1 - (last10Volatility / volatilityDenom) * 0.34, 0.56, 0.98);
  const minutesProfile = input.minutesProfile;
  const minuteDelta =
    minutesProfile.expected == null || input.minutesLast10Avg == null ? 0 : minutesProfile.expected - input.minutesLast10Avg;
  const expectedMinutes = minutesProfile.expected ?? input.minutesLast10Avg ?? input.minutesLast3Avg ?? 0;
  const sameOpponentSignal = buildSameOpponentProjectionSignal({
    market: input.market,
    sameOpponentValues: input.sameOpponentValues,
    sameOpponentMinutes: input.sameOpponentMinutes,
    expectedMinutes,
    anchorValue: seasonAnchor,
  });
  const perMinuteRate =
    input.minutesLast10Avg == null || input.minutesLast10Avg <= 0
      ? null
      : (input.last10Average ?? seasonAnchor) / input.minutesLast10Avg;
  const perMinuteProjection = perMinuteRate == null ? null : round(Math.max(0, perMinuteRate * expectedMinutes), 2);
  const minutesConditioned = minutesConditionedEstimate(input.historyValues, input.historyMinutes, expectedMinutes);
  const minutesAdjustment =
    perMinuteRate == null
      ? 0
      : clamp(perMinuteRate * minuteDelta * config.minuteImpact, -config.minuteCap, config.minuteCap);
  const opponentAdjustment = clamp(
    (input.opponentAllowanceDelta ?? 0) * config.opponentDeltaImpact,
    -config.opponentCap,
    config.opponentCap,
  );
  const trendDelta = (input.last3Average ?? input.last10Average ?? seasonAnchor) - (input.last10Average ?? seasonAnchor);
  const trendAdjustment = clamp(trendDelta * config.trendImpact, -config.trendCap, config.trendCap);
  const median10 = median(input.last10Values);
  const relativeVolatility = clamp(last10Volatility / Math.max(1.2, Math.abs(input.last10Average ?? seasonAnchor)), 0, 2);
  const minutesVolatilityRatio = clamp((input.minutesVolatility ?? 0) / Math.max(8, expectedMinutes || 8), 0, 1.8);
  const minutesStability = clamp(1 - minutesVolatilityRatio * 0.55, 0.2, 1);
  const sampleConfidence = clamp((input.sampleSize - 8) / 24, 0, 1);
  const consistencyScore = clamp(1 - relativeVolatility * 0.5, 0.18, 1);
  const seasonMinutes = input.minutesSeasonAvg ?? input.minutesLast10Avg ?? expectedMinutes;
  const playerSpecificTier = seasonMinutes >= PLAYER_SPECIFIC_MINUTES_THRESHOLD;

  const globalProjection =
    seasonAnchor +
    (base - seasonAnchor) * volatilityShrink +
    minutesAdjustment +
    opponentAdjustment +
    trendAdjustment +
    sameOpponentSignal.adjustment;
  let projected = globalProjection;

  if (playerSpecificTier) {
    // Personalized model for stable rotation players (>=15 mpg): trust player-specific rate + robust median.
    const personalizedBlend = weightedBlend([
      { value: globalProjection, weight: isVolumeMarket ? 0.28 : 0.36 },
      { value: perMinuteProjection, weight: isVolumeMarket ? 0.33 : 0.26 },
      { value: input.last10Average, weight: 0.2 },
      { value: median10, weight: isVolumeMarket ? 0.12 : 0.11 },
      { value: input.seasonAverage, weight: isVolumeMarket ? 0.07 : 0.07 },
    ]);
    projected = personalizedBlend ?? globalProjection;
    const personalizedTrust = clamp(
      (isVolumeMarket ? 0.32 : 0.3) +
        sampleConfidence * (isVolumeMarket ? 0.36 : 0.34) +
        minutesStability * 0.2 +
        consistencyScore * 0.16,
      isVolumeMarket ? 0.32 : 0.3,
      isVolumeMarket ? 0.94 : 0.92,
    );
    projected =
      weightedBlend([
        { value: projected, weight: personalizedTrust },
        { value: seasonAnchor, weight: 1 - personalizedTrust },
      ]) ?? projected;

    const personalSignal = weightedBlend([
      { value: input.last3Average, weight: 0.4 },
      { value: input.last10Average, weight: 0.4 },
      { value: input.seasonAverage, weight: 0.2 },
    ]);
    const personalProjection =
      input.personalModel && personalSignal != null
        ? round(Math.max(0, input.personalModel.intercept + input.personalModel.slope * personalSignal), 2)
        : null;
    if (personalProjection != null && input.personalModel) {
      const personalWeight = clamp(
        (isVolumeMarket ? 0.22 : 0.15) + input.personalModel.confidence * (isVolumeMarket ? 0.68 : 0.55),
        isVolumeMarket ? 0.22 : 0.15,
        isVolumeMarket ? 0.86 : 0.72,
      );
      projected =
        weightedBlend([
          { value: projected, weight: 1 - personalWeight },
          { value: personalProjection, weight: personalWeight },
        ]) ?? projected;
    }
  } else {
    // Conservative fallback for low-minute players: stronger shrinkage and a bench-minute penalty.
    const conservativeBlend = weightedBlend([
      { value: input.seasonAverage, weight: 0.42 },
      { value: input.last10Average, weight: 0.24 },
      { value: median10, weight: 0.16 },
      { value: perMinuteProjection, weight: 0.12 },
      { value: globalProjection, weight: 0.06 },
    ]);
    projected = conservativeBlend ?? globalProjection;
    const benchPenalty = clamp((PLAYER_SPECIFIC_MINUTES_THRESHOLD - expectedMinutes) * 0.22, 0, 3.0);
    projected = projected - benchPenalty;
    if (input.sampleSize < 18) {
      projected =
        weightedBlend([
          { value: projected, weight: 0.58 },
          { value: seasonAnchor, weight: 0.42 },
        ]) ?? projected;
    }
    if (input.sampleSize < 8) {
      projected =
        weightedBlend([
          { value: projected, weight: 0.4 },
          { value: seasonAnchor, weight: 0.6 },
        ]) ?? projected;
    }
    const upperCap = seasonAnchor + clamp((input.minutesLast10Avg ?? expectedMinutes) * 0.22, 1.5, config.minuteCap + 1.2);
    projected = clamp(projected, 0, Math.max(upperCap, 0));
  }

  const outlierGuardWeight = clamp(relativeVolatility * 0.14 + minutesVolatilityRatio * 0.11, 0, 0.24);
  projected =
    weightedBlend([
      { value: projected, weight: 1 - outlierGuardWeight },
      { value: seasonAnchor, weight: outlierGuardWeight },
    ]) ?? projected;

  if (minutesConditioned.value != null) {
    const minutesConditionWeight = clamp(
      0.1 + (minutesConditioned.sample >= 12 ? 0.13 : 0.06) + sampleConfidence * 0.1,
      0.1,
      0.34,
    );
    projected =
      weightedBlend([
        { value: projected, weight: 1 - minutesConditionWeight },
        { value: minutesConditioned.value, weight: minutesConditionWeight },
      ]) ?? projected;
  }

  if (input.sampleSize < 10 && playerSpecificTier) {
    projected = weightedBlend([
      { value: projected, weight: 0.72 },
      { value: seasonAnchor, weight: 0.28 },
    ]) ?? projected;
  }
  if (input.sampleSize < 6 && playerSpecificTier) {
    projected = weightedBlend([
      { value: projected, weight: 0.58 },
      { value: seasonAnchor, weight: 0.42 },
    ]) ?? projected;
  }

  return round(Math.max(0, projected), 2);
}

export function projectTonightMetrics(input: ProjectTonightInput): SnapshotMetricRecord {
  let minutesProfile = projectMinutesProfile({
    minutesLast3Avg: input.minutesLast3Avg,
    minutesLast10Avg: input.minutesLast10Avg,
    minutesHomeAwayAvg: input.minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg: input.minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: input.minutesCurrentTeamGames,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });

  const centerSpreadProfile = isCenterSpreadProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
  });
  const benchBigSpreadProfile = isBenchBigSpreadProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
  });
  const bigRoleSpreadAdjustment = resolveBigRoleSpreadMinutesAdjustment({
    openingTeamSpread: input.openingTeamSpread,
    centerProfile: centerSpreadProfile,
    benchBigProfile: benchBigSpreadProfile,
  });
  minutesProfile = applyMinutesAdjustmentToProfile(minutesProfile, bigRoleSpreadAdjustment);
  const favoriteGuardSpreadProfile = isFavoriteGuardSpreadProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    last10Average: input.last10Average,
    seasonAverage: input.seasonAverage,
  });
  const favoriteGuardSpreadAdjustment = resolveFavoriteGuardSpreadMinutesAdjustment({
    openingTeamSpread: input.openingTeamSpread,
    guardProfile: favoriteGuardSpreadProfile,
  });
  minutesProfile = applyMinutesAdjustmentToProfile(minutesProfile, favoriteGuardSpreadAdjustment);

  const bigRoleVolatilityProfile = isBigRoleVolatilityProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    last10Average: input.last10Average,
    seasonAverage: input.seasonAverage,
  });
  const bigRoleVolatilityAdjustment = resolveBigRoleVolatilityMinutesAdjustment({
    enabled: bigRoleVolatilityProfile,
    minutesVolatility: input.minutesVolatility,
  });
  minutesProfile = applyMinutesAdjustmentToProfile(minutesProfile, bigRoleVolatilityAdjustment);
  const missingFrontcourtLoad = resolveMissingFrontcourtLoad(input.teammateSynergy);
  const bigRoleMinutesAdjustment = resolveBigRoleMinutesAdjustment({
    enabled: bigRoleVolatilityProfile,
    availabilitySeverity: input.availabilitySeverity,
    missingFrontcourtLoad,
  });
  minutesProfile = applyMinutesAdjustmentToProfile(minutesProfile, bigRoleMinutesAdjustment);

  const result = blankMetricRecord();
  const baseMarkets: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];
  const comboMarkets: SnapshotMarket[] = ["PRA", "PA", "PR", "RA"];
  const directComboProjection = blankMetricRecord();

  const projectionInputFor = (market: SnapshotMarket): ProjectMarketInput => ({
    market,
    last3Average: input.last3Average[market],
    last10Average: input.last10Average[market],
    seasonAverage: input.seasonAverage[market],
    homeAwayAverage: input.homeAwayAverage[market],
    opponentAllowance: input.opponentAllowance[market],
    opponentAllowanceDelta: input.opponentAllowanceDelta[market],
    last10Values: input.last10ByMarket[market],
    historyValues: input.historyByMarket[market],
    historyMinutes: input.historyMinutes,
    sameOpponentValues: input.sameOpponentByMarket?.[market] ?? [],
    sameOpponentMinutes: input.sameOpponentMinutes ?? [],
    sampleSize: input.sampleSize,
    minutesProfile,
    personalModel: input.personalModels?.[market] ?? null,
    minutesSeasonAvg: input.minutesSeasonAvg ?? null,
    minutesLast3Avg: input.minutesLast3Avg,
    minutesLast10Avg: input.minutesLast10Avg,
    minutesVolatility: input.minutesVolatility,
    minutesHomeAwayAvg: input.minutesHomeAwayAvg,
    minutesCurrentTeamLast5Avg: input.minutesCurrentTeamLast5Avg,
    minutesCurrentTeamGames: input.minutesCurrentTeamGames,
    lineupStarter: input.lineupStarter,
    starterRateLast10: input.starterRateLast10,
  });

  baseMarkets.forEach((market) => {
    result[market] = projectMarket(projectionInputFor(market));
  });

  applyTeammateSynergyAdjustments(result, input.last10Average, input.teammateSynergy);
  applyPairwiseTeammateSynergyAdjustments(result, input.pairwiseTeammateSynergy, "base");
  applyOpponentAvailabilityAdjustments(result, input.last10Average, input.opponentAvailability);

  baseMarkets.forEach((market) => {
    result[market] = applyOpeningTotalEnvironmentAdjustment(result[market], market, input.openingTotal);
  });

  const roadBenchDragProfile = isRoadBenchDragProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    pointsProjection: result.PTS,
    reboundsProjection: result.REB,
    assistsProjection: result.AST,
    threesProjection: result.THREES,
  });
  const spotupWingRoadVolatilityProfile = isSpotupWingRoadVolatilityProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    pointsProjection: result.PTS,
    reboundsProjection: result.REB,
    assistsProjection: result.AST,
    threesProjection: result.THREES,
  });
  const spotupWingMinutesVolatilityRatio = clamp(
    (input.minutesVolatility ?? 0) / Math.max(8, minutesProfile.expected || 8),
    0,
    1.8,
  );

  const frontcourtReboundOpportunityProfile = isFrontcourtReboundOpportunityProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    pointsProjection: result.PTS,
    reboundsProjection: result.REB,
    assistsProjection: result.AST,
  });

  const benchBigMinutesProfile = isBenchBigMinutesProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    pointsProjection: result.PTS,
    reboundsProjection: result.REB,
    assistsProjection: result.AST,
    threesProjection: result.THREES,
  });

  baseMarkets.forEach((market) => {
    result[market] = applyBigmanReboundOpportunityAdjustment(
      result[market],
      market,
      input.openingTotal,
      frontcourtReboundOpportunityProfile,
    );
    result[market] = applyBenchBigMinutesSensitivityAdjustment(
      result[market],
      market,
      input.openingTotal,
      benchBigMinutesProfile,
    );
    result[market] = applyBigRoleOpponentDefenseAdjustment(
      result[market],
      market,
      input.opponentPaceAdjustedDelta,
      bigRoleVolatilityProfile,
    );
    result[market] = applyBigRoleVolatilityAdjustment(
      result[market],
      market,
      bigRoleVolatilityAdjustment,
      bigRoleVolatilityProfile,
    );
    result[market] = applyBigRoleInjuryTeammateAdjustment(
      result[market],
      market,
      bigRoleMinutesAdjustment,
      bigRoleVolatilityProfile,
    );
    result[market] = applyB2BEfficiencyDrag(result[market], market, input.restDays, minutesProfile.expected);
    result[market] = applyRoadBenchDrag(result[market], market, input.isHome, roadBenchDragProfile);
    result[market] = applySpotupWingRoadVolatilityFactor(
      result[market],
      market,
      input.isHome,
      spotupWingRoadVolatilityProfile,
      spotupWingMinutesVolatilityRatio,
    );
  });

  if (
    SCORE_FIRST_LEAD_GUARD_THREES_FACTOR !== 1 &&
    result.THREES != null &&
    isScoreFirstLeadGuardProjectionProfile({
      playerPosition: input.playerPosition,
      expectedMinutes: minutesProfile.expected,
      starterRateLast10: input.starterRateLast10,
      pointsProjection: result.PTS,
      assistsProjection: result.AST,
      threesProjection: result.THREES,
    })
  ) {
    result.THREES = round(Math.max(0.5, result.THREES * SCORE_FIRST_LEAD_GUARD_THREES_FACTOR), 2);
  }

  const favoriteGuardScoringPenaltyProfile = isFavoriteGuardScoringPenaltyProfile({
    playerPosition: input.playerPosition,
    expectedMinutes: minutesProfile.expected,
    starterRateLast10: input.starterRateLast10,
    pointsProjection: result.PTS,
    assistsProjection: result.AST,
    openingTeamSpread: input.openingTeamSpread,
  });
  const penalizedPts = applyFavoriteGuardScoringPenalty(result.PTS, "PTS", favoriteGuardScoringPenaltyProfile);
  const penalizedThrees = applyFavoriteGuardScoringPenalty(result.THREES, "THREES", favoriteGuardScoringPenaltyProfile);

  comboMarkets.forEach((market) => {
    directComboProjection[market] = projectMarket(projectionInputFor(market));
    directComboProjection[market] = applyOpeningTotalEnvironmentAdjustment(
      directComboProjection[market],
      market,
      input.openingTotal,
    );
    directComboProjection[market] = applyBigmanReboundOpportunityAdjustment(
      directComboProjection[market],
      market,
      input.openingTotal,
      frontcourtReboundOpportunityProfile,
    );
    directComboProjection[market] = applyBenchBigMinutesSensitivityAdjustment(
      directComboProjection[market],
      market,
      input.openingTotal,
      benchBigMinutesProfile,
    );
    directComboProjection[market] = applyBigRoleOpponentDefenseAdjustment(
      directComboProjection[market],
      market,
      input.opponentPaceAdjustedDelta,
      bigRoleVolatilityProfile,
    );
    directComboProjection[market] = applyBigRoleVolatilityAdjustment(
      directComboProjection[market],
      market,
      bigRoleVolatilityAdjustment,
      bigRoleVolatilityProfile,
    );
    directComboProjection[market] = applyBigRoleInjuryTeammateAdjustment(
      directComboProjection[market],
      market,
      bigRoleMinutesAdjustment,
      bigRoleVolatilityProfile,
    );
    if (market === "PA" || market === "PRA") {
      directComboProjection[market] = applyFavoriteGuardScoringPenalty(
        directComboProjection[market],
        market,
        favoriteGuardScoringPenaltyProfile,
      );
    }
  });

  const sumOrNull = (...values: Array<number | null>): number | null => {
    if (values.some((value) => value == null)) return null;
    const numericValues = values as number[];
    return round(numericValues.reduce((total, value) => total + value, 0), 2);
  };

  const summedCombo: Partial<Record<SnapshotMarket, number | null>> = {
    PRA: sumOrNull(penalizedPts, result.REB, result.AST),
    PA: sumOrNull(penalizedPts, result.AST),
    PR: sumOrNull(penalizedPts, result.REB),
    RA: sumOrNull(result.REB, result.AST),
  };

  comboMarkets.forEach((market) => {
    result[market] =
      weightedBlend([
        { value: summedCombo[market] ?? null, weight: COMBO_SUM_WEIGHT },
        { value: directComboProjection[market], weight: COMBO_DIRECT_WEIGHT },
      ]) ??
      summedCombo[market] ??
      directComboProjection[market];
  });

  result.PTS = penalizedPts;
  result.THREES = penalizedThrees;
  applyPairwiseTeammateSynergyAdjustments(result, input.pairwiseTeammateSynergy, "combo");

  return result;
}
