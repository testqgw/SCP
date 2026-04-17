import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { etDateShift } from "../lib/snapshot/time";
import {
  UNIVERSAL_SYSTEM_SUMMARY,
  UNIVERSAL_SYSTEM_SUMMARY_VERSION,
} from "../lib/snapshot/universalSystemSummary";
import {
  applyPromotedLivePraRawFeatureRows,
  buildLiveQualityRuntimeSnapshot,
  disconnectLiveQualityBoardEvalPrisma,
  evaluateRows,
  filterAndAttachRows,
  loadLiveQualityQualificationSettings,
  loadRowsPayload,
  resolveRowsFilePath,
  summarizeEvaluatedRows,
  summarizePlayers,
  type LiveQualityEvaluatedRow,
  type LiveQualityPlayerSummary,
  type LiveQualityTrainingRow,
} from "./utils/liveQualityBoardEval";
import type { LiveUniversalQualificationSettings } from "../lib/snapshot/liveUniversalSideModels";

type Args = {
  input: string | null;
  out: string;
  minActualMinutes: number;
  minTrainDates: number;
  testDates: number;
  qualificationSettingsFile: string | null;
};

type WorstMarketSummary = {
  market: string;
  accuracy: number;
  samples: number;
};

type PlayerAccuracySummary = {
  playerName: string;
  samples: number;
  finalAccuracy: number;
  rawAccuracy: number;
  worstMarket: WorstMarketSummary | null;
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
  let out = path.join("exports", "current-live-stack-audit.json");
  let minActualMinutes = 15;
  let minTrainDates = 56;
  let testDates = 14;
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
  }

  return {
    input,
    out,
    minActualMinutes,
    minTrainDates,
    testDates,
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

function roundPct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function evaluateForwardHoldout(
  rows: LiveQualityTrainingRow[],
  summaries: Map<string, LiveQualityPlayerSummary>,
  settings: LiveUniversalQualificationSettings,
  holdoutDays: number,
): {
  evaluatedRows: LiveQualityEvaluatedRow[];
  overall: ReturnType<typeof summarizeEvaluatedRows>["overall"];
  byMarket: ReturnType<typeof summarizeEvaluatedRows>["byMarket"];
  holdoutFrom: string | null;
  holdoutTo: string | null;
} {
  const latestDate = rows.reduce((best, row) => (row.gameDateEt > best ? row.gameDateEt : best), "");
  const holdoutStart = etDateShift(latestDate, -(holdoutDays - 1));
  const holdoutRows = rows.filter((row) => row.gameDateEt >= holdoutStart);
  const evaluatedRows = applyPromotedLivePraRawFeatureRows(
    holdoutRows,
    evaluateRows(holdoutRows, summaries, settings),
  );
  const summary = summarizeEvaluatedRows(evaluatedRows);

  return {
    evaluatedRows,
    overall: summary.overall,
    byMarket: summary.byMarket,
    holdoutFrom: holdoutRows[0]?.gameDateEt ?? null,
    holdoutTo: holdoutRows[holdoutRows.length - 1]?.gameDateEt ?? null,
  };
}

function evaluateWalkForward(
  rows: LiveQualityTrainingRow[],
  summaries: Map<string, LiveQualityPlayerSummary>,
  settings: LiveUniversalQualificationSettings,
  minTrainDates: number,
  testDates: number,
): {
  evaluatedRows: LiveQualityEvaluatedRow[];
  overall: ReturnType<typeof summarizeEvaluatedRows>["overall"];
  byMarket: ReturnType<typeof summarizeEvaluatedRows>["byMarket"];
  folds: FoldSummary[];
  latestFold: FoldSummary | null;
} {
  const dates = uniqueSortedDates(rows);
  const folds = buildFolds(dates, minTrainDates, testDates);
  const allEvaluatedRows: LiveQualityEvaluatedRow[] = [];
  const foldSummaries: FoldSummary[] = [];

  for (const fold of folds) {
    const testSet = new Set(fold.testDates);
    const trainRows = rows.filter((row) => row.gameDateEt < fold.testDates[0]);
    const testRows = rows.filter((row) => testSet.has(row.gameDateEt));
    const evaluatedRows = applyPromotedLivePraRawFeatureRows(
      testRows,
      evaluateRows(testRows, summaries, settings),
    );
    const summary = summarizeEvaluatedRows(evaluatedRows);

    allEvaluatedRows.push(...evaluatedRows);
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
  const latestFold = foldSummaries[foldSummaries.length - 1] ?? null;

  return {
    evaluatedRows: allEvaluatedRows,
    overall: overall.overall,
    byMarket: overall.byMarket,
    folds: foldSummaries,
    latestFold,
  };
}

function summarizeWorstPlayers(
  evaluatedRows: LiveQualityEvaluatedRow[],
  minSamples: number,
  topN = 5,
): PlayerAccuracySummary[] {
  const byPlayer = new Map<
    string,
    {
      playerName: string;
      samples: number;
      finalHits: number;
      rawHits: number;
      byMarket: Map<string, { samples: number; finalHits: number }>;
    }
  >();

  for (const row of evaluatedRows) {
    const entry = byPlayer.get(row.playerName) ?? {
      playerName: row.playerName,
      samples: 0,
      finalHits: 0,
      rawHits: 0,
      byMarket: new Map<string, { samples: number; finalHits: number }>(),
    };
    entry.samples += 1;
    if (row.finalCorrect) entry.finalHits += 1;
    if (row.rawCorrect) entry.rawHits += 1;
    const market = entry.byMarket.get(row.market) ?? { samples: 0, finalHits: 0 };
    market.samples += 1;
    if (row.finalCorrect) market.finalHits += 1;
    entry.byMarket.set(row.market, market);
    byPlayer.set(row.playerName, entry);
  }

  return [...byPlayer.values()]
    .filter((entry) => entry.samples >= minSamples)
    .map((entry) => {
      const worstMarketEntry = [...entry.byMarket.entries()]
        .map(([market, marketSummary]) => ({
          market,
          accuracy: roundPct(marketSummary.finalHits, marketSummary.samples),
          samples: marketSummary.samples,
        }))
        .sort((left, right) => left.accuracy - right.accuracy || right.samples - left.samples)[0];

      return {
        playerName: entry.playerName,
        samples: entry.samples,
        finalAccuracy: roundPct(entry.finalHits, entry.samples),
        rawAccuracy: roundPct(entry.rawHits, entry.samples),
        worstMarket: worstMarketEntry ?? null,
      };
    })
    .sort((left, right) => left.finalAccuracy - right.finalAccuracy || right.samples - left.samples)
    .slice(0, topN);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_MANIFEST_MODE?.trim()) {
    process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_MANIFEST_MODE = "on";
  }
  if (!process.env.SNAPSHOT_PLAYER_MARKET_RESIDUAL_DRAG_MEMORY_MODE?.trim()) {
    process.env.SNAPSHOT_PLAYER_MARKET_RESIDUAL_DRAG_MEMORY_MODE = "on";
  }

  const payload = await loadRowsPayload(args.input);
  const rows = filterAndAttachRows(payload.playerMarketRows, args.minActualMinutes);
  const summaries = await summarizePlayers(rows);
  const qualification = await loadLiveQualityQualificationSettings(args.qualificationSettingsFile);
  const walkForward = evaluateWalkForward(rows, summaries, qualification.settings, args.minTrainDates, args.testDates);
  const holdout30d = evaluateForwardHoldout(rows, summaries, qualification.settings, 30);
  const holdout14d = evaluateForwardHoldout(rows, summaries, qualification.settings, 14);
  const runtime = buildLiveQualityRuntimeSnapshot({
    input: args.input,
    label: "current-live-stack-audit",
    qualificationSettingsFile: qualification.sourceFile,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: resolveRowsFilePath(args.input),
    runtime,
    auditDefaults: {
      playerLocalRecoveryManifestMode: process.env.SNAPSHOT_PLAYER_LOCAL_RECOVERY_MANIFEST_MODE,
      playerMarketResidualDragMemoryMode: process.env.SNAPSHOT_PLAYER_MARKET_RESIDUAL_DRAG_MEMORY_MODE,
      minActualMinutes: args.minActualMinutes,
      minTrainDates: args.minTrainDates,
      testDates: args.testDates,
    },
    appSummary: {
      version: UNIVERSAL_SYSTEM_SUMMARY_VERSION,
      values: UNIVERSAL_SYSTEM_SUMMARY,
    },
    walkForward: {
      overall: walkForward.overall,
      latestFold: walkForward.latestFold,
      folds: walkForward.folds,
    },
    honest30d: {
      from: holdout30d.holdoutFrom,
      to: holdout30d.holdoutTo,
      overall: holdout30d.overall,
    },
    honest14d: {
      from: holdout14d.holdoutFrom,
      to: holdout14d.holdoutTo,
      overall: holdout14d.overall,
    },
    worstPlayers: {
      min40: summarizeWorstPlayers(walkForward.evaluatedRows, 40),
      min100: summarizeWorstPlayers(walkForward.evaluatedRows, 100),
      min200: summarizeWorstPlayers(walkForward.evaluatedRows, 200),
    },
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
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
