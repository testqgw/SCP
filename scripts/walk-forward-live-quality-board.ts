import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPromotedLivePraRawFeatureRows,
  buildLiveQualityRuntimeSnapshot,
  disconnectLiveQualityBoardEvalPrisma,
  evaluateRows,
  filterAndAttachRows,
  loadLiveQualityQualificationSettings,
  loadRowsPayload,
  summarizeEvaluatedRows,
  summarizePlayers,
  type LiveQualityEvaluatedRow,
  type LiveQualityTrainingRow,
} from "./utils/liveQualityBoardEval";

type Args = {
  input: string | null;
  out: string;
  detailsOut: string | null;
  label: string;
  minActualMinutes: number;
  minTrainDates: number;
  testDates: number;
  latestFolds: number | null;
  qualificationSettingsFile: string | null;
};

type FoldSummary = {
  index: number;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  trainSamples: number;
  testSamples: number;
  metrics: ReturnType<typeof summarizeEvaluatedRows>["overall"];
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input: string | null = null;
  let out = path.join("exports", "live-quality-walk-forward.json");
  let detailsOut: string | null = null;
  let label = "fixed-live-candidate";
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
  let latestFolds: number | null = null;
  let qualificationSettingsFile: string | null = null;

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
    if ((token === "--details-out" || token === "--row-details-out") && next) {
      detailsOut = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--details-out=") || token.startsWith("--row-details-out=")) {
      detailsOut = token.includes("--row-details-out=")
        ? token.slice("--row-details-out=".length)
        : token.slice("--details-out=".length);
      continue;
    }
    if ((token === "--label" || token === "--candidate-label") && next) {
      label = next.trim();
      index += 1;
      continue;
    }
    if (token.startsWith("--label=") || token.startsWith("--candidate-label=")) {
      label = token.includes("--candidate-label=")
        ? token.slice("--candidate-label=".length).trim()
        : token.slice("--label=".length).trim();
      continue;
    }
    if ((token === "--qualification-settings-file" || token === "--settings-file") && next) {
      qualificationSettingsFile = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--qualification-settings-file=") || token.startsWith("--settings-file=")) {
      qualificationSettingsFile = token.includes("--settings-file=")
        ? token.slice("--settings-file=".length)
        : token.slice("--qualification-settings-file=".length);
      continue;
    }
    if (token === "--min-actual-minutes" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("--min-actual-minutes=")) {
      const parsed = Number(token.slice("--min-actual-minutes=".length));
      if (Number.isFinite(parsed) && parsed >= 0) minActualMinutes = parsed;
      continue;
    }
    if (token === "--min-train-dates" && next) {
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
    if (token === "--test-dates" && next) {
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
  }

  return {
    input,
    out,
    detailsOut,
    label,
    minActualMinutes,
    minTrainDates,
    testDates,
    latestFolds,
    qualificationSettingsFile,
  };
}

function uniqueSortedDates(rows: LiveQualityTrainingRow[]): string[] {
  return [...new Set(rows.map((row) => row.gameDateEt))].sort((left, right) => left.localeCompare(right));
}

function buildFolds(
  dates: string[],
  minTrainDates: number,
  testDates: number,
): Array<{ index: number; trainDates: string[]; testDates: string[] }> {
  const folds: Array<{ index: number; trainDates: string[]; testDates: string[] }> = [];
  for (let trainDateCount = minTrainDates; trainDateCount < dates.length; trainDateCount += testDates) {
    const testDateSlice = dates.slice(trainDateCount, trainDateCount + testDates);
    if (!testDateSlice.length) break;
    folds.push({
      index: folds.length + 1,
      trainDates: dates.slice(0, trainDateCount),
      testDates: testDateSlice,
    });
  }
  return folds;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await loadRowsPayload(args.input);
  const rows = filterAndAttachRows(payload.playerMarketRows, args.minActualMinutes);
  const summaries = await summarizePlayers(rows);
  const qualification = await loadLiveQualityQualificationSettings(args.qualificationSettingsFile);
  const dates = uniqueSortedDates(rows);
  let folds = buildFolds(dates, args.minTrainDates, args.testDates);
  if (args.latestFolds != null) {
    folds = folds.slice(-args.latestFolds);
  }

  const allEvaluatedRows: Array<LiveQualityEvaluatedRow & { foldIndex: number }> = [];
  const foldSummaries: FoldSummary[] = [];

  for (const fold of folds) {
    const testSet = new Set(fold.testDates);
    const trainRows = rows.filter((row) => row.gameDateEt < fold.testDates[0]);
    const testRows = rows.filter((row) => testSet.has(row.gameDateEt));
    const evaluatedRows = applyPromotedLivePraRawFeatureRows(
      testRows,
      evaluateRows(testRows, summaries, qualification.settings),
    );
    const summary = summarizeEvaluatedRows(evaluatedRows);

    evaluatedRows.forEach((row) => allEvaluatedRows.push({ ...row, foldIndex: fold.index }));
    foldSummaries.push({
      index: fold.index,
      trainFrom: fold.trainDates[0] ?? "",
      trainTo: fold.trainDates[fold.trainDates.length - 1] ?? "",
      testFrom: fold.testDates[0] ?? "",
      testTo: fold.testDates[fold.testDates.length - 1] ?? "",
      trainSamples: trainRows.length,
      testSamples: testRows.length,
      metrics: summary.overall,
    });
  }

  const overall = summarizeEvaluatedRows(allEvaluatedRows);
  const runtime = buildLiveQualityRuntimeSnapshot({
    input: args.input,
    label: args.label,
    qualificationSettingsFile: qualification.sourceFile,
  });
  const output = {
    generatedAt: new Date().toISOString(),
    input: args.input ? path.resolve(args.input) : null,
    split: {
      minActualMinutes: args.minActualMinutes,
      minTrainDates: args.minTrainDates,
      testDates: args.testDates,
      uniqueDates: dates.length,
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
      folds: folds.length,
      requestedLatestFolds: args.latestFolds,
    },
    runtime,
    candidate: {
      label: args.label,
      qualificationSettings: qualification.settings,
      overall: overall.overall,
      byMarket: overall.byMarket,
    },
    folds: foldSummaries,
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  if (args.detailsOut) {
    const detailsPath = path.resolve(args.detailsOut);
    await mkdir(path.dirname(detailsPath), { recursive: true });
    await writeFile(detailsPath, `${JSON.stringify(allEvaluatedRows, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLiveQualityBoardEvalPrisma();
  });
