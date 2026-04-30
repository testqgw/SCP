import {
  listSnapshotDates,
  movementSummaryPath,
  PROP_LINE_SNAPSHOT_DIR,
  PROP_LINE_SNAPSHOT_MARKETS,
  readSnapshotRowsForDate,
  summarizeSnapshotRows,
  writeMovementSummary,
} from "./utils/intradayPropLineSnapshots";

type Args = {
  dateEt: string | null;
  outDir: string;
  minSnapshots: number;
};

function parseArgs(): Args {
  const tokens = process.argv.slice(2);
  let dateEt: string | null = null;
  let outDir = PROP_LINE_SNAPSHOT_DIR;
  let minSnapshots = 2;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if ((token === "--date" || token === "-d") && next) {
      dateEt = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--date=")) {
      dateEt = token.slice("--date=".length);
      continue;
    }
    if ((token === "--out-dir" || token === "-o") && next) {
      outDir = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-dir=")) {
      outDir = token.slice("--out-dir=".length);
      continue;
    }
    if ((token === "--min-snapshots" || token === "-n") && next) {
      minSnapshots = Number(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--min-snapshots=")) {
      minSnapshots = Number(token.slice("--min-snapshots=".length));
      continue;
    }
  }

  if (dateEt && !/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) {
    throw new Error(`Invalid --date value: ${dateEt}. Expected YYYY-MM-DD.`);
  }
  if (!Number.isFinite(minSnapshots) || minSnapshots < 1) {
    throw new Error("--min-snapshots must be a positive number.");
  }

  return { dateEt, outDir, minSnapshots };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dates = args.dateEt ? [args.dateEt] : await listSnapshotDates(args.outDir);
  const reports = [];

  for (const dateEt of dates) {
    const rows = await readSnapshotRowsForDate(args.outDir, dateEt);
    const summary = summarizeSnapshotRows(rows, dateEt);
    await writeMovementSummary(args.outDir, summary, false);

    reports.push({
      dateEt,
      snapshotRows: summary.snapshotRows,
      uniqueProps: summary.uniqueProps,
      propsWithMultipleSnapshots: summary.propsWithMultipleSnapshots,
      propsWithLineMove: summary.propsWithLineMove,
      readyForMovementStudy: summary.propsWithMultipleSnapshots >= args.minSnapshots,
      summaryFile: movementSummaryPath(args.outDir, dateEt),
      byMarket: Object.fromEntries(
        PROP_LINE_SNAPSHOT_MARKETS.map((market) => {
          const marketSummary = summary.byMarket[market];
          return [
            market,
            {
              uniqueProps: marketSummary.uniqueProps,
              snapshots: marketSummary.snapshotRows,
              multi: marketSummary.propsWithMultipleSnapshots,
              moved: marketSummary.propsWithLineMove,
            },
          ];
        }),
      ),
    });
  }

  console.log(JSON.stringify({ outDir: args.outDir, dates: reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

