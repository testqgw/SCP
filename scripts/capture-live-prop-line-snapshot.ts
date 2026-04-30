import { appendFile } from "node:fs/promises";
import {
  fetchDailyAstLineMap,
  fetchDailyPaLineMap,
  fetchDailyPraLineMap,
  fetchDailyPrLineMap,
  fetchDailyPtsLineMap,
  fetchDailyRaLineMap,
  fetchDailyRebLineMap,
  fetchDailyThreesLineMap,
  type DailyPlayerPropLine,
} from "../lib/snapshot/pointsContext";
import { getTodayEtDateString } from "../lib/snapshot/time";
import type { SnapshotMarket } from "../lib/types/snapshot";
import {
  ensureSnapshotDir,
  movementSummaryPath,
  parseSnapshotKey,
  PROP_LINE_SNAPSHOT_DIR,
  PROP_LINE_SNAPSHOT_MARKETS,
  readSnapshotRowsForDate,
  snapshotJsonlPath,
  summarizeSnapshotRows,
  type IntradayPropLineSnapshot,
  writeMovementSummary,
} from "./utils/intradayPropLineSnapshots";

type Args = {
  dateEt: string;
  outDir: string;
  markets: SnapshotMarket[];
  summaryOnly: boolean;
  updateLatest: boolean;
};

const LOADERS: Record<SnapshotMarket, (dateEt: string) => Promise<Map<string, DailyPlayerPropLine>>> = {
  PTS: fetchDailyPtsLineMap,
  REB: fetchDailyRebLineMap,
  AST: fetchDailyAstLineMap,
  THREES: fetchDailyThreesLineMap,
  PRA: fetchDailyPraLineMap,
  PA: fetchDailyPaLineMap,
  PR: fetchDailyPrLineMap,
  RA: fetchDailyRaLineMap,
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let dateEt = getTodayEtDateString();
  let outDir = PROP_LINE_SNAPSHOT_DIR;
  let markets = PROP_LINE_SNAPSHOT_MARKETS;
  let summaryOnly = false;
  let updateLatest = true;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

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
    if ((token === "--markets" || token === "-m") && next) {
      markets = parseMarkets(next);
      index += 1;
      continue;
    }
    if (token.startsWith("--markets=")) {
      markets = parseMarkets(token.slice("--markets=".length));
      continue;
    }
    if (token === "--summary-only") {
      summaryOnly = true;
      continue;
    }
    if (token === "--no-latest") {
      updateLatest = false;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) {
    throw new Error(`Invalid --date value: ${dateEt}. Expected YYYY-MM-DD.`);
  }

  return { dateEt, outDir, markets, summaryOnly, updateLatest };
}

function parseMarkets(value: string): SnapshotMarket[] {
  const requested = value
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean);
  const invalid = requested.filter((market) => !PROP_LINE_SNAPSHOT_MARKETS.includes(market as SnapshotMarket));
  if (invalid.length > 0) {
    throw new Error(`Invalid market(s): ${invalid.join(", ")}. Expected one of ${PROP_LINE_SNAPSHOT_MARKETS.join(", ")}.`);
  }
  return requested as SnapshotMarket[];
}

function printUsage(): void {
  console.log(`Usage: npm run lines:snapshot:live -- [--date YYYY-MM-DD] [--markets PTS,REB] [--out-dir path]

Captures current consensus player prop lines for the eight tracked markets and appends them to JSONL.
Run it multiple times on the same slate to create real intraday line-movement features.`);
}

function captureBatchId(capturedAt: string): string {
  return capturedAt.replace(/[^0-9A-Za-z]/g, "");
}

async function captureMarketRows(
  dateEt: string,
  market: SnapshotMarket,
  capturedAt: string,
): Promise<IntradayPropLineSnapshot[]> {
  const lineMap = await LOADERS[market](dateEt);
  return Array.from(lineMap.entries()).map(([key, value]) => {
    const parsed = parseSnapshotKey(key);
    return {
      capturedAt,
      captureBatchId: captureBatchId(capturedAt),
      dateEt,
      market,
      matchupKey: parsed.matchupKey,
      playerName: parsed.playerName,
      line: value.line,
      overPrice: value.overPrice,
      underPrice: value.underPrice,
      sportsbookCount: value.sportsbookCount,
      source: value.source,
    };
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  await ensureSnapshotDir(args.outDir);

  const capturedAt = new Date().toISOString();
  const newRows = args.summaryOnly
    ? []
    : (
        await Promise.all(
          args.markets.map(async (market) => ({
            market,
            rows: await captureMarketRows(args.dateEt, market, capturedAt),
          })),
        )
      ).flatMap((entry) => entry.rows);

  if (newRows.length > 0) {
    const payload = `${newRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    await appendFile(snapshotJsonlPath(args.outDir, args.dateEt), payload, "utf8");
  }

  const allRows = await readSnapshotRowsForDate(args.outDir, args.dateEt);
  const summary = summarizeSnapshotRows(allRows, args.dateEt);
  await writeMovementSummary(args.outDir, summary, args.updateLatest);

  const marketText = PROP_LINE_SNAPSHOT_MARKETS.map((market) => {
    const marketSummary = summary.byMarket[market];
    return `${market}:${marketSummary.uniqueProps}/${marketSummary.snapshotRows}`;
  }).join(" ");

  console.log(
    JSON.stringify(
      {
        dateEt: args.dateEt,
        capturedAt,
        appendedRows: newRows.length,
        totalSnapshotRows: summary.snapshotRows,
        uniqueProps: summary.uniqueProps,
        propsWithMultipleSnapshots: summary.propsWithMultipleSnapshots,
        propsWithLineMove: summary.propsWithLineMove,
        snapshotFile: snapshotJsonlPath(args.outDir, args.dateEt),
        summaryFile: movementSummaryPath(args.outDir, args.dateEt),
        markets: marketText,
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

