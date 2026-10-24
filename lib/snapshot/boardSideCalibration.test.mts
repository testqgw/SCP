import assert from "node:assert/strict";
import test from "node:test";

const { BOARD_SIDE_CALIBRATION, calibrateBoardSide, noVigOverProbability, refitBoardSideMarkets } = (await import(
  new URL("./boardSideCalibration.ts", import.meta.url).href
)) as typeof import("./boardSideCalibration");

const ptsOutcomes = [
  { projection: 24, line: 22.5, overPrice: -150, underPrice: 125, actual: 30 },
  { projection: 18, line: 20.5, overPrice: null, underPrice: null, actual: 15 },
  { projection: 31, line: 28.5, overPrice: -110, underPrice: -110, actual: 25 },
  { projection: 12, line: 14.5, overPrice: 120, underPrice: -145, actual: 16 },
  { projection: 22, line: 21.5, overPrice: null, underPrice: null, actual: 19 },
  { projection: 9.5, line: 11.5, overPrice: -105, underPrice: -115, actual: 8 },
].map((outcome) => ({ market: "PTS" as const, ...outcome }));

test("no projection or no line gives no board side", () => {
  assert.equal(calibrateBoardSide({ market: "PTS", projection: null, line: 22.5 }), null);
  assert.equal(calibrateBoardSide({ market: "PTS", projection: 24, line: null }), null);
  assert.equal(calibrateBoardSide({ market: "PTS", projection: Number.NaN, line: 22.5 }), null);
});

test("no-vig probability needs a normal two-way price", () => {
  assert.equal(noVigOverProbability(-110, -110), 0.5);
  // 0.6 / (0.6 + 100 / 225)
  assert.ok(Math.abs((noVigOverProbability(-150, 125) ?? 0) - 0.5745) < 1e-4);
  // Historical feeds carry placeholders such as -1; those and missing sides are unusable.
  assert.equal(noVigOverProbability(-1, -132.5), null);
  assert.equal(noVigOverProbability(null, -110), null);
  // An overround of 15% or more is not a same-line two-way market.
  assert.equal(noVigOverProbability(-200, -200), null);
});

test("matches the fitted sklearn model after the probability shrink", () => {
  // Reference values from scripts/fit-board-side-calibration.py on the 2025-26 replay.
  const pts = calibrateBoardSide({ market: "PTS", projection: 24, line: 22.5, overPrice: -150, underPrice: 125 });
  assert.deepEqual(pts, { side: "OVER", overProbability: 0.5256, priced: true });
  const reb = calibrateBoardSide({ market: "REB", projection: 5.1, line: 6.5 });
  assert.deepEqual(reb, { side: "UNDER", overProbability: 0.4774, priced: false });
  const pra = calibrateBoardSide({ market: "PRA", projection: 33, line: 30.5, overPrice: -110, underPrice: -110 });
  assert.deepEqual(pra, { side: "OVER", overProbability: 0.5061, priced: true });
});

test("the market price can overrule a small projection gap", () => {
  const call = calibrateBoardSide({ market: "AST", projection: 6.0, line: 5.5, overPrice: 135, underPrice: -165 });
  assert.equal(call?.side, "UNDER");
});

test("refit with no settled rows keeps the shipped coefficients", () => {
  assert.deepEqual(refitBoardSideMarkets([]), BOARD_SIDE_CALIBRATION.markets);
});

test("refit matches the fit script's MAP solution and leaves other markets alone", () => {
  // Reference: map_fit in scripts/fit-board-side-calibration.py with lambda 5 on the same rows.
  const refit = refitBoardSideMarkets(ptsOutcomes, { lambda: 5 });
  const expected = { intercept: -0.184029, gap: 0.000323, marketLogit: 0.87788, priced: -0.002015 };
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Math.abs(refit.PTS[key as keyof typeof expected] - value) < 1e-5, `${key}: ${refit.PTS[key as keyof typeof expected]}`);
  }
  assert.equal(refit.PTS.scale, BOARD_SIDE_CALIBRATION.markets.PTS.scale);
  assert.deepEqual(refit.REB, BOARD_SIDE_CALIBRATION.markets.REB);
});

test("refit ignores pushes and stays at the prior under a very strong penalty", () => {
  const pushes = ptsOutcomes.map((outcome) => ({ ...outcome, actual: outcome.line }));
  assert.deepEqual(refitBoardSideMarkets(pushes, { lambda: 5 }), BOARD_SIDE_CALIBRATION.markets);
  const anchored = refitBoardSideMarkets(ptsOutcomes, { lambda: 1e9 });
  assert.ok(Math.abs(anchored.PTS.intercept - BOARD_SIDE_CALIBRATION.markets.PTS.intercept) < 1e-6);
});

test("side agrees with the probability, which stays inside the shrunk range", () => {
  const maxDistance = 0.5 * BOARD_SIDE_CALIBRATION.probabilityShrink;
  for (const [projection, line, overPrice, underPrice] of [
    [30, 18.5, -400, 300],
    [2, 18.5, 300, -400],
    [18.5, 18.5, -110, -110],
  ] as const) {
    const call = calibrateBoardSide({ market: "PTS", projection, line, overPrice, underPrice });
    assert.ok(call);
    assert.equal(call.side, call.overProbability > 0.5 ? "OVER" : "UNDER");
    assert.ok(Math.abs(call.overProbability - 0.5) <= maxDistance + 1e-9);
  }
});
