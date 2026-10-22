import assert from "node:assert/strict";
import test from "node:test";

const { parseNbaDataSourceMode, selectScheduleSource } = (await import(
  new URL("./sourceSelect.ts", import.meta.url).href
)) as typeof import("./sourceSelect");

const ok = (value: string) => async () => value;
const fail = (message: string) => async (): Promise<string> => {
  throw new Error(message);
};

test("NBA_DATA_SOURCE defaults to the NBA CDN and ignores unknown values", () => {
  assert.equal(parseNbaDataSourceMode(undefined), "nba");
  assert.equal(parseNbaDataSourceMode(""), "nba");
  assert.equal(parseNbaDataSourceMode("sportsdata"), "nba");
  assert.equal(parseNbaDataSourceMode(" ESPN "), "espn");
  assert.equal(parseNbaDataSourceMode("Auto"), "auto");
});

test("nba and espn modes use only their own feed", async () => {
  assert.deepEqual(await selectScheduleSource("nba", { nba: ok("n"), espn: ok("e") }), {
    result: "n",
    source: "nba_official",
    warnings: [],
  });
  assert.deepEqual(await selectScheduleSource("espn", { nba: fail("unused"), espn: ok("e") }), {
    result: "e",
    source: "espn",
    warnings: [],
  });
  await assert.rejects(selectScheduleSource("nba", { nba: fail("NBA endpoint failed (403)"), espn: ok("e") }), /403/);
});

test("auto prefers the NBA CDN and falls back to ESPN with a warning", async () => {
  assert.equal((await selectScheduleSource("auto", { nba: ok("n"), espn: fail("unused") })).source, "nba_official");

  const fallback = await selectScheduleSource("auto", { nba: fail("NBA endpoint failed (403)"), espn: ok("e") });
  assert.equal(fallback.result, "e");
  assert.equal(fallback.source, "espn");
  assert.match(fallback.warnings[0], /ESPN fallback.*403/);

  await assert.rejects(
    selectScheduleSource("auto", { nba: fail("NBA 403"), espn: fail("ESPN 500") }),
    /NBA 403.*ESPN 500/,
  );
});
