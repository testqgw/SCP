import type { SnapshotMarket } from "@/lib/types/snapshot";

// Board side for every lined prop: a per-market logistic P(over) from the residual-corrected
// projection's gap to the line and the no-vig market price. The raw projection sign, which the board
// showed before, hit 51.7% on the replayed 2025-26 holdout (Jan-Jun) and 47.7% on the stored
// 2026-10-20..22 boards; this side hit 52.9% (fit before the holdout) and 55.8% on the same rows.
// Coefficients come from scripts/fit-board-side-calibration.py on the replay written by
// scripts/replay-board-side-season.ts; refit them there, not by hand. The raw logistic was
// overconfident out of sample, so the reported probability is shrunk toward 0.5 by the factor the
// holdout supports; the side is unaffected.
//
// During a season the board refits each market daily on that season's settled rows, pulled toward
// these coefficients by refitLambda pseudo-rows (chosen on a December rehearsal). On the replay this
// took the Jan-Jun holdout from 52.90% to 53.04% (McNemar p=0.008), with the gain growing through
// the season. Line-history, minutes and distribution features, and a boosted model, did not beat
// this on the holdout.

export type MarketCoefficients = {
  // Gap is (projection - line) / scale.
  scale: number;
  intercept: number;
  gap: number;
  // Weight on logit(no-vig P(over)), and the shift applied when a usable price exists.
  marketLogit: number;
  priced: number;
};

export type BoardSideMarkets = Record<SnapshotMarket, MarketCoefficients>;

// <generated:board-side-calibration>
export const BOARD_SIDE_CALIBRATION = {
  version: "2026-10-23-replay-2025-26",
  fitFrom: "2025-10-21",
  fitTo: "2026-06-13",
  rows: 118035,
  probabilityShrink: 0.5523,
  refitLambda: 10000,
  markets: {
    PTS: { scale: 6, intercept: -0.03954, gap: 0.00446, marketLogit: 0.87701, priced: -0.03917 },
    REB: { scale: 2.5, intercept: -0.03929, gap: 0.22298, marketLogit: 0.76788, priced: -0.06006 },
    AST: { scale: 2, intercept: -0.00671, gap: 0.19738, marketLogit: 0.90444, priced: -0.08192 },
    THREES: { scale: 1.2, intercept: -0.15115, gap: 0.18816, marketLogit: 0.90029, priced: 0.05001 },
    PRA: { scale: 8, intercept: -0.30042, gap: 0.43165, marketLogit: 1.17031, priced: 0.20997 },
    PA: { scale: 7, intercept: -0.17292, gap: 0.43734, marketLogit: 1.41955, priced: 0.08773 },
    PR: { scale: 7, intercept: -0.13411, gap: 0.40812, marketLogit: 1.41931, priced: 0.04269 },
    RA: { scale: 3.5, intercept: -0.20981, gap: 0.49220, marketLogit: 1.17388, priced: 0.11207 },
  } satisfies BoardSideMarkets,
};
// </generated:board-side-calibration>

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const MIN_MARKET_PROBABILITY = 0.02;
const MAX_MARKET_PROBABILITY = 0.98;
const REFIT_MAX_ITERATIONS = 25;

export type BoardSideCall = {
  side: "OVER" | "UNDER";
  overProbability: number;
  priced: boolean;
};

/** A settled lined prop: the corrected projection, the line and prices it was graded at, the result. */
export type BoardSideOutcome = {
  market: SnapshotMarket;
  projection: number;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  actual: number;
};

function impliedProbability(odds: number | null | undefined): number | null {
  if (odds == null || !Number.isFinite(odds)) return null;
  if (odds <= -100) return -odds / (-odds + 100);
  if (odds >= 100) return 100 / (odds + 100);
  return null;
}

/** No-vig P(over) from American prices on the same line, or null when the pair is unusable. */
export function noVigOverProbability(overPrice: number | null | undefined, underPrice: number | null | undefined): number | null {
  const over = impliedProbability(overPrice);
  const under = impliedProbability(underPrice);
  if (over == null || under == null) return null;
  const total = over + under;
  // Same bounds as the fit: drop pairs without a normal two-way overround.
  if (total <= 0.98 || total >= 1.15) return null;
  return over / total;
}

