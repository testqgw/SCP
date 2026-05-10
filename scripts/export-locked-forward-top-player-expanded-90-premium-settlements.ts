import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type Side = "OVER" | "UNDER";
type Result = "WIN" | "LOSS" | "PUSH" | "VOID";
type SettlementType = "SETTLED" | "CORRECTED_SETTLEMENT" | "VOIDED_SETTLEMENT";

type Args = {
  lockLedgerPath: string;
  settlementInputPath: string;
  settlementLedgerPath: string;
  outPrefix: string | null;
  dryRun: boolean;
  allowCorrection: boolean;
  modelLabel: string;
};

type LockRecord = {
  pick_id: string;
  lock_id: string;
  lock_mode?: string;
  record_hash: string;
  slate_date: string;
  player_id?: string | null;
  player: string;
  team?: string | null;
  opponent?: string | null;
  matchup_key?: string | null;
  game_time_et?: string | null;
  market: string;
  side: Side;
  line: number | null;
  odds?: number | null;
  sportsbook_source?: string | null;
  [key: string]: unknown;
};

type BoxScore = {
  points?: number | null;
  pts?: number | null;
  rebounds?: number | null;
  reb?: number | null;
  assists?: number | null;
  ast?: number | null;
  threes?: number | null;
  threePointersMade?: number | null;
  fg3m?: number | null;
  steals?: number | null;
  stl?: number | null;
  blocks?: number | null;
  blk?: number | null;
  turnovers?: number | null;
  tov?: number | null;
};

type SettlementInputRow = {
  pick_id: string;
  actual_stat?: number | null;
  actualStat?: number | null;
  result?: Result | null;
  void_reason?: string | null;
  voidReason?: string | null;
  settled_at_utc?: string | null;
  settledAtUtc?: string | null;
  settlement_source?: string | null;
  settlementSource?: string | null;
  closing_line?: number | null;
  closingLine?: number | null;
  closing_odds?: number | null;
  closingOdds?: number | null;
  book_line_at_lock?: number | null;
  bookLineAtLock?: number | null;
  book_odds_at_lock?: number | null;
  bookOddsAtLock?: number | null;
  box_score?: BoxScore | null;
  boxScore?: BoxScore | null;
};

type SettlementInputArtifact = {
  generatedAtUtc?: string | null;
  generatedAt?: string | null;
  source?: string | null;
  rows: SettlementInputRow[];
};

type SettlementRecord = {
  settlement_id: string;
  settlement_type: SettlementType;
  pick_id: string;
  lock_id: string;
  locked_row_hash: string;
  lock_mode: string | null;
  slate_date: string;
  player_id: string | null;
  player: string;
  team: string | null;
  opponent: string | null;
  matchup_key: string | null;
  game_time_et: string | null;
  market: string;
  side: Side;
  line: number | null;
  actual_stat: number | null;
  result: Result;
  void_reason: string | null;
  settled_at_utc: string;
  settlement_source: string;
  settlement_source_artifact_path: string;
  settlement_source_sha256: string;
  source_row_sha256: string;
  closing_line: number | null;
  closing_odds: number | null;
  book_line_at_lock: number | null;
  book_odds_at_lock: number | null;
  clv: number | null;
  roi_at_odds: number | null;
  corrects_settlement_hash: string | null;
};

