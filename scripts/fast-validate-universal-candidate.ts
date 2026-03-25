import fs from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH,
  DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH,
  resolveProjectPath,
} from "../lib/snapshot/universalArtifactPaths";

type ModelSelectionStrategy = "in_sample" | "temporal_holdout";

type EvalSummary = {
  overall: {
    samples: number;
    rawAccuracy: number;
    qualifiedAccuracy: number | null;
    qualifiedPicks: number;
    coveragePct: number;
    blendedAccuracy: number;
  };
};

type ForwardSummary = {
  holdout?: {
    promotedWinner?: {
      metrics: EvalSummary["overall"];
    };
  };
};

type WalkForwardSummary = {
  bestCandidate?: {
    overall: EvalSummary["overall"];
  };
};

type TrainingRow = {
  gameDateEt: string;
};

type BacktestRowsFile = {
  from?: string;
  to?: string;
  playerMarketRows: TrainingRow[];
  [key: string]: unknown;
};

type SubsetInfo = {
  inputFile: string;
  rowsBefore: number;
  rowsAfter: number;
  dateFrom: string | null;
  dateTo: string | null;
};

type Args = {
  input: string;
  out: string;
  label: string;
  selectionStrategy: ModelSelectionStrategy;
  maxDepth: number;
  lateWindowRatio: number;
  latestFolds: number;
  keepTemp: boolean;
  resume: boolean;
  skipWalk: boolean;
  subsetLastDays: number | null;
  sampleSize: number | null;
  sampleSeed: number;
  calibrationOverride: string | null;
  useLiveModel: boolean;
  envOverrides: Record<string, string>;
};

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function resolveDefaultModelPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_MODEL_FALLBACK_RELATIVE_PATH);
}

function resolveDefaultCalibrationPath(): string {
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_CALIBRATION_RELATIVE_PATH);
}

function resolveDefaultProjectionDistributionPath(): string {
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_PROJECTION_DISTRIBUTION_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "fast-universal-candidate-validation.json");
  let label = "candidate";
  let selectionStrategy: ModelSelectionStrategy = "temporal_holdout";
  let maxDepth = 5;
  let lateWindowRatio = 0.3;
  let latestFolds = 2;
  let keepTemp = false;
  let resume = false;
  let skipWalk = false;
  let subsetLastDays: number | null = null;
  let sampleSize: number | null = null;
  let sampleSeed = 42;
  let calibrationOverride: string | null = null;
  let useLiveModel = false;
  const envOverrides: Record<string, string> = {};

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
    if (token === "--label" && next) {
      label = next.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--label=")) {
      label = token.slice("--label=".length).trim();
      continue;
    }
    if (token === "--selection-strategy" && next) {
      if (next === "in_sample" || next === "temporal_holdout") selectionStrategy = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--selection-strategy=")) {
      const value = token.slice("--selection-strategy=".length);
      if (value === "in_sample" || value === "temporal_holdout") selectionStrategy = value;
      continue;
    }
    if (token === "--max-depth" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) maxDepth = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-depth=")) {
      const parsed = Number(token.slice("--max-depth=".length));
      if (Number.isFinite(parsed) && parsed >= 1) maxDepth = Math.floor(parsed);
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
    if (token === "--latest-folds" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--latest-folds=")) {
      const parsed = Number(token.slice("--latest-folds=".length));
      if (Number.isFinite(parsed) && parsed > 0) latestFolds = Math.floor(parsed);
      continue;
    }
    if (token === "--env" && next) {
      const separator = next.indexOf("=");
      if (separator > 0) envOverrides[next.slice(0, separator)] = next.slice(separator + 1);
      index += 1;
      continue;
    }
    if (token.startsWith("--env=")) {
      const pair = token.slice("--env=".length);
      const separator = pair.indexOf("=");
      if (separator > 0) envOverrides[pair.slice(0, separator)] = pair.slice(separator + 1);
      continue;
    }
    if (token === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    if (token === "--resume") {
      resume = true;
      continue;
    }
    if (token === "--skip-walk") {
      skipWalk = true;
      continue;
    }
    if (token === "--subset-last-days" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) subsetLastDays = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--subset-last-days=")) {
      const parsed = Number(token.slice("--subset-last-days=".length));
      if (Number.isFinite(parsed) && parsed > 0) subsetLastDays = Math.floor(parsed);
      continue;
    }
    if (token === "--sample-size" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) sampleSize = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--sample-size=")) {
      const parsed = Number(token.slice("--sample-size=".length));
      if (Number.isFinite(parsed) && parsed > 0) sampleSize = Math.floor(parsed);
      continue;
    }
    if (token === "--sample-seed" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) sampleSeed = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--sample-seed=")) {
      const parsed = Number(token.slice("--sample-seed=".length));
      if (Number.isFinite(parsed)) sampleSeed = Math.floor(parsed);
      continue;
    }
    if (token === "--calibration-override" && next) {
      calibrationOverride = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--calibration-override=")) {
      calibrationOverride = token.slice("--calibration-override=".length);
      continue;
    }
    if (token === "--use-live-model") {
      useLiveModel = true;
    }
  }

  return {
    input,
    out,
    label,
    selectionStrategy,
    maxDepth,
    lateWindowRatio,
    latestFolds,
    keepTemp,
    resume,
    skipWalk,
    subsetLastDays,
    sampleSize,
    sampleSeed,
    calibrationOverride,
    useLiveModel,
    envOverrides,
  };
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

