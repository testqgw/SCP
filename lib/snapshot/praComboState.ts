import type { SnapshotMarket } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

const PRA_GUARD_WING_ARCHETYPES = new Set<string>([
  "LEAD_GUARD",
  "TABLE_SETTING_LEAD_GUARD",
  "SCORE_FIRST_LEAD_GUARD",
  "HELIOCENTRIC_GUARD",
  "ELITE_SHOOTING_GUARD",
  "SCORING_GUARD_CREATOR",
  "JUMBO_CREATOR_GUARD",
  "WING",
  "CONNECTOR_WING",
  "SPOTUP_WING",
  "TWO_WAY_MARKET_WING",
  "SCORER_CREATOR_WING",
  "SHOT_CREATING_WING",
  "MARKET_SHAPED_SCORING_WING",
  "POINT_FORWARD",
]);

export type PRAComboState = {
  ptsShareOfPRA: number | null;
  rebShareOfPRA: number | null;
  astShareOfPRA: number | null;
  maxLegShareOfCombo: number | null;
  comboEntropy: number | null;
  comboBalanceScore: number | null;
  ptsLedPRAFlag: number;
  highLinePRAFlag: number;
  veryHighLinePRAFlag: number;
  lateSeasonFlag: number;
  lateSeasonHighLinePRAFlag: number;
  guardWingArchetypeFlag: number;
  ptsLedPRAxGuardWing: number;
  highLinePRAxGuardWing: number;
  lateSeasonxGuardWing: number;
  closeGamexGuardWing: number;
  ptsLedPRAxCloseGame: number;
  ptsLedPRAxLateSeason: number;
  ptsLedPRAxHighLine: number;
};

function parseEtMonth(dateEt: string | null | undefined): number | null {
  if (!dateEt) return null;
  const [, monthText] = dateEt.split("-");
  const month = Number(monthText);
  return Number.isFinite(month) ? month : null;
}

function normalizedEntropy(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  if (filtered.length === 0) return null;
  const entropy = -filtered.reduce((sum, value) => sum + value * Math.log(value), 0);
  const maxEntropy = Math.log(3);
  if (!Number.isFinite(entropy) || maxEntropy <= 0) return null;
  return round(entropy / maxEntropy, 4);
}

function comboBalanceFromMaxShare(maxLegShare: number | null): number | null {
  if (maxLegShare == null) return null;
  const normalized = 1 - Math.max(0, (maxLegShare - 1 / 3) / (2 / 3));
  return round(Math.max(0, Math.min(1, normalized)), 4);
}

export function isPRAComboGuardWingArchetype(archetype: string | null | undefined): boolean {
  return archetype != null && PRA_GUARD_WING_ARCHETYPES.has(archetype);
}

export function buildPRAComboState(input: {
  market: SnapshotMarket;
  gameDateEt?: string | null;
  line: number | null;
  openingTeamSpread?: number | null;
  archetype?: string | null;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
}): PRAComboState {
  if (input.market !== "PRA") {
    return {
      ptsShareOfPRA: 0,
      rebShareOfPRA: 0,
      astShareOfPRA: 0,
      maxLegShareOfCombo: 0,
      comboEntropy: 0,
      comboBalanceScore: 0,
      ptsLedPRAFlag: 0,
      highLinePRAFlag: 0,
      veryHighLinePRAFlag: 0,
      lateSeasonFlag: 0,
      lateSeasonHighLinePRAFlag: 0,
      guardWingArchetypeFlag: 0,
      ptsLedPRAxGuardWing: 0,
      highLinePRAxGuardWing: 0,
      lateSeasonxGuardWing: 0,
      closeGamexGuardWing: 0,
      ptsLedPRAxCloseGame: 0,
      ptsLedPRAxLateSeason: 0,
      ptsLedPRAxHighLine: 0,
    };
  }

  const pointsProjection = input.pointsProjection;
  const reboundsProjection = input.reboundsProjection;
  const assistProjection = input.assistProjection;
  const totalProjection =
    pointsProjection == null || reboundsProjection == null || assistProjection == null
      ? null
      : pointsProjection + reboundsProjection + assistProjection;

  const ptsShareOfPRA =
    totalProjection != null && totalProjection > 0 ? round(pointsProjection! / totalProjection, 4) : null;
  const rebShareOfPRA =
    totalProjection != null && totalProjection > 0 ? round(reboundsProjection! / totalProjection, 4) : null;
  const astShareOfPRA =
    totalProjection != null && totalProjection > 0 ? round(assistProjection! / totalProjection, 4) : null;
  const shares = [ptsShareOfPRA, rebShareOfPRA, astShareOfPRA].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const maxLegShareOfCombo = shares.length === 3 ? round(Math.max(...shares), 4) : null;
  const comboEntropy = shares.length === 3 ? normalizedEntropy(shares) : null;
  const comboBalanceScore = comboBalanceFromMaxShare(maxLegShareOfCombo);
  const highLinePRAFlag = input.line != null && input.line >= 25 ? 1 : 0;
  const veryHighLinePRAFlag = input.line != null && input.line >= 30 ? 1 : 0;
  const month = parseEtMonth(input.gameDateEt);
  const lateSeasonFlag = month != null && month >= 3 && month <= 8 ? 1 : 0;
  const lateSeasonHighLinePRAFlag = lateSeasonFlag === 1 && highLinePRAFlag === 1 ? 1 : 0;
  const closeGameFlag =
    input.openingTeamSpread != null && Math.abs(input.openingTeamSpread) <= 4.5 ? 1 : 0;
  const guardWingArchetypeFlag = isPRAComboGuardWingArchetype(input.archetype) ? 1 : 0;
  const ptsLedPRAFlag = ptsShareOfPRA != null && ptsShareOfPRA >= 0.56 ? 1 : 0;

  return {
    ptsShareOfPRA,
    rebShareOfPRA,
    astShareOfPRA,
    maxLegShareOfCombo,
    comboEntropy,
    comboBalanceScore,
    ptsLedPRAFlag,
    highLinePRAFlag,
    veryHighLinePRAFlag,
    lateSeasonFlag,
    lateSeasonHighLinePRAFlag,
    guardWingArchetypeFlag,
    ptsLedPRAxGuardWing: ptsLedPRAFlag === 1 && guardWingArchetypeFlag === 1 ? 1 : 0,
    highLinePRAxGuardWing: highLinePRAFlag === 1 && guardWingArchetypeFlag === 1 ? 1 : 0,
    lateSeasonxGuardWing: lateSeasonFlag === 1 && guardWingArchetypeFlag === 1 ? 1 : 0,
    closeGamexGuardWing: closeGameFlag === 1 && guardWingArchetypeFlag === 1 ? 1 : 0,
    ptsLedPRAxCloseGame: ptsLedPRAFlag === 1 && closeGameFlag === 1 ? 1 : 0,
    ptsLedPRAxLateSeason: ptsLedPRAFlag === 1 && lateSeasonFlag === 1 ? 1 : 0,
    ptsLedPRAxHighLine: ptsLedPRAFlag === 1 && highLinePRAFlag === 1 ? 1 : 0,
  };
}
