import type { SnapshotMarket, SnapshotPropSignalGrade } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type SupportedMarket = SnapshotPropSignalGrade["market"];

type PropSignalInput = {
  market: SnapshotMarket;
  projectedValue: number | null;
  line: number | null;
  expectedMinutes: number | null;
  l5MinutesAvg: number | null;
  l5MarketDeltaAvg: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  opponentPositionAllowance: number | null;
};

type RuleKey =
  | "projectedValue"
  | "lineGap"
  | "expectedMinutes"
  | "l5MinutesAvg"
  | "l5MarketDeltaAvg"
  | "opponentAllowance"
  | "opponentAllowanceDelta"
  | "opponentPositionAllowance";

type SignalRule = {
  key: RuleKey;
  weight: number;
  reason: string;
  evaluate: (input: PropSignalInput) => boolean | null;
};

type SignalCombo = {
  keys: RuleKey[];
  reason: string;
};

type MarketConfig = {
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

const SIGNAL_CONFIG: Record<SupportedMarket, MarketConfig> = {
  PTS: {
    rules: [
      {
        key: "projectedValue",
        weight: 5.53,
        reason: "Projection already sits in the validated high-end scoring band.",
        evaluate: (input) => (input.projectedValue == null ? null : gte(input.projectedValue, 14.92)),
      },
      {
        key: "lineGap",
        weight: 4.53,
        reason: "The live points line still sits above projection, which kept showing up in ceiling scoring spots.",
        evaluate: (input) => {
          const lineGap = safeLineGap(input.projectedValue, input.line);
          return lineGap == null ? null : lte(lineGap, -0.91);
        },
      },
      {
        key: "expectedMinutes",
        weight: 4.05,
        reason: "Expected minutes are already in the validated points ceiling range.",
        evaluate: (input) => (input.expectedMinutes == null ? null : gte(input.expectedMinutes, 30.94)),
      },
      {
        key: "l5MinutesAvg",
        weight: 3.07,
        reason: "Recent minutes are holding in the validated points ceiling range.",
        evaluate: (input) => (input.l5MinutesAvg == null ? null : gte(input.l5MinutesAvg, 30.35)),
      },
    ],
    combos: [
      {
        keys: ["projectedValue", "lineGap"],
        reason: "Projection band plus market pressure matched the strongest validated PTS combo.",
      },
      {
        keys: ["expectedMinutes", "l5MinutesAvg"],
        reason: "Minutes floor and recent workload matched the cleanest validated PTS context combo.",
      },
    ],
  },
  REB: {
    rules: [
      {
        key: "projectedValue",
        weight: 8.61,
        reason: "Projection is already in the validated rebound breakout band.",
        evaluate: (input) => (input.projectedValue == null ? null : gte(input.projectedValue, 6.47)),
      },
      {
        key: "lineGap",
        weight: 5.73,
        reason: "The rebound line sits above projection, which repeatedly lined up with ceiling rebound games.",
        evaluate: (input) => {
          const lineGap = safeLineGap(input.projectedValue, input.line);
          return lineGap == null ? null : lte(lineGap, -0.57);
        },
      },
      {
        key: "l5MarketDeltaAvg",
        weight: 2.23,
        reason: "Recent rebound results are running below the line, which historically set up bounceback breakout spots.",
        evaluate: (input) => (input.l5MarketDeltaAvg == null ? null : lte(input.l5MarketDeltaAvg, -0.75)),
      },
      {
        key: "opponentPositionAllowance",
        weight: 1.59,
        reason: "Opponent is generous to this position on rebounds.",
        evaluate: (input) =>
          input.opponentPositionAllowance == null ? null : gte(input.opponentPositionAllowance, 2.566),
      },
      {
        key: "opponentAllowance",
        weight: 1.72,
        reason: "Opponent is generous on rebounds overall.",
        evaluate: (input) => (input.opponentAllowance == null ? null : gte(input.opponentAllowance, 2.661)),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.56,
        reason: "Opponent rebound allowance is trending softer than baseline.",
        evaluate: (input) =>
          input.opponentAllowanceDelta == null ? null : gte(input.opponentAllowanceDelta, 0.144),
      },
    ],
    combos: [
      {
        keys: ["opponentPositionAllowance", "opponentAllowance"],
        reason: "Both position-specific and overall rebound matchup signals are lined up.",
      },
      {
        keys: ["l5MarketDeltaAvg", "opponentAllowanceDelta"],
        reason: "Bounceback form and a softer recent rebound matchup are both active.",
      },
    ],
  },
  AST: {
    rules: [
      {
        key: "projectedValue",
        weight: 6.45,
        reason: "Projection is already in the validated assist breakout band.",
        evaluate: (input) => (input.projectedValue == null ? null : gte(input.projectedValue, 3.43)),
      },
      {
        key: "lineGap",
        weight: 4.1,
        reason: "The assist line sits above projection, a recurring ceiling-game tell in validation.",
        evaluate: (input) => {
          const lineGap = safeLineGap(input.projectedValue, input.line);
          return lineGap == null ? null : lte(lineGap, -0.52);
        },
      },
      {
        key: "l5MinutesAvg",
        weight: 4.49,
        reason: "Recent minutes are already in the validated creator ceiling range.",
        evaluate: (input) => (input.l5MinutesAvg == null ? null : gte(input.l5MinutesAvg, 32.83)),
      },
      {
        key: "expectedMinutes",
        weight: 3.61,
        reason: "Expected minutes are elevated enough for strong assist upside.",
        evaluate: (input) => (input.expectedMinutes == null ? null : gte(input.expectedMinutes, 31.06)),
      },
      {
        key: "opponentPositionAllowance",
        weight: 2.08,
        reason: "Opponent gives up assists to this position.",
        evaluate: (input) =>
          input.opponentPositionAllowance == null ? null : gte(input.opponentPositionAllowance, 1.488),
      },
      {
        key: "l5MarketDeltaAvg",
        weight: 2.43,
        reason: "Recent assist form is already running above the line.",
        evaluate: (input) => (input.l5MarketDeltaAvg == null ? null : gte(input.l5MarketDeltaAvg, 0.9)),
      },
    ],
    combos: [
      {
        keys: ["expectedMinutes", "opponentPositionAllowance"],
        reason: "Creator minutes and matchup both hit the best validated AST combo.",
      },
      {
        keys: ["l5MinutesAvg", "l5MarketDeltaAvg"],
        reason: "Sustained workload and recent assist form are both active.",
      },
    ],
  },
};

function scoreToGrade(scorePct: number): SnapshotPropSignalGrade["grade"] {
  if (scorePct >= 75) return "A";
  if (scorePct >= 55) return "B";
  if (scorePct >= 35) return "C";
  return "D";
}

function buildSummary(
  market: SupportedMarket,
  matchedSignals: number,
  totalSignals: number,
  comboReasons: string[],
  grade: SnapshotPropSignalGrade["grade"],
) {
  const base = `${matchedSignals} of ${totalSignals} validated ${market} breakout signals hit.`;
  if (comboReasons.length > 0) {
    return `${base} ${comboReasons[0]}`;
  }
  if (grade === "A") return `${base} Signals are stacked, not just isolated.`;
  if (grade === "B") return `${base} Several strong inputs are lined up.`;
  if (grade === "C") return `${base} There is some support, but the stack is incomplete.`;
  return `${base} This reads like a thinner breakout setup right now.`;
}

export function buildPropSignalGrade(input: PropSignalInput): SnapshotPropSignalGrade | null {
  if (input.market !== "PTS" && input.market !== "REB" && input.market !== "AST") {
    return null;
  }
  const config = SIGNAL_CONFIG[input.market];
  const matchedKeys = new Set<RuleKey>();
  const reasons: string[] = [];
  let matchedWeight = 0;
  let availableWeight = 0;

  for (const rule of config.rules) {
    const outcome = rule.evaluate(input);
    if (outcome == null) continue;
    availableWeight += rule.weight;
    if (!outcome) continue;
    matchedKeys.add(rule.key);
    matchedWeight += rule.weight;
    reasons.push(rule.reason);
  }

  const comboReasons = config.combos
    .filter((combo) => combo.keys.every((key) => matchedKeys.has(key)))
    .map((combo) => combo.reason);

  const scorePct = availableWeight <= 0 ? 0 : round((matchedWeight / availableWeight) * 100, 1);
  const grade = scoreToGrade(scorePct);
  const availableSignals = config.rules.filter((rule) => rule.evaluate(input) != null).length;

  return {
    market: input.market,
    grade,
    scorePct,
    matchedSignals: matchedKeys.size,
    totalSignals: availableSignals,
    summary: buildSummary(input.market, matchedKeys.size, availableSignals, comboReasons, grade),
    reasons: [...comboReasons, ...reasons].slice(0, 4),
  };
}
