import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Side = "OVER" | "UNDER";
type ScoreMode = "hgb" | "balanced" | "gap" | "recency" | "composite";
type CapMode = "default" | "counting-safe" | "combo-balanced" | "no-pa";
type SelectionStage = "primary" | "fallback" | "forced_cap_relax" | "forced_overlay_relax";

type PriorityHistoryRow = {
  date: string;
  playerId: string;
  playerName: string;
  market: string;
  side: Side;
  correct: boolean;
  poolCount?: number;
  strictPoolCount?: number;
  finalPoolCount?: number;
  scoringCorePool?: boolean;
  comboPool?: boolean;
  rawSource?: string | null;
  strictRawSource?: string | null;
  finalSource?: string | null;
  overrideEngaged?: boolean;
  playerOverrideEngaged?: boolean;
  rawQualified?: boolean;
  strictAgreement?: boolean;
  finalAgreement?: boolean;
  projectionAgreement?: boolean;
  favoredAgreement?: boolean;
  archetype?: string | null;
  modelKind?: string | null;
  bucketSamples?: number | null;
  bucketModelAccuracy?: number | null;
  bucketLateAccuracy?: number | null;
  leafCount?: number | null;
  leafAccuracy?: number | null;
  projectionWinProbability?: number | null;
  projectionPriceEdge?: number | null;
  priceStrength?: number | null;
  projectionMarketAgreement?: number | null;
  rejectionCount?: number;
  holdoutAccuracy?: number | null;
  projectionBaselineAccuracy?: number | null;
  finalBaselineAccuracy?: number | null;
  modelAccuracy?: number | null;
  samples?: number;
  edgeVsProjection?: number | null;
  edgeVsFinal?: number | null;
  projectedValue?: number | null;
  lineGap?: number | null;
  absLineGap?: number | null;
  expectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
  priceLean?: number | null;
  weightedCurrentLineOverRate?: number | null;
  emaCurrentLineDelta?: number | null;
  emaCurrentLineOverRate?: number | null;
  l5CurrentLineOverRate?: number | null;
  baseScoreGap?: number;
  baseScoreRecency?: number;
  baseScoreBalanced?: number;
};

type HistoryArtifact = {
  version?: string;
  generatedAt?: string;
  rowCount?: number;
  rows?: PriorityHistoryRow[];
};

type HgbArtifact = {
  version?: string;
  generatedAt?: string;
  trainedThroughDate?: string;
  walkForwardScores?: Record<string, number>;
};

type LockedReplayArtifact = {
  version?: string;
  generatedAt?: string;
  summary?: unknown;
};

type MarketCaps = Record<string, number>;

type Policy = {
  id: string;
  label: string;
  scoreMode: ScoreMode;
  capMode: CapMode;
  marketCaps: MarketCaps;
  minScore: number;
  minHoldoutAccuracy: number;
  minModelAccuracy: number;
  minExpectedMinutes: number;
  maxMinutesVolatility: number;
  minAbsLineGap: number;
  minSamples: number;
  requireStrictAgreement: boolean;
  requireFinalAgreement: boolean;
  allowFallbackFill: boolean;
};

type SelectedPick = {
  rank: number;
  date: string;
  playerId: string;
  playerName: string;
  market: string;
  side: Side;
  score: number;
  selectionStage: SelectionStage;
  correct: boolean;
  holdoutAccuracy: number | null;
  modelAccuracy: number | null;
  expectedMinutes: number | null;
  minutesVolatility: number | null;
  absLineGap: number | null;
};

type DailyMetric = {
  date: string;
  picks: number;
  correct: number;
  betPlaced: boolean;
  cardHit: boolean;
  fivePlusHit: boolean;
  forcedFillPicks: number;
  profitUnits: number;
};

type DailyEvaluation = {
  metric: DailyMetric;
  selected: SelectedPick[];
};

type Summary = {
  totalDates: number;
  daysBet: number;
  underfilledDays: number;
  coveragePct: number;
  picks: number;
  correct: number;
  legAccuracyPct: number;
  legAccuracyWilsonPct: Interval;
  cardsHit: number;
  cardHitRatePct: number;
  cardHitWilsonPct: Interval;
  fivePlusCards: number;
  fivePlusRatePct: number;
  forcedFillPicks: number;
  forcedFillPct: number;
  avgWinsPerBet: number;
  profitUnits: number;
  roiPct: number;
  maxDrawdownUnits: number;
  maxLosingStreak: number;
};

type Interval = {
  low: number;
  high: number;
};

type PolicyRun = {
  policy: Policy;
  daily: DailyMetric[];
  summary: Summary;
};

type WalkForwardDaily = DailyMetric & {
  chosenPolicyId: string;
  chosenPolicyLabel: string;
  trainDays: number;
  trainDaysBet: number;
  trainCardHitRatePct: number;
  trainLegAccuracyPct: number;
  selected: SelectedPick[];
};

type Args = {
  history: string;
  hgb: string;
  lockedReplay: string;
  outPrefix: string;
  legs: number;
  odds: number;
  warmupDates: number;
  minTrainCoveragePct: number;
  minTrainBetDays: number;
  topPolicies: number;
  forceDailyLegs: boolean;
};

