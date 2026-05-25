import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type Side = "OVER" | "UNDER";
type Result = "WIN" | "LOSS" | "PUSH" | "VOID";
type SettlementType = "SETTLED" | "CORRECTED_SETTLEMENT" | "VOIDED_SETTLEMENT";

type Args = {
  lockLedgerPath: string;
  settlementLedgerPath: string;
};

type LockRecord = {
  pick_id?: string;
  lock_id?: string;
  record_hash?: string;
  slate_date?: string;
  player?: string;
  game_time_et?: string | null;
  market?: string;
  side?: string;
  line?: number | null;
  [key: string]: unknown;
};

type SettlementRecord = {
  settlement_id?: string;
  settlement_type?: SettlementType | string;
  pick_id?: string;
  lock_id?: string;
  locked_row_hash?: string;
  slate_date?: string;
  player?: string;
  game_time_et?: string | null;
  market?: string;
  side?: string;
  line?: number | null;
  actual_stat?: number | null;
  result?: Result | string;
  void_reason?: string | null;
  settled_at_utc?: string;
  settlement_source?: string;
  settlement_source_sha256?: string;
  previous_settlement_hash?: string | null;
  settlement_hash?: string;
  corrects_settlement_hash?: string | null;
  [key: string]: unknown;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let lockLedgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  let settlementLedgerPath = path.join(
    "exports",
    "locked-forward",
    "top-player-expanded-90-premium",
    "settlements.jsonl",
  );

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
  }

  return { lockLedgerPath, settlementLedgerPath };
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

function expectedSettlementHash(record: SettlementRecord): string {
  const { settlement_hash: omittedSettlementHash, ...payload } = record;
  void omittedSettlementHash;
  return sha256(canonicalJson(payload));
}

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function side(value: unknown): Side | null {
  return value === "OVER" || value === "UNDER" ? value : null;
}

