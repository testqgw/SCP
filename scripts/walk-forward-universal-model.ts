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

type EvalBucket = {
  samples: number;
  rawAccuracy: number;
  qualifiedAccuracy: number | null;
  qualifiedPicks: number;
  coveragePct: number;
  blendedAccuracy: number;
};

type EvalSummary = {
  overall: EvalBucket;
  byMarket: Record<Market, EvalBucket>;
};

type CandidateSpec = {
  label: string;
  selectionStrategy: "in_sample" | "temporal_holdout";
  maxDepth: number;
  lateWindowRatio?: number;
};

type CandidateFoldResult = {
  label: string;
  overall: EvalBucket;
  byMarket: Record<Market, EvalBucket>;
};

type FoldSummary = {
  index: number;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  trainSamples: number;
  testSamples: number;
  candidates: CandidateFoldResult[];
  winner: {
    label: string;
    overall: EvalBucket;
  };
};

type AggregateCounts = {
  samples: number;
  rawCorrect: number;
  qualifiedPicks: number;
  qualifiedCorrect: number;
  blendedCorrect: number;
};

type Args = {
  input: string;
  out: string;
  minActualMinutes: number;
  minTrainDates: number;
  testDates: number;
  candidateLabels: string[];
  maxFolds: number | null;
  latestFolds: number | null;
  resume: boolean;
  keepTemp: boolean;
};

const MARKETS: Market[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];
const DEFAULT_LATE_WINDOW_RATIO = 0.3;
const CANDIDATES: CandidateSpec[] = [
  { label: "direct-in-sample-d5", selectionStrategy: "in_sample", maxDepth: 5 },
  { label: "direct-in-sample-d6", selectionStrategy: "in_sample", maxDepth: 6 },
  { label: "direct-holdout-d4", selectionStrategy: "temporal_holdout", maxDepth: 4 },
  { label: "direct-holdout-d5", selectionStrategy: "temporal_holdout", maxDepth: 5 },
  { label: "direct-holdout-d5-r20", selectionStrategy: "temporal_holdout", maxDepth: 5, lateWindowRatio: 0.2 },
  { label: "direct-holdout-d6", selectionStrategy: "temporal_holdout", maxDepth: 6 },
];

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