// Design row [1, gap, logit(no-vig P(over)), priced], matching the coefficient order.
function designRow(
  scale: number,
  projection: number,
  line: number,
  overPrice: number | null | undefined,
  underPrice: number | null | undefined,
): number[] {
  const marketProbability = noVigOverProbability(overPrice, underPrice);
  if (marketProbability == null) return [1, (projection - line) / scale, 0, 0];
  const clipped = Math.min(MAX_MARKET_PROBABILITY, Math.max(MIN_MARKET_PROBABILITY, marketProbability));
  return [1, (projection - line) / scale, Math.log(clipped / (1 - clipped)), 1];
}

const toVector = (c: MarketCoefficients) => [c.intercept, c.gap, c.marketLogit, c.priced];
const dot = (left: number[], right: number[]) => left.reduce((sum, value, index) => sum + value * right[index], 0);

function solve(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[size] / row[index]);
}

/** MAP logistic fit: minimises log-loss plus lambda/2 * ||beta - prior||^2, by Newton's method. */
function refitMarket(rows: number[][], labels: number[], prior: number[], lambda: number): number[] {
  const beta = [...prior];
  for (let iteration = 0; iteration < REFIT_MAX_ITERATIONS; iteration += 1) {
    const gradient = beta.map((value, index) => lambda * (value - prior[index]));
    const hessian = beta.map((_, i) => beta.map((__, j) => (i === j ? lambda : 0)));
    rows.forEach((x, rowIndex) => {
      const p = 1 / (1 + Math.exp(-dot(x, beta)));
      const weight = p * (1 - p);
      for (let i = 0; i < x.length; i += 1) {
        gradient[i] += (p - labels[rowIndex]) * x[i];
        for (let j = 0; j < x.length; j += 1) hessian[i][j] += weight * x[i] * x[j];
      }
    });
    const step = solve(hessian, gradient);
    step.forEach((value, index) => (beta[index] -= value));
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return beta;
}

/** Refits every market on this season's settled outcomes; markets without outcomes keep the prior. */
export function refitBoardSideMarkets(
  outcomes: BoardSideOutcome[],
  options: { prior?: BoardSideMarkets; lambda?: number } = {},
): BoardSideMarkets {
  const prior = options.prior ?? BOARD_SIDE_CALIBRATION.markets;
  const lambda = options.lambda ?? BOARD_SIDE_CALIBRATION.refitLambda;
  const refit = { ...prior };
  for (const market of MARKETS) {
    const base = prior[market];
    const rows: number[][] = [];
    const labels: number[] = [];
    for (const outcome of outcomes) {
      // Pushes are not graded, as in the fit.
      if (outcome.market !== market || outcome.actual === outcome.line) continue;
      if (![outcome.projection, outcome.line, outcome.actual].every(Number.isFinite)) continue;
      rows.push(designRow(base.scale, outcome.projection, outcome.line, outcome.overPrice, outcome.underPrice));
      labels.push(outcome.actual > outcome.line ? 1 : 0);
    }
    if (rows.length === 0) continue;
    const [intercept, gap, marketLogit, priced] = refitMarket(rows, labels, toVector(base), lambda);
    refit[market] = { scale: base.scale, intercept, gap, marketLogit, priced };
  }
  return refit;
}

export function calibrateBoardSide(
  input: {
    market: SnapshotMarket;
    projection: number | null | undefined;
    line: number | null | undefined;
    overPrice?: number | null;
    underPrice?: number | null;
  },
  markets: BoardSideMarkets = BOARD_SIDE_CALIBRATION.markets,
): BoardSideCall | null {
  const { projection, line } = input;
  if (projection == null || line == null || !Number.isFinite(projection) || !Number.isFinite(line)) return null;
  const coefficients = markets[input.market];
  const x = designRow(coefficients.scale, projection, line, input.overPrice, input.underPrice);
  const score = dot(x, toVector(coefficients));
  const shrunk = 0.5 + BOARD_SIDE_CALIBRATION.probabilityShrink * (1 / (1 + Math.exp(-score)) - 0.5);
  const overProbability = Math.round(shrunk * 10_000) / 10_000;
  return { side: score > 0 ? "OVER" : "UNDER", overProbability, priced: x[3] === 1 };
}
