import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parseModule = (await import(new URL("./parse.ts", import.meta.url).href)) as typeof import("./parse");
const timeModule = (await import(new URL("../snapshot/time.ts", import.meta.url).href)) as typeof import("../snapshot/time");
const { espnStatusNumber, listDatesInclusive, parseEspnBoxScore, parseEspnScoreboard, toCanonicalEspnTeamCode } = parseModule;
const { inferSeasonFromEtDate } = timeModule;

type SummaryFixture = {
  boxscore: { players: Array<{ statistics: Array<{ keys: string[]; athletes: Array<{ stats: string[] }> }> }> };
};

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
}

const ATL_AT_ORL = {
  externalGameId: "401909834",
  gameDateEt: "2026-10-21",
  commenceTimeUtc: new Date("2026-10-21T23:00Z"),
  status: "Final",
  statusNumber: 3,
  homeTeamAbbr: "ORL",
  awayTeamAbbr: "ATL",
  homeTeamName: "Orlando Magic",
  awayTeamName: "Atlanta Hawks",
  season: "2026",
};

test("scoreboard assigns late tips to their ET date and maps scheduled status", () => {
  const games = parseEspnScoreboard(fixture("scoreboard-20261022.json"), inferSeasonFromEtDate);

  assert.deepEqual(
    games.map((game) => [game.externalGameId, `${game.awayTeamAbbr}@${game.homeTeamAbbr}`, game.gameDateEt]),
    [
      ["401909093", "CLE@PHI", "2026-10-22"],
      // Tips 2026-10-23T01:30Z, which is still Oct 22 in New York.
      ["401909094", "DEN@OKC", "2026-10-22"],
    ],
  );
  for (const game of games) {
    assert.equal(game.statusNumber, 1);
    assert.equal(game.season, "2026");
    assert.ok(game.commenceTimeUtc instanceof Date);
  }
});

test("scoreboard canonicalizes ESPN team codes and marks completed games final", () => {
  const games = parseEspnScoreboard(fixture("scoreboard-20261021.json"), inferSeasonFromEtDate);
  const matchups = games.map((game) => `${game.awayTeamAbbr}@${game.homeTeamAbbr}`).sort();

  assert.equal(games.length, 11);
  assert.ok(games.every((game) => game.statusNumber === 3 && game.gameDateEt === "2026-10-21"));
  for (const expected of ["GSW@LAL", "UTA@MEM", "MIL@WAS", "IND@NOP", "CHA@BKN"]) {
    assert.ok(matchups.includes(expected), `missing ${expected} in ${matchups.join(", ")}`);
  }
  const codes = new Set(games.flatMap((game) => [game.homeTeamAbbr, game.awayTeamAbbr]));
  for (const espnOnly of ["GS", "NO", "NY", "SA", "UTAH", "WSH"]) {
    assert.equal(codes.has(espnOnly), false, `${espnOnly} should be canonicalized`);
  }
});

test("status mapping only treats completed games as final", () => {
  assert.equal(espnStatusNumber({ state: "pre", completed: false }), 1);
  assert.equal(espnStatusNumber({ state: "in", completed: false }), 2);
  assert.equal(espnStatusNumber({ state: "post", completed: true }), 3);
  assert.equal(espnStatusNumber({ state: "post", completed: false, name: "STATUS_POSTPONED" }), 1);
  assert.equal(espnStatusNumber(null), 0);
});

test("team code mapping matches the canonical codes used elsewhere", () => {
  assert.equal(toCanonicalEspnTeamCode("utah"), "UTA");
  assert.equal(toCanonicalEspnTeamCode("WSH"), "WAS");
  assert.equal(toCanonicalEspnTeamCode("PHX"), "PHX");
  assert.equal(toCanonicalEspnTeamCode(null), null);
});

