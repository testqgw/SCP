import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type LineRole = "LOCK" | "CLOSE";
type LineRecordType = "LINE_SNAPSHOT" | "CORRECTED_LINE_SNAPSHOT";

type Args = {
  lockLedgerPath: string;
  marketLineLedgerPath: string;
};

type LockRecord = {
  pick_id?: string;
  lock_id?: string;
  record_hash?: string;
  generated_at?: string;
  slate_date?: string;
  player?: string;
  game_time_et?: string | null;
  market?: string;
  side?: string;
  line?: number | null;
  [key: string]: unknown;
};

type MarketLineRecord = {
  line_snapshot_id?: string;
  line_record_type?: LineRecordType | string;
  line_role?: LineRole | string;
  pick_id?: string;
  lock_id?: string;
  locked_row_hash?: string;
  slate_date?: string;
  player?: string;
  game_time_et?: string | null;
  market?: string;
  side?: string;
  model_line?: number | null;
  book?: string;
  book_line?: number;
  book_odds?: number;
  line_timestamp_utc?: string;
  captured_at_utc?: string;
  source?: string;
  source_artifact_sha256?: string;
  source_row_sha256?: string;
  previous_line_hash?: string | null;
  line_hash?: string;
  corrects_line_hash?: string | null;
  [key: string]: unknown;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let marketLineLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium", "market-lines.jsonl");

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
    if (token === "--market-line-ledger" && next) {
      marketLineLedgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--market-line-ledger=")) {
      marketLineLedgerPath = token.slice("--market-line-ledger=".length);
      continue;
    }
  }

  return { lockLedgerPath, marketLineLedgerPath };
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

