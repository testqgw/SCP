import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function player(id, name) {
  return { playerId: id, playerName: name };
}

function scoreRow({ playerId, playerName, teamCode }) {
  return {
    dateEt: "2026-05-25",
    playerId,
    playerName,
    teamCode,
    opponentCode: "NYK",
    matchupKey: `${teamCode}-NYK`,
    gameTimeEt: "2026-05-25T20:00:00-04:00",
    market: "PTS",
    wfProbOver: 0.88,
    wfConfidence: 0.92,
    wfSide: "OVER",
    metaProbCorrect: 0.9,
    runtimeFinalSide: "OVER",
    runtimeFinalSource: "player_override",
    projectionSide: "OVER",
    line: 20.5,
    projectedValue: 23,
    lineGap: 2.5,
    absLineGap: 2.5,
    projectedMinutes: 32,
    minutesVolatility: 3,
    starterRateLast10: 1,
    lineupStatus: "CONFIRMED",
    lineupStarter: true,
    availabilityStatus: "AVAILABLE",
    availabilityPercentPlay: 100,
    rotationRank: 1,
    minutesTrend: 1,
    projectedMinutesFloor: 29,
    projectedMinutesCeiling: 35,
    dataCompletenessScore: 95,
    spreadResolved: true,
    openingTeamSpread: -2,
    openingTotal: 225,
    stakeLevel: "PLAYOFF_HIGH_LEVERAGE",
    teamRecentWinPct: 0.6,
    opponentRecentWinPct: 0.55,
    marketSynergyBoost: 1,
    marketSynergyDrag: 0,
    activeSynergyCount: 1,
    priorMarketSourceSideAcc: 0.84,
    priorMarketFinalSideAcc: 0.84,
    sportsbookCount: 8,
  };
}

test("Final V1 exporter rejects selected portfolio rows from team-stability watchlist", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "final-v1-"));
  try {
    const scoresPath = path.join(tempDir, "scores.json");
    const modelPath = path.join(tempDir, "model.json");
    const precisionPath = path.join(tempDir, "precision.json");
    const v9Path = path.join(tempDir, "v9.json");
    const outDir = path.join(tempDir, "out");

    const riskPlayer = player("risk-det", "Alpha Risk");
    const safePlayer = player("safe-bos", "Beta Safe");

    writeJson(scoresPath, {
      generatedAt: "2026-05-25T15:00:00Z",
      generatedAtUtc: "2026-05-25T15:00:00Z",
      dateEt: "2026-05-25",
      firstGameTimeEt: "2026-05-25T20:00:00-04:00",
      scheduledGameTimesEt: ["2026-05-25T20:00:00-04:00"],
      source: "test",
      metaExpandedLane: {
        label: "test meta lane",
        accuracyPct: 83,
        playerDays: 1000,
        last30AccuracyPct: 82,
        last14AccuracyPct: 81,
        activeDates: 30,
        avgPlayersPerSlate: 10,
        metaThreshold: 0.825,
        minWfConfidence: 0.75,
        rule: "test",
      },
      rows: [
        scoreRow({ ...riskPlayer, teamCode: "DET" }),
        scoreRow({ ...safePlayer, teamCode: "BOS" }),
      ],
    });
    writeJson(modelPath, {
      generatedAt: "2026-05-25T14:00:00Z",
      minSamples: 1,
      topPlayerCount: 2,
      qualifiedPlayerCount: 2,
      qualifiedPlayerPool: [riskPlayer, safePlayer],
      primaryPlayerPool: [riskPlayer, safePlayer],
      primaryLane: { label: "primary", accuracyPct: 83, playerDays: 1000, threshold: 0.84, rule: "test" },
      accuracyFirstLane: { label: "accuracy", accuracyPct: 87, playerDays: 500, threshold: 0.89, rule: "test" },
      expandedPremium90Lane: { label: "premium", accuracyPct: 91, playerDays: 500, pockets: [], rule: "test" },
    });
    writeJson(precisionPath, { summary: { overall: { picks: 100, correct: 90, accuracy: 90 } } });
    writeJson(v9Path, { overall: { samples: 1000, blendedAccuracy: 89 } });

    execFileSync(
      process.execPath,
      [
        tsxCli,
        "scripts/export-final-player-prop-model-v1.ts",
        "--scores",
        scoresPath,
        "--model",
        modelPath,
        "--precision",
        precisionPath,
        "--v9",
        v9Path,
        "--out-dir",
        outDir,
        "--max-picks",
        "1",
        "--min-score",
        "0.75",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );

    const card = JSON.parse(
      readFileSync(path.join(outDir, "final-player-prop-model-v1-2026-05-25.json"), "utf8"),
    );
    assert.equal(card.selectedPicks.length, 1);
    assert.equal(card.selectedPicks[0].player, "Beta Safe");

    const riskRow = card.boardRows.find((row) => row.player === "Alpha Risk");
    assert.ok(riskRow);
    assert.equal(riskRow.rejection_reason, "portfolio_guard_team_stability_watchlist");
    assert.ok(riskRow.risk_flags.includes("team_stability_watchlist"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("locked-forward Final V1 exporter uses the same default score floor as preview exporter", () => {
  const source = readFileSync(path.join(repoRoot, "scripts/export-locked-forward-final-player-prop-model-v1.ts"), "utf8");
  assert.match(source, /let minScore = 0\.75;/);
});

test("board data path wires the dated Final V1 player prop artifact into the website payload", () => {
  const source = readFileSync(path.join(repoRoot, "lib/snapshot/query.ts"), "utf8");
  assert.match(source, /loadFinalPlayerPropModelV1/);
  assert.match(source, /const finalModel = await loadFinalPlayerPropModelV1\(dateEt\)/);
  assert.match(source, /finalModel,/);
  assert.match(source, /finalModel: fallback\.finalModel \?\? data\.finalModel \?\? null/);
});

test("Vercel file tracing includes dated Final V1 player prop card artifacts", () => {
  const source = readFileSync(path.join(repoRoot, "next.config.js"), "utf8");
  assert.match(source, /exports\/final-player-prop-model-v1\/\*\*/);
});

test("Final V1 loader rejects summary-only backtest artifacts without board rows", () => {
  const source = readFileSync(path.join(repoRoot, "lib/snapshot/finalPlayerPropModelV1.ts"), "utf8");
  assert.match(source, /!Array\.isArray\(payload\.boardRows\)/);
  assert.match(source, /not a Final V1 live-card artifact/);
});
