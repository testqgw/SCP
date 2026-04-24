import type { SnapshotBoardMarketSource, SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

export const RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET = "2026-03-22";
export const RECENT_WEAKNESS_ROUTER_V1_VERSION = "recent-weakness-router-v1-2026-04-24";
export const RECENT_WEAKNESS_ROUTER_V2_VERSION = "recent-weakness-router-v2-2026-04-24";

type RecentWeaknessRouterMode = "off" | "v1" | "v2";

type RecentWeaknessRouterExpert =
  | "alwaysOver"
  | "alwaysUnder"
  | "baseline"
  | "favored"
  | "final"
  | "inv_current"
  | "inv_final"
  | "inv_overProb"
  | "inv_rawSide"
  | "overProb"
  | "projection"
  | "rawDecision";

type RecentWeaknessRouterRuleKey = `${SnapshotMarket}|${SnapshotBoardMarketSource}|${"OVER" | "UNDER" | "NEUTRAL"}`;

export type RecentWeaknessRouterInput = {
  gameDateEt?: string | null;
  market: SnapshotMarket;
  finalSource: SnapshotBoardMarketSource;
  favoredSide: SnapshotModelSide | null | undefined;
  finalSide: SnapshotModelSide;
  baselineSide: SnapshotModelSide;
  rawSide: SnapshotModelSide;
  rawDecisionSide: SnapshotModelSide;
  overProbability?: number | null;
  underProbability?: number | null;
  projectedValue?: number | null;
  line?: number | null;
  projectedMinutes?: number | null;
  minutesVolatility?: number | null;
  starterRateLast10?: number | null;
  archetype?: string | null;
  modelKind?: string | null;
  minutesBucket?: string | null;
  projectionMarketAgreement?: number | null;
  leafAccuracy?: number | null;
  bucketLateAccuracy?: number | null;
  bucketModelAccuracy?: number | null;
  leafCount?: number | null;
  priceStrength?: number | null;
  projectionWinProbability?: number | null;
  projectionPriceEdge?: number | null;
};

export type RecentWeaknessRouterResult = {
  side: "OVER" | "UNDER";
  source: SnapshotBoardMarketSource;
  expert: RecentWeaknessRouterExpert;
  ruleKey: string;
  version: typeof RECENT_WEAKNESS_ROUTER_V1_VERSION | typeof RECENT_WEAKNESS_ROUTER_V2_VERSION;
};

const RECENT_WEAKNESS_ROUTER_V1_RULES: Partial<Record<RecentWeaknessRouterRuleKey, RecentWeaknessRouterExpert>> = {
  "AST|baseline|OVER": "favored",
  "AST|baseline|UNDER": "favored",
  "AST|universal_qualified|NEUTRAL": "inv_final",
  "AST|universal_qualified|OVER": "baseline",
  "PA|baseline|NEUTRAL": "overProb",
  "PA|baseline|UNDER": "projection",
  "PA|universal_qualified|NEUTRAL": "overProb",
  "PA|universal_qualified|UNDER": "alwaysOver",
  "PR|baseline|NEUTRAL": "inv_final",
  "PR|baseline|OVER": "rawDecision",
  "PR|baseline|UNDER": "favored",
  "PR|universal_qualified|OVER": "baseline",
  "PR|universal_qualified|UNDER": "projection",
  "PRA|baseline|NEUTRAL": "alwaysUnder",
  "PRA|baseline|OVER": "alwaysUnder",
  "PRA|baseline|UNDER": "rawDecision",
  "PRA|universal_qualified|NEUTRAL": "overProb",
  "PRA|universal_qualified|OVER": "baseline",
  "PTS|baseline|NEUTRAL": "rawDecision",
  "PTS|baseline|OVER": "projection",
  "PTS|baseline|UNDER": "projection",
  "PTS|universal_qualified|NEUTRAL": "alwaysOver",
  "PTS|universal_qualified|OVER": "favored",
  "RA|baseline|NEUTRAL": "overProb",
  "RA|baseline|UNDER": "rawDecision",
  "RA|universal_qualified|OVER": "favored",
  "RA|universal_qualified|UNDER": "favored",
  "REB|baseline|NEUTRAL": "rawDecision",
  "REB|baseline|OVER": "inv_rawSide",
  "REB|universal_qualified|NEUTRAL": "inv_overProb",
  "REB|universal_qualified|OVER": "baseline",
  "REB|universal_qualified|UNDER": "projection",
  "THREES|baseline|OVER": "projection",
  "THREES|universal_qualified|UNDER": "projection",
};

type RecentWeaknessRouterV2Rule = {
  key: string;
  expert: RecentWeaknessRouterExpert;
};

const RECENT_WEAKNESS_ROUTER_V2_RULES: RecentWeaknessRouterV2Rule[] = [
  { key: "market=RA|finalSource=baseline|finalSide=OVER|vol=lt8", expert: "inv_overProb" },
  { key: "market=RA|finalSource=universal_qualified|finalSide=OVER|mins=lt36|start=ge0p95", expert: "inv_overProb" },
  { key: "market=RA|finalSource=baseline|fav=UNDER|start=ge0p95", expert: "rawDecision" },
  { key: "market=REB|finalSource=baseline|finalSide=OVER|start=lt0p65", expert: "alwaysUnder" },
  { key: "market=THREES|finalSource=universal_qualified|fav=OVER|priceStrengthBin=lt0p6", expert: "alwaysUnder" },
  { key: "market=AST|finalSource=universal_qualified|fav=UNDER|leafCountBin=lt20", expert: "inv_current" },
  { key: "market=PTS|finalSource=universal_qualified|fav=UNDER|absg=lt3", expert: "alwaysOver" },
  { key: "market=THREES|finalSource=baseline|finalSide=UNDER|bucketModelAccuracyBin=lt60", expert: "alwaysOver" },
  { key: "market=PR|finalSource=universal_qualified|finalSide=UNDER|projectionPriceEdgeBin=0p25_to_inf", expert: "alwaysOver" },
  { key: "market=AST|finalSource=baseline|finalSide=OVER|bucketLateAccuracyBin=lt65", expert: "alwaysUnder" },
  { key: "market=PTS|finalSource=universal_qualified|fav=UNDER|minb=MIN_24_29", expert: "alwaysUnder" },
  { key: "market=PA|finalSource=universal_qualified|finalSide=OVER|leafAccuracyBin=ge80", expert: "inv_rawSide" },
  { key: "market=PRA|finalSource=universal_qualified|fav=NEUTRAL|finalSide=OVER|mins=lt18|start=lt0p05", expert: "rawDecision" },
  { key: "market=REB|finalSource=baseline|finalSide=UNDER|minb=LT_24", expert: "inv_rawSide" },
  { key: "market=REB|finalSource=baseline|fav=UNDER|projectionWinProbabilityBin=lt0p45", expert: "inv_current" },
  { key: "market=PR|finalSource=universal_qualified|fav=UNDER|absg=lt5", expert: "inv_current" },
  { key: "market=AST|finalSource=universal_qualified|finalSide=OVER|projectionWinProbabilityBin=lt0p65|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_rawSide" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=UNDER|leafAccuracyBin=lt70", expert: "alwaysOver" },
  { key: "market=PA|finalSource=universal_qualified|finalSide=OVER|vol=lt6", expert: "rawDecision" },
  { key: "market=REB|finalSource=universal_qualified|finalSide=UNDER|vol=lt8", expert: "inv_rawSide" },
  { key: "market=PR|finalSource=baseline|fav=OVER|arch=LEAD_GUARD", expert: "inv_current" },
  { key: "market=PR|finalSource=universal_qualified|finalSide=OVER|mins=lt30|start=ge0p95", expert: "projection" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=OVER|bucketModelAccuracyBin=lt80", expert: "baseline" },
  { key: "market=REB|finalSource=universal_qualified|finalSide=OVER|vol=lt4", expert: "alwaysUnder" },
  { key: "market=RA|finalSource=universal_qualified|finalSide=UNDER|start=lt0p95", expert: "inv_rawSide" },
  { key: "market=PTS|finalSource=universal_qualified|fav=OVER|lg=1_to_3|absg=lt3", expert: "alwaysUnder" },
  { key: "market=PR|finalSource=baseline|fav=UNDER|proj=OVER", expert: "rawDecision" },
  { key: "market=PR|finalSource=baseline|finalSide=UNDER|leafAccuracyBin=NA", expert: "rawDecision" },
  { key: "market=PA|finalSource=baseline|finalSide=OVER|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "alwaysUnder" },
  { key: "market=PRA|finalSource=universal_qualified|fav=OVER|kind=gapThenProjection", expert: "projection" },
  { key: "market=PA|finalSource=baseline|finalSide=OVER|projectionWinProbabilityBin=lt0p75|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_overProb" },
  { key: "market=RA|finalSource=baseline|fav=UNDER|bucketLateAccuracyBin=lt60", expert: "inv_current" },
  { key: "market=THREES|finalSource=universal_qualified|finalSide=OVER|arch=CONNECTOR_WING", expert: "alwaysUnder" },
  { key: "market=PR|finalSource=universal_qualified|fav=OVER|lg=1_to_3|absg=lt3", expert: "inv_current" },
  { key: "market=AST|finalSource=universal_qualified|finalSide=UNDER|vol=lt6", expert: "projection" },
  { key: "market=THREES|finalSource=baseline|finalSide=OVER|vol=lt4", expert: "inv_overProb" },
  { key: "market=RA|finalSource=universal_qualified|fav=UNDER|bucketLateAccuracyBin=lt60", expert: "projection" },
  { key: "market=PA|finalSource=baseline|finalSide=UNDER|sameCurFav=N", expert: "inv_rawSide" },
  { key: "market=PA|finalSource=universal_qualified|fav=UNDER|start=lt0p05", expert: "projection" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=OVER|mins=lt24|start=lt0p05", expert: "inv_rawSide" },
  { key: "market=THREES|finalSource=universal_qualified|finalSide=UNDER|mins=lt18|start=lt0p05", expert: "inv_overProb" },
  { key: "market=REB|finalSource=universal_qualified|fav=UNDER|projectionWinProbabilityBin=lt0p55|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "alwaysOver" },
  { key: "market=PR|finalSource=universal_qualified|fav=NEUTRAL|leafAccuracyBin=lt70", expert: "inv_rawSide" },
  { key: "market=THREES|finalSource=baseline|finalSide=UNDER|mins=lt36|start=ge0p95", expert: "inv_rawSide" },
  { key: "market=THREES|finalSource=baseline|fav=UNDER|bucketModelAccuracyBin=lt70", expert: "rawDecision" },
  { key: "market=PTS|finalSource=universal_qualified|finalSide=OVER|arch=WING", expert: "inv_rawSide" },
  { key: "market=PTS|finalSource=universal_qualified|finalSide=OVER|absg=lt8", expert: "projection" },
  { key: "market=PTS|finalSource=universal_qualified|fav=UNDER|finalSide=OVER|vol=lt8", expert: "projection" },
  { key: "market=RA|finalSource=baseline|fav=OVER|start=ge0p95", expert: "projection" },
  { key: "market=AST|finalSource=player_override|fav=UNDER|kind=lowQualityThenMarket", expert: "inv_current" },
  { key: "market=THREES|finalSource=universal_qualified|finalSide=UNDER|start=lt0p35", expert: "overProb" },
  { key: "market=PTS|finalSource=universal_qualified|fav=OVER|absg=lt2", expert: "baseline" },
  { key: "market=PRA|finalSource=baseline|finalSide=OVER|absg=lt2", expert: "alwaysUnder" },
  { key: "market=RA|finalSource=baseline|finalSide=UNDER|pmAgree=-1.0", expert: "inv_rawSide" },
  { key: "market=RA|finalSource=universal_qualified|fav=OVER|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_rawSide" },
  { key: "market=RA|finalSource=universal_qualified|finalSide=OVER|minb=MIN_24_29", expert: "baseline" },
  { key: "market=AST|finalSource=baseline|fav=NEUTRAL|proj=OVER", expert: "inv_rawSide" },
  { key: "market=THREES|finalSource=universal_qualified|finalSide=OVER|start=lt0p95", expert: "inv_overProb" },
  { key: "market=AST|finalSource=universal_qualified|finalSide=OVER|mins=lt24|start=lt0p05", expert: "inv_overProb" },
  { key: "market=PA|finalSource=player_override|finalSide=OVER|arch=TWO_WAY_MARKET_WING", expert: "favored" },
  { key: "market=PTS|finalSource=baseline|fav=OVER|projectionPriceEdgeBin=0p05_to_0p15", expert: "alwaysUnder" },
  { key: "market=PRA|finalSource=baseline|finalSide=UNDER|mins=lt24", expert: "alwaysOver" },
  { key: "market=PA|finalSource=player_override|fav=OVER|finalSide=OVER|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "baseline" },
  { key: "market=REB|finalSource=universal_qualified|fav=OVER|projectionWinProbabilityBin=lt0p55", expert: "projection" },
  { key: "market=PR|finalSource=universal_qualified|finalSide=UNDER|leafCountBin=lt20", expert: "overProb" },
  { key: "market=PA|finalSource=universal_qualified|fav=UNDER|mins=lt30|start=ge0p95", expert: "baseline" },
  { key: "market=PA|finalSource=universal_qualified|fav=OVER|mins=lt30", expert: "alwaysOver" },
  { key: "market=PR|finalSource=baseline|fav=OVER|absg=lt5", expert: "inv_rawSide" },
  { key: "market=PR|finalSource=universal_qualified|fav=UNDER|start=lt0p65", expert: "baseline" },
  { key: "market=PA|finalSource=universal_qualified|finalSide=OVER|mins=lt30|start=lt0p65", expert: "inv_rawSide" },
];

export function getRecentWeaknessRouterMode(): RecentWeaknessRouterMode {
  const raw = process.env.SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "disabled") return "off";
  if (raw === "v1") return "v1";
  return "v2";
}

export function getRecentWeaknessRouterRuntimeMeta(): {
  mode: RecentWeaknessRouterMode;
  version: string | null;
  startDateEt: string | null;
} {
  const mode = getRecentWeaknessRouterMode();
  return {
    mode,
    version: mode === "v2" ? RECENT_WEAKNESS_ROUTER_V2_VERSION : mode === "v1" ? RECENT_WEAKNESS_ROUTER_V1_VERSION : null,
    startDateEt: mode === "off" ? null : RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET,
  };
}

function isBinarySide(value: SnapshotModelSide | null | undefined): value is "OVER" | "UNDER" {
  return value === "OVER" || value === "UNDER";
}

function invertSide(value: SnapshotModelSide | null | undefined): "OVER" | "UNDER" | null {
  if (value === "OVER") return "UNDER";
  if (value === "UNDER") return "OVER";
  return null;
}

function favoredKey(value: SnapshotModelSide | null | undefined): "OVER" | "UNDER" | "NEUTRAL" {
  return value === "OVER" || value === "UNDER" ? value : "NEUTRAL";
}

function projectionSide(input: RecentWeaknessRouterInput): "OVER" | "UNDER" | null {
  const projectedValue = input.projectedValue;
  const line = input.line;
  if (projectedValue == null || line == null || !Number.isFinite(projectedValue) || !Number.isFinite(line)) {
    return null;
  }
  return projectedValue >= line ? "OVER" : "UNDER";
}

function finiteNumber(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function binNumber(value: number | null | undefined, cuts: number[], labels: string[]): string {
  const resolved = finiteNumber(value);
  if (resolved == null) return "NA";
  for (let index = 0; index < cuts.length; index += 1) {
    if (resolved < cuts[index]) return labels[index] ?? "NA";
  }
  return labels[labels.length - 1] ?? "NA";
}

function signedLineGapBin(value: number | null | undefined): string {
  return binNumber(value, [-5, -3, -1, 0, 1, 3, 5], [
    "minf_to_m5",
    "m5_to_m3",
    "m3_to_m1",
    "m1_to_0",
    "0_to_1",
    "1_to_3",
    "3_to_5",
    "5_to_inf",
  ]);
}

function projectionPriceEdgeBin(value: number | null | undefined): string {
  return binNumber(value, [-0.25, -0.15, -0.05, 0, 0.05, 0.15, 0.25], [
    "minf_to_m0p25",
    "m0p25_to_m0p15",
    "m0p15_to_m0p05",
    "m0p05_to_0",
    "0_to_0p05",
    "0p05_to_0p15",
    "0p15_to_0p25",
    "0p25_to_inf",
  ]);
}

function projectionMarketAgreementKey(value: number | null | undefined): string {
  const resolved = finiteNumber(value);
  return resolved == null ? "NA" : resolved.toFixed(1);
}

function textKey(value: string | null | undefined): string {
  return value?.trim() || "NA";
}

function probabilitySide(input: RecentWeaknessRouterInput): "OVER" | "UNDER" | null {
  const overProbability = input.overProbability;
  const underProbability = input.underProbability;
  if (
    overProbability == null ||
    underProbability == null ||
    !Number.isFinite(overProbability) ||
    !Number.isFinite(underProbability)
  ) {
    return null;
  }
  return overProbability >= underProbability ? "OVER" : "UNDER";
}

function resolveExpertSide(
  input: RecentWeaknessRouterInput,
  expert: RecentWeaknessRouterExpert,
  currentSide: SnapshotModelSide = input.finalSide,
): "OVER" | "UNDER" | null {
  const baselineSide = isBinarySide(input.baselineSide) ? input.baselineSide : null;
  const finalSide = isBinarySide(currentSide) ? currentSide : isBinarySide(input.finalSide) ? input.finalSide : baselineSide;
  const favoredSide = isBinarySide(input.favoredSide) ? input.favoredSide : baselineSide;
  const rawSide = isBinarySide(input.rawSide) ? input.rawSide : baselineSide;
  const rawDecisionSide = isBinarySide(input.rawDecisionSide) ? input.rawDecisionSide : baselineSide;
  const overProbSide = probabilitySide(input) ?? baselineSide;
  const projectedSide = projectionSide(input) ?? baselineSide;

  switch (expert) {
    case "alwaysOver":
      return "OVER";
    case "alwaysUnder":
      return "UNDER";
    case "baseline":
      return baselineSide;
    case "favored":
      return favoredSide;
    case "final":
      return finalSide;
    case "inv_current":
    case "inv_final":
      return invertSide(finalSide);
    case "inv_overProb":
      return invertSide(overProbSide);
    case "inv_rawSide":
      return invertSide(rawSide);
    case "overProb":
      return overProbSide;
    case "projection":
      return projectedSide;
    case "rawDecision":
      return rawDecisionSide;
  }
}

function sourceForRoutedSide(input: RecentWeaknessRouterInput, side: "OVER" | "UNDER"): SnapshotBoardMarketSource {
  return side === input.baselineSide ? "baseline" : "universal_qualified";
}

function applyRecentWeaknessRouterV1(input: RecentWeaknessRouterInput): RecentWeaknessRouterResult | null {
  const ruleKey = `${input.market}|${input.finalSource}|${favoredKey(input.favoredSide)}` as RecentWeaknessRouterRuleKey;
  const expert = RECENT_WEAKNESS_ROUTER_V1_RULES[ruleKey];
  if (!expert) return null;

  const side = resolveExpertSide(input, expert, input.finalSide);
  if (!side || side === input.finalSide) return null;

  return {
    side,
    source: sourceForRoutedSide(input, side),
    expert,
    ruleKey,
    version: RECENT_WEAKNESS_ROUTER_V1_VERSION,
  };
}

function buildRecentWeaknessRouterV2Features(
  input: RecentWeaknessRouterInput,
  currentSide: "OVER" | "UNDER",
  currentSource: SnapshotBoardMarketSource,
): Record<string, string> {
  const projectedSide = projectionSide(input) ?? "NEUTRAL";
  const probability = probabilitySide(input) ?? "NEUTRAL";
  const favored = favoredKey(input.favoredSide);
  const raw = isBinarySide(input.rawSide) ? input.rawSide : "NEUTRAL";

  return {
    market: input.market,
    finalSource: currentSource,
    finalSide: currentSide,
    fav: favored,
    baselineSide: input.baselineSide,
    raw_bin: raw,
    strict_bin: raw,
    rawdec: isBinarySide(input.rawDecisionSide) ? input.rawDecisionSide : "NEUTRAL",
    proj: projectedSide,
    prob: probability,
    arch: textKey(input.archetype),
    kind: textKey(input.modelKind),
    minb: textKey(input.minutesBucket),
    pmAgree: projectionMarketAgreementKey(input.projectionMarketAgreement),
    lg: signedLineGapBin(
      input.projectedValue != null && input.line != null ? input.projectedValue - input.line : null,
    ),
    absg: binNumber(Math.abs((input.projectedValue ?? Number.NaN) - (input.line ?? Number.NaN)), [1, 2, 3, 5, 8], [
      "lt1",
      "lt2",
      "lt3",
      "lt5",
      "lt8",
      "ge8",
    ]),
    mins: binNumber(input.projectedMinutes, [18, 24, 30, 36], ["lt18", "lt24", "lt30", "lt36", "ge36"]),
    vol: binNumber(input.minutesVolatility, [2, 4, 6, 8], ["lt2", "lt4", "lt6", "lt8", "ge8"]),
    start: binNumber(input.starterRateLast10, [0.05, 0.35, 0.65, 0.95], [
      "lt0p05",
      "lt0p35",
      "lt0p65",
      "lt0p95",
      "ge0p95",
    ]),
    leafAccuracyBin: binNumber(input.leafAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    bucketLateAccuracyBin: binNumber(input.bucketLateAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    bucketModelAccuracyBin: binNumber(input.bucketModelAccuracy, [55, 60, 65, 70, 75, 80], [
      "lt55",
      "lt60",
      "lt65",
      "lt70",
      "lt75",
      "lt80",
      "ge80",
    ]),
    leafCountBin: binNumber(input.leafCount, [20, 40, 80, 160, 320], [
      "lt20",
      "lt40",
      "lt80",
      "lt160",
      "lt320",
      "ge320",
    ]),
    priceStrengthBin: binNumber(input.priceStrength, [0.52, 0.56, 0.6, 0.65, 0.7], [
      "lt0p52",
      "lt0p56",
      "lt0p6",
      "lt0p65",
      "lt0p7",
      "ge0p7",
    ]),
    projectionWinProbabilityBin: binNumber(input.projectionWinProbability, [0.35, 0.45, 0.55, 0.65, 0.75], [
      "lt0p35",
      "lt0p45",
      "lt0p55",
      "lt0p65",
      "lt0p75",
      "ge0p75",
    ]),
    projectionPriceEdgeBin: projectionPriceEdgeBin(input.projectionPriceEdge),
    sameCurProj: currentSide === projectedSide ? "Y" : "N",
    sameCurProb: currentSide === probability ? "Y" : "N",
    sameCurFav: currentSide === favored ? "Y" : "N",
    sameRawProj: raw === projectedSide ? "Y" : "N",
    sameBaseRaw: input.baselineSide === raw ? "Y" : "N",
    sameCurRaw: currentSide === raw ? "Y" : "N",
  };
}

function matchesRecentWeaknessRouterV2Rule(ruleKey: string, features: Record<string, string>): boolean {
  return ruleKey.split("|").every((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) return false;
    const key = part.slice(0, separatorIndex);
    const value = part.slice(separatorIndex + 1);
    return features[key] === value;
  });
}

function applyRecentWeaknessRouterV2(
  input: RecentWeaknessRouterInput,
  currentSide: "OVER" | "UNDER",
  currentSource: SnapshotBoardMarketSource,
): RecentWeaknessRouterResult | null {
  const features = buildRecentWeaknessRouterV2Features(input, currentSide, currentSource);
  const rule = RECENT_WEAKNESS_ROUTER_V2_RULES.find((candidate) =>
    matchesRecentWeaknessRouterV2Rule(candidate.key, features),
  );
  if (!rule) return null;

  const side = resolveExpertSide(input, rule.expert, currentSide);
  if (!side || side === currentSide) return null;

  return {
    side,
    source: sourceForRoutedSide(input, side),
    expert: rule.expert,
    ruleKey: rule.key,
    version: RECENT_WEAKNESS_ROUTER_V2_VERSION,
  };
}

export function applyRecentWeaknessRouter(input: RecentWeaknessRouterInput): RecentWeaknessRouterResult | null {
  const mode = getRecentWeaknessRouterMode();
  if (mode === "off") return null;
  if (!input.gameDateEt || input.gameDateEt < RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET) return null;

  const v1Result = applyRecentWeaknessRouterV1(input);
  if (mode === "v1") return v1Result;

  const currentSide = v1Result?.side ?? input.finalSide;
  if (!isBinarySide(currentSide)) return v1Result;

  const currentSource = v1Result?.source ?? input.finalSource;
  return applyRecentWeaknessRouterV2(input, currentSide, currentSource) ?? v1Result;
}
