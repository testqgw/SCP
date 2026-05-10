import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Side = "OVER" | "UNDER";
type Result = "WIN" | "LOSS" | "PUSH" | "VOID";

type Args = {
  lockLedgerPath: string;
  settlementLedgerPath: string;
  marketLineLedgerPath: string;
  outPrefix: string;
  modelLabel: string;
};

type LockRecord = {
  pick_id: string;
  lock_id: string;
  record_hash: string;
  lock_mode?: string;
  generated_at?: string;
  slate_date: string;
  player: string;
  market: string;
  side: Side;
  line: number | null;
  [key: string]: unknown;
};

type SettlementRecord = {
  pick_id: string;
  settlement_hash?: string;
  settlement_type?: string;
  result?: Result | string;
  actual_stat?: number | null;
  settled_at_utc?: string;
  [key: string]: unknown;
};

type MarketLineRecord = {
  pick_id: string;
  line_hash?: string;
  line_record_type?: string;
  line_role?: "LOCK" | "CLOSE" | string;
  book?: string;
  book_line?: number;
  book_odds?: number;
  line_timestamp_utc?: string;
  stake_units?: number | null;
  [key: string]: unknown;
};

type PerformanceRow = {
  pick_id: string;
  lock_id: string;
  locked_row_hash: string;
  slate_date: string;
  player: string;
  market: string;
  side: Side;
  model_line: number | null;
  result: Result | null;
  actual_stat: number | null;
  book: string | null;
  lock_book_line: number | null;
  lock_book_odds: number | null;
  lock_line_timestamp_utc: string | null;
  close_book_line: number | null;
  close_book_odds: number | null;
  close_line_timestamp_utc: string | null;
  clv: number | null;
  stake_units: number | null;
  profit_loss_units: number | null;
  roi_at_odds: number | null;
  settlement_hash: string | null;
  lock_line_hash: string | null;
  close_line_hash: string | null;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let settlementLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "settlements.jsonl");
  let marketLineLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "market-lines.jsonl");
  let outPrefix = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "performance-report");
  let modelLabel = "Top Player Expanded 90 Premium";

  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--lock-ledger" && next) {
      lockLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--lock-ledger=")) {
      lockLedgerPath = token.slice("--lock-ledger=".length);
      continue;
    }
    if (token === "--settlement-ledger" && next) {
      settlementLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--settlement-ledger=")) {
      settlementLedgerPath = token.slice("--settlement-ledger=".length);
      continue;
    }
    if (token === "--market-line-ledger" && next) {
      marketLineLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--market-line-ledger=")) {
      marketLineLedgerPath = token.slice("--market-line-ledger=".length);
      continue;
    }
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = token.slice("--out-prefix=".length);
      continue;
    }
    if (token === "--model-label" && next) {
      modelLabel = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model-label=")) {
      modelLabel = token.slice("--model-label=".length);
    }
  }

  return {
    lockLedgerPath: path.resolve(lockLedgerPath),
    settlementLedgerPath: path.resolve(settlementLedgerPath),
    marketLineLedgerPath: path.resolve(marketLineLedgerPath),
    outPrefix: path.resolve(outPrefix),
    modelLabel,
  };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readJsonl<T>(inputPath: string): Promise<T[]> {
  if (!existsSync(inputPath)) return [];
  const text = stripBom(await readFile(inputPath, "utf8"));
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSON on ${inputPath} line ${index + 1}: ${(error as Error).message}`);
      }
    });
}

function round(value: number | null | undefined, decimals = 6): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sideAwareClv(side: Side, lockLine: number | null, closeLine: number | null): number | null {
  if (lockLine == null || closeLine == null) return null;
  return side === "OVER" ? round(closeLine - lockLine, 3) : round(lockLine - closeLine, 3);
}

function profitAtOdds(result: Result | null, odds: number | null, stakeUnits: number | null): number | null {
  if (!result || odds == null || stakeUnits == null) return null;
  if (result === "LOSS") return round(-stakeUnits, 6);
  if (result === "PUSH" || result === "VOID") return 0;
  const profit = odds > 0 ? stakeUnits * (odds / 100) : stakeUnits * (100 / Math.abs(odds));
  return round(profit, 6);
}

function result(value: unknown): Result | null {
  return value === "WIN" || value === "LOSS" || value === "PUSH" || value === "VOID" ? value : null;
}

function latestSettlementByPick(settlements: SettlementRecord[]): Map<string, SettlementRecord> {
  const byPick = new Map<string, SettlementRecord>();
  for (const settlement of settlements) {
    byPick.set(settlement.pick_id, settlement);
  }
  return byPick;
}

function lineSlotKey(line: MarketLineRecord): string | null {
  if (!line.pick_id || !line.book) return null;
  return `${line.pick_id}|${line.book.toLowerCase()}`;
}

function marketLinesByPickBook(lines: MarketLineRecord[]): Map<string, { lock: MarketLineRecord | null; close: MarketLineRecord | null }> {
  const bySlot = new Map<string, { lock: MarketLineRecord | null; close: MarketLineRecord | null }>();
  for (const line of lines) {
    const key = lineSlotKey(line);
    if (!key) continue;
    const slot = bySlot.get(key) ?? { lock: null, close: null };
    if (line.line_role === "LOCK") slot.lock = line;
    if (line.line_role === "CLOSE") slot.close = line;
    bySlot.set(key, slot);
  }
  return bySlot;
}

function buildRows(input: {
  locks: LockRecord[];
  settlements: SettlementRecord[];
  marketLines: MarketLineRecord[];
}): PerformanceRow[] {
  const settlementsByPick = latestSettlementByPick(input.settlements);
  const lineSlots = marketLinesByPickBook(input.marketLines);
  const rows: PerformanceRow[] = [];

  for (const lock of input.locks) {
    const settlement = settlementsByPick.get(lock.pick_id) ?? null;
    const matchedSlots = [...lineSlots.entries()].filter(([key]) => key.startsWith(`${lock.pick_id}|`));
    const slots = matchedSlots.length > 0 ? matchedSlots.map(([, slot]) => slot) : [{ lock: null, close: null }];
    for (const slot of slots) {
      const lockLine = slot.lock ?? null;
      const closeLine = slot.close ?? null;
      const stakeUnits = lockLine?.stake_units ?? (lockLine ? 1 : null);
      const settledResult = result(settlement?.result);
      const profitLossUnits = profitAtOdds(settledResult, lockLine?.book_odds ?? null, stakeUnits);
      rows.push({
        pick_id: lock.pick_id,
        lock_id: lock.lock_id,
        locked_row_hash: lock.record_hash,
        slate_date: lock.slate_date,
        player: lock.player,
        market: lock.market,
        side: lock.side,
        model_line: lock.line,
        result: settledResult,
        actual_stat: typeof settlement?.actual_stat === "number" ? settlement.actual_stat : null,
        book: lockLine?.book ?? closeLine?.book ?? null,
        lock_book_line: lockLine?.book_line ?? null,
        lock_book_odds: lockLine?.book_odds ?? null,
        lock_line_timestamp_utc: lockLine?.line_timestamp_utc ?? null,
        close_book_line: closeLine?.book_line ?? null,
        close_book_odds: closeLine?.book_odds ?? null,
        close_line_timestamp_utc: closeLine?.line_timestamp_utc ?? null,
        clv: sideAwareClv(lock.side, lockLine?.book_line ?? null, closeLine?.book_line ?? null),
        stake_units: stakeUnits,
        profit_loss_units: profitLossUnits,
        roi_at_odds: profitLossUnits == null || stakeUnits == null || stakeUnits === 0 ? null : round(profitLossUnits / stakeUnits, 6),
        settlement_hash: settlement?.settlement_hash ?? null,
        lock_line_hash: lockLine?.line_hash ?? null,
        close_line_hash: closeLine?.line_hash ?? null,
      });
    }
  }

  return rows;
}

function summary(rows: PerformanceRow[], locks: LockRecord[], settlements: SettlementRecord[], marketLines: MarketLineRecord[]) {
  const settledPickIds = new Set(settlements.map((settlement) => settlement.pick_id));
  const pricedRows = rows.filter((row) => row.lock_book_line != null && row.lock_book_odds != null);
  const clvRows = rows.filter((row) => row.clv != null);
  const settledRows = rows.filter((row) => row.result != null);
  const decisionRows = settledRows.filter((row) => row.result === "WIN" || row.result === "LOSS");
  const unitRows = rows.filter((row) => row.profit_loss_units != null);
  const totalStake = unitRows.reduce((sum, row) => sum + (row.stake_units ?? 0), 0);
  const totalProfit = unitRows.reduce((sum, row) => sum + (row.profit_loss_units ?? 0), 0);

  return {
    lockRows: locks.length,
    settlementRows: settlements.length,
    marketLineRows: marketLines.length,
    settledPickCount: settledPickIds.size,
    performanceRows: rows.length,
    pricedBookSlots: pricedRows.length,
    clvRows: clvRows.length,
    positiveClvRows: clvRows.filter((row) => (row.clv ?? 0) > 0).length,
    negativeClvRows: clvRows.filter((row) => (row.clv ?? 0) < 0).length,
    avgClv: clvRows.length ? round(clvRows.reduce((sum, row) => sum + (row.clv ?? 0), 0) / clvRows.length, 4) : null,
    decisions: decisionRows.length,
    wins: decisionRows.filter((row) => row.result === "WIN").length,
    losses: decisionRows.filter((row) => row.result === "LOSS").length,
    accuracyPct: decisionRows.length
      ? round((decisionRows.filter((row) => row.result === "WIN").length / decisionRows.length) * 100, 2)
      : null,
    totalStakeUnits: round(totalStake, 4),
    profitLossUnits: round(totalProfit, 4),
    roiPct: totalStake > 0 ? round((totalProfit / totalStake) * 100, 2) : null,
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: PerformanceRow[]): string {
  const columns: Array<keyof PerformanceRow> = [
    "pick_id",
    "slate_date",
    "player",
    "market",
    "side",
    "model_line",
    "result",
    "actual_stat",
    "book",
    "lock_book_line",
    "lock_book_odds",
    "close_book_line",
    "close_book_odds",
    "clv",
    "stake_units",
    "profit_loss_units",
    "roi_at_odds",
    "settlement_hash",
    "lock_line_hash",
    "close_line_hash",
  ];
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
}

function toMarkdown(input: {
  generatedAt: string;
  summary: Record<string, unknown>;
  rows: PerformanceRow[];
  modelLabel: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.modelLabel} Performance Report`);
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push("- This is a joined report, not a source ledger.");
  lines.push("- Trust it only after lock, market-line, and settlement verifiers pass.");
  lines.push("- ROI/CLV are computed only for rows with captured book lines and odds.");
  lines.push("- Multiple books create multiple priced book-slot rows for the same pick.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [key, value] of Object.entries(input.summary)) {
    lines.push(`- ${key}: ${value ?? "-"}`);
  }
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  if (input.rows.length === 0) {
    lines.push("No locked picks are available yet.");
  } else {
    lines.push("| # | Player | Market | Side | Result | Book | Lock Line | Close Line | CLV | Units | ROI |");
    lines.push("|---:|---|---|---|---|---|---:|---:|---:|---:|---:|");
    input.rows.forEach((row, index) => {
      lines.push(
        `| ${index + 1} | ${row.player} | ${row.market} | ${row.side} | ${row.result ?? "-"} | ${row.book ?? "-"} | ${row.lock_book_line ?? "-"} | ${row.close_book_line ?? "-"} | ${row.clv ?? "-"} | ${row.profit_loss_units ?? "-"} | ${row.roi_at_odds ?? "-"} |`,
      );
    });
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const generatedAt = new Date().toISOString();
  const locks = await readJsonl<LockRecord>(args.lockLedgerPath);
  const settlements = await readJsonl<SettlementRecord>(args.settlementLedgerPath);
  const marketLines = await readJsonl<MarketLineRecord>(args.marketLineLedgerPath);
  const rows = buildRows({ locks, settlements, marketLines });
  const reportSummary = summary(rows, locks, settlements, marketLines);
  const report = {
    generatedAt,
    claimBoundary:
      "Joined report only. Source truth remains the lock ledger, market-line ledger, and settlement ledger after their verifiers pass.",
    inputs: {
      lockLedgerPath: args.lockLedgerPath,
      settlementLedgerPath: args.settlementLedgerPath,
      marketLineLedgerPath: args.marketLineLedgerPath,
    },
    summary: reportSummary,
    rows,
  };

  await mkdir(path.dirname(args.outPrefix), { recursive: true });
  await Promise.all([
    writeFile(`${args.outPrefix}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(`${args.outPrefix}.md`, toMarkdown({ generatedAt, summary: reportSummary, rows, modelLabel: args.modelLabel }), "utf8"),
    writeFile(`${args.outPrefix}.csv`, toCsv(rows), "utf8"),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt,
        outputs: {
          json: `${args.outPrefix}.json`,
          md: `${args.outPrefix}.md`,
          csv: `${args.outPrefix}.csv`,
        },
        summary: reportSummary,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