const DEFAULT_MARKET_CAPS: MarketCaps = {
  PTS: 2,
  REB: 2,
  AST: 1,
  PRA: 2,
  PA: 1,
  PR: 2,
  RA: 2,
};

const MARKET_CAP_MODES: Record<CapMode, MarketCaps> = {
  default: DEFAULT_MARKET_CAPS,
  "counting-safe": {
    PTS: 1,
    REB: 2,
    AST: 1,
    PRA: 1,
    PA: 1,
    PR: 2,
    RA: 2,
  },
  "combo-balanced": {
    PTS: 1,
    REB: 1,
    AST: 1,
    PRA: 2,
    PA: 2,
    PR: 2,
    RA: 2,
  },
  "no-pa": {
    PTS: 2,
    REB: 2,
    AST: 1,
    PRA: 2,
    PA: 0,
    PR: 2,
    RA: 2,
  },
};

const DEFAULT_ARGS: Args = {
  history: path.join("exports", "precision-upstream-reranker-history-v1.json"),
  hgb: path.join("exports", "precision-upstream-hgb-reranker-runtime-model-v1.json"),
  lockedReplay: path.join("exports", "precision-upstream-locked-pregame-history-replay.json"),
  outPrefix: path.join("exports", "parlay-backtest-results"),
  legs: 6,
  odds: -110,
  warmupDates: 14,
  minTrainCoveragePct: 80,
  minTrainBetDays: 10,
  topPolicies: 25,
  forceDailyLegs: true,
};

function parseArgs(argv: string[]): Args {
  const args = { ...DEFAULT_ARGS };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (!key.startsWith("--")) continue;
    const readValue = () => {
      if (next == null || next.startsWith("--")) {
        throw new Error(`Missing value for ${key}`);
      }
      index += 1;
      return next;
    };

    if (key === "--history") args.history = readValue();
    else if (key === "--hgb") args.hgb = readValue();
    else if (key === "--locked-replay") args.lockedReplay = readValue();
    else if (key === "--out-prefix") args.outPrefix = readValue();
    else if (key === "--legs") args.legs = Number.parseInt(readValue(), 10);
    else if (key === "--odds") args.odds = Number.parseInt(readValue(), 10);
    else if (key === "--warmup-dates") args.warmupDates = Number.parseInt(readValue(), 10);
    else if (key === "--min-train-coverage-pct") args.minTrainCoveragePct = Number.parseFloat(readValue());
    else if (key === "--min-train-bet-days") args.minTrainBetDays = Number.parseInt(readValue(), 10);
    else if (key === "--top-policies") args.topPolicies = Number.parseInt(readValue(), 10);
    else if (key === "--allow-underfilled") args.forceDailyLegs = false;
    else if (key === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.legs) || args.legs < 2) throw new Error("--legs must be at least 2");
  if (!Number.isFinite(args.warmupDates) || args.warmupDates < 1) throw new Error("--warmup-dates must be positive");
  if (!Number.isFinite(args.minTrainCoveragePct) || args.minTrainCoveragePct < 0 || args.minTrainCoveragePct > 100) {
    throw new Error("--min-train-coverage-pct must be between 0 and 100");
  }
  return args;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run projection:backtest:parlay -- [options]

Options:
  --history <file>                 Full candidate history JSON.
  --hgb <file>                     Optional HGB walk-forward score artifact.
  --locked-replay <file>           Optional locked replay reference artifact.
  --out-prefix <path>              Output prefix for .json/.md/.csv files.
  --legs <n>                       Parlay legs to test. Default: 6.
  --odds <american>                Assumed flat per-leg odds. Default: -110.
  --warmup-dates <n>               Walk-forward policy warmup dates. Default: 14.
  --min-train-coverage-pct <pct>   Minimum historical daily coverage to choose a policy. Default: 80.
  --min-train-bet-days <n>         Minimum historical bet days to choose a policy. Default: 10.
  --allow-underfilled              Research mode: do not force-fill daily cards to the leg target.