function deterministicResult(input: {
  side: Side;
  line: number | null | undefined;
  actualStat: number | null | undefined;
}): Result | null {
  if (input.line == null || input.actualStat == null) return null;
  if (input.actualStat === input.line) return "PUSH";
  if (input.side === "OVER") return input.actualStat > input.line ? "WIN" : "LOSS";
  return input.actualStat < input.line ? "WIN" : "LOSS";
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lockLedgerPath = path.resolve(args.lockLedgerPath);
  const settlementLedgerPath = path.resolve(args.settlementLedgerPath);
  const lockRows = await readJsonl<LockRecord>(lockLedgerPath);
  const settlementRows = await readJsonl<SettlementRecord>(settlementLedgerPath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const locksByPickId = new Map<string, LockRecord>();
  const settlementIds = new Set<string>();
  const settlementHashes = new Set<string>();
  const latestByPickId = new Map<string, SettlementRecord>();
  let previousHash: string | null = null;
  let settledRows = 0;
  let correctionRows = 0;
  let voidRows = 0;

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

  settlementRows.forEach((row, index) => {
    const line = index + 1;
    if (!row.settlement_id) errors.push(`Settlement line ${line}: missing settlement_id`);
    if (!row.pick_id) errors.push(`Settlement line ${line}: missing pick_id`);
    if (!row.lock_id) errors.push(`Settlement line ${line}: missing lock_id`);
    if (!row.locked_row_hash) errors.push(`Settlement line ${line}: missing locked_row_hash`);
    if (!row.settlement_hash) errors.push(`Settlement line ${line}: missing settlement_hash`);
    if (!Object.prototype.hasOwnProperty.call(row, "previous_settlement_hash")) {
      errors.push(`Settlement line ${line}: missing previous_settlement_hash`);
    }
    if (row.previous_settlement_hash !== previousHash) {
      errors.push(`Settlement line ${line}: previous_settlement_hash does not match prior settlement hash`);
    }
    if (row.settlement_hash && row.settlement_hash !== expectedSettlementHash(row)) {
      errors.push(`Settlement line ${line}: settlement_hash does not match canonical payload`);
    }
    if (row.settlement_id) {
      if (settlementIds.has(row.settlement_id)) {
        errors.push(`Settlement line ${line}: duplicate settlement_id ${row.settlement_id}`);
      }
      settlementIds.add(row.settlement_id);
    }
    if (row.settlement_hash) {
      if (settlementHashes.has(row.settlement_hash)) {
        errors.push(`Settlement line ${line}: duplicate settlement_hash ${row.settlement_hash}`);
      }
      settlementHashes.add(row.settlement_hash);
    }

    const lock = row.pick_id ? locksByPickId.get(row.pick_id) : undefined;
    if (!lock) {
      errors.push(`Settlement line ${line}: pick_id ${String(row.pick_id)} does not exist in lock ledger`);
    } else {
      if (row.lock_id !== lock.lock_id) errors.push(`Settlement line ${line}: lock_id does not match lock ledger`);
      if (row.locked_row_hash !== lock.record_hash) {
        errors.push(`Settlement line ${line}: locked_row_hash does not match lock ledger record_hash`);
      }
      if (row.market !== lock.market) errors.push(`Settlement line ${line}: market does not match lock ledger`);
      if (row.side !== lock.side) errors.push(`Settlement line ${line}: side does not match lock ledger`);
      if (row.line !== lock.line) errors.push(`Settlement line ${line}: line does not match lock ledger`);
      if (!lock.game_time_et) {
        errors.push(`Settlement line ${line}: lock row has no game_time_et for postgame settlement proof`);
      }
      const settledMs = parseDateTime(row.settled_at_utc);
      const gameMs = parseDateTime(lock.game_time_et ?? null);
      if (settledMs == null) {
        errors.push(`Settlement line ${line}: invalid settled_at_utc`);
      } else if (gameMs != null && settledMs <= gameMs) {
        errors.push(`Settlement line ${line}: settled_at_utc is not after game_time_et`);
      }
    }

    const priorSettlement = row.pick_id ? latestByPickId.get(row.pick_id) : undefined;
    if (priorSettlement && row.settlement_type !== "CORRECTED_SETTLEMENT") {
      errors.push(`Settlement line ${line}: duplicate final settlement for pick_id ${String(row.pick_id)}`);
    }
    if (row.settlement_type === "CORRECTED_SETTLEMENT") {
      correctionRows += 1;
      if (!priorSettlement) {
        errors.push(`Settlement line ${line}: correction row has no prior settlement`);
      } else if (row.corrects_settlement_hash !== priorSettlement.settlement_hash) {
        errors.push(`Settlement line ${line}: correction row does not reference prior settlement_hash`);
      }
    } else if (row.settlement_type === "SETTLED") {
      settledRows += 1;
    } else if (row.settlement_type === "VOIDED_SETTLEMENT") {
      voidRows += 1;
    } else {
      errors.push(`Settlement line ${line}: unknown settlement_type ${String(row.settlement_type)}`);
    }

    if (row.result === "VOID") {
      if (!row.void_reason) errors.push(`Settlement line ${line}: VOID result requires void_reason`);
    } else if (row.result === "WIN" || row.result === "LOSS" || row.result === "PUSH") {
      if (row.actual_stat == null) errors.push(`Settlement line ${line}: ${row.result} result requires actual_stat`);
      const lockSide = side(lock?.side);
      const expected = lockSide ? deterministicResult({ side: lockSide, line: lock?.line, actualStat: row.actual_stat }) : null;
      if (expected && row.result !== expected) {
        errors.push(`Settlement line ${line}: result ${row.result} does not match deterministic ${expected}`);
      }
    } else {
      errors.push(`Settlement line ${line}: unknown result ${String(row.result)}`);
    }

    if (!row.settlement_source_sha256) errors.push(`Settlement line ${line}: missing settlement_source_sha256`);
    if (!row.settlement_source) warnings.push(`Settlement line ${line}: missing settlement_source label`);

    if (row.pick_id) latestByPickId.set(row.pick_id, row);
    previousHash = row.settlement_hash ?? null;
  });

  const summary = {
    ok: errors.length === 0,
    lockLedgerPath,
    settlementLedgerPath,
    lockRows: lockRows.length,
    settlementRows: settlementRows.length,
    settledRows,
    correctionRows,
    voidRows,
    settledPickCount: latestByPickId.size,
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
