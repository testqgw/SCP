import { normalizeLivePlayerOverrideKey } from "@/lib/snapshot/livePlayerSideModels";
import type { SnapshotBoardMarketSource, SnapshotMarket, SnapshotModelSide } from "@/lib/types/snapshot";

export const RECENT_WEAKNESS_ROUTER_V1_START_DATE_ET = "2026-03-22";
export const RECENT_WEAKNESS_ROUTER_V1_VERSION = "recent-weakness-router-v1-2026-04-24";
export const RECENT_WEAKNESS_ROUTER_V2_VERSION = "recent-weakness-router-v2-2026-04-24";
export const RECENT_WEAKNESS_ROUTER_V3_VERSION = "recent-weakness-router-v3-2026-04-24";
export const RECENT_WEAKNESS_ROUTER_V4_VERSION = "recent-weakness-router-v4-2026-04-24";

type RecentWeaknessRouterMode = "off" | "v1" | "v2" | "v3" | "v4";

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
  playerName?: string | null;
  normalizedPlayerKey?: string | null;
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
  version:
    | typeof RECENT_WEAKNESS_ROUTER_V1_VERSION
    | typeof RECENT_WEAKNESS_ROUTER_V2_VERSION
    | typeof RECENT_WEAKNESS_ROUTER_V3_VERSION
    | typeof RECENT_WEAKNESS_ROUTER_V4_VERSION;
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