`);
}

async function readJson<T>(filePath: string): Promise<T> {
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, "utf8");
  return JSON.parse(raw) as T;
}

function maybeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numeric(value: unknown, fallback = 0): number {
  return maybeNumber(value) ?? fallback;
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number, digits = 2): number {
  return denominator > 0 ? round((numerator / denominator) * 100, digits) : 0;
}

function rowKey(row: PriorityHistoryRow): string {
  return `${row.date}|${row.playerId}|${row.market}|${row.side}`;
}

function americanToDecimal(americanOdds: number): number {
  if (americanOdds < 0) return 1 + 100 / Math.abs(americanOdds);
  return 1 + americanOdds / 100;
}

function getPrecisionV6OverlayRejectionReason(row: PriorityHistoryRow): string | null {
  if ((row.holdoutAccuracy ?? 0) > 87.5) {
    return "V6 overlay: ultra-high holdout prior pocket is treated as overfit risk.";
  }
  if (row.market === "PRA" && (row.starterRateLast10 ?? 0) < 0.1) {
    return "V6 overlay: PRA profile has missing or very low starter-rate support.";
  }
  if (row.market === "PTS" && (row.leafAccuracy ?? 0) > 75.71) {
    return "V6 overlay: PTS tree-leaf pocket replayed as an overconfident miss cluster.";
  }
  if (row.market === "RA" && (row.minutesVolatility ?? 0) < 3.78) {
    return "V6 overlay: RA low-volatility role pocket replayed below the promoted bar.";
  }
  if (row.market === "RA" && row.side === "OVER" && (row.emaCurrentLineOverRate ?? 0) > 0.875) {
    return "V6 overlay: extreme RA over-recency chase pocket is vetoed.";
  }
  return null;
}

function getPolicyScore(row: PriorityHistoryRow, policy: Policy, hgbScores: Map<string, number>): number {
  const hgbScore = hgbScores.get(rowKey(row));
  const balancedScore = numeric(row.baseScoreBalanced, numeric(row.baseScoreGap));

  if (policy.scoreMode === "hgb") return hgbScore ?? balancedScore;
  if (policy.scoreMode === "balanced") return balancedScore;
  if (policy.scoreMode === "gap") return numeric(row.baseScoreGap, balancedScore);
  if (policy.scoreMode === "recency") return numeric(row.baseScoreRecency, balancedScore);

  const modelAccuracy = clamp(numeric(row.modelAccuracy) / 100, 0, 1);
  const holdoutAccuracy = clamp(numeric(row.holdoutAccuracy) / 100, 0, 1);
  const lineGap = clamp(numeric(row.absLineGap) / 3, 0, 1);
  const strictBonus = row.strictAgreement ? 1 : 0;
  const finalBonus = row.finalAgreement ? 1 : 0;
  const volatilityPenalty = clamp((numeric(row.minutesVolatility, 10) - 5) / 8, 0, 1);
  const base = hgbScore ?? balancedScore;

  return (
    base * 0.58 +
    modelAccuracy * 0.14 +
    holdoutAccuracy * 0.1 +
    lineGap * 0.08 +
    strictBonus * 0.06 +
    finalBonus * 0.04 -
    volatilityPenalty * 0.03
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function passesPrimaryPolicy(row: PriorityHistoryRow, policy: Policy, score: number): boolean {
  if (getPrecisionV6OverlayRejectionReason(row)) return false;
  if (score < policy.minScore) return false;
  if (numeric(row.holdoutAccuracy) < policy.minHoldoutAccuracy) return false;
  if (numeric(row.modelAccuracy) < policy.minModelAccuracy) return false;
  if (policy.minExpectedMinutes > 0 && numeric(row.expectedMinutes) < policy.minExpectedMinutes) return false;
  if (
    policy.maxMinutesVolatility < 99 &&
    (row.minutesVolatility == null || row.minutesVolatility > policy.maxMinutesVolatility)
  ) {
    return false;
  }
  if (numeric(row.absLineGap) < policy.minAbsLineGap) return false;
  if (numeric(row.samples) < policy.minSamples) return false;
  if (policy.requireStrictAgreement && !row.strictAgreement) return false;
  if (policy.requireFinalAgreement && !row.finalAgreement) return false;
  return true;
}

function selectRows(
  rows: PriorityHistoryRow[],
  policy: Policy,
  hgbScores: Map<string, number>,
  targetLegs: number,
  forceDailyLegs: boolean,
): SelectedPick[] {
  const scoredRows = rows
    .map((row) => ({ row, score: getPolicyScore(row, policy, hgbScores) }))
    .sort((left, right) => compareScoredRows(left, right));
  const selected: Array<{ row: PriorityHistoryRow; score: number; selectionStage: SelectionStage }> = [];
  const selectedPlayers = new Set<string>();
  const marketCounts = new Map<string, number>();

  const trySelect = (
    item: { row: PriorityHistoryRow; score: number },
    selectionStage: SelectionStage,
    options?: { ignoreMarketCaps?: boolean },
  ) => {
    if (selected.length >= targetLegs) return;
    if (selectedPlayers.has(item.row.playerId)) return;
    const cap = policy.marketCaps[item.row.market] ?? 0;
    if (!options?.ignoreMarketCaps && (marketCounts.get(item.row.market) ?? 0) >= cap) return;
    selected.push({ ...item, selectionStage });
    selectedPlayers.add(item.row.playerId);
    marketCounts.set(item.row.market, (marketCounts.get(item.row.market) ?? 0) + 1);
  };

  scoredRows.filter((item) => passesPrimaryPolicy(item.row, policy, item.score)).forEach((item) => {
    trySelect(item, "primary");
  });

  if ((policy.allowFallbackFill || forceDailyLegs) && selected.length < targetLegs) {
    scoredRows
      .filter((item) => !getPrecisionV6OverlayRejectionReason(item.row))
      .forEach((item) => {
        trySelect(item, "fallback");
      });
  }

  if (forceDailyLegs && selected.length < targetLegs) {
    scoredRows
      .filter((item) => !getPrecisionV6OverlayRejectionReason(item.row))
      .forEach((item) => {
        trySelect(item, "forced_cap_relax", { ignoreMarketCaps: true });
      });
  }

  if (forceDailyLegs && selected.length < targetLegs) {
    scoredRows.forEach((item) => {
      trySelect(item, "forced_overlay_relax", { ignoreMarketCaps: true });
    });
  }

  return selected.map((item, index) => ({
    rank: index + 1,
    date: item.row.date,
    playerId: item.row.playerId,
    playerName: item.row.playerName,
    market: item.row.market,
    side: item.row.side,
    score: round(item.score, 8),
    selectionStage: item.selectionStage,
    correct: item.row.correct,
    holdoutAccuracy: maybeNumber(item.row.holdoutAccuracy),
    modelAccuracy: maybeNumber(item.row.modelAccuracy),
    expectedMinutes: maybeNumber(item.row.expectedMinutes),
    minutesVolatility: maybeNumber(item.row.minutesVolatility),
    absLineGap: maybeNumber(item.row.absLineGap),
  }));
}

function compareScoredRows(
  left: { row: PriorityHistoryRow; score: number },
  right: { row: PriorityHistoryRow; score: number },
): number {
  return (
    right.score - left.score ||
    numeric(right.row.holdoutAccuracy, Number.NEGATIVE_INFINITY) -
      numeric(left.row.holdoutAccuracy, Number.NEGATIVE_INFINITY) ||
    numeric(right.row.absLineGap) - numeric(left.row.absLineGap) ||
    left.row.playerName.localeCompare(right.row.playerName)
  );
}

function evaluatePolicyDay(
  date: string,
  rows: PriorityHistoryRow[],
  policy: Policy,
  hgbScores: Map<string, number>,
  targetLegs: number,
  parlayWinProfitUnits: number,
  forceDailyLegs: boolean,
): DailyEvaluation {
  const selected = selectRows(rows, policy, hgbScores, targetLegs, forceDailyLegs);
  const correct = selected.filter((pick) => pick.correct).length;
  const betPlaced = selected.length >= targetLegs;
  const cardHit = betPlaced && correct === selected.length;
  const fivePlusHit = betPlaced && correct >= Math.max(targetLegs - 1, 1);
  const forcedFillPicks = selected.filter((pick) => pick.selectionStage !== "primary").length;
  const profitUnits = !betPlaced ? 0 : cardHit ? round(parlayWinProfitUnits, 4) : -1;

  return {
    metric: {
      date,
      picks: selected.length,
      correct,
      betPlaced,
      cardHit,
      fivePlusHit,
      forcedFillPicks,
      profitUnits,
    },
    selected,
  };
}

function evaluatePolicy(
  policy: Policy,
  rowsByDate: Map<string, PriorityHistoryRow[]>,
  dates: string[],
  hgbScores: Map<string, number>,
  args: Args,
): PolicyRun {
  const parlayWinProfitUnits = americanToDecimal(args.odds) ** args.legs - 1;
  const daily = dates.map((date) =>
    evaluatePolicyDay(
      date,
      rowsByDate.get(date) ?? [],
      policy,
      hgbScores,
      args.legs,
      parlayWinProfitUnits,
      args.forceDailyLegs,
    ).metric,
  );
  return {
    policy,
    daily,
    summary: summarizeDaily(daily),
  };
}

function summarizeDaily(daily: DailyMetric[]): Summary {
  const betDays = daily.filter((day) => day.betPlaced);
  const picks = betDays.reduce((sum, day) => sum + day.picks, 0);
  const correct = betDays.reduce((sum, day) => sum + day.correct, 0);
  const cardsHit = betDays.filter((day) => day.cardHit).length;
  const fivePlusCards = betDays.filter((day) => day.fivePlusHit).length;
  const forcedFillPicks = betDays.reduce((sum, day) => sum + day.forcedFillPicks, 0);
  const profitUnits = betDays.reduce((sum, day) => sum + day.profitUnits, 0);

  return {
    totalDates: daily.length,
    daysBet: betDays.length,
    underfilledDays: daily.length - betDays.length,
    coveragePct: pct(betDays.length, daily.length),
    picks,
    correct,
    legAccuracyPct: pct(correct, picks),
    legAccuracyWilsonPct: wilsonInterval(correct, picks),
    cardsHit,
    cardHitRatePct: pct(cardsHit, betDays.length),
    cardHitWilsonPct: wilsonInterval(cardsHit, betDays.length),
    fivePlusCards,
    fivePlusRatePct: pct(fivePlusCards, betDays.length),
    forcedFillPicks,
    forcedFillPct: pct(forcedFillPicks, picks),
    avgWinsPerBet: betDays.length > 0 ? round(correct / betDays.length, 2) : 0,
    profitUnits: round(profitUnits, 2),
    roiPct: pct(profitUnits, betDays.length),
    maxDrawdownUnits: round(getMaxDrawdown(daily), 2),
    maxLosingStreak: getMaxLosingStreak(daily),
  };
}

function wilsonInterval(successes: number, total: number): Interval {
  if (total <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return {
    low: round(Math.max(0, center - spread) * 100, 2),
    high: round(Math.min(1, center + spread) * 100, 2),
  };
}

function getMaxDrawdown(daily: DailyMetric[]): number {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  daily.forEach((day) => {
    cumulative += day.profitUnits;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  });
  return maxDrawdown;
}

function getMaxLosingStreak(daily: DailyMetric[]): number {
  let current = 0;
  let max = 0;
  daily.forEach((day) => {
    if (!day.betPlaced) return;
    if (day.cardHit) {
      current = 0;
      return;
    }
    current += 1;
    max = Math.max(max, current);
  });
  return max;
}

function buildPolicies(hasHgbScores: boolean): Policy[] {
  const policies: Policy[] = [];
  const seen = new Set<string>();
  const scoreModes: ScoreMode[] = hasHgbScores ? ["hgb", "composite", "balanced", "recency"] : ["composite", "balanced", "recency", "gap"];
  const capModes: CapMode[] = ["default", "counting-safe", "combo-balanced", "no-pa"];
  const minScores = [0, 0.6, 0.66];
  const minHoldouts = [0, 64];
  const minModels = [0, 75];
  const minMinutes = [0, 20];
  const maxVols = [99, 8];
  const minGaps = [0, 0.5];
  const minSamples = [0];
  const booleans = [false, true];

  const addPolicy = (policy: Omit<Policy, "id" | "label"> & { id?: string; label?: string }) => {
    const slug =
      policy.id ??
      [
        policy.scoreMode,
        policy.capMode,
        `s${policy.minScore}`,
        `h${policy.minHoldoutAccuracy}`,
        `m${policy.minModelAccuracy}`,
        `min${policy.minExpectedMinutes}`,
        `vol${policy.maxMinutesVolatility}`,
        `gap${policy.minAbsLineGap}`,
        `n${policy.minSamples}`,
        policy.requireStrictAgreement ? "strict" : "nostrict",
        policy.requireFinalAgreement ? "final" : "nofinal",
        policy.allowFallbackFill ? "fill" : "nofill",
      ].join("_");
    if (seen.has(slug)) return;
    seen.add(slug);
    policies.push({
      ...policy,
      id: slug,
      label: policy.label ?? slug,
    });
  };

  addPolicy({
    id: hasHgbScores ? "baseline-v6-hgb-default" : "baseline-v6-balanced-default",
    label: hasHgbScores ? "Baseline V6 HGB Default" : "Baseline V6 Balanced Default",
    scoreMode: hasHgbScores ? "hgb" : "balanced",
    capMode: "default",
    marketCaps: MARKET_CAP_MODES.default,
    minScore: 0,
    minHoldoutAccuracy: 0,
    minModelAccuracy: 0,
    minExpectedMinutes: 0,
    maxMinutesVolatility: 99,
    minAbsLineGap: 0,
    minSamples: 0,
    requireStrictAgreement: false,
    requireFinalAgreement: false,
    allowFallbackFill: true,
  });

  scoreModes.forEach((scoreMode) => {
    capModes.forEach((capMode) => {
      minScores.forEach((minScore) => {
        minHoldouts.forEach((minHoldoutAccuracy) => {
          minModels.forEach((minModelAccuracy) => {
            minMinutes.forEach((minExpectedMinutes) => {
              maxVols.forEach((maxMinutesVolatility) => {
                minGaps.forEach((minAbsLineGap) => {
                  minSamples.forEach((minSampleCount) => {
                    booleans.forEach((requireStrictAgreement) => {
                      booleans.forEach((allowFallbackFill) => {
                        addPolicy({
                          scoreMode,
                          capMode,
                          marketCaps: MARKET_CAP_MODES[capMode],
                          minScore,
                          minHoldoutAccuracy,
                          minModelAccuracy,
                          minExpectedMinutes,
                          maxMinutesVolatility,
                          minAbsLineGap,
                          minSamples: minSampleCount,
                          requireStrictAgreement,
                          requireFinalAgreement: false,
                          allowFallbackFill,
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  return policies;
}

function comparePolicyRuns(left: PolicyRun, right: PolicyRun): number {
  return compareSummaries(left.summary, right.summary) || left.policy.id.localeCompare(right.policy.id);
}

function compareSummaries(left: Summary, right: Summary): number {
  return (
    right.cardHitRatePct - left.cardHitRatePct ||
    right.roiPct - left.roiPct ||
    right.legAccuracyPct - left.legAccuracyPct ||
    right.coveragePct - left.coveragePct ||
    right.fivePlusRatePct - left.fivePlusRatePct ||
    left.maxDrawdownUnits - right.maxDrawdownUnits
  );
}

function chooseWalkForwardPolicy(
  policyRuns: PolicyRun[],
  dateIndex: number,
  args: Args,
): { run: PolicyRun; trainSummary: Summary } {
  const trainDays = dateIndex;
  const minimumCoverageDays = Math.ceil(trainDays * (args.minTrainCoveragePct / 100));
  const minimumBetDays = Math.max(args.minTrainBetDays, minimumCoverageDays);
  const candidates = policyRuns
    .map((run) => ({
      run,
      trainSummary: summarizeDaily(run.daily.slice(0, dateIndex)),
    }))
    .filter((candidate) => candidate.trainSummary.daysBet >= minimumBetDays);

  const fallbackCandidates =
    candidates.length > 0
      ? candidates
      : policyRuns.map((run) => ({
          run,
          trainSummary: summarizeDaily(run.daily.slice(0, dateIndex)),
        }));

  return fallbackCandidates.sort((left, right) => {
    const summaryCompare = compareSummaries(left.trainSummary, right.trainSummary);
    if (summaryCompare !== 0) return summaryCompare;
    return left.run.policy.id.localeCompare(right.run.policy.id);
  })[0];
}

function summarizeMarkets(walkForwardDaily: WalkForwardDaily[]): Array<{
  market: string;
  picks: number;
  correct: number;
  accuracyPct: number;
}> {
  const buckets = new Map<string, { picks: number; correct: number }>();
  walkForwardDaily.forEach((day) => {
    if (!day.betPlaced) return;
    day.selected.forEach((pick) => {
      const bucket = buckets.get(pick.market) ?? { picks: 0, correct: 0 };
      bucket.picks += 1;
      if (pick.correct) bucket.correct += 1;
      buckets.set(pick.market, bucket);
    });
  });
  return Array.from(buckets.entries())
    .map(([market, bucket]) => ({
      market,
      picks: bucket.picks,
      correct: bucket.correct,
      accuracyPct: pct(bucket.correct, bucket.picks),
    }))
    .sort((left, right) => right.picks - left.picks || left.market.localeCompare(right.market));
}

function summarizeChosenPolicies(walkForwardDaily: WalkForwardDaily[]): Array<{
  policyId: string;
  label: string;
  days: number;
}> {
  const counts = new Map<string, { label: string; days: number }>();
  walkForwardDaily.forEach((day) => {
    const current = counts.get(day.chosenPolicyId) ?? { label: day.chosenPolicyLabel, days: 0 };
    current.days += 1;
    counts.set(day.chosenPolicyId, current);
  });
  return Array.from(counts.entries())
    .map(([policyId, value]) => ({ policyId, label: value.label, days: value.days }))
    .sort((left, right) => right.days - left.days || left.policyId.localeCompare(right.policyId));
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  if (!/[",\r\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildDailyCsv(days: WalkForwardDaily[]): string {
  const header = [
    "date",
    "chosenPolicyId",
    "picks",
    "correct",
    "betPlaced",
    "cardHit",
    "fivePlusHit",
    "forcedFillPicks",
    "profitUnits",
    "trainDays",
    "trainDaysBet",
    "trainCardHitRatePct",
    "trainLegAccuracyPct",
  ];
  const rows = days.map((day) =>
    [
      day.date,
      day.chosenPolicyId,
      day.picks,
      day.correct,
      day.betPlaced,
      day.cardHit,
      day.fivePlusHit,
      day.forcedFillPicks,
      day.profitUnits,
      day.trainDays,
      day.trainDaysBet,
      day.trainCardHitRatePct,
      day.trainLegAccuracyPct,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function buildPickCsv(days: WalkForwardDaily[]): string {
  const header = [
    "date",
    "chosenPolicyId",
    "rank",
    "playerName",
    "playerId",
    "market",
    "side",
    "score",
    "selectionStage",
    "correct",
    "holdoutAccuracy",
    "modelAccuracy",
    "expectedMinutes",
    "minutesVolatility",
    "absLineGap",
  ];
  const rows = days.flatMap((day) =>
    day.selected.map((pick) =>
      [
        day.date,
        day.chosenPolicyId,
        pick.rank,
        pick.playerName,
        pick.playerId,
        pick.market,
        pick.side,
        pick.score,
        pick.selectionStage,
        pick.correct,
        pick.holdoutAccuracy,
        pick.modelAccuracy,
        pick.expectedMinutes,
        pick.minutesVolatility,
        pick.absLineGap,
      ]
        .map(csvEscape)
        .join(","),
    ),
  );
  return [header.join(","), ...rows].join("\n");
}

function formatSummary(summary: Summary): string {
  return [
    `- Dates evaluated: ${summary.totalDates}`,
    `- Bet days: ${summary.daysBet} (${summary.coveragePct}%), underfilled/no-bet days: ${summary.underfilledDays}`,
    `- Leg accuracy: ${summary.correct}/${summary.picks} (${summary.legAccuracyPct}%, Wilson ${summary.legAccuracyWilsonPct.low}-${summary.legAccuracyWilsonPct.high}%)`,
    `- Full-card hits: ${summary.cardsHit}/${summary.daysBet} (${summary.cardHitRatePct}%, Wilson ${summary.cardHitWilsonPct.low}-${summary.cardHitWilsonPct.high}%)`,
    `- 5+ win cards: ${summary.fivePlusCards}/${summary.daysBet} (${summary.fivePlusRatePct}%)`,
    `- Forced-fill legs: ${summary.forcedFillPicks}/${summary.picks} (${summary.forcedFillPct}%)`,
    `- Average wins per bet: ${summary.avgWinsPerBet}`,
    `- Assumed-unit profit: ${summary.profitUnits}u, ROI: ${summary.roiPct}%`,
    `- Max drawdown: ${summary.maxDrawdownUnits}u, max losing streak: ${summary.maxLosingStreak}`,
  ].join("\n");
}

function markdownTable(headers: string[], rows: unknown[][]): string {
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((value) => String(value ?? "")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function buildMarkdownReport(input: {
  generatedAt: string;
  args: Args;
  history: HistoryArtifact;
  hgb: HgbArtifact | null;
  lockedReplay: LockedReplayArtifact | null;
  dateRange: { start: string; end: string; count: number };
  policyCount: number;
  baselineRun: PolicyRun;
  sameWindowBest: PolicyRun;
  topDiagnosticRuns: PolicyRun[];
  walkForwardSummary: Summary;
  walkForwardDaily: WalkForwardDaily[];
  marketSummary: ReturnType<typeof summarizeMarkets>;
  chosenPolicySummary: ReturnType<typeof summarizeChosenPolicies>;
}): string {
  const legDecimal = americanToDecimal(input.args.odds);
  const parlayDecimal = legDecimal ** input.args.legs;
  const breakEvenPct = pct(1, parlayDecimal, 2);
  const recentDays = input.walkForwardDaily.slice(-10);

  return `# Parlay Backtest Results