function resolveInputPath(input: string): string {
  return path.resolve(input);
}

function runTsxScript(scriptPath: string, args: string[], envOverrides: Record<string, string>): Promise<void> {
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

function shiftEtDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
}

async function prepareInputFile(args: Args, tempDir: string, label: string): Promise<SubsetInfo> {
  const resolvedInput = resolveInputPath(args.input);
  if (!args.subsetLastDays && !args.sampleSize) {
    const payload = await readJsonFile<BacktestRowsFile>(resolvedInput);
    const rows = payload.playerMarketRows;
    const dates = rows.map((row) => row.gameDateEt).filter(Boolean).sort((left, right) => left.localeCompare(right));
    return {
      inputFile: resolvedInput,
      rowsBefore: rows.length,
      rowsAfter: rows.length,
      dateFrom: dates[0] ?? payload.from ?? null,
      dateTo: dates[dates.length - 1] ?? payload.to ?? null,
    };
  }

  const payload = await readJsonFile<BacktestRowsFile>(resolvedInput);
  if (!Array.isArray(payload.playerMarketRows)) {
    throw new Error(`Input file does not contain playerMarketRows: ${resolvedInput}`);
  }

  const originalRows = payload.playerMarketRows;
  let workingRows = originalRows.slice();
  if (args.subsetLastDays) {
    const maxDate = workingRows.reduce((latest, row) => (row.gameDateEt > latest ? row.gameDateEt : latest), "");
    const cutoff = shiftEtDate(maxDate, -(args.subsetLastDays - 1));
    workingRows = workingRows.filter((row) => row.gameDateEt >= cutoff);
  }

  if (args.sampleSize && args.sampleSize < workingRows.length) {
    const random = createSeededRandom(args.sampleSeed);
    const sampledRows = workingRows.slice();
    shuffleInPlace(sampledRows, random);
    workingRows = sampledRows.slice(0, args.sampleSize);
  }

  const dates = workingRows.map((row) => row.gameDateEt).filter(Boolean).sort((left, right) => left.localeCompare(right));
  const subsetPayload: BacktestRowsFile = {
    ...payload,
    from: dates[0] ?? payload.from,
    to: dates[dates.length - 1] ?? payload.to,
    playerMarketRows: workingRows,
  };
  const subsetFile = path.join(tempDir, `${label}-subset-input.json`);
  await writeFile(subsetFile, `${JSON.stringify(subsetPayload, null, 2)}\n`, "utf8");

  return {
    inputFile: subsetFile,
    rowsBefore: originalRows.length,
    rowsAfter: workingRows.length,
    dateFrom: dates[0] ?? payload.from ?? null,
    dateTo: dates[dates.length - 1] ?? payload.to ?? null,
  };
}

