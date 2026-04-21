import type { SnapshotMarket, SnapshotModelSide, SnapshotPropSignalGrade } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type SupportedMarket = SnapshotPropSignalGrade["market"];
type TrackedSide = "OVER" | "UNDER";

type PropSignalInput = {
  market: SnapshotMarket;
  side: SnapshotModelSide;
  projectedValue: number | null;
  line: number | null;
  confidence: number | null;
  expectedMinutes: number | null;
  l5MinutesAvg: number | null;
  minutesVolatility: number | null;
  trendVsSeason: number | null;
  l5CurrentLineDeltaAvg: number | null;
  weightedCurrentLineOverRate: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  completenessScore: number | null;
};

type RuleKey =
  | "projectionGap"
  | "confidence"
  | "workload"
  | "stability"
  | "recentForm"
  | "l5CurrentLineDeltaAvg"
  | "weightedCurrentLineOverRate"
  | "opponentAllowance"
  | "opponentAllowanceDelta"
  | "completenessScore";

type SignalRule = {
  key: RuleKey;
  weight: number;
  reason: (side: TrackedSide) => string;
  evaluate: (input: PropSignalInput, side: TrackedSide) => boolean | null;
};

type SignalCombo = {
  keys: RuleKey[];
  reason: (side: TrackedSide) => string;
};

type MarketConfig = {
  thresholds: {
    projectionGap: { over: number; under: number };
    trendVsSeason: { over: number; under: number };
    l5CurrentLineDeltaAvg: { over: number; under: number };
    weightedCurrentLineOverRate: { over: number; under: number };
    opponentAllowance: { over: number; under: number };
    opponentAllowanceDelta: { over: number; under: number };
  };
  rules: SignalRule[];
  combos: SignalCombo[];
};

function safeLineGap(projectedValue: number | null, line: number | null) {
  if (projectedValue == null || line == null) return null;
  return projectedValue - line;
}

function gte(value: number | null, threshold: number) {
  return value != null && value >= threshold;
}

function lte(value: number | null, threshold: number) {
  return value != null && value <= threshold;
}

function supportsDirectionalThreshold(
  value: number | null,
  side: TrackedSide,
  threshold: { over: number; under: number },
) {
  if (value == null) return null;
  return side === "OVER" ? gte(value, threshold.over) : lte(value, threshold.under);
}

function resolveTrackedSide(input: PropSignalInput): TrackedSide | null {
  if (input.side === "OVER" || input.side === "UNDER") return input.side;

  const lineGap = safeLineGap(input.projectedValue, input.line);
  if (lineGap == null || Math.abs(lineGap) < 0.15) {
    return null;
  }

  return lineGap > 0 ? "OVER" : "UNDER";
}

function resolveMinutesBase(input: PropSignalInput) {
  if (input.expectedMinutes != null && input.l5MinutesAvg != null) {
    return round((input.expectedMinutes + input.l5MinutesAvg) / 2, 3);
  }
  return input.expectedMinutes ?? input.l5MinutesAvg ?? null;
}

const PTS_THRESHOLDS = {
  projectionGap: { over: 1.0, under: -1.0 },
  trendVsSeason: { over: 0.9, under: -0.9 },
  l5CurrentLineDeltaAvg: { over: 0.8, under: -0.8 },
  weightedCurrentLineOverRate: { over: 0.56, under: 0.44 },
  opponentAllowance: { over: 10.2, under: 9.5 },
  opponentAllowanceDelta: { over: 0.45, under: -0.45 },
} as const;

const REB_THRESHOLDS = {
  projectionGap: { over: 0.65, under: -0.65 },
  trendVsSeason: { over: 0.5, under: -0.5 },
  l5CurrentLineDeltaAvg: { over: 0.45, under: -0.45 },
  weightedCurrentLineOverRate: { over: 0.54, under: 0.46 },
  opponentAllowance: { over: 3.55, under: 3.1 },
  opponentAllowanceDelta: { over: 0.12, under: -0.12 },
} as const;

const AST_THRESHOLDS = {
  projectionGap: { over: 0.5, under: -0.5 },
  trendVsSeason: { over: 0.45, under: -0.45 },
  l5CurrentLineDeltaAvg: { over: 0.35, under: -0.35 },
  weightedCurrentLineOverRate: { over: 0.54, under: 0.46 },
  opponentAllowance: { over: 2.35, under: 2.0 },
  opponentAllowanceDelta: { over: 0.15, under: -0.15 },
} as const;

