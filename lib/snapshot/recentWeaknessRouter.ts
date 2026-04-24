import type { SnapshotBoardMarketSource, SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

export const RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET = "2026-03-22";
export const RECENT_WEAKNESS_ROUTER_V1_VERSION = "recent-weakness-router-v1-2026-04-24";

type RecentWeaknessRouterMode = "off" | "v1";

type RecentWeaknessRouterExpert =
  | "alwaysOver"
  | "alwaysUnder"
  | "baseline"
  | "favored"
  | "final"
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
};

export type RecentWeaknessRouterResult = {
  side: "OVER" | "UNDER";
  source: SnapshotBoardMarketSource;
  expert: RecentWeaknessRouterExpert;
  ruleKey: RecentWeaknessRouterRuleKey;
  version: typeof RECENT_WEAKNESS_ROUTER_V1_VERSION;
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

export function getRecentWeaknessRouterMode(): RecentWeaknessRouterMode {
  const raw = process.env.SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "disabled") return "off";
  return "v1";
}

export function getRecentWeaknessRouterRuntimeMeta(): {
  mode: RecentWeaknessRouterMode;
  version: string | null;
  startDateEt: string | null;
} {
  const mode = getRecentWeaknessRouterMode();
  return {
    mode,
    version: mode === "v1" ? RECENT_WEAKNESS_ROUTER_V1_VERSION : null,
    startDateEt: mode === "v1" ? RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET : null,
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

function resolveExpertSide(input: RecentWeaknessRouterInput, expert: RecentWeaknessRouterExpert): "OVER" | "UNDER" | null {
  const baselineSide = isBinarySide(input.baselineSide) ? input.baselineSide : null;
  const finalSide = isBinarySide(input.finalSide) ? input.finalSide : baselineSide;
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

export function applyRecentWeaknessRouter(input: RecentWeaknessRouterInput): RecentWeaknessRouterResult | null {
  if (getRecentWeaknessRouterMode() !== "v1") return null;
  if (!input.gameDateEt || input.gameDateEt < RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET) return null;

  const ruleKey = `${input.market}|${input.finalSource}|${favoredKey(input.favoredSide)}` as RecentWeaknessRouterRuleKey;
  const expert = RECENT_WEAKNESS_ROUTER_V1_RULES[ruleKey];
  if (!expert) return null;

  const side = resolveExpertSide(input, expert);
  if (!side || side === input.finalSide) return null;

  return {
    side,
    source: side === input.baselineSide ? "baseline" : "universal_qualified",
    expert,
    ruleKey,
    version: RECENT_WEAKNESS_ROUTER_V1_VERSION,
  };
}
