import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

type Args = {
  ledgerPath: string;
};

type LedgerRecord = {
  pick_id?: string;
  lock_id?: string;
  lock_mode?: string;
  lock_timing_status?: string;
  generated_at?: string;
  slate_date?: string;
  input_snapshot_id?: string;
  game_time_et?: string | null;
  previous_record_hash?: string | null;
  record_hash?: string;
  [key: string]: unknown;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let ledgerPath = path.join("exports", "locked-forward", "top-player-expanded-90-premium-ledger.jsonl");
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    const next = raw[index + 1];
    if (token === "--ledger" && next) {
      ledgerPath = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--ledger=")) {
      ledgerPath = token.slice("--ledger=".length);
    }
  }
  return { ledgerPath };
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

function parseDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readLedger(ledgerPath: string): Promise<LedgerRecord[]> {
  if (!existsSync(ledgerPath)) return [];
  const text = await readFile(ledgerPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as LedgerRecord;
      } catch (error) {
        throw new Error(`Invalid JSON on ledger line ${index + 1}: ${(error as Error).message}`);
      }
    });
}

function expectedRecordHash(record: LedgerRecord): string {
  const { record_hash: omittedRecordHash, ...payload } = record;
  void omittedRecordHash;
  return sha256(canonicalJson(payload));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ledgerPath = path.resolve(args.ledgerPath);
  const rows = await readLedger(ledgerPath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const pickIds = new Set<string>();
  const recordHashes = new Set<string>();
  const lockGroups = new Map<string, Set<string>>();
  const nowEt = todayEt();
  let previousHash: string | null = null;
  let forwardRows = 0;
  let backfillRows = 0;
  let afterTipoffRows = 0;
  let missingGameTimeRows = 0;

  rows.forEach((row, index) => {
    const line = index + 1;
    if (!row.pick_id) errors.push(`Line ${line}: missing pick_id`);
    if (!row.lock_id) errors.push(`Line ${line}: missing lock_id`);
    if (!row.record_hash) errors.push(`Line ${line}: missing record_hash`);
    if (!Object.prototype.hasOwnProperty.call(row, "previous_record_hash")) {
      errors.push(`Line ${line}: missing previous_record_hash`);
    }
    if (row.previous_record_hash !== previousHash) {
      errors.push(`Line ${line}: previous_record_hash does not match prior row hash`);
    }
    if (row.record_hash && row.record_hash !== expectedRecordHash(row)) {
      errors.push(`Line ${line}: record_hash does not match canonical payload`);
    }
    if (row.pick_id) {
      if (pickIds.has(row.pick_id)) errors.push(`Line ${line}: duplicate pick_id ${row.pick_id}`);
      pickIds.add(row.pick_id);
    }
    if (row.record_hash) {
      if (recordHashes.has(row.record_hash)) errors.push(`Line ${line}: duplicate record_hash ${row.record_hash}`);
      recordHashes.add(row.record_hash);
    }
    if (row.lock_id) {
      const lockSignature = canonicalJson({
        generated_at: row.generated_at ?? null,
        slate_date: row.slate_date ?? null,
        input_snapshot_id: row.input_snapshot_id ?? null,
        lock_mode: row.lock_mode ?? null,
      });
      const signatures = lockGroups.get(row.lock_id) ?? new Set<string>();
      signatures.add(lockSignature);
      lockGroups.set(row.lock_id, signatures);
    }

    if (row.lock_mode === "LOCKED_FORWARD") {
      forwardRows += 1;
      if (row.slate_date && row.slate_date < nowEt) {
        errors.push(`Line ${line}: stale slate ${row.slate_date} is marked LOCKED_FORWARD on ${nowEt}`);
      }
      if (!row.game_time_et || row.lock_timing_status === "NO_GAME_TIME_IN_ARTIFACT") {
        errors.push(`Line ${line}: LOCKED_FORWARD row has no game-time proof in artifact`);
      }
      const generatedMs = parseDateTime(row.generated_at);
      const gameMs = parseDateTime(row.game_time_et ?? null);
      if (generatedMs != null && gameMs != null && generatedMs >= gameMs) {
        errors.push(`Line ${line}: LOCKED_FORWARD row generated at or after listed game_time_et`);
      }
    } else if (row.lock_mode === "BACKFILL_NOT_FORWARD_PROOF") {
      backfillRows += 1;
    } else if (row.lock_mode === "AFTER_TIPOFF_NOT_FORWARD_PROOF") {
      afterTipoffRows += 1;
    } else if (row.lock_mode === "MISSING_GAME_TIME_NOT_FORWARD_PROOF") {
      missingGameTimeRows += 1;
    } else {
      errors.push(`Line ${line}: unknown lock_mode ${String(row.lock_mode)}`);
    }

    previousHash = row.record_hash ?? null;
  });

  for (const [lockId, signatures] of lockGroups) {
    if (signatures.size > 1) {
      errors.push(`lock_id ${lockId} is reused with conflicting run metadata`);
    }
  }

  const summary = {
    ok: errors.length === 0,
    ledgerPath,
    rows: rows.length,
    forwardRows,
    backfillRows,
    afterTipoffRows,
    missingGameTimeRows,
    lockRuns: lockGroups.size,
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
