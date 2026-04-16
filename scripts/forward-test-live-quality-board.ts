import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { etDateShift } from "../lib/snapshot/time";
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
} from "./utils/liveQualityBoardEval";

type Args = {
  input: string | null;
  out: string;
  detailsOut: string | null;
  label: string;
  holdoutDays: number;
  minActualMinutes: number;
  qualificationSettingsFile: string | null;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let input: string | null = null;
  let out = path.join("exports", "live-quality-forward-test.json");
  let detailsOut: string | null = null;
  let label = "fixed-live-candidate";
  let holdoutDays = 30;
  let minActualMinutes = 15;
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
  }

  return {
    input,
    out,
    detailsOut,
    label,
    holdoutDays,
    minActualMinutes,
    qualificationSettingsFile,
  };
}

function maxDate(values: string[]): string {
  return values.reduce((best, value) => (value > best ? value : best), "");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const payload = await loadRowsPayload(args.input);
  const rows = filterAndAttachRows(payload.playerMarketRows, args.minActualMinutes);
  const summaries = await summarizePlayers(rows);
  const qualification = await loadLiveQualityQualificationSettings(args.qualificationSettingsFile);
  const latestDate = maxDate(rows.map((row) => row.gameDateEt));
  const holdoutStart = etDateShift(latestDate, -(args.holdoutDays - 1));
  const trainRows = rows.filter((row) => row.gameDateEt < holdoutStart);
  const holdoutRows = rows.filter((row) => row.gameDateEt >= holdoutStart);
  const evaluatedRows = applyPromotedLivePraRawFeatureRows(
    holdoutRows,
    evaluateRows(holdoutRows, summaries, qualification.settings),
  );
  const summary = summarizeEvaluatedRows(evaluatedRows);
  const runtime = buildLiveQualityRuntimeSnapshot({
    input: args.input,
    label: args.label,
    qualificationSettingsFile: qualification.sourceFile,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    input: args.input ? path.resolve(args.input) : null,
    split: {
      holdoutDays: args.holdoutDays,
      minActualMinutes: args.minActualMinutes,
      train: {
        from: trainRows[0]?.gameDateEt ?? null,
        to: trainRows[trainRows.length - 1]?.gameDateEt ?? null,
        samples: trainRows.length,
      },
      holdout: {
        from: holdoutRows[0]?.gameDateEt ?? null,
        to: holdoutRows[holdoutRows.length - 1]?.gameDateEt ?? null,
        samples: holdoutRows.length,
      },
    },
    runtime,
    candidate: {
      label: args.label,
      qualificationSettings: qualification.settings,
      overall: summary.overall,
      byMarket: summary.byMarket,
    },
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  if (args.detailsOut) {
    const detailsPath = path.resolve(args.detailsOut);
    await mkdir(path.dirname(detailsPath), { recursive: true });
    await writeFile(detailsPath, `${JSON.stringify(evaluatedRows, null, 2)}\n`, "utf8");
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
