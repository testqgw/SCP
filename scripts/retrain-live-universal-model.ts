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
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { etDateShift, getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import type { UniversalResidualCalibrationFile } from "../lib/snapshot/universalResidualCalibration";

type EvalSummary = {
  overall: {
    rawAccuracy: number;
    qualifiedAccuracy: number | null;
    qualifiedPicks: number;
    coveragePct: number;
    blendedAccuracy: number;
  };
};

type Args = {
  from: string;
  to: string;
  season: string;
  skipLineExport: boolean;
  skipBacktest: boolean;
};

type Candidate = {
  label: string;
  modelFile: string;
  calibrationFile: string;
  evalFile: string;
  calibrated: boolean;
  eval: EvalSummary;
};

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
];
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let from = process.env.SNAPSHOT_UNIVERSAL_FROM?.trim() || "2025-10-23";
  let to = process.env.SNAPSHOT_UNIVERSAL_TO?.trim() || etDateShift(getTodayEtDateString(), -1);
  let season = inferSeasonFromEtDate(from);
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
    if (token === "--skip-line-export") {
      skipLineExport = true;
      continue;
    }
    if (token === "--skip-backtest") {
      skipBacktest = true;
    }
  }

  return { from, to, season, skipLineExport, skipBacktest };
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

function pickBestCandidate(candidates: Candidate[]): Candidate {
  const eligible = candidates.filter((candidate) => (candidate.eval.overall.qualifiedAccuracy ?? 0) >= 70);
  const pool = eligible.length > 0 ? eligible : candidates;
  return pool
    .slice()
    .sort((left, right) => {
      if (right.eval.overall.blendedAccuracy !== left.eval.overall.blendedAccuracy) {
        return right.eval.overall.blendedAccuracy - left.eval.overall.blendedAccuracy;
      }
      if ((right.eval.overall.qualifiedAccuracy ?? 0) !== (left.eval.overall.qualifiedAccuracy ?? 0)) {
        return (right.eval.overall.qualifiedAccuracy ?? 0) - (left.eval.overall.qualifiedAccuracy ?? 0);
      }
      return right.eval.overall.coveragePct - left.eval.overall.coveragePct;
    })[0];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lineFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_LINES_RELATIVE_PATH);
  const rowsFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  const liveModelFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
  const liveCalibrationFile = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
  const previousModelCandidate = fs.existsSync(liveModelFile)
    ? liveModelFile
    : resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);

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
  const hybridCalibrationFile = path.join(
    process.cwd(),
    "exports",
    `universal-live-calibration-${args.from}-to-${args.to}-hybrid.json`,
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

  await runTsxScript("scripts/train-universal-archetype-side-models.ts", [
    "--input",
    rowsFile,
    "--selection-strategy",
    "in_sample",
    "--out",
    directModelFile,
  ]);
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

  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--disable-live-calibration", "--out", directEvalFile],
    { SNAPSHOT_UNIVERSAL_MODEL_FILE: directModelFile },
  );
  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--out", directCalibratedEvalFile],
    {
      SNAPSHOT_UNIVERSAL_MODEL_FILE: directModelFile,
      SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: directCalibrationFile,
    },
  );
  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--disable-live-calibration", "--out", hybridEvalFile],
    { SNAPSHOT_UNIVERSAL_MODEL_FILE: hybridModelFile },
  );
  await runTsxScript(
    "scripts/evaluate-universal-model-qualification.ts",
    ["--input", rowsFile, "--out", hybridCalibratedEvalFile],
    {
      SNAPSHOT_UNIVERSAL_MODEL_FILE: hybridModelFile,
      SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: hybridCalibrationFile,
    },
  );

  const candidates: Candidate[] = [
    {
      label: "direct",
      modelFile: directModelFile,
      calibrationFile: directCalibrationFile,
      evalFile: directEvalFile,
      calibrated: false,
      eval: await readJsonFile<EvalSummary>(directEvalFile),
    },
    {
      label: "direct-calibrated",
      modelFile: directModelFile,
      calibrationFile: directCalibrationFile,
      evalFile: directCalibratedEvalFile,
      calibrated: true,
      eval: await readJsonFile<EvalSummary>(directCalibratedEvalFile),
    },
    {
      label: "hybrid",
      modelFile: hybridModelFile,
      calibrationFile: hybridCalibrationFile,
      evalFile: hybridEvalFile,
      calibrated: false,
      eval: await readJsonFile<EvalSummary>(hybridEvalFile),
    },
    {
      label: "hybrid-calibrated",
      modelFile: hybridModelFile,
      calibrationFile: hybridCalibrationFile,
      evalFile: hybridCalibratedEvalFile,
      calibrated: true,
      eval: await readJsonFile<EvalSummary>(hybridCalibratedEvalFile),
    },
  ];

  const winner = pickBestCandidate(candidates);
  await mkdir(path.dirname(liveModelFile), { recursive: true });
  await copyFile(winner.modelFile, liveModelFile);
  if (winner.calibrated) {
    await copyFile(winner.calibrationFile, liveCalibrationFile);
  } else {
    await writeNeutralCalibration(liveCalibrationFile, winner.modelFile, rowsFile);
  }
  await copyFile(winner.evalFile, path.join(process.cwd(), "exports", "universal-model-qualification-eval.json"));

  const promotionSummaryPath = path.join(process.cwd(), "exports", "universal-live-promotion.json");
  await writeFile(
    promotionSummaryPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        from: args.from,
        to: args.to,
        season: args.season,
        rowsFile,
        lineFile,
        winner: {
          label: winner.label,
          calibrated: winner.calibrated,
          modelFile: winner.modelFile,
          calibrationFile: winner.calibrated ? winner.calibrationFile : liveCalibrationFile,
          metrics: winner.eval.overall,
        },
        candidates: candidates.map((candidate) => ({
          label: candidate.label,
          calibrated: candidate.calibrated,
          modelFile: candidate.modelFile,
          calibrationFile: candidate.calibrationFile,
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
          blendedAccuracy: winner.eval.overall.blendedAccuracy,
          qualifiedAccuracy: winner.eval.overall.qualifiedAccuracy,
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