type SettlementLedgerRecord = SettlementRecord & {
  previous_settlement_hash: string | null;
  settlement_hash: string;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let settlementInputPath = path.join(
    "exports",
    "locked-forward",
    "top-player-expanded-90-premium",
    "settlement-input.json",
  );
  let settlementLedgerPath = path.join(
    "exports",
    "locked-forward",
    "top-player-expanded-90-premium",
    "settlements.jsonl",
  );
  let outPrefix: string | null = null;
  let dryRun = false;
  let allowCorrection = false;
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
    if ((token === "--settlement-input" || token === "--source") && next) {
      settlementInputPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--settlement-input=")) {
      settlementInputPath = token.slice("--settlement-input=".length);
      continue;
    }
    if (token.startsWith("--source=")) {
      settlementInputPath = token.slice("--source=".length);
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
    if ((token === "--out-prefix" || token === "-o") && next) {
      outPrefix = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--out-prefix=")) {
      outPrefix = token.slice("--out-prefix=".length);
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--allow-correction") {
      allowCorrection = true;
      continue;
    }
    if (token === "--model-label" && next) {
      modelLabel = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--model-label=")) {
      modelLabel = token.slice("--model-label=".length);
      continue;
    }
  }

  return { lockLedgerPath, settlementInputPath, settlementLedgerPath, outPrefix, dryRun, allowCorrection, modelLabel };
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function todayEt(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function readJsonFile<T>(inputPath: string): { value: T; absolutePath: string; hash: string } {
  const absolutePath = path.resolve(inputPath);
  const text = readFileSync(absolutePath, "utf8");
  return { value: JSON.parse(stripBom(text)) as T, absolutePath, hash: sha256(text) };
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

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function num(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function round(value: number | null | undefined, decimals = 6): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function statValue(boxScore: BoxScore | null, keys: Array<keyof BoxScore>): number | null {
  if (!boxScore) return null;
  for (const key of keys) {
    const value = boxScore[key];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function sumStats(values: Array<number | null>): number | null {
  if (values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function marketStat(market: string, boxScore: BoxScore | null): number | null {
  const points = statValue(boxScore, ["points", "pts"]);
  const rebounds = statValue(boxScore, ["rebounds", "reb"]);
  const assists = statValue(boxScore, ["assists", "ast"]);
  switch (market) {
    case "PTS":
      return points;
    case "REB":
      return rebounds;
    case "AST":
      return assists;
    case "THREES":
      return statValue(boxScore, ["threes", "threePointersMade", "fg3m"]);
    case "STL":
      return statValue(boxScore, ["steals", "stl"]);
    case "BLK":
      return statValue(boxScore, ["blocks", "blk"]);
    case "TO":
      return statValue(boxScore, ["turnovers", "tov"]);
    case "PR":
      return sumStats([points, rebounds]);
    case "PA":
      return sumStats([points, assists]);
    case "RA":
      return sumStats([rebounds, assists]);
    case "PRA":
      return sumStats([points, rebounds, assists]);
    default:
      return null;
  }
}

function requiresRawBoxScore(market: string): boolean {
  return market === "PR" || market === "PA" || market === "RA" || market === "PRA";
}

function actualStatFor(lock: LockRecord, row: SettlementInputRow): number | null {
  const boxScore = row.box_score ?? row.boxScore ?? null;
  const fromBox = marketStat(lock.market, boxScore);
  if (fromBox != null) return fromBox;
  if (requiresRawBoxScore(lock.market)) {
    throw new Error(`Settlement for ${lock.pick_id} ${lock.market} must include raw box_score fields for combo stat calculation.`);
  }
  return num(row.actual_stat ?? row.actualStat);
}

function normalizeResult(value: Result | null | undefined): Result | null {
  if (value === "WIN" || value === "LOSS" || value === "PUSH" || value === "VOID") return value;
  return null;
}

function deterministicResult(side: Side, line: number | null, actualStat: number | null): Result {
  if (line == null || actualStat == null) {
    throw new Error("Cannot compute WIN/LOSS/PUSH without both line and actual_stat.");
  }
  if (actualStat === line) return "PUSH";
  if (side === "OVER") return actualStat > line ? "WIN" : "LOSS";
  return actualStat < line ? "WIN" : "LOSS";
}

function americanOddsRoi(result: Result, odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds)) return null;
  if (result === "LOSS") return -1;
  if (result === "PUSH" || result === "VOID") return 0;
  return odds > 0 ? round(odds / 100, 6) : round(100 / Math.abs(odds), 6);
}

function sideAwareClv(side: Side, lockedLine: number | null, closingLine: number | null): number | null {
  if (lockedLine == null || closingLine == null) return null;
  return side === "OVER" ? round(closingLine - lockedLine, 3) : round(lockedLine - closingLine, 3);
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSettlementRecord(input: {
  lock: LockRecord;
  row: SettlementInputRow;
  settlementInputPath: string;
  settlementInputHash: string;
  defaultSource: string;
  generatedAt: string;
  priorSettlement: SettlementLedgerRecord | null;
}): SettlementRecord {
  if (!input.lock.game_time_et) {
    throw new Error(`Settlement for ${input.lock.pick_id} cannot prove postgame timing because the lock row has no game_time_et.`);
  }
  const settledAtUtc = input.row.settled_at_utc ?? input.row.settledAtUtc ?? input.generatedAt;
  const settledMs = parseDateTime(settledAtUtc);
  const gameMs = parseDateTime(input.lock.game_time_et);
  if (settledMs == null) throw new Error(`Settlement for ${input.lock.pick_id} has invalid settled_at_utc.`);
  if (gameMs != null && settledMs <= gameMs) {
    throw new Error(`Settlement for ${input.lock.pick_id} settled_at_utc must be after game_time_et.`);
  }

  const requestedResult = normalizeResult(input.row.result);
  const voidReason = input.row.void_reason ?? input.row.voidReason ?? null;
  const actualStat = requestedResult === "VOID" ? null : actualStatFor(input.lock, input.row);
  const result = requestedResult === "VOID" ? "VOID" : deterministicResult(input.lock.side, input.lock.line, actualStat);
  if (requestedResult && requestedResult !== result) {
    throw new Error(`Settlement for ${input.lock.pick_id} provided result ${requestedResult} but deterministic result is ${result}.`);
  }
  if (result === "VOID" && !voidReason) {
    throw new Error(`Settlement for ${input.lock.pick_id} is VOID but has no void_reason.`);
  }

  const bookLineAtLock = num(input.row.book_line_at_lock ?? input.row.bookLineAtLock ?? input.lock.line);
  const bookOddsAtLock = num(input.row.book_odds_at_lock ?? input.row.bookOddsAtLock ?? input.lock.odds ?? null);
  const closingLine = num(input.row.closing_line ?? input.row.closingLine);
  const closingOdds = num(input.row.closing_odds ?? input.row.closingOdds);
  const sourceRowHash = sha256(canonicalJson(input.row));
  const settlementSource = input.row.settlement_source ?? input.row.settlementSource ?? input.defaultSource;
  const settlementType: SettlementType = input.priorSettlement
    ? "CORRECTED_SETTLEMENT"
    : result === "VOID"
      ? "VOIDED_SETTLEMENT"
      : "SETTLED";
  const correctsSettlementHash = input.priorSettlement?.settlement_hash ?? null;
  const settlementId = sha256(
    canonicalJson({
      pick_id: input.lock.pick_id,
      lock_id: input.lock.lock_id,
      locked_row_hash: input.lock.record_hash,
      source_row_hash: sourceRowHash,
      actual_stat: actualStat,
      result,
      settled_at_utc: settledAtUtc,
      corrects_settlement_hash: correctsSettlementHash,
    }),
  ).slice(0, 20);

  return {
    settlement_id: settlementId,
    settlement_type: settlementType,
    pick_id: input.lock.pick_id,
    lock_id: input.lock.lock_id,
    locked_row_hash: input.lock.record_hash,
    lock_mode: input.lock.lock_mode ?? null,
    slate_date: input.lock.slate_date,
    player_id: input.lock.player_id ?? null,
    player: input.lock.player,
    team: input.lock.team ?? null,
    opponent: input.lock.opponent ?? null,
    matchup_key: input.lock.matchup_key ?? null,
    game_time_et: input.lock.game_time_et ?? null,
    market: input.lock.market,
    side: input.lock.side,
    line: input.lock.line,
    actual_stat: actualStat,
    result,
    void_reason: voidReason,
    settled_at_utc: settledAtUtc,
    settlement_source: settlementSource,
    settlement_source_artifact_path: input.settlementInputPath,
    settlement_source_sha256: input.settlementInputHash,
    source_row_sha256: sourceRowHash,
    closing_line: closingLine,
    closing_odds: closingOdds,
    book_line_at_lock: bookLineAtLock,
    book_odds_at_lock: bookOddsAtLock,
    clv: sideAwareClv(input.lock.side, bookLineAtLock, closingLine),
    roi_at_odds: americanOddsRoi(result, bookOddsAtLock),
    corrects_settlement_hash: correctsSettlementHash,
  };
}

function withSettlementHash(
  record: SettlementRecord,
  previousSettlementHash: string | null,
): SettlementLedgerRecord {
  const payload = { ...record, previous_settlement_hash: previousSettlementHash };
  return { ...payload, settlement_hash: sha256(canonicalJson(payload)) };
}

async function appendSettlementLedger(input: {
  settlementLedgerPath: string;
  records: SettlementRecord[];
}): Promise<{ appended: number; skippedDuplicateSettlementIds: number }> {
  const existing = await readJsonl<SettlementLedgerRecord>(input.settlementLedgerPath);
  const existingIds = new Set(existing.map((record) => record.settlement_id));
  let previousHash = existing.at(-1)?.settlement_hash ?? null;
  let skippedDuplicateSettlementIds = 0;
  const newRows: SettlementLedgerRecord[] = [];

  for (const record of input.records) {
    if (existingIds.has(record.settlement_id)) {
      skippedDuplicateSettlementIds += 1;
      continue;
    }
    const ledgerRecord = withSettlementHash(record, previousHash);
    previousHash = ledgerRecord.settlement_hash;
    newRows.push(ledgerRecord);
  }

  if (newRows.length > 0) {
    await mkdir(path.dirname(input.settlementLedgerPath), { recursive: true });
    const prefix = existing.length > 0 ? "\n" : "";
    await writeFile(input.settlementLedgerPath, `${prefix}${newRows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
      encoding: "utf8",
      flag: existing.length > 0 ? "a" : "w",
    });
  }

  return { appended: newRows.length, skippedDuplicateSettlementIds };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(records: SettlementRecord[]): string {
  const columns: Array<keyof SettlementRecord> = [
    "settlement_id",
    "settlement_type",
    "pick_id",
    "lock_id",
    "locked_row_hash",
    "slate_date",
    "player",
    "market",
    "side",
    "line",
    "actual_stat",
    "result",
    "void_reason",
    "settled_at_utc",
    "settlement_source",
    "settlement_source_sha256",
    "closing_line",
    "closing_odds",
    "book_line_at_lock",
    "book_odds_at_lock",
    "clv",
    "roi_at_odds",
    "corrects_settlement_hash",
  ];
  return `${[columns.join(","), ...records.map((record) => columns.map((column) => csvCell(record[column])).join(","))].join("\n")}\n`;
}

function toMarkdown(input: {
  records: SettlementRecord[];
  generatedAt: string;
  dryRun: boolean;
  lockLedgerPath: string;
  settlementLedgerPath: string;
  settlementInputPath: string;
  settlementInputHash: string;
  appended: number;
  skippedDuplicateSettlementIds: number;
  modelLabel: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.modelLabel} Settlements`);
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Mode: ${input.dryRun ? "DRY_RUN" : "APPEND"}`);
  lines.push(`Lock ledger: ${input.lockLedgerPath}`);
  lines.push(`Settlement ledger: ${input.settlementLedgerPath}`);
  lines.push(`Settlement input: ${input.settlementInputPath}`);
  lines.push(`Settlement input SHA-256: \`${input.settlementInputHash}\``);
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push("- Settlement rows resolve immutable lock rows by `pick_id`, `lock_id`, and `locked_row_hash`.");
  lines.push("- This artifact does not rewrite the pregame lock ledger.");
  lines.push("- Combo markets are settled from raw box-score fields when they are exported.");
  lines.push("- Performance reports should join the lock ledger and settlement ledger instead of trusting either in isolation.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Settlement rows built: ${input.records.length}`);
  lines.push(`- Newly appended settlement rows: ${input.appended}`);
  lines.push(`- Duplicate settlement IDs skipped: ${input.skippedDuplicateSettlementIds}`);
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  if (input.records.length === 0) {
    lines.push("No settlement rows were built.");
  } else {
    lines.push("| # | Player | Market | Side | Line | Actual | Result | CLV | ROI | Type |");
    lines.push("|---:|---|---|---|---:|---:|---|---:|---:|---|");
    input.records.forEach((record, index) => {
      lines.push(
        `| ${index + 1} | ${record.player} | ${record.market} | ${record.side} | ${record.line ?? "-"} | ${record.actual_stat ?? "-"} | ${record.result} | ${record.clv ?? "-"} | ${record.roi_at_odds ?? "-"} | ${record.settlement_type} |`,
      );
    });
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lockLedgerPath = path.resolve(args.lockLedgerPath);
  const settlementInputFile = readJsonFile<SettlementInputArtifact>(args.settlementInputPath);
  const settlementInputPath = settlementInputFile.absolutePath;
  const settlementLedgerPath = path.resolve(args.settlementLedgerPath);
  const generatedAt = new Date().toISOString();
  const defaultSource = settlementInputFile.value.source ?? "settlement-input";
  const locks = await readJsonl<LockRecord>(lockLedgerPath);
  const settlements = await readJsonl<SettlementLedgerRecord>(settlementLedgerPath);
  const locksByPickId = new Map(locks.map((lock) => [lock.pick_id, lock]));
  const latestSettlementByPickId = new Map<string, SettlementLedgerRecord>();
  for (const settlement of settlements) {
    latestSettlementByPickId.set(settlement.pick_id, settlement);
  }

  const records: SettlementRecord[] = [];
  for (const row of settlementInputFile.value.rows) {
    const lock = locksByPickId.get(row.pick_id);
    if (!lock) {
      throw new Error(`Refusing settlement for unknown pick_id ${row.pick_id}.`);
    }
    const priorSettlement = latestSettlementByPickId.get(row.pick_id) ?? null;
    if (priorSettlement && !args.allowCorrection) {
      throw new Error(
        `Refusing to settle ${row.pick_id} because it already has a settlement. Re-run with --allow-correction to append a correction row.`,
      );
    }
    const record = buildSettlementRecord({
      lock,
      row,
      settlementInputPath,
      settlementInputHash: settlementInputFile.hash,
      defaultSource,
      generatedAt,
      priorSettlement,
    });
    records.push(record);
    latestSettlementByPickId.set(row.pick_id, withSettlementHash(record, priorSettlement?.settlement_hash ?? null));
  }

  const outPrefix = path.resolve(
    args.outPrefix ?? path.join(path.dirname(settlementLedgerPath), "settlements", `${todayEt()}-settlement`),
  );
  let appended = 0;
  let skippedDuplicateSettlementIds = 0;

  if (!args.dryRun) {
    const result = await appendSettlementLedger({ settlementLedgerPath, records });
    appended = result.appended;
    skippedDuplicateSettlementIds = result.skippedDuplicateSettlementIds;
    await mkdir(path.dirname(outPrefix), { recursive: true });
    await Promise.all([
      writeFile(
        `${outPrefix}.json`,
        `${JSON.stringify(
          {
            generatedAt,
            dryRun: args.dryRun,
            lockLedgerPath,
            settlementLedgerPath,
            settlementInputPath,
            settlementInputSha256: settlementInputFile.hash,
            appended,
            skippedDuplicateSettlementIds,
            records,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        `${outPrefix}.md`,
        toMarkdown({
          records,
          generatedAt,
          dryRun: args.dryRun,
          lockLedgerPath,
          settlementLedgerPath,
          settlementInputPath,
          settlementInputHash: settlementInputFile.hash,
          appended,
          skippedDuplicateSettlementIds,
          modelLabel: args.modelLabel,
        }),
        "utf8",
      ),
      writeFile(`${outPrefix}.csv`, toCsv(records), "utf8"),
    ]);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        dryRun: args.dryRun,
        lockLedgerPath,
        settlementLedgerPath,
        settlementInputPath,
        settlementInputSha256: settlementInputFile.hash,
        inputRows: settlementInputFile.value.rows.length,
        settlementsBuilt: records.length,
        appended,
        skippedDuplicateSettlementIds,
        outputs: args.dryRun
          ? null
          : {
              json: `${outPrefix}.json`,
              md: `${outPrefix}.md`,
              csv: `${outPrefix}.csv`,
            },
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
