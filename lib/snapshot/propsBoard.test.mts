import assert from "node:assert/strict";
import test from "node:test";

const propsModule = (await import(new URL("./propsBoard.ts", import.meta.url).href)) as typeof import("./propsBoard");
const { buildPropsBoardData, gameStartMs, lineHitSummary, noVigOverProbability, seasonStartDate, validAmericanPrice } = propsModule;

function signal(marketLine: number | null, extra: Record<string, unknown> = {}) {
  return { marketLine, sportsbookCount: marketLine == null ? 0 : 6, side: "NEUTRAL", confidence: null, passReasons: [], ...extra };
}

function metrics(value: number) {
  return { PTS: value, REB: value, AST: value, THREES: value, PRA: value, PA: value, PR: value, RA: value };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    playerName: "Test Guard",
    position: "G",
    teamCode: "NOP",
    opponentCode: "UTA",
    matchupKey: "NOP@UTA",
    gameTimeEt: "Oct 23, 9:30 PM",
    last5: { PTS: [30, 10, 22, 18, 25], REB: [], AST: [6, 2, 5, 4, 3], THREES: [], PRA: [], PA: [], PR: [], RA: [] },
    last10Average: metrics(20),
    seasonAverage: metrics(19),
    trendVsSeason: metrics(0),
    opponentAllowanceDelta: metrics(1),
    projectedTonight: metrics(21.4),
    modelLines: {},
    ptsSignal: signal(19.5, { overPrice: -120, underPrice: 100, side: "OVER" }),
    rebSignal: signal(null),
    astSignal: signal(4.5, { overPrice: -13.5, underPrice: -140 }),
    threesSignal: null,
    praSignal: signal(null),
    paSignal: signal(null),
    prSignal: signal(null),
    raSignal: signal(null),
    dataCompleteness: { score: 100, tier: "HIGH" },
    playerContext: { lineupStarter: true, projectedMinutes: 33, primaryDefender: null, teammateCore: [], teammateSynergies: [] },
    gameIntel: {},
    ...overrides,
  };
}

test("only markets with a live sportsbook line become props", () => {
  const board = {
    dateEt: "2026-10-23",
    lastUpdatedAt: "2026-10-23T23:38:23.385Z",
    matchups: [{ key: "NOP@UTA", awayTeam: "NOP", homeTeam: "UTA", gameTimeEt: "Oct 23, 9:30 PM", label: "" }],
    rows: [row()],
  } as unknown as Parameters<typeof buildPropsBoardData>[0];

  const data = buildPropsBoardData(board);
  assert.deepEqual(
    data.props.map((entry) => entry.market),
    ["PTS", "AST"],
  );
  const pts = data.props[0];
  assert.equal(pts.edge, 1.9);
  assert.equal(pts.last5Over, 3);
  assert.equal(pts.isHome, false);
  assert.equal(data.games[0].propCount, 2);
  // -13.5 is an average of a plus and a minus price, not a quote.
  assert.equal(data.props[1].overPrice, null);
  assert.equal(data.props[1].underPrice, -140);
});

test("American price validation and no-vig probability", () => {
  assert.equal(validAmericanPrice(-13.5), null);
  assert.equal(validAmericanPrice(99), null);
  assert.equal(validAmericanPrice(100), 100);
  assert.equal(validAmericanPrice(-110), -110);
  assert.equal(noVigOverProbability(-110, -110), 0.5);
  assert.equal(noVigOverProbability(-110, -18.5), null);
  assert.ok(Math.abs((noVigOverProbability(-150, 130) ?? 0) - 0.5798) < 0.001);
});

test("game start is read as Eastern time across daylight saving", () => {
  assert.equal(new Date(gameStartMs("2026-10-23", "Oct 23, 9:30 PM") ?? 0).toISOString(), "2026-10-24T01:30:00.000Z");
  assert.equal(new Date(gameStartMs("2026-12-25", "Dec 25, 12:00 PM") ?? 0).toISOString(), "2026-12-25T17:00:00.000Z");
  assert.equal(gameStartMs("2026-10-23", "TBD"), null);
});

test("line hit summary counts pushes separately", () => {
  assert.deepEqual(lineHitSummary([10, 12, 8, 10], 10), { over: 1, under: 1, push: 2, games: 4 });
});

test("season starts in the fall of the board's season", () => {
  assert.equal(seasonStartDate("2026-10-23"), "2026-08-01");
  assert.equal(seasonStartDate("2027-03-02"), "2026-08-01");
});
