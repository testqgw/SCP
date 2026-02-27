import type { Confidence } from "@prisma/client";
import { clamp, round } from "@/lib/utils";

export type EdgeInput = {
  recentFormOver: number;
  recentFormUnder: number;
  opponentOver: number;
  opponentUnder: number;
  seasonOver: number;
  seasonUnder: number;
  bounceOver: number;
  bounceUnder: number;
  minutesTrend: number;
  paceTotal: number;
  lineValueOver: number;
  lineValueUnder: number;
};

export type EdgeOutput = {
  overEdgeScore: number;
  underEdgeScore: number;
  edgeScore: number;
  confidence: Confidence;
  recommendedSide: "OVER" | "UNDER";
};

function weightedScore(values: {
  recentForm: number;
  opponentAllowance: number;
  seasonVsLine: number;
  bounceBack: number;
  minutesTrend: number;
  paceTotal: number;
  lineValue: number;
}): number {
  return (
    0.3 * values.recentForm +
    0.2 * values.opponentAllowance +
    0.15 * values.seasonVsLine +
    0.1 * values.bounceBack +
    0.1 * values.minutesTrend +
    0.1 * values.paceTotal +
    0.05 * values.lineValue
  );
}

export function scoreEdge(input: EdgeInput): EdgeOutput {
  const overRaw = weightedScore({
    recentForm: clamp(input.recentFormOver, 0, 100),
    opponentAllowance: clamp(input.opponentOver, 0, 100),
    seasonVsLine: clamp(input.seasonOver, 0, 100),
    bounceBack: clamp(input.bounceOver, 0, 100),
    minutesTrend: clamp(input.minutesTrend, 0, 100),
    paceTotal: clamp(input.paceTotal, 0, 100),
    lineValue: clamp(input.lineValueOver, 0, 100),
  });
  const underRaw = weightedScore({
    recentForm: clamp(input.recentFormUnder, 0, 100),
    opponentAllowance: clamp(input.opponentUnder, 0, 100),
    seasonVsLine: clamp(input.seasonUnder, 0, 100),
    bounceBack: clamp(input.bounceUnder, 0, 100),
    minutesTrend: clamp(input.minutesTrend, 0, 100),
    paceTotal: clamp(input.paceTotal, 0, 100),
    lineValue: clamp(input.lineValueUnder, 0, 100),
  });

  const overEdgeScore = round(overRaw, 2);
  const underEdgeScore = round(underRaw, 2);
  const recommendedSide = overEdgeScore >= underEdgeScore ? "OVER" : "UNDER";
  const edgeScore = Math.max(overEdgeScore, underEdgeScore);

  let confidence: Confidence = "LOW";
  if (edgeScore >= 78) {
    confidence = "A";
  } else if (edgeScore >= 68) {
    confidence = "B";
  } else if (edgeScore >= 58) {
    confidence = "C";
  }

  return {
    overEdgeScore,
    underEdgeScore,
    edgeScore,
    confidence,
    recommendedSide,
  };
}