const RECENT_WEAKNESS_ROUTER_V3_RULES: RecentWeaknessRouterV2Rule[] = [
  { key: "playerMarket=oso ighodaro__RA", expert: "inv_current" },
  { key: "playerMarket=jrue holiday__AST", expert: "inv_rawSide" },
  { key: "playerMarket=ryan kalkbrenner__PTS", expert: "inv_current" },
  { key: "playerMarket=aj green__PA", expert: "inv_current" },
  { key: "playerMarket=vj edgecombe__THREES|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=mikal bridges__REB", expert: "alwaysUnder" },
  { key: "playerMarket=anthony black__PRA", expert: "inv_overProb" },
  { key: "playerMarket=mikal bridges__RA|finalSide=OVER", expert: "inv_overProb" },
  { key: "playerMarket=bruce brown__PA", expert: "inv_current" },
  { key: "playerMarket=anthony gill__AST", expert: "inv_overProb" },
  { key: "market=RA|finalSource=baseline|finalSide=UNDER|raw_bin=UNDER", expert: "projection" },
  { key: "playerMarket=desmond bane__PTS", expert: "alwaysUnder" },
  { key: "playerMarket=luke kennard__AST", expert: "inv_current" },
  { key: "playerMarket=james harden__PRA", expert: "favored" },
  { key: "playerMarket=jalen suggs__PRA", expert: "inv_overProb" },
  { key: "playerMarket=rj barrett__THREES", expert: "inv_rawSide" },
  { key: "playerMarket=aj green__PRA", expert: "alwaysOver" },
  { key: "playerMarket=max christie__PR", expert: "inv_current" },
  { key: "playerMarket=luguentz dort__RA", expert: "rawDecision" },
  { key: "playerMarket=luguentz dort__REB", expert: "alwaysUnder" },
  { key: "playerMarket=rob dillingham__REB", expert: "alwaysOver" },
  { key: "playerMarket=bruce brown__PTS|finalSide=UNDER", expert: "baseline" },
  { key: "playerMarket=scoot henderson__PA", expert: "inv_overProb" },
  { key: "playerMarket=dylan harper__REB", expert: "inv_current" },
  { key: "playerMarket=julian champagnie__AST", expert: "inv_current" },
  { key: "playerMarket=scottie barnes__PA", expert: "inv_overProb" },
  { key: "playerMarket=keon ellis__PTS|proj=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=kon knueppel__PTS", expert: "projection" },
  { key: "playerMarket=og anunoby__PR|finalSide=UNDER", expert: "favored" },
  { key: "playerMarket=de anthony melton__THREES", expert: "inv_overProb" },
  { key: "playerMarket=davion mitchell__PTS|raw_bin=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=tyler herro__PTS", expert: "inv_current" },
  { key: "playerMarket=aj green__REB", expert: "alwaysOver" },
  { key: "playerMarket=vj edgecombe__PTS|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=jamal murray__REB", expert: "alwaysOver" },
  { key: "playerMarket=shai gilgeous alexander__AST", expert: "alwaysOver" },
  { key: "playerMarket=royce o neale__PA|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=paolo banchero__PA|proj=UNDER", expert: "inv_rawSide" },
  { key: "playerMarket=aaron gordon__AST", expert: "alwaysOver" },
  { key: "playerMarket=desmond bane__PA", expert: "inv_overProb" },
  { key: "playerMarket=jrue holiday__THREES|proj=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=cason wallace__PA", expert: "alwaysUnder" },
  { key: "playerMarket=franz wagner__AST", expert: "baseline" },
  { key: "playerMarket=ryan kalkbrenner__RA", expert: "alwaysUnder" },
  { key: "playerMarket=kawhi leonard__PR", expert: "alwaysUnder" },
  { key: "playerMarket=dyson daniels__RA", expert: "projection" },
  { key: "playerMarket=tari eason__REB", expert: "inv_overProb" },
  { key: "playerMarket=ben saraf__REB", expert: "inv_overProb" },
  { key: "playerMarket=josh hart__REB", expert: "inv_current" },
  { key: "playerMarket=nickeil alexander walker__PTS|finalSide=OVER", expert: "inv_overProb" },
  { key: "playerMarket=bennedict mathurin__PRA", expert: "projection" },
  { key: "playerMarket=payton pritchard__PTS|proj=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=brandon ingram__PR", expert: "inv_current" },
  { key: "playerMarket=jakob poeltl__PRA", expert: "inv_current" },
  { key: "playerMarket=james harden__RA|proj=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=alperen sengun__PA", expert: "favored" },
  { key: "playerMarket=jalen suggs__RA", expert: "rawDecision" },
  { key: "playerMarket=shai gilgeous alexander__PTS", expert: "alwaysUnder" },
  { key: "playerMarket=jay huff__RA", expert: "alwaysOver" },
  { key: "playerMarket=karl anthony towns__PRA", expert: "alwaysOver" },
  { key: "playerMarket=scottie barnes__PTS", expert: "rawDecision" },
  { key: "playerMarket=tari eason__PTS", expert: "alwaysOver" },
  { key: "playerMarket=payton pritchard__THREES|finalSide=UNDER", expert: "inv_rawSide" },
  { key: "playerMarket=max christie__THREES", expert: "inv_current" },
  { key: "normalizedPlayerKey=mikal bridges|market=PRA|fav=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=julian champagnie__PR", expert: "inv_overProb" },
  { key: "normalizedPlayerKey=vj edgecombe|market=PA|fav=OVER", expert: "inv_current" },
  { key: "playerMarket=cj mccollum__AST|proj=OVER", expert: "inv_rawSide" },
  { key: "playerMarket=brandin podziemski__PR", expert: "favored" },
  { key: "playerMarket=de anthony melton__RA", expert: "projection" },
  { key: "playerMarket=gui santos__PTS", expert: "rawDecision" },
  { key: "playerMarket=ryan kalkbrenner__PA", expert: "alwaysUnder" },
  { key: "playerMarket=brandin podziemski__THREES", expert: "alwaysOver" },
  { key: "playerMarket=aj green__PR|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=james harden__PTS", expert: "inv_current" },
  { key: "playerMarket=kevin durant__AST", expert: "alwaysOver" },
  { key: "playerMarket=lamelo ball__PR", expert: "inv_overProb" },
  { key: "normalizedPlayerKey=vj edgecombe|market=PRA|fav=UNDER", expert: "inv_rawSide" },
  { key: "playerMarket=maxime raynaud__REB", expert: "inv_current" },
  { key: "playerMarket=jordan goodwin__THREES", expert: "alwaysOver" },
  { key: "playerMarket=naz reid__AST", expert: "alwaysUnder" },
  { key: "playerMarket=tyrese maxey__PRA|finalSide=OVER", expert: "favored" },
  { key: "playerMarket=miles bridges__PRA", expert: "favored" },
  { key: "playerMarket=scoot henderson__PTS|finalSide=OVER", expert: "projection" },
  { key: "playerMarket=scottie barnes__PR", expert: "alwaysUnder" },
  { key: "playerMarket=alperen sengun__PRA", expert: "favored" },
  { key: "playerMarket=christian braun__RA", expert: "inv_current" },
  { key: "playerMarket=cooper flagg__PA", expert: "inv_current" },
  { key: "playerMarket=ajay mitchell__PRA", expert: "alwaysUnder" },
  { key: "playerMarket=nikola jokic__REB|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=andrew wiggins__PA|proj=OVER", expert: "inv_current" },
  { key: "normalizedPlayerKey=donte divincenzo|market=PTS|fav=OVER", expert: "inv_current" },
  { key: "playerMarket=jalen johnson__REB", expert: "baseline" },
  { key: "playerMarket=kawhi leonard__PRA", expert: "alwaysUnder" },
  { key: "playerMarket=sion james__PRA|finalSide=UNDER", expert: "inv_overProb" },
  { key: "normalizedPlayerKey=ausar thompson|market=PA|fav=OVER", expert: "projection" },
  { key: "playerMarket=jalen green__AST", expert: "baseline" },
  { key: "playerMarket=leonard miller__PRA", expert: "projection" },
  { key: "playerMarket=miles bridges__PR", expert: "baseline" },
  { key: "playerMarket=ousmane dieng__PTS", expert: "baseline" },
  { key: "playerMarket=coby white__RA", expert: "alwaysUnder" },
  { key: "playerMarket=jalen johnson__PRA", expert: "baseline" },
  { key: "playerMarket=jamal murray__RA", expert: "baseline" },
  { key: "playerMarket=dillon brooks__REB|finalSide=OVER", expert: "baseline" },
  { key: "playerMarket=nikola jokic__PRA|finalSide=OVER", expert: "inv_overProb" },
  { key: "playerMarket=devin vassell__PA", expert: "inv_current" },
  { key: "playerMarket=ajay mitchell__PR", expert: "alwaysUnder" },
  { key: "playerMarket=jamal shead__RA", expert: "overProb" },
  { key: "playerMarket=kris dunn__PRA", expert: "alwaysUnder" },
  { key: "playerMarket=christian braun__PTS|raw_bin=UNDER", expert: "inv_overProb" },
  { key: "normalizedPlayerKey=tyrese maxey|market=THREES|fav=NEUTRAL", expert: "alwaysUnder" },
  { key: "playerMarket=sandro mamukelashvili__THREES", expert: "alwaysOver" },
  { key: "playerMarket=luke kennard__PR", expert: "inv_current" },
  { key: "playerMarket=cooper flagg__THREES", expert: "inv_current" },
  { key: "playerMarket=kristaps porzingis__PR", expert: "inv_current" },
  { key: "playerMarket=aj green__RA", expert: "alwaysOver" },
  { key: "playerMarket=de aaron fox__THREES", expert: "inv_rawSide" },
  { key: "playerMarket=nique clifford__REB", expert: "alwaysOver" },
  { key: "playerMarket=quenton jackson__PA", expert: "inv_rawSide" },
  { key: "playerMarket=tyrese maxey__REB|finalSide=OVER", expert: "inv_overProb" },
  { key: "playerMarket=cody williams__RA", expert: "baseline" },
  { key: "playerMarket=deni avdija__RA", expert: "inv_rawSide" },
  { key: "playerMarket=scoot henderson__RA", expert: "inv_rawSide" },
  { key: "playerMarket=tristan da silva__PTS", expert: "overProb" },
  { key: "playerMarket=desmond bane__PR|finalSide=OVER", expert: "favored" },
  { key: "playerMarket=tyrese maxey__PA|proj=UNDER", expert: "inv_rawSide" },
  { key: "playerMarket=ayo dosunmu__RA", expert: "inv_rawSide" },
  { key: "playerMarket=bennedict mathurin__REB", expert: "rawDecision" },
  { key: "playerMarket=de anthony melton__REB", expert: "alwaysOver" },
  { key: "playerMarket=ja kobe walter__THREES", expert: "alwaysOver" },
  { key: "playerMarket=jamir watkins__PA", expert: "inv_overProb" },
  { key: "playerMarket=quenton jackson__RA", expert: "rawDecision" },
  { key: "playerMarket=shai gilgeous alexander__PR", expert: "alwaysUnder" },
  { key: "playerMarket=lebron james__PA|proj=UNDER", expert: "favored" },
  { key: "playerMarket=devin vassell__PRA", expert: "overProb" },
  { key: "playerMarket=scoot henderson__AST", expert: "alwaysUnder" },
  { key: "playerMarket=jamal murray__PRA", expert: "alwaysOver" },
  { key: "playerMarket=rj barrett__PR", expert: "favored" },
  { key: "playerMarket=amen thompson__PTS|finalSide=UNDER", expert: "inv_overProb" },
  { key: "playerMarket=coby white__PR", expert: "inv_overProb" },
  { key: "playerMarket=draymond green__PTS", expert: "rawDecision" },
  { key: "playerMarket=rui hachimura__PRA", expert: "projection" },
  { key: "playerMarket=toumani camara__THREES", expert: "baseline" },
  { key: "playerMarket=donte divincenzo__PR|finalSide=UNDER", expert: "inv_overProb" },
  { key: "playerMarket=jamal shead__PA|finalSide=OVER", expert: "inv_rawSide" },
  { key: "playerMarket=jalen brunson__AST|proj=OVER", expert: "inv_overProb" },
  { key: "playerMarket=julian champagnie__PA|proj=OVER", expert: "inv_overProb" },
  { key: "playerMarket=anthony black__PA", expert: "alwaysUnder" },
  { key: "playerMarket=deandre ayton__PR", expert: "rawDecision" },
  { key: "playerMarket=devin booker__PR", expert: "rawDecision" },
  { key: "playerMarket=harrison barnes__PTS", expert: "rawDecision" },
  { key: "playerMarket=lebron james__REB", expert: "inv_overProb" },
  { key: "playerMarket=max strus__PA", expert: "inv_rawSide" },
  { key: "playerMarket=scottie barnes__REB", expert: "alwaysUnder" },
  { key: "playerMarket=ben saraf__AST|raw_bin=UNDER", expert: "projection" },
  { key: "playerMarket=max christie__PA", expert: "inv_current" },
  { key: "playerMarket=lebron james__PTS|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=tyrese maxey__AST|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=tyler herro__THREES|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=ryan kalkbrenner__PRA", expert: "alwaysUnder" },
  { key: "playerMarket=devin carter__PRA", expert: "projection" },
  { key: "playerMarket=bub carrington__PA|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=taurean prince__REB", expert: "rawDecision" },
  { key: "playerMarket=neemias queta__PRA|raw_bin=UNDER", expert: "projection" },
  { key: "normalizedPlayerKey=scoot henderson|market=REB|fav=OVER", expert: "rawDecision" },
  { key: "playerMarket=bub carrington__PTS", expert: "alwaysOver" },
  { key: "playerMarket=draymond green__PR", expert: "favored" },
  { key: "playerMarket=draymond green__RA", expert: "baseline" },
  { key: "playerMarket=jalen duren__RA", expert: "rawDecision" },
  { key: "playerMarket=oso ighodaro__PR", expert: "baseline" },
];