const SIGNAL_CONFIG: Record<SupportedMarket, MarketConfig> = {
  PTS: {
    thresholds: PTS_THRESHOLDS,
    rules: [
      {
        key: "projectionGap",
        weight: 5.2,
        reason: () => "Projection is giving the current read a real cushion versus the line.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, PTS_THRESHOLDS.projectionGap),
      },
      {
        key: "confidence",
        weight: 4.1,
        reason: () => "Live model confidence cleared the support bar.",
        evaluate: (input) => gte(input.confidence, 58),
      },
      {
        key: "workload",
        weight: 2.5,
        reason: () => "Role and minute load are healthy enough to matter here.",
        evaluate: (input) => gte(resolveMinutesBase(input), 24),
      },
      {
        key: "stability",
        weight: 2.1,
        reason: () => "The player’s role looks stable enough to trust right now.",
        evaluate: (input) =>
          input.minutesVolatility == null ? null : lte(input.minutesVolatility, 6.1),
      },
      {
        key: "recentForm",
        weight: 2.6,
        reason: () => "Recent player form is moving with the current read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.trendVsSeason, side, PTS_THRESHOLDS.trendVsSeason),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 3.1,
        reason: () => "Recent results versus this line are supportive.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.weightedCurrentLineOverRate,
            side,
            PTS_THRESHOLDS.weightedCurrentLineOverRate,
          ),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.6,
        reason: () => "Last-five line results are reinforcing the read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.l5CurrentLineDeltaAvg,
            side,
            PTS_THRESHOLDS.l5CurrentLineDeltaAvg,
          ),
      },
      {
        key: "opponentAllowance",
        weight: 1.9,
        reason: () => "Opponent season allowance is supportive for the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowance,
            side,
            PTS_THRESHOLDS.opponentAllowance,
          ),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.7,
        reason: () => "Opponent’s recent allowance trend is reinforcing the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowanceDelta,
            side,
            PTS_THRESHOLDS.opponentAllowanceDelta,
          ),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["projectionGap", "weightedCurrentLineOverRate"],
        reason: () => "Projection and recent market fit are lined up.",
      },
      {
        keys: ["recentForm", "opponentAllowanceDelta"],
        reason: () => "Player form and opponent context are both supportive.",
      },
      {
        keys: ["opponentAllowance", "opponentAllowanceDelta"],
        reason: () => "Opponent season profile and recent allowance are both supportive.",
      },
      {
        keys: ["workload", "stability"],
        reason: () => "Role and minutes look stable enough to trust.",
      },
    ],
  },
  REB: {
    thresholds: REB_THRESHOLDS,
    rules: [
      {
        key: "projectionGap",
        weight: 4.8,
        reason: () => "Projection is giving the current read a useful cushion versus the line.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, REB_THRESHOLDS.projectionGap),
      },
      {
        key: "confidence",
        weight: 3.6,
        reason: () => "Live model confidence cleared the support bar.",
        evaluate: (input) => gte(input.confidence, 55),
      },
      {
        key: "workload",
        weight: 2.2,
        reason: () => "Role and minute load are healthy enough to matter here.",
        evaluate: (input) => gte(resolveMinutesBase(input), 22),
      },
      {
        key: "stability",
        weight: 2.0,
        reason: () => "The player’s role looks stable enough to trust right now.",
        evaluate: (input) =>
          input.minutesVolatility == null ? null : lte(input.minutesVolatility, 6.4),
      },
      {
        key: "recentForm",
        weight: 2.2,
        reason: () => "Recent player form is moving with the current read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.trendVsSeason, side, REB_THRESHOLDS.trendVsSeason),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 2.9,
        reason: () => "Recent results versus this line are supportive.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.weightedCurrentLineOverRate,
            side,
            REB_THRESHOLDS.weightedCurrentLineOverRate,
          ),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.4,
        reason: () => "Last-five line results are reinforcing the read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.l5CurrentLineDeltaAvg,
            side,
            REB_THRESHOLDS.l5CurrentLineDeltaAvg,
          ),
      },
      {
        key: "opponentAllowance",
        weight: 2.0,
        reason: () => "Opponent season allowance is supportive for the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowance,
            side,
            REB_THRESHOLDS.opponentAllowance,
          ),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.9,
        reason: () => "Opponent’s recent allowance trend is reinforcing the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowanceDelta,
            side,
            REB_THRESHOLDS.opponentAllowanceDelta,
          ),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["projectionGap", "opponentAllowanceDelta"],
        reason: () => "Projection edge and matchup are lined up.",
      },
      {
        keys: ["opponentAllowance", "opponentAllowanceDelta"],
        reason: () => "Opponent season profile and recent allowance are both supportive.",
      },
      {
        keys: ["workload", "stability"],
        reason: () => "Role and minutes look stable enough to trust.",
      },
      {
        keys: ["weightedCurrentLineOverRate", "l5CurrentLineDeltaAvg"],
        reason: () => "Recent line history is supporting the read from two angles.",
      },
    ],
  },
  AST: {
    thresholds: AST_THRESHOLDS,
    rules: [
      {
        key: "projectionGap",
        weight: 4.9,
        reason: () => "Projection is giving the current read a useful cushion versus the line.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, AST_THRESHOLDS.projectionGap),
      },
      {
        key: "confidence",
        weight: 3.8,
        reason: () => "Live model confidence cleared the support bar.",
        evaluate: (input) => gte(input.confidence, 55),
      },
      {
        key: "workload",
        weight: 2.3,
        reason: () => "Role and minute load are healthy enough to matter here.",
        evaluate: (input) => gte(resolveMinutesBase(input), 24),
      },
      {
        key: "stability",
        weight: 2.0,
        reason: () => "The player’s role looks stable enough to trust right now.",
        evaluate: (input) =>
          input.minutesVolatility == null ? null : lte(input.minutesVolatility, 6.1),
      },
      {
        key: "recentForm",
        weight: 2.5,
        reason: () => "Recent player form is moving with the current read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.trendVsSeason, side, AST_THRESHOLDS.trendVsSeason),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 2.9,
        reason: () => "Recent results versus this line are supportive.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.weightedCurrentLineOverRate,
            side,
            AST_THRESHOLDS.weightedCurrentLineOverRate,
          ),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.4,
        reason: () => "Last-five line results are reinforcing the read.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.l5CurrentLineDeltaAvg,
            side,
            AST_THRESHOLDS.l5CurrentLineDeltaAvg,
          ),
      },
      {
        key: "opponentAllowance",
        weight: 1.8,
        reason: () => "Opponent season allowance is supportive for the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowance,
            side,
            AST_THRESHOLDS.opponentAllowance,
          ),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.9,
        reason: () => "Opponent’s recent allowance trend is reinforcing the matchup.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(
            input.opponentAllowanceDelta,
            side,
            AST_THRESHOLDS.opponentAllowanceDelta,
          ),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["recentForm", "opponentAllowanceDelta"],
        reason: () => "Player form and opponent context are both supportive.",
      },
      {
        keys: ["opponentAllowance", "opponentAllowanceDelta"],
        reason: () => "Opponent season profile and recent allowance are both supportive.",
      },
      {
        keys: ["weightedCurrentLineOverRate", "l5CurrentLineDeltaAvg"],
        reason: () => "Recent line history is supporting the read from two angles.",
      },
      {
        keys: ["workload", "stability"],
        reason: () => "Role and minutes look stable enough to trust.",
      },
    ],
  },
};

