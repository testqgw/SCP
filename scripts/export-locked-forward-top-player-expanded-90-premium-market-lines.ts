import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type Side = "OVER" | "UNDER";
type LineRole = "LOCK" | "CLOSE";
type LineRecordType = "LINE_SNAPSHOT" | "CORRECTED_LINE_SNAPSHOT";

type Args = {
  lockLedgerPath: string;
  lineInputPath: string;
  marketLineLedgerPath: string;
  outPrefix: string | null;
  dryRun: boolean;
  allowCorrection: boolean;
  modelLabel: string;
};

type LockRecord = {
  pick_id: string;
  lock_id: string;
  record_hash: string;
  generated_at?: string;
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
  [key: string]: unknown;
};

type MarketLineInputRow = {
  pick_id: string;
  line_role?: LineRole | string;
  role?: LineRole | string;
  book?: string | null;
  sportsbook?: string | null;
  book_line?: number | null;
  line?: number | null;
  book_odds?: number | null;
  odds?: number | null;
  line_timestamp_utc?: string | null;
  timestamp_utc?: string | null;
  timestamp?: string | null;
  captured_at_utc?: string | null;
  source?: string | null;
  source_url?: string | null;
  stake_units?: number | null;
};

type MarketLineInputArtifact = {
  generatedAtUtc?: string | null;
  generatedAt?: string | null;
  source?: string | null;
  rows: MarketLineInputRow[];
};

type MarketLineRecord = {
  line_snapshot_id: string;
  line_record_type: LineRecordType;
  line_role: LineRole;
  pick_id: string;
  lock_id: string;
  locked_row_hash: string;
  slate_date: string;
  player_id: string | null;
  player: string;
  team: string | null;
  opponent: string | null;
  matchup_key: string | null;
  game_time_et: string | null;
  market: string;
  side: Side;
  model_line: number | null;
  book: string;
  book_line: number;
  book_odds: number;
  line_timestamp_utc: string;
  captured_at_utc: string;
  source: string;
  source_url: string | null;
  source_artifact_path: string;
  source_artifact_sha256: string;
  source_row_sha256: string;
  stake_units: number | null;
  corrects_line_hash: string | null;
};

type MarketLineLedgerRecord = MarketLineRecord & {
  previous_line_hash: string | null;
  line_hash: string;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let lineInputPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "market-lines-input.json");
  let marketLineLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "market-lines.jsonl");
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
    if ((token === "--line-input" || token === "--source") && next) {
      lineInputPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--line-input=")) {
      lineInputPath = token.slice("--line-input=".length);
      continue;
    }
    if (token.startsWith("--source=")) {
      lineInputPath = token.slice("--source=".length);
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
    }
  }

  return { lockLedgerPath, lineInputPath, marketLineLedgerPath, outPrefix, dryRun, allowCorrection, modelLabel };
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

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