Generated: ${input.generatedAt}

## Integrity Contract

- Primary result is honest walk-forward: each evaluation date chooses a policy using only earlier dates, then applies it to that date.
- Same-window best is shown for diagnostics only and should be treated as overfit until it survives walk-forward.
- Daily cards are forced to ${input.args.legs} legs by default. If policy filters underfill, the backtest fills from the next best candidates and labels those as forced-fill legs.
- Candidate rows come from \`${input.args.history}\`; HGB walk-forward scores ${input.hgb ? `come from \`${input.args.hgb}\`` : "were not available"}.
- The history artifact does not carry full game/team IDs, so this backtest cannot replay same-game/team correlation caps. The live card still applies those runtime controls.
- Profit assumes flat ${input.args.odds} American odds per leg. Actual sportsbook prices, boosts, limits, voids, and correlated-payout rules can change real results.

## Dataset

- History version: ${input.history.version ?? "unknown"}
- Candidate rows: ${input.history.rows?.length ?? input.history.rowCount ?? 0}
- Dates: ${input.dateRange.start} through ${input.dateRange.end} (${input.dateRange.count})
- Policies searched: ${input.policyCount}
- Legs tested: ${input.args.legs}
- Per-leg decimal odds: ${round(legDecimal, 4)}
- Parlay decimal odds: ${round(parlayDecimal, 4)}
- Break-even full-card hit rate: ${breakEvenPct}%
- Daily leg mandate: ${input.args.forceDailyLegs ? `forced ${input.args.legs}-leg cards` : "underfilled cards allowed"}