const RECENT_WEAKNESS_ROUTER_V4_RULES: RecentWeaknessRouterV2Rule[] = [
  { key: "market=AST|finalSource=universal_qualified|finalSide=UNDER|mins=lt24|start=lt0p65", expert: "inv_rawSide" },
  { key: "playerMarket=og anunoby__PRA|sameCurProj=Y", expert: "inv_current" },
  { key: "playerMarket=anthony edwards__PRA", expert: "inv_current" },
  { key: "playerMarket=donovan clingan__PR|absg=lt1", expert: "inv_overProb" },
  { key: "market=RA|finalSource=universal_qualified|finalSide=UNDER|mins=lt18|start=lt0p35", expert: "overProb" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=OVER|leafAccuracyBin=lt70|leafCountBin=lt80", expert: "inv_overProb" },
  { key: "market=AST|finalSource=universal_qualified|finalSide=UNDER|projectionWinProbabilityBin=lt0p65|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_overProb" },
  { key: "market=PR|finalSource=universal_qualified|finalSide=OVER|projectionWinProbabilityBin=lt0p55|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "favored" },
  { key: "playerMarket=moussa diabate__RA|absg=lt2", expert: "inv_current" },
  { key: "playerMarket=nikola vucevic__RA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=jarace walker__AST|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=goga bitadze__REB|lg=1_to_3", expert: "baseline" },
  { key: "playerMarket=cade cunningham__REB|mins=lt30", expert: "baseline" },
  { key: "playerMarket=cade cunningham__PA|mins=lt30", expert: "favored" },
  { key: "playerMarket=ausar thompson__PRA|vol=lt4", expert: "inv_current" },
  { key: "playerMarket=mikal bridges__PA|vol=ge8", expert: "alwaysUnder" },
  { key: "playerMarket=og anunoby__REB|vol=lt8", expert: "alwaysOver" },
  { key: "playerMarket=josh okogie__REB|start=lt0p35", expert: "alwaysUnder" },
  { key: "playerMarket=collin gillespie__REB|start=lt0p65", expert: "inv_current" },
  { key: "playerMarket=cameron johnson__RA|finalSide=OVER|mins=lt36", expert: "alwaysUnder" },
  { key: "playerMarket=daniss jenkins__PTS|sameCurProj=Y", expert: "inv_current" },
  { key: "playerMarket=guerschon yabusele__THREES|absg=lt1", expert: "inv_current" },
  { key: "playerMarket=jordan walsh__PTS", expert: "alwaysUnder" },
  { key: "playerMarket=mark williams__PRA", expert: "inv_current" },
  { key: "playerMarket=andrew wiggins__PR|vol=lt8", expert: "alwaysUnder" },
  { key: "market=PR|finalSource=baseline|finalSide=UNDER|projectionWinProbabilityBin=lt0p75|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_overProb" },
  { key: "market=PTS|finalSource=baseline|finalSide=UNDER|absg=lt5|proj=UNDER", expert: "inv_overProb" },
  { key: "market=AST|finalSource=universal_qualified|finalSide=UNDER|projectionWinProbabilityBin=lt0p45|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "inv_overProb" },
  { key: "playerMarket=tre jones__RA|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=jared mccain__AST", expert: "inv_current" },
  { key: "playerMarket=bez mbeng__REB", expert: "inv_current" },
  { key: "playerMarket=khris middleton__RA", expert: "inv_current" },
  { key: "playerMarket=jarace walker__THREES|raw_bin=OVER", expert: "favored" },
  { key: "playerMarket=adem bona__PTS|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=nikola jokic__PA|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=matisse thybulle__PR|prob=UNDER", expert: "inv_current" },
  { key: "playerMarket=donovan mitchell__PRA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=stephen curry__PA|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=gui santos__PR|absg=lt3", expert: "inv_current" },
  { key: "playerMarket=toumani camara__REB|rawdec=UNDER|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=josh hart__RA|rawdec=UNDER|proj=UNDER", expert: "favored" },
  { key: "playerMarket=royce o neale__REB|vol=lt6", expert: "baseline" },
  { key: "market=PRA|finalSource=baseline|finalSide=OVER|mins=lt24|start=lt0p35", expert: "projection" },
  { key: "market=RA|finalSource=baseline|finalSide=UNDER|mins=lt30|start=lt0p95", expert: "inv_rawSide" },
  { key: "playerMarket=andrew wiggins__RA|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=scottie barnes__AST|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=immanuel quickley__PTS|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=tyler herro__PA|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=jerami grant__PA|raw_bin=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=pat spencer__REB|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=anthony edwards__REB|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=adem bona__RA|prob=OVER", expert: "inv_current" },
  { key: "playerMarket=collin sexton__PR|prob=OVER", expert: "inv_current" },
  { key: "playerMarket=rui hachimura__PA|absg=lt2", expert: "alwaysOver" },
  { key: "playerMarket=stephen curry__PR|absg=lt8", expert: "baseline" },
  { key: "playerMarket=max christie__PRA|lg=m1_to_0", expert: "alwaysOver" },
  { key: "playerMarket=daeqwon plowden__PRA|mins=lt36", expert: "alwaysUnder" },
  { key: "playerMarket=kobe brown__THREES|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=nickeil alexander walker__PA|vol=lt4", expert: "inv_current" },
  { key: "playerMarket=rudy gobert__PTS|vol=lt4", expert: "inv_current" },
  { key: "playerMarket=jalen brunson__PTS|finalSide=UNDER|raw_bin=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=brandon ingram__RA|finalSide=OVER|rawdec=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=ja kobe walter__REB|finalSide=OVER|rawdec=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=rudy gobert__RA|finalSide=OVER|absg=lt1", expert: "alwaysUnder" },
  { key: "playerMarket=max christie__PA|finalSide=UNDER|absg=lt1", expert: "favored" },
  { key: "playerMarket=jarrett allen__PR|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=donovan mitchell__PA|sameCurProb=N", expert: "alwaysOver" },
  { key: "playerMarket=harrison barnes__THREES", expert: "inv_current" },
  { key: "playerMarket=evan mobley__REB|finalSide=OVER|proj=OVER", expert: "rawDecision" },
  { key: "playerMarket=moussa diabate__PRA|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=neemias queta__RA|sameCurProb=N", expert: "favored" },
  { key: "playerMarket=victor wembanyama__AST", expert: "baseline" },
  { key: "playerMarket=stephen curry__PTS|sameCurProj=N", expert: "inv_current" },
  { key: "playerMarket=dyson daniels__PR|fav=UNDER|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=duncan robinson__PTS|rawdec=OVER", expert: "inv_current" },
  { key: "playerMarket=cason wallace__AST|mins=lt24", expert: "alwaysOver" },
  { key: "playerMarket=oso ighodaro__REB|fav=UNDER|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=chet holmgren__THREES|vol=lt6", expert: "alwaysOver" },
  { key: "playerMarket=scottie barnes__PRA|vol=lt6", expert: "favored" },
  { key: "playerMarket=paolo banchero__PTS|lg=m1_to_0", expert: "alwaysUnder" },
  { key: "playerMarket=reed sheppard__PA|start=lt0p95", expert: "rawDecision" },
  { key: "playerMarket=will riley__REB|finalSide=UNDER|absg=lt1", expert: "alwaysOver" },
  { key: "playerMarket=miles bridges__AST|sameCurProj=Y", expert: "inv_rawSide" },
  { key: "playerMarket=jalen johnson__AST|absg=lt1", expert: "inv_overProb" },
  { key: "market=REB|finalSource=player_override|finalSide=UNDER|leafAccuracyBin=lt70|leafCountBin=lt160", expert: "inv_overProb" },
  { key: "playerMarket=franz wagner__REB|absg=lt1", expert: "rawDecision" },
  { key: "market=REB|finalSource=baseline|finalSide=UNDER|bucketLateAccuracyBin=lt75|bucketModelAccuracyBin=lt70", expert: "overProb" },
  { key: "playerMarket=collin murray boyles__REB|finalSide=UNDER|absg=lt1", expert: "alwaysOver" },
  { key: "market=PA|finalSource=universal_qualified|finalSide=OVER|bucketLateAccuracyBin=lt65|bucketModelAccuracyBin=lt65", expert: "projection" },
  { key: "market=THREES|finalSource=player_override|finalSide=OVER|bucketLateAccuracyBin=lt60|bucketModelAccuracyBin=lt65", expert: "baseline" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=UNDER|projectionWinProbabilityBin=lt0p65|projectionPriceEdgeBin=0p05_to_0p15", expert: "inv_rawSide" },
  { key: "playerMarket=collin gillespie__PRA|sameCurProj=Y", expert: "inv_current" },
  { key: "playerMarket=grayson allen__AST|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=collin murray boyles__PTS|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=rudy gobert__PRA|proj=OVER", expert: "alwaysOver" },
  { key: "playerMarket=jaxson hayes__RA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=bilal coulibaly__REB|prob=OVER", expert: "inv_current" },
  { key: "playerMarket=kyle anderson__PTS|finalSource=universal_qualified", expert: "inv_current" },
  { key: "playerMarket=luke kornet__PA|sameCurProb=N", expert: "baseline" },
  { key: "playerMarket=brandon ingram__PTS|lg=m1_to_0", expert: "inv_current" },
  { key: "playerMarket=jonathan kuminga__REB|vol=lt6", expert: "baseline" },
  { key: "playerMarket=ryan nembhard__PA|fav=OVER|proj=UNDER", expert: "alwaysUnder" },
  { key: "playerMarket=coby white__PRA|finalSide=UNDER|lg=1_to_3", expert: "alwaysOver" },
  { key: "playerMarket=jake laravia__AST|finalSide=UNDER|mins=lt30", expert: "inv_overProb" },
  { key: "playerMarket=anthony black__PR|finalSide=OVER|mins=lt24", expert: "alwaysUnder" },
  { key: "playerMarket=matas buzelis__PRA|vol=lt6", expert: "inv_current" },
  { key: "playerMarket=victor wembanyama__PR|finalSide=UNDER|mins=lt30", expert: "alwaysOver" },
  { key: "playerMarket=justin edwards__THREES", expert: "alwaysOver" },
  { key: "playerMarket=donovan mitchell__PTS|rawdec=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=anthony edwards__RA|proj=UNDER", expert: "inv_overProb" },
  { key: "playerMarket=evan mobley__PA|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=micah potter__THREES|prob=OVER", expert: "rawDecision" },
  { key: "playerMarket=jalen williams__REB|finalSource=baseline", expert: "alwaysOver" },
  { key: "playerMarket=norman powell__PR|sameCurProj=Y", expert: "alwaysUnder" },
  { key: "playerMarket=sandro mamukelashvili__RA|sameCurProb=N", expert: "alwaysUnder" },
  { key: "playerMarket=jalen williams__PA|absg=lt1", expert: "alwaysOver" },
  { key: "playerMarket=rui hachimura__RA|absg=lt2", expert: "baseline" },
  { key: "playerMarket=jrue holiday__PR|lg=0_to_1", expert: "inv_overProb" },
  { key: "playerMarket=paolo banchero__PRA|lg=m1_to_0", expert: "alwaysUnder" },
  { key: "playerMarket=bruce brown__REB|lg=0_to_1", expert: "baseline" },
  { key: "playerMarket=devin vassell__AST|vol=lt4", expert: "rawDecision" },
  { key: "playerMarket=jerami grant__PR|vol=lt6", expert: "inv_overProb" },
  { key: "playerMarket=jerami grant__RA|vol=lt6", expert: "alwaysUnder" },
  { key: "playerMarket=micah potter__PA|vol=lt6", expert: "inv_rawSide" },
  { key: "playerMarket=saddiq bey__THREES|prob=UNDER", expert: "inv_current" },
  { key: "playerMarket=paul george__THREES|vol=lt4", expert: "alwaysOver" },
  { key: "playerMarket=jalen suggs__PTS|finalSide=OVER|vol=lt6", expert: "favored" },
  { key: "playerMarket=ziaire williams__PR", expert: "inv_current" },
  { key: "playerMarket=pete nance__PRA", expert: "inv_current" },
  { key: "playerMarket=joel embiid__THREES", expert: "inv_current" },
  { key: "playerMarket=cam spencer__REB", expert: "inv_current" },
  { key: "playerMarket=donovan mitchell__RA|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=tobias harris__REB|vol=lt6", expert: "inv_current" },
  { key: "playerMarket=will richard__RA", expert: "inv_current" },
  { key: "playerMarket=noah clowney__PA", expert: "inv_current" },
  { key: "playerMarket=jevon carter__THREES|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=caris levert__REB|raw_bin=OVER", expert: "alwaysOver" },
  { key: "playerMarket=klay thompson__PRA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=victor wembanyama__REB|prob=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=brandon williams__PR|sameCurProj=Y", expert: "inv_current" },
  { key: "playerMarket=demar derozan__PR|mins=lt36", expert: "inv_current" },
  { key: "playerMarket=victor wembanyama__RA|finalSide=UNDER|rawdec=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=tre jones__PTS|finalSide=UNDER|proj=OVER", expert: "alwaysOver" },
  { key: "playerMarket=kristaps porzingis__AST|raw_bin=OVER|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=kyle filipowski__PTS|fav=UNDER|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=tyler herro__RA|finalSide=OVER|vol=lt4", expert: "alwaysUnder" },
  { key: "market=PTS|finalSource=baseline|finalSide=UNDER|projectionWinProbabilityBin=lt0p55|projectionPriceEdgeBin=m0p15_to_m0p05", expert: "favored" },
  { key: "playerMarket=rob dillingham__PTS|fav=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=jevon carter__RA|absg=lt1", expert: "inv_current" },
  { key: "playerMarket=brice sensabaugh__THREES|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=jrue holiday__PTS|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=cooper flagg__RA|absg=lt1", expert: "inv_current" },
  { key: "market=REB|finalSource=universal_qualified|finalSide=OVER|leafAccuracyBin=lt65|leafCountBin=lt320", expert: "rawDecision" },
  { key: "market=PR|finalSource=universal_qualified|finalSide=OVER|leafAccuracyBin=ge80|leafCountBin=lt40", expert: "alwaysUnder" },
  { key: "market=PRA|finalSource=universal_qualified|finalSide=UNDER|projectionWinProbabilityBin=lt0p55|projectionPriceEdgeBin=m0p05_to_0", expert: "inv_overProb" },
  { key: "market=PTS|finalSource=universal_qualified|finalSide=UNDER|leafAccuracyBin=lt65|leafCountBin=lt320", expert: "alwaysOver" },
  { key: "playerMarket=kris murray__PR|vol=lt8", expert: "inv_current" },
  { key: "playerMarket=jared mccain__PR", expert: "alwaysUnder" },
  { key: "playerMarket=alex caruso__RA", expert: "inv_current" },
  { key: "playerMarket=jerami grant__AST|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=jarrett allen__AST|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=naji marshall__PTS|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=matas buzelis__PR|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=rob dillingham__PA|fav=OVER", expert: "inv_current" },
  { key: "playerMarket=bennedict mathurin__PA|fav=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=will riley__PA|absg=lt3", expert: "inv_current" },
  { key: "playerMarket=pelle larsson__PA|absg=lt1", expert: "alwaysOver" },
  { key: "playerMarket=tyrese maxey__PTS|absg=lt1", expert: "alwaysUnder" },
  { key: "playerMarket=darius garland__PA|absg=lt2", expert: "alwaysUnder" },
  { key: "playerMarket=dominick barlow__PRA|lg=0_to_1", expert: "inv_current" },
  { key: "playerMarket=daeqwon plowden__PR|mins=lt30", expert: "alwaysOver" },
  { key: "playerMarket=cedric coward__THREES|mins=lt30", expert: "alwaysOver" },
  { key: "playerMarket=neemias queta__PA|vol=lt8", expert: "inv_current" },
  { key: "playerMarket=grayson allen__RA|vol=lt6", expert: "inv_current" },
  { key: "playerMarket=royce o neale__PTS|start=lt0p95", expert: "alwaysUnder" },
  { key: "playerMarket=dylan cardwell__PTS|finalSource=universal_qualified|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=cody williams__PA|finalSide=UNDER|rawdec=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=andre drummond__AST|finalSide=UNDER|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=cj mccollum__RA|finalSide=UNDER|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=kobe brown__PA|fav=UNDER|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=bub carrington__PR|prob=OVER", expert: "projection" },
  { key: "playerMarket=luke kornet__REB|absg=lt2", expert: "baseline" },
  { key: "playerMarket=tobias harris__PR|absg=lt1", expert: "inv_rawSide" },
  { key: "playerMarket=og anunoby__PR|finalSide=OVER|absg=lt2", expert: "inv_overProb" },
  { key: "playerMarket=bones hyland__THREES|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=kyle filipowski__AST|prob=UNDER", expert: "inv_current" },
  { key: "playerMarket=ajay mitchell__RA|finalSource=universal_qualified", expert: "alwaysUnder" },
  { key: "playerMarket=myles turner__RA|absg=lt2", expert: "alwaysOver" },
  { key: "playerMarket=draymond green__PA|mins=lt36", expert: "inv_current" },
  { key: "playerMarket=baylor scheierman__PTS|raw_bin=OVER|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=victor wembanyama__PA|finalSide=UNDER|mins=lt30", expert: "alwaysOver" },
  { key: "playerMarket=og anunoby__PA|sameCurProj=Y", expert: "favored" },
  { key: "playerMarket=jeremiah fears__REB|sameCurProb=N", expert: "rawDecision" },
  { key: "playerMarket=leonard miller__PTS|fav=OVER", expert: "projection" },
  { key: "playerMarket=leonard miller__PR|prob=OVER", expert: "inv_current" },
  { key: "playerMarket=reed sheppard__PR|finalSource=universal_qualified", expert: "inv_rawSide" },
  { key: "playerMarket=leonard miller__PA|finalSource=baseline", expert: "rawDecision" },
  { key: "playerMarket=gui santos__PRA|sameCurProj=Y", expert: "overProb" },
  { key: "playerMarket=andrew wiggins__PRA|vol=lt6", expert: "overProb" },
  { key: "playerMarket=jrue holiday__PA|finalSide=OVER|mins=lt36", expert: "projection" },
  { key: "playerMarket=ben saraf__PTS|start=lt0p35", expert: "inv_rawSide" },
  { key: "market=PTS|finalSource=baseline|finalSide=UNDER|leafAccuracyBin=lt60|leafCountBin=lt320", expert: "overProb" },
  { key: "playerMarket=elijah harkless__PR", expert: "inv_current" },
  { key: "playerMarket=duncan robinson__THREES|finalSide=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=zion williamson__RA|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=will richard__PTS|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=andrew nembhard__RA|finalSide=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=tre johnson__PTS|finalSide=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=austin reaves__PR|raw_bin=OVER", expert: "inv_current" },
  { key: "playerMarket=zion williamson__PA|raw_bin=UNDER", expert: "inv_current" },
  { key: "playerMarket=ziaire williams__PTS|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=malik monk__PRA|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=austin reaves__RA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=caris levert__RA|proj=UNDER", expert: "inv_current" },
  { key: "playerMarket=jay huff__REB|proj=OVER", expert: "alwaysOver" },
  { key: "playerMarket=saddiq bey__RA|proj=OVER", expert: "inv_current" },
  { key: "playerMarket=dylan cardwell__PR|proj=OVER", expert: "baseline" },
  { key: "playerMarket=matas buzelis__RA|proj=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=rudy gobert__PR|prob=UNDER", expert: "baseline" },
  { key: "playerMarket=de anthony melton__PA|prob=OVER", expert: "alwaysUnder" },
  { key: "playerMarket=joel embiid__RA|prob=UNDER", expert: "alwaysOver" },
  { key: "playerMarket=sam merrill__RA|prob=OVER", expert: "alwaysOver" },
  { key: "playerMarket=tyrese maxey__RA|fav=UNDER", expert: "inv_current" },
  { key: "playerMarket=luke kennard__PA|finalSource=baseline", expert: "alwaysUnder" },
  { key: "playerMarket=terance mann__PRA|sameCurProj=N", expert: "alwaysUnder" },
  { key: "playerMarket=grayson allen__REB|sameCurProj=N", expert: "inv_current" },
  { key: "playerMarket=julian champagnie__PTS|sameCurProb=N", expert: "baseline" },
  { key: "playerMarket=isaac okoro__RA|sameCurProb=N", expert: "favored" },
  { key: "playerMarket=mikal bridges__PA|absg=lt2", expert: "inv_current" },
  { key: "playerMarket=dejounte murray__REB|absg=lt1", expert: "alwaysOver" },
  { key: "playerMarket=matisse thybulle__PA|lg=m3_to_m1", expert: "inv_current" },
  { key: "playerMarket=pete nance__PR|lg=minf_to_m5", expert: "alwaysUnder" },
  { key: "playerMarket=josh hart__REB|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=daniss jenkins__PRA|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=oso ighodaro__PA|mins=lt36", expert: "alwaysUnder" },
  { key: "playerMarket=isaac okoro__PA|mins=lt30", expert: "inv_current" },
  { key: "playerMarket=devin booker__AST|vol=lt2", expert: "alwaysOver" },
  { key: "playerMarket=deni avdija__AST|finalSource=universal_qualified|finalSide=UNDER", expert: "rawDecision" },
];

export function getRecentWeaknessRouterMode(): RecentWeaknessRouterMode {
  const raw = process.env.SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "disabled") return "off";
  if (raw === "v1") return "v1";
  if (raw === "v2") return "v2";
  if (raw === "v3") return "v3";
  return "v4";
}

export function getRecentWeaknessRouterRuntimeMeta(): {
  mode: RecentWeaknessRouterMode;
  version: string | null;
  startDateEt: string | null;
} {
  const mode = getRecentWeaknessRouterMode();
  return {
    mode,
    version:
      mode === "v4"
        ? RECENT_WEAKNESS_ROUTER_V4_VERSION
        : mode === "v3"
          ? RECENT_WEAKNESS_ROUTER_V3_VERSION
          : mode === "v2"
            ? RECENT_WEAKNESS_ROUTER_V2_VERSION
            : mode === "v1"
              ? RECENT_WEAKNESS_ROUTER_V1_VERSION
              : null,
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
  const normalizedPlayerKey =
    input.normalizedPlayerKey?.trim() || normalizeLivePlayerOverrideKey(input.playerName);

  return {
    normalizedPlayerKey,
    playerMarket: normalizedPlayerKey ? `${normalizedPlayerKey}__${input.market}` : `NA__${input.market}`,
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

function applyRecentWeaknessRouterV3(
  input: RecentWeaknessRouterInput,
  currentSide: "OVER" | "UNDER",
  currentSource: SnapshotBoardMarketSource,
): RecentWeaknessRouterResult | null {
  const features = buildRecentWeaknessRouterV2Features(input, currentSide, currentSource);
  const rule = RECENT_WEAKNESS_ROUTER_V3_RULES.find((candidate) =>
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
    version: RECENT_WEAKNESS_ROUTER_V3_VERSION,
  };
}

function applyRecentWeaknessRouterV4(
  input: RecentWeaknessRouterInput,
  currentSide: "OVER" | "UNDER",
  currentSource: SnapshotBoardMarketSource,
): RecentWeaknessRouterResult | null {
  const features = buildRecentWeaknessRouterV2Features(input, currentSide, currentSource);
  const rule = RECENT_WEAKNESS_ROUTER_V4_RULES.find((candidate) =>
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
    version: RECENT_WEAKNESS_ROUTER_V4_VERSION,
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
  const v2Result = applyRecentWeaknessRouterV2(input, currentSide, currentSource);
  if (mode === "v2") return v2Result ?? v1Result;

  const v3CurrentSide = v2Result?.side ?? currentSide;
  const v3CurrentSource = v2Result?.source ?? currentSource;
  const v3Result = applyRecentWeaknessRouterV3(input, v3CurrentSide, v3CurrentSource);
  if (mode === "v3") return v3Result ?? v2Result ?? v1Result;

  const v4CurrentSide = v3Result?.side ?? v3CurrentSide;
  const v4CurrentSource = v3Result?.source ?? v3CurrentSource;
  return applyRecentWeaknessRouterV4(input, v4CurrentSide, v4CurrentSource) ?? v3Result ?? v2Result ?? v1Result;
}
