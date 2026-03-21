import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";
import { etDateShift } from "../lib/snapshot/time";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Market = SnapshotMarket;

type BacktestRow = {
  gameDateEt: string;
  actualMinutes: number;
  market: Market;
};

type BacktestRowsFile = {
  from: string;
  to: string;
  playerMarketRows: BacktestRow[];
};

type EvalSummary = {
  overall: {
    samples: number;
    rawAccuracy: number;
    qualifiedAccuracy: number | null;
    qualifiedPicks: number;
    coveragePct: number;
    blendedAccuracy: number;
  };
  byMarket: Record<
    Market,
    {
      samples: number;
      rawAccuracy: number;
      qualifiedAccuracy: number | null;
      qualifiedPicks: number;
      coveragePct: number;
      blendedAccuracy: number;
    }
  >;
};

type Candidate = {
  label: string;
  modelFile: string;
  eval: EvalSummary;
};

type ModelSelectionStrategy = "in_sample" | "temporal_holdout";

type Args = {
  input: string;
  out: string;
  holdoutDays: number;
  minActualMinutes: number;
  baselineSelectionStrategy: ModelSelectionStrategy;
  baselineMaxDepth: number;
  baselineLateWindowRatio: number;
  candidateSelectionStrategy: ModelSelectionStrategy;
  candidateMaxDepth: number;
  candidateLateWindowRatio: number;
  skipHybrid: boolean;
  resume: boolean;
  keepTemp: boolean;
  fixedModelFile: string | null;
  fixedCalibrationFile: string | null;
};

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const DEFAULT_LATE_WINDOW_RATIO = 0.3;

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "universal-model-forward-test.json");
  let holdoutDays = 30;
  let minActualMinutes = 15;
  let baselineSelectionStrategy: ModelSelectionStrategy = "in_sample";
  let baselineMaxDepth = 5;
  let baselineLateWindowRatio = DEFAULT_LATE_WINDOW_RATIO;
  let candidateSelectionStrategy: ModelSelectionStrategy = "in_sample";
  let candidateMaxDepth = 6;
  let candidateLateWindowRatio = DEFAULT_LATE_WINDOW_RATIO;
  let skipHybrid = false;
  let resume = false;
  let keepTemp = false;
  let fixedModelFile: string | null = null;
  let fixedCalibrationFile: string | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if ((token === "--input" || token === "-i") && next) {
      input = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = token.slice("--input=".length);
      continue;
    }
    if ((token === "--out" || token === "-o") && next) {
      out = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
    if ((token === "--holdout-days" || token === "-d") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 7) holdoutDays = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--holdout-days=")) {
      const parsed = Number(token.slice("--holdout-days=".length));
      if (Number.isFinite(parsed) && parsed >= 7) holdoutDays = Math.floor(parsed);
      continue;
    }
    if ((token === "--min-actual-minutes" || token === "-m") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = Math.floor(parsed);
      continue;
    }
    if ((token === "--baseline-strategy" || token === "--baseline-selection-strategy") && next) {
      if (next === "in_sample" || next === "temporal_holdout") baselineSelectionStrategy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--baseline-strategy=") || token.startsWith("--baseline-selection-strategy=")) {
      const value = token.includes("--baseline-selection-strategy=")
        ? token.slice("--baseline-selection-strategy=".length)
        : token.slice("--baseline-strategy=".length);
      if (value === "in_sample" || value === "temporal_holdout") baselineSelectionStrategy = value;
      continue;
    }
    if ((token === "--candidate-strategy" || token === "--candidate-selection-strategy") && next) {
      if (next === "in_sample" || next === "temporal_holdout") candidateSelectionStrategy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--candidate-strategy=") || token.startsWith("--candidate-selection-strategy=")) {
      const value = token.includes("--candidate-selection-strategy=")
        ? token.slice("--candidate-selection-strategy=".length)
        : token.slice("--candidate-strategy=".length);
      if (value === "in_sample" || value === "temporal_holdout") candidateSelectionStrategy = value;
      continue;
    }
    if (token === "--baseline-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) baselineMaxDepth = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--baseline-depth=")) {
      const parsed = Number(token.slice("--baseline-depth=".length));
      if (Number.isFinite(parsed) && parsed >= 1) baselineMaxDepth = Math.floor(parsed);
      continue;
    }
    if (token === "--baseline-late-window-ratio" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) baselineLateWindowRatio = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--baseline-late-window-ratio=")) {
      const parsed = Number(token.slice("--baseline-late-window-ratio=".length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) baselineLateWindowRatio = parsed;
      continue;
    }
    if (token === "--candidate-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) candidateMaxDepth = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--candidate-depth=")) {
      const parsed = Number(token.slice("--candidate-depth=".length));
      if (Number.isFinite(parsed) && parsed >= 1) candidateMaxDepth = Math.floor(parsed);
      continue;
    }
    if (token === "--candidate-late-window-ratio" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) candidateLateWindowRatio = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--candidate-late-window-ratio=")) {
      const parsed = Number(token.slice("--candidate-late-window-ratio=".length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) candidateLateWindowRatio = parsed;
      continue;
    }
    if (token === "--skip-hybrid") {
      skipHybrid = true;
      continue;
    }
    if (token === "--resume") {
      resume = true;
      continue;
    }
    if (token === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    if (token === "--fixed-model-file" && next) {
      fixedModelFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--fixed-model-file=")) {
      fixedModelFile = token.slice("--fixed-model-file=".length);
      continue;
    }
    if (token === "--fixed-calibration-file" && next) {
      fixedCalibrationFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--fixed-calibration-file=")) {
      fixedCalibrationFile = token.slice("--fixed-calibration-file=".length);
    }
  }

  return {
    input,
    out,
    holdoutDays,
    minActualMinutes,
    baselineSelectionStrategy,
    baselineMaxDepth,
    baselineLateWindowRatio,
    candidateSelectionStrategy,
    candidateMaxDepth,
    candidateLateWindowRatio,
    skipHybrid,
    resume,
    keepTemp,
    fixedModelFile,
    fixedCalibrationFile,
  };
}