## Honest Walk-Forward Result

${formatSummary(input.walkForwardSummary)}

## Baseline V6 Replay From Candidate History

Policy: \`${input.baselineRun.policy.id}\`

${formatSummary(input.baselineRun.summary)}

## Locked Pregame Reference

The separate locked replay artifact reports:

\`\`\`json
${JSON.stringify(input.lockedReplay?.summary ?? null, null, 2)}
\`\`\`

## Same-Window Best Diagnostic

Policy: \`${input.sameWindowBest.policy.id}\`

${formatSummary(input.sameWindowBest.summary)}

This section is intentionally marked diagnostic because it chooses the policy after seeing the whole backtest window.

## Top Diagnostic Policies

${markdownTable(
  ["rank", "policy", "coverage", "card hit", "leg acc", "forced", "roi", "drawdown"],
  input.topDiagnosticRuns.map((run, index) => [
    index + 1,
    `\`${run.policy.id}\``,
    `${run.summary.coveragePct}%`,
    `${run.summary.cardHitRatePct}%`,
    `${run.summary.legAccuracyPct}%`,
    `${run.summary.forcedFillPct}%`,
    `${run.summary.roiPct}%`,
    `${run.summary.maxDrawdownUnits}u`,
  ]),
)}

## Walk-Forward Markets

