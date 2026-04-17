import assert from "node:assert/strict";
import test from "node:test";

const timeModule = (await import(new URL("./time.ts", import.meta.url).href)) as typeof import("./time");
const { SNAPSHOT_BOARD_TIMEZONE, getSnapshotBoardDateString, getTodayEtDateString } = timeModule;

test("snapshot board date rolls over at midnight Pacific time", () => {
  const cases = [
    { now: "2026-04-17T06:59:59.000Z", expectedBoardDate: "2026-04-16" },
    { now: "2026-04-17T07:00:00.000Z", expectedBoardDate: "2026-04-17" },
  ];

  for (const entry of cases) {
    assert.equal(getSnapshotBoardDateString(new Date(entry.now)), entry.expectedBoardDate);
  }
});

test("snapshot board date can differ from ET on the same UTC instant", () => {
  const now = new Date("2026-04-17T05:30:00.000Z");

  assert.equal(SNAPSHOT_BOARD_TIMEZONE, "America/Los_Angeles");
  assert.equal(getTodayEtDateString(now), "2026-04-17");
  assert.equal(getSnapshotBoardDateString(now), "2026-04-16");
});

test("snapshot board date stays stable across the Pacific spring-forward boundary", () => {
  const cases = ["2026-03-08T09:59:59.000Z", "2026-03-08T10:00:00.000Z"];

  for (const now of cases) {
    assert.equal(getSnapshotBoardDateString(new Date(now)), "2026-03-08");
  }
});

test("snapshot board date stays stable across the Pacific fall-back boundary", () => {
  const cases = ["2026-11-01T08:59:59.000Z", "2026-11-01T09:00:00.000Z"];

  for (const now of cases) {
    assert.equal(getSnapshotBoardDateString(new Date(now)), "2026-11-01");
  }
});