function resolveWalkCandidateLabel(args: Args): string | null {
  if (args.selectionStrategy === "temporal_holdout" && args.maxDepth === 5 && Math.abs(args.lateWindowRatio - 0.2) < 1e-9) {
    return "direct-holdout-d5-r20";
  }
  if (args.selectionStrategy === "temporal_holdout" && args.maxDepth === 5 && Math.abs(args.lateWindowRatio - 0.3) < 1e-9) {
    return "direct-holdout-d5";
  }
  if (args.selectionStrategy === "temporal_holdout" && args.maxDepth === 4) return "direct-holdout-d4";
  if (args.selectionStrategy === "temporal_holdout" && args.maxDepth === 6) return "direct-holdout-d6";
  if (args.selectionStrategy === "in_sample" && args.maxDepth === 5) return "direct-in-sample-d5";
  if (args.selectionStrategy === "in_sample" && args.maxDepth === 6) return "direct-in-sample-d6";
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const label = sanitizeLabel(args.label);
  const tempDir = path.join(process.cwd(), "exports", `tmp-fast-validate-${label}`);
  await mkdir(tempDir, { recursive: true });
  const preparedInput = await prepareInputFile(args, tempDir, label);

  const calibrationOverride = args.calibrationOverride == null ? null : path.resolve(args.calibrationOverride);
  const useFixedLiveModel = args.useLiveModel || calibrationOverride != null;
  if (useFixedLiveModel && !args.skipWalk) {
    throw new Error("Fixed live model validation currently requires --skip-walk.");
  }
  const liveCalibrationFile = useFixedLiveModel
    ? calibrationOverride ?? resolveDefaultCalibrationPath()
    : null;
  const liveProjectionDistributionFile = useFixedLiveModel ? resolveDefaultProjectionDistributionPath() : null;
  const modelFile = useFixedLiveModel ? resolveDefaultModelPath() : path.join(tempDir, `${label}.json`);
  const fullEvalFile = path.join(tempDir, `${label}-full-eval.json`);
  const forward14File = path.join(tempDir, `${label}-forward-14d.json`);
  const forward30File = path.join(tempDir, `${label}-forward-30d.json`);
  const walkFile = path.join(tempDir, `${label}-walk-latest${args.latestFolds}.json`);

  if (!useFixedLiveModel && (!args.resume || !fs.existsSync(modelFile))) {
    await runTsxScript(
        "scripts/train-universal-archetype-side-models.ts",
        [
          "--input",
          preparedInput.inputFile,
          "--selection-strategy",
          args.selectionStrategy,
          "--max-depth",
        String(args.maxDepth),
        "--late-window-ratio",
        String(args.lateWindowRatio),
        "--out",
        modelFile,
      ],
      args.envOverrides,
    );
  }

  if (!args.resume || !fs.existsSync(fullEvalFile)) {
    const evalArgs = ["--input", preparedInput.inputFile, "--out", fullEvalFile];
    if (!liveCalibrationFile) {
      evalArgs.splice(2, 0, "--disable-live-calibration");
    }
    await runTsxScript(
      "scripts/evaluate-universal-model-qualification.ts",
      evalArgs,
      {
        ...args.envOverrides,
        SNAPSHOT_UNIVERSAL_MODEL_FILE: modelFile,
        ...(liveCalibrationFile
          ? { SNAPSHOT_UNIVERSAL_CALIBRATION_FILE: liveCalibrationFile }
          : { SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION: "1" }),
        ...(liveProjectionDistributionFile
          ? { SNAPSHOT_UNIVERSAL_PROJECTION_DISTRIBUTION_FILE: liveProjectionDistributionFile }
          : { SNAPSHOT_UNIVERSAL_DISABLE_PROJECTION_DISTRIBUTION: "1" }),
      },
    );
  }

  for (const days of [14, 30]) {
    const outFile = days === 14 ? forward14File : forward30File;
    if (!args.resume || !fs.existsSync(outFile)) {
      await runTsxScript(
        "scripts/forward-test-universal-model.ts",
        useFixedLiveModel
          ? [
              "--input",
              preparedInput.inputFile,
              "--holdout-days",
              String(days),
              "--skip-hybrid",
              "--resume",
              "--fixed-model-file",
              modelFile,
              ...(liveCalibrationFile ? ["--fixed-calibration-file", liveCalibrationFile] : []),
              ...(liveProjectionDistributionFile
                ? ["--fixed-projection-distribution-file", liveProjectionDistributionFile]
                : []),
              "--out",
              outFile,
            ]
          : [
          "--input",
          preparedInput.inputFile,
          "--holdout-days",
          String(days),
          "--baseline-strategy",
          args.selectionStrategy,
          "--baseline-depth",
          String(args.maxDepth),
          "--baseline-late-window-ratio",
          String(args.lateWindowRatio),
          "--candidate-strategy",
          args.selectionStrategy,
          "--candidate-depth",
          String(args.maxDepth),
          "--candidate-late-window-ratio",
          String(args.lateWindowRatio),
          "--skip-hybrid",
          "--resume",
          "--out",
          outFile,
            ],
        args.envOverrides,
      );
    }
  }

  const walkCandidateLabel = resolveWalkCandidateLabel(args);
  let walkLatestFolds: EvalSummary["overall"] | null = null;
  if (!args.skipWalk && walkCandidateLabel) {
    if (!args.resume || !fs.existsSync(walkFile)) {
      await runTsxScript(
        "scripts/walk-forward-universal-model.ts",
        [
          "--input",
          preparedInput.inputFile,
          "--candidate",
          walkCandidateLabel,
          "--latest-folds",
          String(args.latestFolds),
          "--resume",
          "--out",
          walkFile,
        ],
        args.envOverrides,
      );
    }
    walkLatestFolds = (await readJsonFile<WalkForwardSummary>(walkFile)).bestCandidate?.overall ?? null;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    label,
    config: {
      input: resolveInputPath(args.input),
      effectiveInput: preparedInput.inputFile,
      selectionStrategy: args.selectionStrategy,
      maxDepth: args.maxDepth,
      lateWindowRatio: args.lateWindowRatio,
      latestFolds: args.latestFolds,
      subsetLastDays: args.subsetLastDays,
      sampleSize: args.sampleSize,
      sampleSeed: args.sampleSeed,
      calibrationOverride,
      useLiveModel: args.useLiveModel,
      envOverrides: args.envOverrides,
    },
    artifacts: {
      subsetInputFile: preparedInput.inputFile === path.resolve(args.input) ? null : preparedInput.inputFile,
      modelFile,
      fullEvalFile,
      forward14File,
      forward30File,
      walkFile: walkLatestFolds ? walkFile : null,
    },
    inputRows: {
      rowsBefore: preparedInput.rowsBefore,
      rowsAfter: preparedInput.rowsAfter,
      dateFrom: preparedInput.dateFrom,
      dateTo: preparedInput.dateTo,
    },
    fullEval: (await readJsonFile<EvalSummary>(fullEvalFile)).overall,
    forward14: (await readJsonFile<ForwardSummary>(forward14File)).holdout?.promotedWinner?.metrics ?? null,
    forward30: (await readJsonFile<ForwardSummary>(forward30File)).holdout?.promotedWinner?.metrics ?? null,
    walkLatestFolds,
  };

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(path.resolve(args.out), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await copyFile(modelFile, path.join(process.cwd(), "exports", `${label}-candidate-model.json`));

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