function resolveDefaultInputPath(): string {
  const preferred = resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_RELATIVE_PATH);
  if (fs.existsSync(preferred)) return preferred;
  return resolveProjectPath(DEFAULT_UNIVERSAL_LIVE_ROWS_FALLBACK_RELATIVE_PATH);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input = resolveDefaultInputPath();
  let out = path.join("exports", "universal-model-walk-forward.json");
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
  const candidateLabels: string[] = [];
  let maxFolds: number | null = null;
  let latestFolds: number | null = null;
  let resume = false;
  let keepTemp = false;

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
    if ((token === "--min-train-dates" || token === "-t") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-train-dates=")) {
      const parsed = Number(token.slice("--min-train-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 28) minTrainDates = Math.floor(parsed);
      continue;
    }
    if ((token === "--test-dates" || token === "-d") && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--test-dates=")) {
      const parsed = Number(token.slice("--test-dates=".length));
      if (Number.isFinite(parsed) && parsed >= 7) testDates = Math.floor(parsed);
      continue;
    }
    if ((token === "--candidate" || token === "--candidate-label") && next) {
      candidateLabels.push(next.trim());
      index += 1;
      continue;
    }
    if (token.startsWith("--candidate=")) {
      candidateLabels.push(token.slice("--candidate=".length).trim());
      continue;
    }
    if (token.startsWith("--candidate-label=")) {
      candidateLabels.push(token.slice("--candidate-label=".length).trim());
      continue;
    }
    if (token === "--max-folds" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) maxFolds = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--max-folds=")) {
      const parsed = Number(token.slice("--max-folds=".length));
      if (Number.isFinite(parsed) && parsed > 0) maxFolds = Math.floor(parsed);
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
    if (token === "--resume") {
      resume = true;
      continue;
    }
    if (token === "--keep-temp") {
      keepTemp = true;
    }
  }

  return { input, out, minActualMinutes, minTrainDates, testDates, candidateLabels, maxFolds, latestFolds, resume, keepTemp };
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

function pickWinner(candidates: CandidateFoldResult[]): CandidateFoldResult {
  const eligible = candidates.filter((candidate) => (candidate.overall.qualifiedAccuracy ?? 0) >= 52);
  const pool = eligible.length > 0 ? eligible : candidates;
  return pool
    .slice()
    .sort((left, right) => {
      if (right.overall.blendedAccuracy !== left.overall.blendedAccuracy) {
        return right.overall.blendedAccuracy - left.overall.blendedAccuracy;
      }
      if ((right.overall.qualifiedAccuracy ?? 0) !== (left.overall.qualifiedAccuracy ?? 0)) {
        return (right.overall.qualifiedAccuracy ?? 0) - (left.overall.qualifiedAccuracy ?? 0);
      }
      return right.overall.coveragePct - left.overall.coveragePct;
    })[0];
}

function bucketToCounts(bucket: EvalBucket): AggregateCounts {
  const qualifiedCorrect =
    bucket.qualifiedAccuracy == null ? 0 : Math.round((bucket.qualifiedAccuracy / 100) * bucket.qualifiedPicks);
  return {
    samples: bucket.samples,
    rawCorrect: Math.round((bucket.rawAccuracy / 100) * bucket.samples),
    qualifiedPicks: bucket.qualifiedPicks,
    qualifiedCorrect,
    blendedCorrect: Math.round((bucket.blendedAccuracy / 100) * bucket.samples),
  };
}

function summarizeCounts(counts: AggregateCounts): EvalBucket {
  return {
    samples: counts.samples,
    rawAccuracy: counts.samples > 0 ? Number(((counts.rawCorrect / counts.samples) * 100).toFixed(2)) : 0,
    qualifiedAccuracy:
      counts.qualifiedPicks > 0 ? Number(((counts.qualifiedCorrect / counts.qualifiedPicks) * 100).toFixed(2)) : null,
    qualifiedPicks: counts.qualifiedPicks,
    coveragePct: counts.samples > 0 ? Number(((counts.qualifiedPicks / counts.samples) * 100).toFixed(2)) : 0,
    blendedAccuracy: counts.samples > 0 ? Number(((counts.blendedCorrect / counts.samples) * 100).toFixed(2)) : 0,
  };
}

function addCounts(target: AggregateCounts, source: AggregateCounts): void {
  target.samples += source.samples;
  target.rawCorrect += source.rawCorrect;
  target.qualifiedPicks += source.qualifiedPicks;
  target.qualifiedCorrect += source.qualifiedCorrect;
  target.blendedCorrect += source.blendedCorrect;
}

async function evaluateCandidate(trainFile: string, testFile: string, tempDir: string, candidate: CandidateSpec): Promise<CandidateFoldResult> {
  const modelFile = path.join(tempDir, `${candidate.label}.json`);
  const evalFile = path.join(tempDir, `${candidate.label}-eval.json`);
  if (!fs.existsSync(modelFile)) {
    const lateWindowRatio = candidate.lateWindowRatio ?? DEFAULT_LATE_WINDOW_RATIO;
    await runTsxScript("scripts/train-universal-archetype-side-models.ts", [
      "--input",
      trainFile,
      "--selection-strategy",
      candidate.selectionStrategy,
      "--max-depth",
      String(candidate.maxDepth),
      "--late-window-ratio",
      String(lateWindowRatio),
      "--out",
      modelFile,
    ]);
  }
  if (!fs.existsSync(evalFile)) {
    await runTsxScript(
      "scripts/evaluate-universal-model-qualification.ts",
      ["--input", testFile, "--disable-live-calibration", "--out", evalFile],
      {
        SNAPSHOT_UNIVERSAL_MODEL_FILE: modelFile,
        SNAPSHOT_UNIVERSAL_DISABLE_CALIBRATION: "1",
      },
    );
  }
  const evalSummary = await readJsonFile<EvalSummary>(evalFile);
  return {
    label: candidate.label,
    overall: evalSummary.overall,
    byMarket: evalSummary.byMarket,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await readJsonFile<BacktestRowsFile>(path.resolve(args.input));
  const filteredRows = payload.playerMarketRows.filter((row) => row.actualMinutes >= args.minActualMinutes);
  const uniqueDates = [...new Set(filteredRows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
  const activeCandidates =
    args.candidateLabels.length > 0
      ? CANDIDATES.filter((candidate) => args.candidateLabels.includes(candidate.label))
      : CANDIDATES;

  if (uniqueDates.length < args.minTrainDates + args.testDates) {
    throw new Error(
      `Not enough unique dates for walk-forward test. ` +
        `Need at least ${args.minTrainDates + args.testDates}, found ${uniqueDates.length}.`,
    );
  }
  if (activeCandidates.length === 0) {
    throw new Error(`No walk-forward candidates matched: ${args.candidateLabels.join(", ")}`);
  }

  const plannedFolds: Array<{ foldIndex: number; trainDateCount: number; testDateSlice: string[] }> = [];
  for (let trainDateCount = args.minTrainDates, foldIndex = 1; trainDateCount < uniqueDates.length; trainDateCount += args.testDates, foldIndex += 1) {
    const testDateSlice = uniqueDates.slice(trainDateCount, trainDateCount + args.testDates);
    if (testDateSlice.length === 0) break;
    plannedFolds.push({ foldIndex, trainDateCount, testDateSlice });
  }
  const selectedFolds = (() => {
    let folds = plannedFolds;
    if (args.latestFolds != null) {
      folds = folds.slice(-args.latestFolds);
    }
    if (args.maxFolds != null) {
      folds = folds.slice(0, args.maxFolds);
    }
    return folds;
  })();
  const tempRoot = args.resume
    ? path.join(
        process.cwd(),
        "exports",
        `tmp-universal-walk-forward-${path.basename(args.out, path.extname(args.out)).replace(/[^a-z0-9._-]+/gi, "-")}`,
      )
    : path.join(process.cwd(), "exports", `tmp-universal-walk-forward-${Date.now()}`);
  await mkdir(tempRoot, { recursive: true });

  try {
    const folds: FoldSummary[] = [];
    const aggregateByCandidate = new Map<
      string,
      {
        overall: AggregateCounts;
        byMarket: Record<Market, AggregateCounts>;
      }
    >();

    for (const foldPlan of selectedFolds) {
      const { foldIndex, trainDateCount, testDateSlice } = foldPlan;
      const trainDates = new Set(uniqueDates.slice(0, trainDateCount));
      const testDates = new Set(testDateSlice);

      const trainRows = filteredRows.filter((row) => trainDates.has(row.gameDateEt));
      const testRows = filteredRows.filter((row) => testDates.has(row.gameDateEt));
      const foldTempDir = path.join(tempRoot, `fold-${String(foldIndex).padStart(2, "0")}`);
      await mkdir(foldTempDir, { recursive: true });

      const trainFile = path.join(foldTempDir, "train-rows.json");
      const testFile = path.join(foldTempDir, "test-rows.json");
      await writeRowsFile(trainFile, trainRows);
      await writeRowsFile(testFile, testRows);

      const candidateResults: CandidateFoldResult[] = [];
      for (const candidate of activeCandidates) {
        candidateResults.push(await evaluateCandidate(trainFile, testFile, foldTempDir, candidate));
      }

      const winner = pickWinner(candidateResults);
      folds.push({
        index: foldIndex,
        trainFrom: minDate(trainRows),
        trainTo: maxDate(trainRows),
        testFrom: minDate(testRows),
        testTo: maxDate(testRows),
        trainSamples: trainRows.length,
        testSamples: testRows.length,
        candidates: candidateResults,
        winner: {
          label: winner.label,
          overall: winner.overall,
        },
      });

      for (const result of candidateResults) {
        const current = aggregateByCandidate.get(result.label) ?? {
          overall: { samples: 0, rawCorrect: 0, qualifiedPicks: 0, qualifiedCorrect: 0, blendedCorrect: 0 },
          byMarket: Object.fromEntries(
            MARKETS.map((market) => [
              market,
              { samples: 0, rawCorrect: 0, qualifiedPicks: 0, qualifiedCorrect: 0, blendedCorrect: 0 },
            ]),
          ) as Record<Market, AggregateCounts>,
        };
        addCounts(current.overall, bucketToCounts(result.overall));
        for (const market of MARKETS) {
          addCounts(current.byMarket[market], bucketToCounts(result.byMarket[market]));
        }
        aggregateByCandidate.set(result.label, current);
      }
    }

    const candidateSummaries = [...aggregateByCandidate.entries()]
      .map(([label, counts]) => ({
        label,
        overall: summarizeCounts(counts.overall),
        byMarket: Object.fromEntries(
          MARKETS.map((market) => [market, summarizeCounts(counts.byMarket[market])]),
        ) as Record<Market, EvalBucket>,
      }))
      .sort((left, right) => {
        if (right.overall.blendedAccuracy !== left.overall.blendedAccuracy) {
          return right.overall.blendedAccuracy - left.overall.blendedAccuracy;
        }
        if ((right.overall.qualifiedAccuracy ?? 0) !== (left.overall.qualifiedAccuracy ?? 0)) {
          return (right.overall.qualifiedAccuracy ?? 0) - (left.overall.qualifiedAccuracy ?? 0);
        }
        return right.overall.coveragePct - left.overall.coveragePct;
      });

    const bestCandidate = candidateSummaries[0];
    const baselineCandidate = candidateSummaries.find((candidate) => candidate.label === "direct-in-sample-d5") ?? candidateSummaries[0];

    const output = {
      generatedAt: new Date().toISOString(),
      input: path.resolve(args.input),
      split: {
        minActualMinutes: args.minActualMinutes,
        minTrainDates: args.minTrainDates,
        testDates: args.testDates,
        uniqueDates: uniqueDates.length,
        from: uniqueDates[0],
        to: uniqueDates.at(-1) ?? null,
        requestedCandidates: activeCandidates.map((candidate) => candidate.label),
        requestedMaxFolds: args.maxFolds,
        requestedLatestFolds: args.latestFolds,
        folds: folds.length,
      },
      candidates: candidateSummaries,
      bestCandidate: {
        label: bestCandidate.label,
        overall: bestCandidate.overall,
      },
      deltaVsBaselineInSampleD5: {
        rawAccuracy: Number((bestCandidate.overall.rawAccuracy - baselineCandidate.overall.rawAccuracy).toFixed(2)),
        qualifiedAccuracy: Number(
          (((bestCandidate.overall.qualifiedAccuracy ?? 0) - (baselineCandidate.overall.qualifiedAccuracy ?? 0)).toFixed(2)),
        ),
        coveragePct: Number((bestCandidate.overall.coveragePct - baselineCandidate.overall.coveragePct).toFixed(2)),
        blendedAccuracy: Number((bestCandidate.overall.blendedAccuracy - baselineCandidate.overall.blendedAccuracy).toFixed(2)),
        qualifiedPicks: bestCandidate.overall.qualifiedPicks - baselineCandidate.overall.qualifiedPicks,
      },
      folds,
    };

    const outPath = path.resolve(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (!args.keepTemp && !args.resume) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