function expectedLineHash(record: MarketLineRecord): string {
  const { line_hash: omittedLineHash, ...payload } = record;
  void omittedLineHash;
  return sha256(canonicalJson(payload));
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineKey(record: Pick<MarketLineRecord, "pick_id" | "book" | "line_role">): string | null {
  if (!record.pick_id || !record.book || !record.line_role) return null;
  return `${record.pick_id}|${record.book.toLowerCase()}|${record.line_role}`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lockLedgerPath = path.resolve(args.lockLedgerPath);
  const marketLineLedgerPath = path.resolve(args.marketLineLedgerPath);
  const lockRows = await readJsonl<LockRecord>(lockLedgerPath);
  const lineRows = await readJsonl<MarketLineRecord>(marketLineLedgerPath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const locksByPickId = new Map<string, LockRecord>();
  const lineSnapshotIds = new Set<string>();
  const lineHashes = new Set<string>();
  const latestByKey = new Map<string, MarketLineRecord>();
  let previousHash: string | null = null;
  let lockRowsSeen = 0;
  let closeRowsSeen = 0;
  let correctionRows = 0;

  lockRows.forEach((lock, index) => {
    if (!lock.pick_id) {
      errors.push(`Lock line ${index + 1}: missing pick_id`);
      return;
    }
    if (locksByPickId.has(lock.pick_id)) {
      errors.push(`Lock line ${index + 1}: duplicate lock pick_id ${lock.pick_id}`);
    }
    locksByPickId.set(lock.pick_id, lock);
  });

  lineRows.forEach((row, index) => {
    const line = index + 1;
    if (!row.line_snapshot_id) errors.push(`Market-line line ${line}: missing line_snapshot_id`);
    if (!row.pick_id) errors.push(`Market-line line ${line}: missing pick_id`);
    if (!row.lock_id) errors.push(`Market-line line ${line}: missing lock_id`);
    if (!row.locked_row_hash) errors.push(`Market-line line ${line}: missing locked_row_hash`);
    if (!row.line_hash) errors.push(`Market-line line ${line}: missing line_hash`);
    if (!Object.prototype.hasOwnProperty.call(row, "previous_line_hash")) {
      errors.push(`Market-line line ${line}: missing previous_line_hash`);
    }
    if (row.previous_line_hash !== previousHash) {
      errors.push(`Market-line line ${line}: previous_line_hash does not match prior line hash`);
    }
    if (row.line_hash && row.line_hash !== expectedLineHash(row)) {
      errors.push(`Market-line line ${line}: line_hash does not match canonical payload`);
    }
    if (row.line_snapshot_id) {
      if (lineSnapshotIds.has(row.line_snapshot_id)) {
        errors.push(`Market-line line ${line}: duplicate line_snapshot_id ${row.line_snapshot_id}`);
      }
      lineSnapshotIds.add(row.line_snapshot_id);
    }
    if (row.line_hash) {
      if (lineHashes.has(row.line_hash)) errors.push(`Market-line line ${line}: duplicate line_hash ${row.line_hash}`);
      lineHashes.add(row.line_hash);
    }

    if (row.line_role === "LOCK") {
      lockRowsSeen += 1;
    } else if (row.line_role === "CLOSE") {
      closeRowsSeen += 1;
    } else {
      errors.push(`Market-line line ${line}: unknown line_role ${String(row.line_role)}`);
    }

    if (!row.book) errors.push(`Market-line line ${line}: missing book`);
    if (row.book_line == null || !Number.isFinite(row.book_line)) {
      errors.push(`Market-line line ${line}: missing/invalid book_line`);
    }
    if (row.book_odds == null || !Number.isFinite(row.book_odds)) {
      errors.push(`Market-line line ${line}: missing/invalid book_odds`);
    }
    if (!row.source_artifact_sha256) errors.push(`Market-line line ${line}: missing source_artifact_sha256`);
    if (!row.source_row_sha256) errors.push(`Market-line line ${line}: missing source_row_sha256`);
    if (!row.source) warnings.push(`Market-line line ${line}: missing source label`);

    const lock = row.pick_id ? locksByPickId.get(row.pick_id) : undefined;
    if (!lock) {
      errors.push(`Market-line line ${line}: pick_id ${String(row.pick_id)} does not exist in lock ledger`);
    } else {
      if (row.lock_id !== lock.lock_id) errors.push(`Market-line line ${line}: lock_id does not match lock ledger`);
      if (row.locked_row_hash !== lock.record_hash) {
        errors.push(`Market-line line ${line}: locked_row_hash does not match lock ledger record_hash`);
      }
      if (row.market !== lock.market) errors.push(`Market-line line ${line}: market does not match lock ledger`);
      if (row.side !== lock.side) errors.push(`Market-line line ${line}: side does not match lock ledger`);
      if (row.model_line !== lock.line) errors.push(`Market-line line ${line}: model_line does not match lock ledger line`);
      if (!lock.game_time_et) {
        errors.push(`Market-line line ${line}: lock row has no game_time_et for pregame line proof`);
      }
      const gameMs = parseDateTime(lock.game_time_et ?? null);
      const lineMs = parseDateTime(row.line_timestamp_utc);
      const capturedMs = parseDateTime(row.captured_at_utc);
      if (lineMs == null) {
        errors.push(`Market-line line ${line}: invalid line_timestamp_utc`);
      } else if (gameMs != null && lineMs >= gameMs) {
        errors.push(`Market-line line ${line}: line_timestamp_utc is not before game_time_et`);
      }
      if (capturedMs == null) {
        errors.push(`Market-line line ${line}: invalid captured_at_utc`);
      } else if (gameMs != null && capturedMs >= gameMs) {
        errors.push(`Market-line line ${line}: captured_at_utc is not before game_time_et`);
      }
    }

    const key = lineKey(row);
    const priorLine = key ? latestByKey.get(key) : undefined;
    if (priorLine && row.line_record_type !== "CORRECTED_LINE_SNAPSHOT") {
      errors.push(`Market-line line ${line}: duplicate final line snapshot for ${key}`);
    }
    if (row.line_record_type === "CORRECTED_LINE_SNAPSHOT") {
      correctionRows += 1;
      if (!priorLine) {
        errors.push(`Market-line line ${line}: correction row has no prior line snapshot`);
      } else if (row.corrects_line_hash !== priorLine.line_hash) {
        errors.push(`Market-line line ${line}: correction row does not reference prior line_hash`);
      }
    } else if (row.line_record_type !== "LINE_SNAPSHOT") {
      errors.push(`Market-line line ${line}: unknown line_record_type ${String(row.line_record_type)}`);
    }

    if (key) latestByKey.set(key, row);
    previousHash = row.line_hash ?? null;
  });

  const summary = {
    ok: errors.length === 0,
    lockLedgerPath,
    marketLineLedgerPath,
    lockRows: lockRows.length,
    marketLineRows: lineRows.length,
    lockLineRows: lockRowsSeen,
    closeLineRows: closeRowsSeen,
    correctionRows,
    pricedPickBookSlots: latestByKey.size,
    errors,
    warnings,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
