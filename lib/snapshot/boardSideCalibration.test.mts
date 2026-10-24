import assert from "node:assert/strict";
import test from "node:test";

const { BOARD_SIDE_CALIBRATION, calibrateBoardSide, noVigOverProbability } = (await import(
  new URL("./boardSideCalibration.ts", import.meta.url).href
)) as typeof import("./boardSideCalibration");

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
