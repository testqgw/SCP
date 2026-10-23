import assert from "node:assert/strict";
import test from "node:test";

const { buildResidualBins, correctMetricRecord, correctProjection } = (await import(
  new URL("./residualCorrection.ts", import.meta.url).href
)) as typeof import("./residualCorrection");

const blank = { PTS: null, REB: null, AST: null, THREES: null, PRA: null, PA: null, PR: null, RA: null };

test("no history leaves projections unchanged", () => {
  const bins = buildResidualBins([]);
  assert.equal(correctProjection(bins, "PTS", 21.4), 21.4);
  assert.equal(correctProjection(bins, "PTS", null), null);
});

test("a day is corrected only from earlier days, by weight 1.3 times the bin median", () => {
  // Day 1 has no history, so its residuals are actual - raw: -2 and -4 (median -3) in PTS bin 10.
  const bins = buildResidualBins([
    { dateEt: "2026-10-20", entries: [
      { market: "PTS", rawProjection: 20.5, actual: 18.5 },
      { market: "PTS", rawProjection: 21.0, actual: 17.0 },
    ] },
  ]);
  // -3 * 1.3 = -3.9, capped at the PTS cap of 2.6.
  assert.equal(correctProjection(bins, "PTS", 20.0), 17.4);
  // A different bin has no history.
  assert.equal(correctProjection(bins, "PTS", 30.0), 30.0);
});

test("residuals feed back against the corrected projection, as in the backtest", () => {
  const bins = buildResidualBins([
    { dateEt: "2026-10-20", entries: [{ market: "REB", rawProjection: 6.2, actual: 5.6 }] },
    // Corrected to 6.2 + 1.3 * -0.6 = 5.42; residual 5.0 - 5.42 = -0.42.
    { dateEt: "2026-10-21", entries: [{ market: "REB", rawProjection: 6.2, actual: 5.0 }] },
  ]);
  // Bin median of [-0.6, -0.42] = -0.51; 6.4 + 1.3 * -0.51 = 5.737 -> 5.74.
  assert.equal(correctProjection(bins, "REB", 6.4), 5.74);
});

test("days are replayed in date order regardless of input order", () => {
  const days = [
    { dateEt: "2026-10-21", entries: [{ market: "AST" as const, rawProjection: 4.1, actual: 3.0 }] },
    { dateEt: "2026-10-20", entries: [{ market: "AST" as const, rawProjection: 4.4, actual: 5.0 }] },
  ];
  assert.equal(
    correctProjection(buildResidualBins(days), "AST", 4.5),
    correctProjection(buildResidualBins([...days].reverse()), "AST", 4.5),
  );
});

test("corrections are floored at zero and each market uses its own bins", () => {
  const bins = buildResidualBins([
    { dateEt: "2026-10-20", entries: [{ market: "THREES", rawProjection: 0.3, actual: 0 }] },
  ]);
  assert.equal(correctProjection(bins, "THREES", 0.2), 0);
  const corrected = correctMetricRecord(bins, { ...blank, THREES: 0.2, PTS: 12 });
  assert.deepEqual(corrected, { ...blank, THREES: 0, PTS: 12 });
});
