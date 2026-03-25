import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import type { UniversalResidualCalibrationFile } from "../lib/snapshot/universalResidualCalibration";
import type { SnapshotMarket } from "../lib/types/snapshot";

type EvalSummary = {
  headlineMetrics?: {
    rawAccuracy: number;
    qualifiedAccuracy: number | null;
    qualifiedPicks: number;
    coveragePct: number;
    blendedAccuracy: number;
  };
  overall: {
    rawAccuracy: number;
    qualifiedAccuracy: number | null;
    qualifiedPicks: number;
    coveragePct: number;
    blendedAccuracy: number;
  };
};

type WalkForwardSummary = {
  bestCandidate?: {
    label: string;
    overall: EvalSummary["overall"];
  };
};

type ForwardTestSummary = {
  holdout?: {
    promotedWinner?: {
      label: string;
      metrics: EvalSummary["overall"];
    };
  };
};

type BacktestRowsFile = {
  playerMarketRows?: Array<{
    playerId: string;
    playerName: string;
    market: SnapshotMarket;
    pointsProjection?: number | null;
    reboundsProjection?: number | null;
    assistProjection?: number | null;
    threesProjection?: number | null;
    actualMinutes?: number | null;
  }>;
};

type Args = {
  from: string;
  to: string;
  season: string;
  lateWindowRatio: number;
  skipLineExport: boolean;
  skipBacktest: boolean;
};

type Candidate = {
  label: string;
  modelFile: string;
  calibrationFile: string;
  projectionDistributionFile: string;
  evalFile: string;
  calibrated: boolean;
  eval: EvalSummary;
};

const USE_HYBRID_CANDIDATES = false;

const BEST_BACKTEST_ARGS = [
  "--mode",
  "model",
  "--player-bias-weight",
  "0.12",
  "--player-bias-window",
  "30",
  "--global-bias-weight",
  "1.3",
  "--global-bias-min-samples",
  "1",
  "--rest-weight",
  "0.08",
  "--rest-min-samples",
  "6",
  "--quantile-clamp-weight",
  "0.08",
  "--quantile-clamp-min-samples",
  "16",
  "--median-blend-weight",
  "0.12",
  "--median-blend-take",
  "36",
  "--composite-from-core",
  "--teammate-synergy",
];
const EXPECTED_ROW_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const DEFAULT_LATE_WINDOW_RATIO = 0.3;
const QUALIFIED_FIRST_MIN_COVERAGE_PCT = 60;

function buildHeadlineMetrics(summary: EvalSummary["overall"]): NonNullable<EvalSummary["headlineMetrics"]> {
  return {
    rawAccuracy: summary.rawAccuracy,
    qualifiedAccuracy: summary.qualifiedAccuracy,
    qualifiedPicks: summary.qualifiedPicks,
    coveragePct: summary.coveragePct,
    blendedAccuracy: summary.blendedAccuracy,
  };
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let from = process.env.SNAPSHOT_UNIVERSAL_FROM?.trim() || "2025-10-23";
  let to = process.env.SNAPSHOT_UNIVERSAL_TO?.trim() || etDateShift(getTodayEtDateString(), -1);
  let season = inferSeasonFromEtDate(from);
  let lateWindowRatio = DEFAULT_LATE_WINDOW_RATIO;
  let skipLineExport = false;
  let skipBacktest = false;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--from" && next) {
      from = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }
    if (token === "--to" && next) {
      to = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }
    if (token === "--season" && next) {
      season = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--season=")) {
      season = token.slice("--season=".length);
      continue;
    }
    if (token === "--late-window-ratio" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) lateWindowRatio = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--late-window-ratio=")) {
      const parsed = Number(token.slice("--late-window-ratio=".length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) lateWindowRatio = parsed;
      continue;
    }
    if (token === "--skip-line-export") {
      skipLineExport = true;
      continue;
    }
    if (token === "--skip-backtest") {
      skipBacktest = true;
    }
  }

  return { from, to, season, lateWindowRatio, skipLineExport, skipBacktest };
}