function scoreToGrade(scorePct: number): SnapshotPropSignalGrade["grade"] {
  if (scorePct >= 78) return "A";
  if (scorePct >= 58) return "B";
  if (scorePct >= 38) return "C";
  return "D";
}

function buildSummary(
  market: SupportedMarket,
  matchedSignals: number,
  totalSignals: number,
  comboReasons: string[],
  grade: SnapshotPropSignalGrade["grade"],
) {
  const base = `${matchedSignals} of ${totalSignals} context signals matched for ${market}.`;
  if (comboReasons.length > 0) {
    return `${base} ${comboReasons[0]}`;
  }
  if (grade === "A") {
    return `${base} Form, role, and matchup are all lined up.`;
  }
  if (grade === "B") {
    return `${base} Several key inputs are pointing the same way.`;
  }
  if (grade === "C") {
    return `${base} There is some support here, but the picture is mixed.`;
  }
  return `${base} The overall setup still looks thin right now.`;
}

export function buildPropSignalGrade(input: PropSignalInput): SnapshotPropSignalGrade | null {
  if (input.market !== "PTS" && input.market !== "REB" && input.market !== "AST") {
    return null;
  }

  const trackedSide = resolveTrackedSide(input);
  if (trackedSide == null) {
    return null;
  }

  const config = SIGNAL_CONFIG[input.market];
  const matchedKeys = new Set<RuleKey>();
  const reasons: string[] = [];
  let matchedWeight = 0;
  let availableWeight = 0;

  for (const rule of config.rules) {
    const outcome = rule.evaluate(input, trackedSide);
    if (outcome == null) continue;
    availableWeight += rule.weight;
    if (!outcome) continue;
    matchedKeys.add(rule.key);
    matchedWeight += rule.weight;
    reasons.push(rule.reason(trackedSide));
  }

  const comboReasons = config.combos
    .filter((combo) => combo.keys.every((key) => matchedKeys.has(key)))
    .map((combo) => combo.reason(trackedSide));

  const availableSignals = config.rules.filter((rule) => rule.evaluate(input, trackedSide) != null).length;
  if (availableSignals === 0 || availableWeight <= 0) {
    return null;
  }

  const scorePct = round((matchedWeight / availableWeight) * 100, 1);
  const grade = scoreToGrade(scorePct);

  return {
    market: input.market,
    side: trackedSide,
    grade,
    scorePct,
    matchedSignals: matchedKeys.size,
    totalSignals: availableSignals,
    summary: buildSummary(input.market, matchedKeys.size, availableSignals, comboReasons, grade),
    reasons: Array.from(new Set([...comboReasons, ...reasons])).slice(0, 4),
  };
}
