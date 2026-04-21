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
  l5CurrentLineDeltaAvg: number | null;
  weightedCurrentLineOverRate: number | null;
  opponentAllowance: number | null;
  opponentAllowanceDelta: number | null;
  completenessScore: number | null;
};

type RuleKey =
  | "projectionGap"
  | "confidence"
  | "expectedMinutes"
  | "l5MinutesAvg"
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

const SIGNAL_CONFIG: Record<SupportedMarket, MarketConfig> = {
  PTS: {
    rules: [
      {
        key: "projectionGap",
        weight: 5.2,
        reason: (side) =>
          side === "OVER"
            ? "Projection is clearing the PTS line by a healthy margin."
            : "Projection is sitting comfortably below the PTS line.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, {
            over: 1.05,
            under: -1.05,
          }),
      },
      {
        key: "confidence",
        weight: 4.1,
        reason: () => "Live model confidence cleared the PTS support bar.",
        evaluate: (input) => gte(input.confidence, 58),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 3.4,
        reason: (side) =>
          side === "OVER"
            ? "Recent games have been beating this PTS line often enough to back the over."
            : "Recent games have been staying under this PTS line often enough to back the under.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.weightedCurrentLineOverRate, side, {
            over: 0.56,
            under: 0.44,
          }),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.8,
        reason: (side) =>
          side === "OVER"
            ? "Last-five scoring results are landing above this number on average."
            : "Last-five scoring results are landing below this number on average.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.l5CurrentLineDeltaAvg, side, {
            over: 0.8,
            under: -0.8,
          }),
      },
      {
        key: "expectedMinutes",
        weight: 2.3,
        reason: (side) =>
          side === "OVER"
            ? "Minutes base is strong enough to support a PTS over."
            : "Minutes base is light enough to support a PTS under.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(resolveMinutesBase(input), side, {
            over: 30.0,
            under: 27.5,
          }),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.7,
        reason: (side) =>
          side === "OVER"
            ? "Matchup is softer than league baseline for scoring."
            : "Matchup is tighter than league baseline for scoring.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.opponentAllowanceDelta, side, {
            over: 0.55,
            under: -0.55,
          }),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the PTS read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["projectionGap", "weightedCurrentLineOverRate"],
        reason: (side) =>
          side === "OVER"
            ? "Projection edge and recent line history are both leaning over."
            : "Projection edge and recent line history are both leaning under.",
      },
      {
        keys: ["confidence", "expectedMinutes"],
        reason: (side) =>
          side === "OVER"
            ? "Model confidence and workload are aligned for this over."
            : "Model confidence is there, and the workload setup is supportive of the under.",
      },
    ],
  },
  REB: {
    rules: [
      {
        key: "projectionGap",
        weight: 4.8,
        reason: (side) =>
          side === "OVER"
            ? "Projection is clearing the REB line by enough to matter."
            : "Projection is sitting below the REB line by enough to support the under.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, {
            over: 0.7,
            under: -0.7,
          }),
      },
      {
        key: "confidence",
        weight: 3.6,
        reason: () => "Live model confidence cleared the REB support bar.",
        evaluate: (input) => gte(input.confidence, 55),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 3.0,
        reason: (side) =>
          side === "OVER"
            ? "Recent rebound hit rates are supporting the over."
            : "Recent rebound hit rates are supporting the under.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.weightedCurrentLineOverRate, side, {
            over: 0.55,
            under: 0.45,
          }),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.5,
        reason: (side) =>
          side === "OVER"
            ? "Last-five rebound results are finishing above this line on average."
            : "Last-five rebound results are finishing below this line on average.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.l5CurrentLineDeltaAvg, side, {
            over: 0.45,
            under: -0.45,
          }),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 2.1,
        reason: (side) =>
          side === "OVER"
            ? "Matchup is giving up extra rebounds versus league baseline."
            : "Matchup is suppressing rebounds versus league baseline.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.opponentAllowanceDelta, side, {
            over: 0.16,
            under: -0.16,
          }),
      },
      {
        key: "expectedMinutes",
        weight: 1.7,
        reason: (side) =>
          side === "OVER"
            ? "Minutes base is healthy enough to support rebound volume."
            : "Minutes base is soft enough to keep rebound volume capped.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(resolveMinutesBase(input), side, {
            over: 28.0,
            under: 25.5,
          }),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the REB read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["projectionGap", "opponentAllowanceDelta"],
        reason: (side) =>
          side === "OVER"
            ? "Projection edge and matchup both point toward the over."
            : "Projection edge and matchup both point toward the under.",
      },
      {
        keys: ["weightedCurrentLineOverRate", "l5CurrentLineDeltaAvg"],
        reason: (side) =>
          side === "OVER"
            ? "Short-run rebound form is backing the over from two angles."
            : "Short-run rebound form is backing the under from two angles.",
      },
    ],
  },
  AST: {
    rules: [
      {
        key: "projectionGap",
        weight: 4.9,
        reason: (side) =>
          side === "OVER"
            ? "Projection is clearing the AST line by a useful margin."
            : "Projection is sitting below the AST line by a useful margin.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(safeLineGap(input.projectedValue, input.line), side, {
            over: 0.55,
            under: -0.55,
          }),
      },
      {
        key: "confidence",
        weight: 3.8,
        reason: () => "Live model confidence cleared the AST support bar.",
        evaluate: (input) => gte(input.confidence, 55),
      },
      {
        key: "weightedCurrentLineOverRate",
        weight: 3.1,
        reason: (side) =>
          side === "OVER"
            ? "Recent assist hit rates are supporting the over."
            : "Recent assist hit rates are supporting the under.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.weightedCurrentLineOverRate, side, {
            over: 0.55,
            under: 0.45,
          }),
      },
      {
        key: "l5CurrentLineDeltaAvg",
        weight: 2.6,
        reason: (side) =>
          side === "OVER"
            ? "Last-five assist results are landing above this line on average."
            : "Last-five assist results are landing below this line on average.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.l5CurrentLineDeltaAvg, side, {
            over: 0.4,
            under: -0.4,
          }),
      },
      {
        key: "expectedMinutes",
        weight: 2.2,
        reason: (side) =>
          side === "OVER"
            ? "Minutes base is strong enough to support creator volume."
            : "Minutes base is soft enough to cap creator volume.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(resolveMinutesBase(input), side, {
            over: 31.0,
            under: 28.5,
          }),
      },
      {
        key: "opponentAllowanceDelta",
        weight: 1.9,
        reason: (side) =>
          side === "OVER"
            ? "Matchup is softer than league baseline for assists."
            : "Matchup is tighter than league baseline for assists.",
        evaluate: (input, side) =>
          supportsDirectionalThreshold(input.opponentAllowanceDelta, side, {
            over: 0.2,
            under: -0.2,
          }),
      },
      {
        key: "completenessScore",
        weight: 1.1,
        reason: () => "Runtime context is complete enough to trust the AST read.",
        evaluate: (input) => gte(input.completenessScore, 72),
      },
    ],
    combos: [
      {
        keys: ["expectedMinutes", "opponentAllowanceDelta"],
        reason: (side) =>
          side === "OVER"
            ? "Creator minutes and matchup are both backing the over."
            : "Minutes context and matchup are both backing the under.",
      },
      {
        keys: ["weightedCurrentLineOverRate", "l5CurrentLineDeltaAvg"],
        reason: (side) =>
          side === "OVER"
            ? "Short-run assist form is supporting the over cleanly."
            : "Short-run assist form is supporting the under cleanly.",
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
  side: TrackedSide,
  matchedSignals: number,
  totalSignals: number,
  comboReasons: string[],
  grade: SnapshotPropSignalGrade["grade"],
) {
  const base = `${matchedSignals} of ${totalSignals} validated ${market} ${side.toLowerCase()} support signals hit.`;
  if (comboReasons.length > 0) {
    return `${base} ${comboReasons[0]}`;
  }
  if (grade === "A") {
    return `${base} This ${side.toLowerCase()} case is stacked from multiple angles.`;
  }
  if (grade === "B") {
    return `${base} Several meaningful inputs are aligned for this side.`;
  }
  if (grade === "C") {
    return `${base} There is some support here, but the stack is incomplete.`;
  }
  return `${base} This side is still a thinner context read right now.`;
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
    summary: buildSummary(input.market, trackedSide, matchedKeys.size, availableSignals, comboReasons, grade),
    reasons: [...comboReasons, ...reasons].slice(0, 4),
  };
}
