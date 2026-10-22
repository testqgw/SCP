import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const idMatch = (await import(new URL("./idMatch.ts", import.meta.url).href)) as typeof import("./idMatch");
const parse = (await import(new URL("./parse.ts", import.meta.url).href)) as typeof import("./parse");
const { matchGames, matchPlayers, normalizePlayerName, translateEspnPayload } = idMatch;
type KnownPlayer = import("./idMatch").KnownPlayer;
type KnownGame = import("./idMatch").KnownGame;

function known(overrides: Partial<KnownPlayer> & Pick<KnownPlayer, "externalId" | "fullName">): KnownPlayer {
  return { espnId: null, firstName: null, lastName: null, position: null, teamAbbr: null, isActive: true, ...overrides };
}

function knownGame(externalId: string, gameDateEt: string, matchup: string, espnId: string | null = null): KnownGame {
  const [awayTeamAbbr, homeTeamAbbr] = matchup.split("@");
  return { externalId, espnId, gameDateEt, homeTeamAbbr, awayTeamAbbr };
}

function espnGame(externalGameId: string, gameDateEt: string, matchup: string) {
  const [awayTeamAbbr, homeTeamAbbr] = matchup.split("@");
  return {
    externalGameId, gameDateEt, commenceTimeUtc: null, status: null, statusNumber: 3,
    homeTeamAbbr, awayTeamAbbr, homeTeamName: null, awayTeamName: null, season: "2026",
  };
}

test("name keys ignore accents, punctuation and generational suffixes", () => {
  assert.equal(normalizePlayerName("Luka Dončić"), normalizePlayerName("Luka Doncic"));
  assert.equal(normalizePlayerName("Ernest Udeh, Jr."), normalizePlayerName("Ernest Udeh Jr"));
  assert.equal(normalizePlayerName("De'Aaron Fox"), "deaaron fox");
  assert.equal(normalizePlayerName("Jimmy Butler III"), "jimmy butler");
  assert.equal(normalizePlayerName("Shai Gilgeous-Alexander"), "shai gilgeous alexander");
});

test("player matching tiers: stored espnId, name+team, league-unique active name", () => {
  const players = [
    known({ externalId: "1629029", fullName: "Luka Dončić", teamAbbr: "LAL" }),
    known({ externalId: "203507", fullName: "Giannis Antetokounmpo", teamAbbr: "MIL" }), // stale offseason team
    known({ externalId: "1643640", fullName: "Ernest Udeh, Jr.", teamAbbr: "CLE" }),
    known({ externalId: "1631094", fullName: "Paolo Banchero", teamAbbr: "ORL", espnId: "4432573" }),
  ];
  const matches = matchPlayers(
    [
      { espnId: "3945274", fullName: "Luka Doncic", teamAbbr: "LAL" },
      { espnId: "3032977", fullName: "Giannis Antetokounmpo", teamAbbr: "MIA" },
      { espnId: "5000001", fullName: "Ernest Udeh Jr.", teamAbbr: "CLE" },
      { espnId: "4432573", fullName: "P. Banchero", teamAbbr: "ORL" },
    ],
    players,
  );

  assert.deepEqual(
    Array.from(matches.values()).map((match) => [match.espnId, match.externalId, match.method]),
    [
      ["3945274", "1629029", "nameTeam"],
      ["3032977", "203507", "nameActive"],
      ["5000001", "1643640", "nameTeam"],
      ["4432573", "1631094", "espnId"],
    ],
  );
});

test("suffix collisions are settled by team, and true ambiguity stays unresolved", () => {
  const players = [
    known({ externalId: "1627780", fullName: "Gary Payton II", teamAbbr: "GSW" }),
    known({ externalId: "56", fullName: "Gary Payton", teamAbbr: null, isActive: false }),
    known({ externalId: "1001", fullName: "Jalen Smith", teamAbbr: "CHI" }),
    known({ externalId: "1002", fullName: "Jalen Smith", teamAbbr: "PHX" }),
  ];
  const matches = matchPlayers(
    [
      { espnId: "e-gp2", fullName: "Gary Payton II", teamAbbr: "GSW" },
      { espnId: "e-js", fullName: "Jalen Smith", teamAbbr: "IND" },
    ],
    players,
  );

  assert.equal(matches.get("e-gp2")?.externalId, "1627780");
  assert.equal(matches.get("e-js")?.method, "unresolved");
  assert.equal(matches.get("e-js")?.externalId, "espn:e-js");
});

