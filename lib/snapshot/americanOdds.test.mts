import assert from "node:assert/strict";
import test from "node:test";

const oddsModule = (await import(new URL("./americanOdds.ts", import.meta.url).href)) as typeof import("./americanOdds");
const { americanToImpliedProbability, impliedProbabilityToAmerican, isValidAmericanPrice, medianAmericanPrice } = oddsModule;

test("an even book count straddling even money stays a real price", () => {
  // The old numeric median returned (-110 + 100) / 2 = -5.
  const price = medianAmericanPrice([-110, 100]);
  assert.ok(price != null && isValidAmericanPrice(price));
  assert.equal(price, -104.88);

  // The old numeric median returned (-131 + 105) / 2 = -13.
  const mixed = medianAmericanPrice([-140, -131, 105, 120]);
  assert.ok(mixed != null && isValidAmericanPrice(mixed));
  assert.ok(mixed < -100 && mixed > -131);
});

test("an odd book count returns the middle quote unchanged", () => {
  assert.equal(medianAmericanPrice([-120, 150, -110]), -110);
  assert.equal(medianAmericanPrice([-115]), -115);
});

test("same-sign quotes match the numeric median closely", () => {
  assert.equal(medianAmericanPrice([-110, -110]), -110);
  const price = medianAmericanPrice([-120, -110]) ?? 0;
  assert.ok(Math.abs(price - -114.88) < 0.01);
});

test("missing and impossible quotes are ignored", () => {
  assert.equal(medianAmericanPrice([]), null);
  assert.equal(medianAmericanPrice([null, undefined, Number.NaN]), null);
  assert.equal(medianAmericanPrice([0, -5, 50]), null);
  assert.equal(medianAmericanPrice([-5, -120, null]), -120);
});

test("probability conversion round-trips", () => {
  for (const price of [-400, -150, -110, -100, 100, 130, 280]) {
    const probability = americanToImpliedProbability(price);
    assert.ok(probability != null);
    const back = impliedProbabilityToAmerican(probability);
    assert.ok(back != null);
    // -100 and +100 are the same price.
    assert.ok(Math.abs(Math.abs(back) - Math.abs(price)) < 1e-9, `${price} -> ${back}`);
  }
  assert.equal(americanToImpliedProbability(-13.5), null);
  assert.equal(impliedProbabilityToAmerican(1), null);
});