test("box score parses stat lines by key with home/away sides", () => {
  const { players, logs } = parseEspnBoxScore(fixture("summary-401909834.json"), ATL_AT_ORL);
  const byName = new Map(logs.map((log) => [log.fullName, log]));

  assert.equal(logs.length, 26);
  assert.equal(players.length, 26);
  assert.equal(logs.filter((log) => log.starter).length, 10);
  assert.ok(logs.every((log) => log.externalGameId === "401909834" && log.gameDateEt === "2026-10-21"));

  assert.deepEqual(
    (({ teamAbbr, opponentAbbr, isHome, starter, played, minutes, points, rebounds, assists, threes, steals, blocks, turnovers }) => ({
      teamAbbr, opponentAbbr, isHome, starter, played, minutes, points, rebounds, assists, threes, steals, blocks, turnovers,
    }))(byName.get("Paolo Banchero")!),
    {
      teamAbbr: "ORL", opponentAbbr: "ATL", isHome: true, starter: true, played: true,
      minutes: 41, points: 35, rebounds: 7, assists: 10, threes: 3, steals: 1, blocks: 0, turnovers: 6,
    },
  );

  const okongwu = byName.get("Onyeka Okongwu")!;
  assert.equal(okongwu.externalPlayerId, "4431680");
  assert.equal(okongwu.isHome, false);
  assert.equal(okongwu.opponentAbbr, "ORL");
  assert.equal(okongwu.threes, 0);
  assert.equal(okongwu.firstName, "Onyeka");
  assert.equal(okongwu.lastName, "Okongwu");
});

test("box score zeroes DNP stat lines like the NBA CDN feed", () => {
  const { logs } = parseEspnBoxScore(fixture("summary-401909834.json"), ATL_AT_ORL);
  const dnps = logs.filter((log) => !log.played);

  assert.deepEqual(
    dnps.map((log) => log.fullName).sort(),
    ["Alex Morales", "Asa Newell", "Colin Castleton", "Corey Kispert", "Dorian Finney-Smith", "Jevon Carter", "Zuby Ejiofor"],
  );
  for (const log of dnps) {
    assert.equal(log.minutes, 0);
    assert.equal(log.points, 0);
    assert.equal(log.threes, 0);
  }
  // Bench players ESPN flags active=false (off the floor) still count as having played.
  assert.equal(logs.find((log) => log.fullName === "CJ McCollum")?.played, true);
});

test("box score reads columns by key, not position", () => {
  const payload = fixture<SummaryFixture>("summary-401909834.json");
  for (const side of payload.boxscore.players) {
    const group = side.statistics[0];
    const order = group.keys.map((_, index) => index).reverse();
    group.keys = order.map((index) => group.keys[index]);
    for (const athlete of group.athletes) {
      if (athlete.stats.length > 0) {
        athlete.stats = order.map((index) => athlete.stats[index]);
      }
    }
  }

  const banchero = parseEspnBoxScore(payload, ATL_AT_ORL).logs.find((log) => log.fullName === "Paolo Banchero")!;
  assert.equal(banchero.points, 35);
  assert.equal(banchero.threes, 3);
  assert.equal(banchero.minutes, 41);
});

test("teams and rosters parse with canonical team codes", () => {
  const teams = parseModule.parseEspnTeams({
    sports: [{ leagues: [{ teams: [{ team: { id: "9", abbreviation: "GS" } }, { team: { id: "26", abbreviation: "UTAH" } }] }] }],
  });
  assert.deepEqual(teams, [
    { espnTeamId: "9", teamAbbr: "GSW" },
    { espnTeamId: "26", teamAbbr: "UTA" },
  ]);

  const roster = parseModule.parseEspnRoster(
    { athletes: [{ id: "3975", fullName: "Stephen Curry", jersey: "30" }, { id: "", fullName: "No Id" }] },
    "GSW",
  );
  assert.deepEqual(roster, [{ espnId: "3975", fullName: "Stephen Curry", teamAbbr: "GSW", jersey: "30" }]);
});

test("date range helper is inclusive and crosses month boundaries", () => {
  assert.deepEqual(listDatesInclusive("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(listDatesInclusive("2026-10-22", "2026-10-22"), ["2026-10-22"]);
  assert.deepEqual(listDatesInclusive("2026-10-23", "2026-10-22"), []);
});