test("a row already linked to another ESPN id is never re-claimed", () => {
  const players = [known({ externalId: "1630178", fullName: "Tyrese Maxey", teamAbbr: "PHI", espnId: "4431678" })];
  const matches = matchPlayers([{ espnId: "9999999", fullName: "Tyrese Maxey", teamAbbr: "PHI" }], players);
  assert.equal(matches.get("9999999")?.method, "unresolved");
});

test("two ESPN athletes landing on one NBA player both stay unresolved", () => {
  const players = [known({ externalId: "1641737", fullName: "Adem Bona", teamAbbr: "PHI" })];
  const matches = matchPlayers(
    [
      { espnId: "a", fullName: "Adem Bona", teamAbbr: "PHI" },
      { espnId: "b", fullName: "Adem Bona", teamAbbr: "PHI" },
    ],
    players,
  );
  assert.equal(matches.get("a")?.method, "unresolved");
  assert.equal(matches.get("b")?.method, "unresolved");
});

test("game matching: same day, postponed within two days, otherwise espn-prefixed", () => {
  const games = [
    knownGame("0022600006", "2026-10-22", "CLE@PHI"),
    knownGame("0022600007", "2026-10-22", "DEN@OKC"),
    knownGame("0022600150", "2026-11-10", "BOS@NYK"),
    knownGame("0022600151", "2026-11-12", "BOS@NYK"),
  ];
  const matches = matchGames(
    [
      espnGame("401909093", "2026-10-22", "CLE@PHI"),
      espnGame("401909094", "2026-10-24", "DEN@OKC"), // postponed two days
      espnGame("401909500", "2026-11-11", "BOS@NYK"), // between two candidates: ambiguous
      espnGame("401919999", "2026-12-16", "NYK@SAS"), // NBA Cup knockout, not seeded yet
    ],
    games,
  );

  assert.deepEqual(
    Array.from(matches.values()).map((match) => [match.espnId, match.externalId, match.method]),
    [
      ["401909093", "0022600006", "dateTeams"],
      ["401909094", "0022600007", "nearbyDate"],
      ["401909500", "espn:401909500", "unresolved"],
      ["401919999", "espn:401919999", "unresolved"],
    ],
  );
});

test("translate rewrites a real ESPN box score onto NBA ids and keeps stored names", () => {
  const summary = JSON.parse(readFileSync(new URL("./fixtures/summary-401909834.json", import.meta.url), "utf8"));
  const scoreboard = JSON.parse(readFileSync(new URL("./fixtures/scoreboard-20261021.json", import.meta.url), "utf8"));
  const games = parse.parseEspnScoreboard(scoreboard, () => "2026").filter((game) => game.externalGameId === "401909834");
  const box = parse.parseEspnBoxScore(summary, games[0]);

  const result = translateEspnPayload(
    { games, players: box.players, logs: box.logs },
    {
      games: [knownGame("0022600085", "2026-10-21", "ATL@ORL")],
      players: [
        known({ externalId: "1631094", fullName: "Paolo Banchero", firstName: "Paolo", lastName: "Banchero", position: "F", teamAbbr: "ORL" }),
        known({ externalId: "1630168", fullName: "Onyeka Okongwu", teamAbbr: "ATL", espnId: "4431680" }),
        known({ externalId: "1627827", fullName: "Dorian Finney-Smith", teamAbbr: "HOU" }),
      ],
    },
  );

  assert.deepEqual(result.games.map((game) => game.externalGameId), ["0022600085"]);
  assert.ok(result.logs.every((log) => log.externalGameId === "0022600085"));

  const banchero = result.logs.find((log) => log.externalPlayerId === "1631094");
  assert.equal(banchero?.points, 35);
  assert.equal(banchero?.position, "F");
  assert.equal(result.logs.find((log) => log.externalPlayerId === "1630168")?.minutes, 29);
  assert.equal(result.logs.find((log) => log.externalPlayerId === "1627827")?.played, false);

  // Everyone else on the 26-man box score falls back to espn: ids rather than guessing.
  assert.equal(result.methodCounts.players.unresolved, 23);
  assert.ok(result.unresolved.players.every((match) => match.externalId.startsWith("espn:")));
  assert.equal(result.players.length, 26);

  // Okongwu already carries his espnId, so only the new matches and fallbacks need linking.
  assert.deepEqual(result.links.games, [{ externalId: "0022600085", espnId: "401909834" }]);
  assert.equal(result.links.players.length, 25);
  assert.ok(!result.links.players.some((link) => link.externalId === "1630168"));
});