function formatLateWindowSuffix(selectionStrategy: ModelSelectionStrategy, ratio: number): string {
  if (selectionStrategy !== "temporal_holdout" || Math.abs(ratio - DEFAULT_LATE_WINDOW_RATIO) < 1e-9) return "";
  return `-lw${Math.round(ratio * 100)}`;
}

function runTsxScript(
  scriptPath: string,
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "--env-file=.env.local", "--env-file=.env", scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Command failed with exit code ${code ?? -1}: ${scriptPath}`));
    });
  });
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function minDate(rows: BacktestRow[]): string {
  return rows.reduce((best, row) => (row.gameDateEt < best ? row.gameDateEt : best), rows[0]?.gameDateEt ?? "");
}

function maxDate(rows: BacktestRow[]): string {
  return rows.reduce((best, row) => (row.gameDateEt > best ? row.gameDateEt : best), rows[0]?.gameDateEt ?? "");
}

async function writeRowsFile(filePath: string, rows: BacktestRow[]): Promise<void> {
  const payload: BacktestRowsFile = {
    from: minDate(rows),
    to: maxDate(rows),
    playerMarketRows: rows,
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

async function evaluateModel(
  rowsFile: string,
  modelFile: string,
  outFile: string,
  calibrationFile: string | null = null,
): Promise<EvalSummary> {
  if (!fs.existsSync(outFile)) {
    const evalArgs = ["--input", rowsFile, "--out", outFile];
    if (!calibrationFile) {
      evalArgs.splice(2, 0, "--disable-live-calibration");
    }
    await runTsxScript(
      "scripts/evaluate-universal-model-qualification.ts",
      evalArgs,
      calibrationFile
        ? {
            SNAPSHOT_UNIVERSAL_MODEL_FILE: modelFile,
            SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: calibrationFile,
          }
        : {
            SNAPSHOT_UNIVERSAL_MODEL_FILE: modelFile,
            SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION: "1",
          },
    );
  }
  return readJsonFile<EvalSummary>(outFile);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await readJsonFile<BacktestRowsFile>(path.resolve(args.input));
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const latestDate = maxDate(filteredRows);
  const holdoutStart = etDateShift(latestDate, -(args.holdoutDays - 1));
  const trainRows = filteredRows.filter((row) => row.gameDateEt < holdoutStart);
  const holdoutRows = filteredRows.filter((row) => row.gameDateEt >= holdoutStart);

  if (trainRows.length === 0 || holdoutRows.length === 0) {
    throw new Error(
      `Unable to create a forward split with holdout start ${holdoutStart}. ` +
        `Train rows: ${trainRows.length}, holdout rows: ${holdoutRows.length}.`,
    );
  }

    const fixedModelFile = args.fixedModelFile == null ? null : path.resolve(args.fixedModelFile);
    const fixedCalibrationFile = args.fixedCalibrationFile == null ? null : path.resolve(args.fixedCalibrationFile);

    const baselineLabel =
      `baseline-${args.baselineSelectionStrategy}-d${args.baselineMaxDepth}` +
      formatLateWindowSuffix(args.baselineSelectionStrategy, args.baselineLateWindowRatio);
  const candidateLabel =
    `candidate-${args.candidateSelectionStrategy}-d${args.candidateMaxDepth}` +
    formatLateWindowSuffix(args.candidateSelectionStrategy, args.candidateLateWindowRatio);
  const tempDir = args.resume
    ? path.join(
        process.cwd(),
        "exports",
        `tmp-universal-forward-${path.basename(args.out, path.extname(args.out)).replace(/[^a-z0-9._-]+/gi, "-")}`,
      )
    : path.join(process.cwd(), "exports", `tmp-universal-forward-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const trainFile = path.join(tempDir, "train-rows.json");
    const holdoutFile = path.join(tempDir, "holdout-rows.json");
    if (!fs.existsSync(trainFile)) {
      await writeRowsFile(trainFile, trainRows);
    }
    if (!fs.existsSync(holdoutFile)) {
      await writeRowsFile(holdoutFile, holdoutRows);
    }

    const baselineModelFile = fixedModelFile ?? path.join(tempDir, `${baselineLabel}.json`);
    const candidateModelFile = fixedModelFile ?? path.join(tempDir, `${candidateLabel}.json`);
    const hybridModelFile = path.join(tempDir, `hybrid-${baselineLabel}-vs-${candidateLabel}.json`);

    if (!fixedModelFile && !fs.existsSync(baselineModelFile)) {
      await runTsxScript("scripts/train-universal-archetype-side-models.ts", [
        "--input",
        trainFile,
        "--selection-strategy",
        args.baselineSelectionStrategy,
        "--max-depth",
        String(args.baselineMaxDepth),
        "--late-window-ratio",
        String(args.baselineLateWindowRatio),
        "--out",
        baselineModelFile,
      ]);
    }
    if (!fixedModelFile && !fs.existsSync(candidateModelFile)) {
      await runTsxScript("scripts/train-universal-archetype-side-models.ts", [
        "--input",
        trainFile,
        "--selection-strategy",
        args.candidateSelectionStrategy,
        "--max-depth",
        String(args.candidateMaxDepth),
        "--late-window-ratio",
        String(args.candidateLateWindowRatio),
        "--out",
        candidateModelFile,
      ]);
    }
    if (!fixedModelFile && !args.skipHybrid && !fs.existsSync(hybridModelFile)) {
      await runTsxScript("scripts/build-universal-hybrid-model.ts", [
        "--input",
        trainFile,
        "--selection-strategy",
        "full_then_late",
        "--candidate",
        baselineModelFile,
        "--candidate",
        candidateModelFile,
        "--out",
        hybridModelFile,
      ]);
    }

    const trainCandidates: Candidate[] = [
      {
        label: fixedModelFile ? "fixed-live-model" : baselineLabel,
        modelFile: baselineModelFile,
        eval: await evaluateModel(
          trainFile,
          baselineModelFile,
          path.join(tempDir, `train-${fixedModelFile ? "fixed-live-model" : baselineLabel}-eval.json`),
          fixedCalibrationFile,
        ),
      },
    ];
    if (!fixedModelFile) {
      trainCandidates.push({
        label: candidateLabel,
        modelFile: candidateModelFile,
        eval: await evaluateModel(trainFile, candidateModelFile, path.join(tempDir, `train-${candidateLabel}-eval.json`)),
      });
    }
    if (!fixedModelFile && !args.skipHybrid) {
      trainCandidates.push({
        label: `hybrid-${baselineLabel}-vs-${candidateLabel}`,
        modelFile: hybridModelFile,
        eval: await evaluateModel(
          trainFile,
          hybridModelFile,
          path.join(tempDir, `train-hybrid-${baselineLabel}-vs-${candidateLabel}-eval.json`),
        ),
      });
    }

    const promotedCandidate = pickBestCandidate(trainCandidates);
    const holdoutCandidates: Candidate[] = [
      {
        label: fixedModelFile ? "fixed-live-model" : baselineLabel,
        modelFile: baselineModelFile,
        eval: await evaluateModel(
          holdoutFile,
          baselineModelFile,
          path.join(tempDir, `holdout-${fixedModelFile ? "fixed-live-model" : baselineLabel}-eval.json`),
          fixedCalibrationFile,
        ),
      },
    ];
    if (!fixedModelFile) {
      holdoutCandidates.push({
        label: candidateLabel,
        modelFile: candidateModelFile,
        eval: await evaluateModel(
          holdoutFile,
          candidateModelFile,
          path.join(tempDir, `holdout-${candidateLabel}-eval.json`),
        ),
      });
    }
    if (!fixedModelFile && !args.skipHybrid) {
      holdoutCandidates.push({
        label: `hybrid-${baselineLabel}-vs-${candidateLabel}`,
        modelFile: hybridModelFile,
        eval: await evaluateModel(
          holdoutFile,
          hybridModelFile,
          path.join(tempDir, `holdout-hybrid-${baselineLabel}-vs-${candidateLabel}-eval.json`),
        ),
      });
    }

    const holdoutWinnerEvalResolved = holdoutCandidates.find((candidate) => candidate.label === promotedCandidate.label)?.eval;
    const holdoutBaseline = fixedModelFile
      ? holdoutWinnerEvalResolved?.overall
      : holdoutCandidates.find((candidate) => candidate.label === baselineLabel)?.eval.overall;
    if (!holdoutWinnerEvalResolved || !holdoutBaseline) {
      throw new Error("Failed to resolve holdout candidate metrics.");
    }
    const holdoutWinnerEval = holdoutWinnerEvalResolved;
    const holdoutWinner = holdoutWinnerEval.overall;

    const output = {
      generatedAt: new Date().toISOString(),
      input: path.resolve(args.input),
      split: {
        holdoutDays: args.holdoutDays,
        minActualMinutes: args.minActualMinutes,
        train: {
          from: minDate(trainRows),
          to: maxDate(trainRows),
          samples: trainRows.length,
        },
        holdout: {
          from: minDate(holdoutRows),
          to: maxDate(holdoutRows),
          samples: holdoutRows.length,
        },
      },
      trainSelection: {
        candidates: Object.fromEntries(trainCandidates.map((candidate) => [candidate.label, candidate.eval.overall])),
        promotedWinner: {
          label: promotedCandidate.label,
          metrics: promotedCandidate.eval.overall,
        },
      },
      holdout: {
        candidates: Object.fromEntries(holdoutCandidates.map((candidate) => [candidate.label, candidate.eval.overall])),
        promotedWinner: {
          label: promotedCandidate.label,
          metrics: holdoutWinner,
          byMarket: holdoutWinnerEval.byMarket,
        },
        deltaVsBaseline: {
          rawAccuracy: Number((holdoutWinner.rawAccuracy - holdoutBaseline.rawAccuracy).toFixed(2)),
          qualifiedAccuracy: Number(
            (((holdoutWinner.qualifiedAccuracy ?? 0) - (holdoutBaseline.qualifiedAccuracy ?? 0)).toFixed(2)),
          ),
          coveragePct: Number((holdoutWinner.coveragePct - holdoutBaseline.coveragePct).toFixed(2)),
          blendedAccuracy: Number((holdoutWinner.blendedAccuracy - holdoutBaseline.blendedAccuracy).toFixed(2)),
          qualifiedPicks: holdoutWinner.qualifiedPicks - holdoutBaseline.qualifiedPicks,
        },
      },
      config: {
        baseline: {
          label: baselineLabel,
          selectionStrategy: args.baselineSelectionStrategy,
          maxDepth: args.baselineMaxDepth,
          lateWindowRatio: args.baselineLateWindowRatio,
        },
        candidate: {
          label: candidateLabel,
          selectionStrategy: args.candidateSelectionStrategy,
          maxDepth: args.candidateMaxDepth,
          lateWindowRatio: args.candidateLateWindowRatio,
        },
        hybridEnabled: !args.skipHybrid,
      },
    };

    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (!args.keepTemp && !args.resume) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