${markdownTable(
  ["market", "picks", "correct", "accuracy"],
  input.marketSummary.map((row) => [row.market, row.picks, row.correct, `${row.accuracyPct}%`]),
)}

## Walk-Forward Policy Usage

${markdownTable(
  ["policy", "days"],
  input.chosenPolicySummary.slice(0, 15).map((row) => [`\`${row.policyId}\``, row.days]),
)}

## Recent Walk-Forward Cards

${markdownTable(
  ["date", "policy", "wins", "hit", "profit"],
  recentDays.map((day) => [day.date, `\`${day.chosenPolicyId}\``, `${day.correct}/${day.picks}`, day.cardHit, `${day.profitUnits}u`]),
)}

## Read This Before Betting

This is a strong research harness, not a guarantee engine. Six-leg parlays are high variance even when each leg has a real edge. Use the walk-forward section as the truth source, keep stake sizing small, and prefer no-bet days over forcing weak legs.
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const history = await readJson<HistoryArtifact>(args.history);
  const rows = history.rows ?? [];
  if (rows.length === 0) {
    throw new Error(`No rows found in ${args.history}`);
  }

  const hgb = existsSync(path.resolve(args.hgb)) ? await readJson<HgbArtifact>(args.hgb) : null;
  const lockedReplay = existsSync(path.resolve(args.lockedReplay))
    ? await readJson<LockedReplayArtifact>(args.lockedReplay)
    : null;
  const hgbScores = new Map(Object.entries(hgb?.walkForwardScores ?? {}));
  const rowsByDate = new Map<string, PriorityHistoryRow[]>();
  rows.forEach((row) => {
    const bucket = rowsByDate.get(row.date) ?? [];
    bucket.push(row);
    rowsByDate.set(row.date, bucket);
  });

  const dates = Array.from(rowsByDate.keys()).sort((left, right) => left.localeCompare(right));
  if (dates.length <= args.warmupDates) {
    throw new Error(`Need more than ${args.warmupDates} dates for walk-forward evaluation; found ${dates.length}`);
  }

  const policies = buildPolicies(hgbScores.size > 0);
  const policyRuns = policies.map((policy) => evaluatePolicy(policy, rowsByDate, dates, hgbScores, args));
  const minimumAllWindowBets = Math.ceil(dates.length * (args.minTrainCoveragePct / 100));
  const diagnosticPool = policyRuns.filter((run) => run.summary.daysBet >= minimumAllWindowBets);
  const rankedDiagnostic = (diagnosticPool.length > 0 ? diagnosticPool : policyRuns).slice().sort(comparePolicyRuns);
  const sameWindowBest = rankedDiagnostic[0];
  const baselineRun = policyRuns.find((run) => run.policy.id.startsWith("baseline-v6")) ?? policyRuns[0];
  const parlayWinProfitUnits = americanToDecimal(args.odds) ** args.legs - 1;

  const walkForwardDaily: WalkForwardDaily[] = [];
  for (let index = args.warmupDates; index < dates.length; index += 1) {
    const date = dates[index];
    const choice = chooseWalkForwardPolicy(policyRuns, index, args);
    const evaluation = evaluatePolicyDay(
      date,
      rowsByDate.get(date) ?? [],
      choice.run.policy,
      hgbScores,
      args.legs,
      parlayWinProfitUnits,
      args.forceDailyLegs,
    );
    walkForwardDaily.push({
      ...evaluation.metric,
      chosenPolicyId: choice.run.policy.id,
      chosenPolicyLabel: choice.run.policy.label,
      trainDays: choice.trainSummary.totalDates,
      trainDaysBet: choice.trainSummary.daysBet,
      trainCardHitRatePct: choice.trainSummary.cardHitRatePct,
      trainLegAccuracyPct: choice.trainSummary.legAccuracyPct,
      selected: evaluation.selected,
    });
  }

  const walkForwardSummary = summarizeDaily(walkForwardDaily);
  const marketSummary = summarizeMarkets(walkForwardDaily);
  const chosenPolicySummary = summarizeChosenPolicies(walkForwardDaily);
  const generatedAt = new Date().toISOString();
  const output = {
    generatedAt,
    args,
    dataset: {
      historyVersion: history.version ?? null,
      historyGeneratedAt: history.generatedAt ?? null,
      hgbVersion: hgb?.version ?? null,
      hgbGeneratedAt: hgb?.generatedAt ?? null,
      lockedReplayVersion: lockedReplay?.version ?? null,
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
        count: dates.length,
      },
      rowCount: rows.length,
      hgbScoreCount: hgbScores.size,
    },
    searchedPolicies: policies.length,
    baseline: {
      policy: baselineRun.policy,
      summary: baselineRun.summary,
    },
    lockedReplayReference: lockedReplay?.summary ?? null,
    sameWindowBestDiagnostic: {
      policy: sameWindowBest.policy,
      summary: sameWindowBest.summary,
    },
    topDiagnosticPolicies: rankedDiagnostic.slice(0, args.topPolicies).map((run) => ({
      policy: run.policy,
      summary: run.summary,
    })),
    walkForward: {
      summary: walkForwardSummary,
      marketSummary,
      chosenPolicySummary,
      daily: walkForwardDaily,
    },
  };

  const outPrefix = path.resolve(args.outPrefix);
  await mkdir(path.dirname(outPrefix), { recursive: true });
  await writeFile(`${outPrefix}.json`, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(`${outPrefix}-daily.csv`, buildDailyCsv(walkForwardDaily), "utf8");
  await writeFile(`${outPrefix}-picks.csv`, buildPickCsv(walkForwardDaily), "utf8");
  await writeFile(
    `${outPrefix}.md`,
    buildMarkdownReport({
      generatedAt,
      args,
      history,
      hgb,
      lockedReplay,
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
        count: dates.length,
      },
      policyCount: policies.length,
      baselineRun,
      sameWindowBest,
      topDiagnosticRuns: rankedDiagnostic.slice(0, args.topPolicies),
      walkForwardSummary,
      walkForwardDaily,
      marketSummary,
      chosenPolicySummary,
    }),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        out: {
          json: `${outPrefix}.json`,
          markdown: `${outPrefix}.md`,
          dailyCsv: `${outPrefix}-daily.csv`,
          picksCsv: `${outPrefix}-picks.csv`,
        },
        policiesSearched: policies.length,
        dates: `${dates[0]} to ${dates[dates.length - 1]}`,
        baseline: baselineRun.summary,
        walkForward: walkForwardSummary,
        sameWindowBestDiagnostic: {
          policyId: sameWindowBest.policy.id,
          summary: sameWindowBest.summary,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