function runTsxScript(scriptPath: string, args: string[], envOverrides: Record<string, string> = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "--env-file=.env.local", "--env-file=.env", scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? -1}: ${scriptPath}`));
    });
  });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) return null;
  return readJsonFile<T>(filePath);
}

async function writeNeutralCalibration(outPath: string, modelFile: string, inputFile: string): Promise<void> {
  const payload: UniversalResidualCalibrationFile = {
    generatedAt: new Date().toISOString(),
    inputFile,
    modelFile,
    shortWindowDays: 7,
    longWindowDays: 14,
    adjustmentMode: "penalties_only",
    records: [],
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function assertRowsFileHasExpectedMarkets(filePath: string): Promise<void> {
  const payload = await readJsonFile<BacktestRowsFile>(filePath);
  const rows = payload.playerMarketRows ?? [];
  const presentMarkets = new Set(rows.map((row) => row.market));
  const missingMarkets = EXPECTED_ROW_MARKETS.filter((market) => !presentMarkets.has(market));
  if (missingMarkets.length > 0) {
    throw new Error(
      `Backtest rows file is missing market rows for: ${missingMarkets.join(", ")}. ` +
        `Refusing to retrain the live universal model from incomplete data.`,
    );
  }

  const projectionFields = [
    "pointsProjection",
    "reboundsProjection",
    "assistProjection",
    "threesProjection",
  ] as const;
  const rowsMissingProjectionContext = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => projectionFields.some((field) => row[field] == null || !Number.isFinite(row[field])))
    .slice(0, 10);
  if (rowsMissingProjectionContext.length > 0) {
    throw new Error(
      `Backtest rows file is missing cross-market projection context on ${rowsMissingProjectionContext.length}+ rows. ` +
        `Example rows: ${rowsMissingProjectionContext
          .map(
            ({ row, index }) =>
              `#${index}:${row.playerName}:${row.market}:${[
                row.pointsProjection,
                row.reboundsProjection,
                row.assistProjection,
                row.threesProjection,
              ].join("/")}`,
          )
          .join(", ")}`,
    );
  }

  const byPlayer = new Map<
    string,
    {
      playerName: string;
      rows: NonNullable<BacktestRowsFile["playerMarketRows"]>;
    }
  >();
  rows.forEach((row) => {
    const bucket = byPlayer.get(row.playerId);
    if (bucket) {
      bucket.rows.push(row);
      return;
    }
    byPlayer.set(row.playerId, { playerName: row.playerName, rows: [row] });
  });

  const suspiciousPlayers = [...byPlayer.entries()]
    .map(([playerId, value]) => ({
      playerId,
      playerName: value.playerName,
      rows: value.rows,
    }))
    .filter(({ rows: playerRows }) => {
      const eligibleRows = playerRows.filter((row) => (row.actualMinutes ?? 0) >= 15);
      if (eligibleRows.length === 0) return false;
      const markets = new Set(eligibleRows.map((row) => row.market));
      if (!(markets.size === 1 && markets.has("THREES"))) return false;
      const meanPointsProjection =
        eligibleRows.reduce((sum, row) => sum + (row.pointsProjection ?? 0), 0) / eligibleRows.length;
      const meanReboundsProjection =
        eligibleRows.reduce((sum, row) => sum + (row.reboundsProjection ?? 0), 0) / eligibleRows.length / 1;
      const meanAssistProjection =
        eligibleRows.reduce((sum, row) => sum + (row.assistProjection ?? 0), 0) / eligibleRows.length;
      return meanPointsProjection <= 0.05 && meanReboundsProjection <= 0.05 && meanAssistProjection <= 0.05;
    })
    .slice(0, 10);
  if (suspiciousPlayers.length > 0) {
    throw new Error(
      `Detected Jaime-style THREES-only players with effectively missing non-THREES projection context: ` +
        suspiciousPlayers
          .map(({ playerName, rows: playerRows }) => `${playerName}(${playerRows.length})`)
          .join(", "),
    );
  }
}

function pickBestCandidate(candidates: Candidate[]): Candidate {
  const coverageEligible = candidates.filter(
    (candidate) => candidate.eval.overall.coveragePct >= QUALIFIED_FIRST_MIN_COVERAGE_PCT,
  );
  const pool = coverageEligible.length > 0 ? coverageEligible : candidates;
  return pool
    .slice()
    .sort((left, right) => {
      if (right.eval.overall.rawAccuracy !== left.eval.overall.rawAccuracy) {
        return right.eval.overall.rawAccuracy - left.eval.overall.rawAccuracy;
      }
      if ((right.eval.overall.qualifiedAccuracy ?? 0) !== (left.eval.overall.qualifiedAccuracy ?? 0)) {
        return (right.eval.overall.qualifiedAccuracy ?? 0) - (left.eval.overall.qualifiedAccuracy ?? 0);
      }
      if (right.eval.overall.coveragePct !== left.eval.overall.coveragePct) {
        return right.eval.overall.coveragePct - left.eval.overall.coveragePct;
      }
      return right.eval.overall.blendedAccuracy - left.eval.overall.blendedAccuracy;
    })[0];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lineFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH);
  const rowsFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  const liveModelFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
  const liveCalibrationFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
  const liveProjectionDistributionFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH);
  const directModelFile = path.join(
    process.cwd(),
    "exports",
    `universal-archetype-side-models-${args.from}-to-${args.to}-wing-guard-split.json`,
  );
  const hybridModelFile = path.join(
    process.cwd(),
    "exports",
    `universal-archetype-side-models-${args.from}-to-${args.to}-hybrid-wing-guard-split.json`,
  );
  const directCalibrationFile = path.join(
    process.cwd(),
    "exports",
    `universal-live-calibration-${args.from}-to-${args.to}-direct.json`,
  );
  const directProjectionDistributionFile = path.join(
    process.cwd(),
    "exports",
    `universal-live-projection-distribution-${args.from}-to-${args.to}-direct.json`,
  );
  const hybridCalibrationFile = path.join(
    process.cwd(),
    "exports",
    `universal-live-calibration-${args.from}-to-${args.to}-hybrid.json`,
  );
  const hybridProjectionDistributionFile = path.join(
    process.cwd(),
    "exports",
    `universal-live-projection-distribution-${args.from}-to-${args.to}-hybrid.json`,
  );
  const directEvalFile = path.join(
    process.cwd(),
    "exports",
    `universal-model-qualification-eval-${args.from}-to-${args.to}-direct.json`,
  );
  const directCalibratedEvalFile = path.join(
    process.cwd(),
    "exports",
    `universal-model-qualification-eval-${args.from}-to-${args.to}-direct-calibrated.json`,
  );
  const hybridEvalFile = path.join(
    process.cwd(),
    "exports",
    `universal-model-qualification-eval-${args.from}-to-${args.to}-hybrid.json`,
  );
  const hybridCalibratedEvalFile = path.join(
    process.cwd(),
    "exports",
    `universal-model-qualification-eval-${args.from}-to-${args.to}-hybrid-calibrated.json`,
  );

  if (!args.skipLineExport) {
    await runTsxScript("scripts/export-historical-all-player-lines.ts", [
      "--from",
      args.from,
      "--to",
      args.to,
      "--out",
      lineFile,
    ]);
  }

  if (!args.skipBacktest) {
    await runTsxScript("scripts/backtest-projection-model.ts", [
      "--season",
      args.season,
      "--from",
      args.from,
      "--to",
      args.to,
      "--line-file",
      lineFile,
      "--emit-player-rows",
      "--out",
      rowsFile,
      ...BEST_BACKTEST_ARGS,
    ]);
  }
  await assertRowsFileHasExpectedMarkets(rowsFile);

  await runTsxScript("scripts/train-universal-archetype-side-models.ts", [
    "--input",
    rowsFile,
    "--selection-strategy",
    "temporal_holdout",
    "--max-depth",
    "6",
    "--late-window-ratio",
    String(args.lateWindowRatio),
    "--out",
    directModelFile,
  ]);
  if (USE_HYBRID_CANDIDATES) {
    const previousModelCandidate = fs.existsSync(liveModelFile)
      ? liveModelFile
      : resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
    await runTsxScript("scripts/build-universal-hybrid-model.ts", [
      "--input",
      rowsFile,
      "--selection-strategy",
      "full_then_late",
      "--candidate",
      previousModelCandidate,
      "--candidate",
      directModelFile,
      "--out",
      hybridModelFile,
    ]);
  }

  await runTsxScript("scripts/build-universal-residual-calibration.ts", [
    "--input",
    rowsFile,
    "--model-file",
    directModelFile,
    "--out",
    directCalibrationFile,
    "--adjustment-mode",
    "penalties_only",
  ]);
  if (USE_HYBRID_CANDIDATES) {
    await runTsxScript("scripts/build-universal-residual-calibration.ts", [
      "--input",
      rowsFile,
      "--model-file",
      hybridModelFile,
      "--out",
      hybridCalibrationFile,
      "--adjustment-mode",
      "penalties_only",
    ]);
  }
  await runTsxScript("scripts/build-universal-projection-distribution.ts", [
    "--input",
    rowsFile,
    "--model-file",
    directModelFile,
    "--out",
    directProjectionDistributionFile,
  ]);
  if (USE_HYBRID_CANDIDATES) {
    await runTsxScript("scripts/build-universal-projection-distribution.ts", [
      "--input",
      rowsFile,
      "--model-file",
      hybridModelFile,
      "--out",
      hybridProjectionDistributionFile,
    ]);
  }

  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--disable-live-calibration", "--out", directEvalFile],
    {
      SNAPSHOT_UNIVERSAL_MODEL_FILE: directModelFile,
      SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE: directProjectionDistributionFile,
    },
  );
  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--out", directCalibratedEvalFile],
    {
      SNAPSHOT_UNIVERSAL_MODEL_FILE: directModelFile,
      SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: directCalibrationFile,
      SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE: directProjectionDistributionFile,
    },
  );
  if (USE_HYBRID_CANDIDATES) {
    await runTsxScript(
      "scripts/evaluate-universal-model-qualification.ts",
      ["--input", rowsFile, "--disable-live-calibration", "--out", hybridEvalFile],
      {
        SNAPSHOT_UNIVERSAL_MODEL_FILE: hybridModelFile,
        SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE: hybridProjectionDistributionFile,
      },
    );
    await runTsxScript(
      "scripts/evaluate-universal-model-qualification.ts",
      ["--input", rowsFile, "--out", hybridCalibratedEvalFile],
      {
        SNAPSHOT_UNIVERSAL_MODEL_FILE: hybridModelFile,
        SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: hybridCalibrationFile,
        SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE: hybridProjectionDistributionFile,
      },
    );
  }

  const candidates: Candidate[] = [
    {
      label: "direct",
      modelFile: directModelFile,
      calibrationFile: directCalibrationFile,
      projectionDistributionFile: directProjectionDistributionFile,
      evalFile: directEvalFile,
      calibrated: false,
      eval: await readJsonFile<EvalSummary>(directEvalFile),
    },
    {
      label: "direct-calibrated",
      modelFile: directModelFile,
      calibrationFile: directCalibrationFile,
      projectionDistributionFile: directProjectionDistributionFile,
      evalFile: directCalibratedEvalFile,
      calibrated: true,
      eval: await readJsonFile<EvalSummary>(directCalibratedEvalFile),
    },
  ];
  if (USE_HYBRID_CANDIDATES) {
    candidates.push(
      {
        label: "hybrid",
        modelFile: hybridModelFile,
        calibrationFile: hybridCalibrationFile,
        projectionDistributionFile: hybridProjectionDistributionFile,
        evalFile: hybridEvalFile,
        calibrated: false,
        eval: await readJsonFile<EvalSummary>(hybridEvalFile),
      },
      {
        label: "hybrid-calibrated",
        modelFile: hybridModelFile,
        calibrationFile: hybridCalibrationFile,
        projectionDistributionFile: hybridProjectionDistributionFile,
        evalFile: hybridCalibratedEvalFile,
        calibrated: true,
        eval: await readJsonFile<EvalSummary>(hybridCalibratedEvalFile),
      },
    );
  }

  const winner = pickBestCandidate(candidates);
  await mkdir(path.dirname(liveModelFile), { recursive: true });
  await copyFile(winner.modelFile, liveModelFile);
  if (winner.calibrated) {
    await copyFile(winner.calibrationFile, liveCalibrationFile);
  } else {
    await writeNeutralCalibration(liveCalibrationFile, winner.modelFile, rowsFile);
  }
  await copyFile(winner.projectionDistributionFile, liveProjectionDistributionFile);
  await copyFile(winner.evalFile, path.join(process.cwd(), "exports", "universal-model-qualification-eval.json"));

  const walkForwardSummary = await readOptionalJsonFile<WalkForwardSummary>(
    path.join(process.cwd(), "exports", "universal-model-walk-forward.json"),
  );
  const forwardTest14Summary = await readOptionalJsonFile<ForwardTestSummary>(
    path.join(process.cwd(), "exports", "universal-model-forward-test-14d.json"),
  );
  const forwardTest30Summary = await readOptionalJsonFile<ForwardTestSummary>(
    path.join(process.cwd(), "exports", "universal-model-forward-test-30d.json"),
  );

  const promotionSummaryPath = path.join(process.cwd(), "exports", "universal-live-promotion.json");
  await writeFile(
    promotionSummaryPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        from: args.from,
        to: args.to,
        season: args.season,
        lateWindowRatio: args.lateWindowRatio,
        rowsFile,
        lineFile,
        audit: {
          note:
            "headlineMetrics are replay metrics from the promoted rebuild. Use walkForwardMetrics as the stricter forward-style audit when comparing expected live performance.",
          walkForward: walkForwardSummary?.bestCandidate
            ? {
                label: walkForwardSummary.bestCandidate.label,
                metrics: walkForwardSummary.bestCandidate.overall,
              }
            : null,
          forwardTest14: forwardTest14Summary?.holdout?.promotedWinner ?? null,
          forwardTest30: forwardTest30Summary?.holdout?.promotedWinner ?? null,
        },
        winner: {
          label: winner.label,
          calibrated: winner.calibrated,
          modelFile: winner.modelFile,
          calibrationFile: winner.calibrated ? winner.calibrationFile : liveCalibrationFile,
          projectionDistributionFile: winner.projectionDistributionFile,
          headlineMetrics: buildHeadlineMetrics(winner.eval.overall),
          metrics: winner.eval.overall,
        },
        candidates: candidates.map((candidate) => ({
          label: candidate.label,
          calibrated: candidate.calibrated,
          modelFile: candidate.modelFile,
          calibrationFile: candidate.calibrationFile,
          projectionDistributionFile: candidate.projectionDistributionFile,
          headlineMetrics: buildHeadlineMetrics(candidate.eval.overall),
          metrics: candidate.eval.overall,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        winner: {
          label: winner.label,
          calibrated: winner.calibrated,
          modelFile: winner.modelFile,
          rawAccuracy: winner.eval.overall.rawAccuracy,
          qualifiedAccuracy: winner.eval.overall.qualifiedAccuracy,
          blendedAccuracy: winner.eval.overall.blendedAccuracy,
          coveragePct: winner.eval.overall.coveragePct,
        },
        promotionSummaryPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