function num(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLineRole(value: unknown): LineRole {
  if (value === "LOCK" || value === "CLOSE") return value;
  throw new Error(`Unknown line_role ${String(value)}. Expected LOCK or CLOSE.`);
}

function normalizedBook(row: MarketLineInputRow): string {
  const book = row.book ?? row.sportsbook ?? null;
  if (!book || !book.trim()) throw new Error(`Market line row for ${row.pick_id} is missing book/sportsbook.`);
  return book.trim();
}

function buildMarketLineRecord(input: {
  lock: LockRecord;
  row: MarketLineInputRow;
  sourceArtifactPath: string;
  sourceArtifactHash: string;
  defaultSource: string;
  generatedAt: string;
  priorLine: MarketLineLedgerRecord | null;
}): MarketLineRecord {
  if (!input.lock.game_time_et) {
    throw new Error(`Market line for ${input.lock.pick_id} cannot prove pregame timing because lock row has no game_time_et.`);
  }
  const lineRole = normalizeLineRole(input.row.line_role ?? input.row.role);
  const book = normalizedBook(input.row);
  const bookLine = num(input.row.book_line ?? input.row.line);
  const bookOdds = num(input.row.book_odds ?? input.row.odds);
  const lineTimestampUtc = input.row.line_timestamp_utc ?? input.row.timestamp_utc ?? input.row.timestamp ?? null;
  const capturedAtUtc = input.row.captured_at_utc ?? input.generatedAt;
  const lineMs = parseDateTime(lineTimestampUtc);
  const capturedMs = parseDateTime(capturedAtUtc);
  const gameMs = parseDateTime(input.lock.game_time_et);
  if (bookLine == null) throw new Error(`Market line row for ${input.lock.pick_id} is missing book_line.`);
  if (bookOdds == null) throw new Error(`Market line row for ${input.lock.pick_id} is missing book_odds.`);
  if (!lineTimestampUtc || lineMs == null) throw new Error(`Market line row for ${input.lock.pick_id} has invalid line_timestamp_utc.`);
  if (capturedMs == null) throw new Error(`Market line row for ${input.lock.pick_id} has invalid captured_at_utc.`);
  if (gameMs != null && lineMs >= gameMs) {
    throw new Error(`Market line row for ${input.lock.pick_id} has line_timestamp_utc at or after game_time_et.`);
  }
  if (gameMs != null && capturedMs >= gameMs) {
    throw new Error(`Market line row for ${input.lock.pick_id} has captured_at_utc at or after game_time_et.`);
  }

  const sourceRowHash = sha256(canonicalJson(input.row));
  const lineRecordType: LineRecordType = input.priorLine ? "CORRECTED_LINE_SNAPSHOT" : "LINE_SNAPSHOT";
  const correctsLineHash = input.priorLine?.line_hash ?? null;
  const lineSnapshotId = sha256(
    canonicalJson({
      pick_id: input.lock.pick_id,
      lock_id: input.lock.lock_id,
      locked_row_hash: input.lock.record_hash,
      line_role: lineRole,
      book,
      book_line: bookLine,
      book_odds: bookOdds,
      line_timestamp_utc: lineTimestampUtc,
      source_row_sha256: sourceRowHash,
      corrects_line_hash: correctsLineHash,
    }),
  ).slice(0, 20);

  return {
    line_snapshot_id: lineSnapshotId,
    line_record_type: lineRecordType,
    line_role: lineRole,
    pick_id: input.lock.pick_id,
    lock_id: input.lock.lock_id,
    locked_row_hash: input.lock.record_hash,
    slate_date: input.lock.slate_date,
    player_id: input.lock.player_id ?? null,
    player: input.lock.player,
    team: input.lock.team ?? null,
    opponent: input.lock.opponent ?? null,
    matchup_key: input.lock.matchup_key ?? null,
    game_time_et: input.lock.game_time_et ?? null,
    market: input.lock.market,
    side: input.lock.side,
    model_line: input.lock.line,
    book,
    book_line: bookLine,
    book_odds: bookOdds,
    line_timestamp_utc: lineTimestampUtc,
    captured_at_utc: capturedAtUtc,
    source: input.row.source ?? input.defaultSource,
    source_url: input.row.source_url ?? null,
    source_artifact_path: input.sourceArtifactPath,
    source_artifact_sha256: input.sourceArtifactHash,
    source_row_sha256: sourceRowHash,
    stake_units: num(input.row.stake_units),
    corrects_line_hash: correctsLineHash,
  };
}

function lineKey(record: Pick<MarketLineRecord, "pick_id" | "book" | "line_role">): string {
  return `${record.pick_id}|${record.book.toLowerCase()}|${record.line_role}`;
}

function withLineHash(record: MarketLineRecord, previousLineHash: string | null): MarketLineLedgerRecord {
  const payload = { ...record, previous_line_hash: previousLineHash };
  return { ...payload, line_hash: sha256(canonicalJson(payload)) };
}

async function appendMarketLineLedger(input: {
  marketLineLedgerPath: string;
  records: MarketLineRecord[];
}): Promise<{ appended: number; skippedDuplicateLineSnapshotIds: number }> {
  const existing = await readJsonl<MarketLineLedgerRecord>(input.marketLineLedgerPath);
  const existingIds = new Set(existing.map((record) => record.line_snapshot_id));
  let previousHash = existing.at(-1)?.line_hash ?? null;
  let skippedDuplicateLineSnapshotIds = 0;
  const newRows: MarketLineLedgerRecord[] = [];

  for (const record of input.records) {
    if (existingIds.has(record.line_snapshot_id)) {
      skippedDuplicateLineSnapshotIds += 1;
      continue;
    }
    const ledgerRecord = withLineHash(record, previousHash);
    previousHash = ledgerRecord.line_hash;
    newRows.push(ledgerRecord);
  }

  if (newRows.length > 0) {
    await mkdir(path.dirname(input.marketLineLedgerPath), { recursive: true });
    const prefix = existing.length > 0 ? "\n" : "";
    await writeFile(input.marketLineLedgerPath, `${prefix}${newRows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
      encoding: "utf8",
      flag: existing.length > 0 ? "a" : "w",
    });
  }

  return { appended: newRows.length, skippedDuplicateLineSnapshotIds };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(records: MarketLineRecord[]): string {
  const columns: Array<keyof MarketLineRecord> = [
    "line_snapshot_id",
    "line_record_type",
    "line_role",
    "pick_id",
    "lock_id",
    "locked_row_hash",
    "slate_date",
    "player",
    "market",
    "side",
    "model_line",
    "book",
    "book_line",
    "book_odds",
    "line_timestamp_utc",
    "captured_at_utc",
    "source",
    "source_artifact_sha256",
    "stake_units",
    "corrects_line_hash",
  ];
  return `${[columns.join(","), ...records.map((record) => columns.map((column) => csvCell(record[column])).join(","))].join("\n")}\n`;
}

function toMarkdown(input: {
  records: MarketLineRecord[];
  generatedAt: string;
  dryRun: boolean;
  lockLedgerPath: string;
  marketLineLedgerPath: string;
  lineInputPath: string;
  lineInputHash: string;
  appended: number;
  skippedDuplicateLineSnapshotIds: number;
  modelLabel: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.modelLabel} Market Lines`);
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Mode: ${input.dryRun ? "DRY_RUN" : "APPEND"}`);
  lines.push(`Lock ledger: ${input.lockLedgerPath}`);
  lines.push(`Market-line ledger: ${input.marketLineLedgerPath}`);
  lines.push(`Line input: ${input.lineInputPath}`);
  lines.push(`Line input SHA-256: \`${input.lineInputHash}\``);
  lines.push("");
  lines.push("## Claim Boundary");
  lines.push("");
  lines.push("- Market-line rows prove observed book price/line snapshots; they do not settle picks.");
  lines.push("- Rows resolve immutable lock rows by `pick_id`, `lock_id`, and `locked_row_hash`.");
  lines.push("- `LOCK` and `CLOSE` snapshots must both be captured before the listed game time.");
  lines.push("- CLV and ROI should be computed by joining lock rows, market-line rows, and settlement rows.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Market-line rows built: ${input.records.length}`);
  lines.push(`- Newly appended market-line rows: ${input.appended}`);
  lines.push(`- Duplicate line snapshot IDs skipped: ${input.skippedDuplicateLineSnapshotIds}`);
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  if (input.records.length === 0) {
    lines.push("No market-line rows were built.");
  } else {
    lines.push("| # | Player | Market | Side | Role | Book | Book Line | Odds | Timestamp | Type |");
    lines.push("|---:|---|---|---|---|---|---:|---:|---|---|");
    input.records.forEach((record, index) => {
      lines.push(
        `| ${index + 1} | ${record.player} | ${record.market} | ${record.side} | ${record.line_role} | ${record.book} | ${record.book_line} | ${record.book_odds} | ${record.line_timestamp_utc} | ${record.line_record_type} |`,
      );
    });
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lockLedgerPath = path.resolve(args.lockLedgerPath);
  const lineInputFile = readJsonFile<MarketLineInputArtifact>(args.lineInputPath);
  const lineInputPath = lineInputFile.absolutePath;
  const marketLineLedgerPath = path.resolve(args.marketLineLedgerPath);
  const generatedAt = new Date().toISOString();
  const defaultSource = lineInputFile.value.source ?? "market-line-input";
  const locks = await readJsonl<LockRecord>(lockLedgerPath);
  const marketLines = await readJsonl<MarketLineLedgerRecord>(marketLineLedgerPath);
  const locksByPickId = new Map(locks.map((lock) => [lock.pick_id, lock]));
  const latestLineByKey = new Map<string, MarketLineLedgerRecord>();
  for (const line of marketLines) {
    latestLineByKey.set(lineKey(line), line);
  }

  const records: MarketLineRecord[] = [];
  for (const row of lineInputFile.value.rows) {
    const lock = locksByPickId.get(row.pick_id);
    if (!lock) throw new Error(`Refusing market-line row for unknown pick_id ${row.pick_id}.`);
    const role = normalizeLineRole(row.line_role ?? row.role);
    const book = normalizedBook(row);
    const key = `${row.pick_id}|${book.toLowerCase()}|${role}`;
    const priorLine = latestLineByKey.get(key) ?? null;
    if (priorLine && !args.allowCorrection) {
      throw new Error(
        `Refusing market-line row for ${row.pick_id} ${book} ${role} because that slot already exists. Re-run with --allow-correction to append a correction row.`,
      );
    }
    const record = buildMarketLineRecord({
      lock,
      row,
      sourceArtifactPath: lineInputPath,
      sourceArtifactHash: lineInputFile.hash,
      defaultSource,
      generatedAt,
      priorLine,
    });
    records.push(record);
    latestLineByKey.set(lineKey(record), withLineHash(record, priorLine?.line_hash ?? null));
  }

  const outPrefix = path.resolve(
    args.outPrefix ?? path.join(path.dirname(marketLineLedgerPath), "market-lines", `${todayEt()}-market-lines`),
  );
  let appended = 0;
  let skippedDuplicateLineSnapshotIds = 0;

  if (!args.dryRun) {
    const result = await appendMarketLineLedger({ marketLineLedgerPath, records });
    appended = result.appended;
    skippedDuplicateLineSnapshotIds = result.skippedDuplicateLineSnapshotIds;
    await mkdir(path.dirname(outPrefix), { recursive: true });
    await Promise.all([
      writeFile(
        `${outPrefix}.json`,
        `${JSON.stringify(
          {
            generatedAt,
            dryRun: args.dryRun,
            lockLedgerPath,
            marketLineLedgerPath,
            lineInputPath,
            lineInputSha256: lineInputFile.hash,
            appended,
            skippedDuplicateLineSnapshotIds,
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
          marketLineLedgerPath,
          lineInputPath,
          lineInputHash: lineInputFile.hash,
          appended,
          skippedDuplicateLineSnapshotIds,
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
        marketLineLedgerPath,
        lineInputPath,
        lineInputSha256: lineInputFile.hash,
        inputRows: lineInputFile.value.rows.length,
        marketLinesBuilt: records.length,
        appended,
        skippedDuplicateLineSnapshotIds,
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
