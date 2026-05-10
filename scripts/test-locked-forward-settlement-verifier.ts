import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type LockRecord = {
  pick_id: string;
  lock_id: string;
  lock_mode: "LOCKED_FORWARD";
  generated_at: string;
  slate_date: string;
  input_snapshot_id: string;
  player: string;
  game_time_et: string;
  market: string;
  side: "OVER" | "UNDER";
  line: number;
  previous_record_hash?: string | null;
  record_hash?: string;
};

type SettlementRecord = {
  settlement_id: string;
  settlement_type: "SETTLED" | "CORRECTED_SETTLEMENT" | "VOIDED_SETTLEMENT";
  pick_id: string;
  lock_id: string;
  locked_row_hash: string;
  slate_date: string;
  player: string;
  game_time_et: string;
  market: string;
  side: "OVER" | "UNDER";
  line: number;
  actual_stat: number | null;
  result: "WIN" | "LOSS" | "PUSH" | "VOID";
  void_reason: string | null;
  settled_at_utc: string;
  settlement_source: string;
  settlement_source_sha256: string;
  corrects_settlement_hash: string | null;
  previous_settlement_hash?: string | null;
  settlement_hash?: string;
};

type CaseSpec = {
  name: string;
  locks: LockRecord[];
  settlements: SettlementRecord[];
  shouldPass: boolean;
  expectedText?: string;
};

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

function datePlus(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function withLockHashes(rows: LockRecord[]): LockRecord[] {
  let previous: string | null = null;
  return rows.map((row) => {
    const payload = { ...row, previous_record_hash: previous };
    delete payload.record_hash;
    const record = { ...payload, record_hash: sha256(canonicalJson(payload)) };
    previous = record.record_hash;
    return record;
  });
}

function withSettlementHashes(rows: SettlementRecord[]): SettlementRecord[] {
  let previous: string | null = null;
  return rows.map((row) => {
    const payload = { ...row, previous_settlement_hash: previous };
    delete payload.settlement_hash;
    const record = { ...payload, settlement_hash: sha256(canonicalJson(payload)) };
    previous = record.settlement_hash;
    return record;
  });
}

function baseLocks(): LockRecord[] {
  const slate = datePlus(1);
  return withLockHashes([
    {
      pick_id: "pick-settle-001",
      lock_id: "lock-settle-001",
      lock_mode: "LOCKED_FORWARD",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-settle-001",
      player: "Fixture Player A",
      game_time_et: `${slate}T23:00:00.000Z`,
      market: "PTS",
      side: "OVER",
      line: 10.5,
    },
    {
      pick_id: "pick-settle-002",
      lock_id: "lock-settle-001",
      lock_mode: "LOCKED_FORWARD",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-settle-001",
      player: "Fixture Player B",
      game_time_et: `${slate}T23:00:00.000Z`,
      market: "REB",
      side: "UNDER",
      line: 5,
    },
    {
      pick_id: "pick-settle-003",
      lock_id: "lock-settle-001",
      lock_mode: "LOCKED_FORWARD",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-settle-001",
      player: "Fixture Player C",
      game_time_et: `${slate}T23:00:00.000Z`,
      market: "AST",
      side: "OVER",
      line: 4,
    },
  ]);
}

function settlementFor(lock: LockRecord, overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    settlement_id: `settlement-${lock.pick_id}`,
    settlement_type: "SETTLED",
    pick_id: lock.pick_id,
    lock_id: lock.lock_id,
    locked_row_hash: lock.record_hash ?? "",
    slate_date: lock.slate_date,
    player: lock.player,
    game_time_et: lock.game_time_et,
    market: lock.market,
    side: lock.side,
    line: lock.line,
    actual_stat: lock.side === "OVER" ? lock.line + 1 : lock.line - 1,
    result: "WIN",
    void_reason: null,
    settled_at_utc: `${lock.slate_date}T23:30:00.000Z`,
    settlement_source: "fixture-box-score",
    settlement_source_sha256: "fixture-source-hash",
    corrects_settlement_hash: null,
    ...overrides,
  };
}

function writeJsonl(filePath: string, rows: Array<Record<string, unknown>>): void {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function runVerifier(lockLedger: string, settlementLedger: string): { ok: boolean; text: string } {
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  try {
    const output = execFileSync(
      process.execPath,
      [
        tsxCli,
        "scripts/verify-locked-forward-settlements.ts",
        "--lock-ledger",
        lockLedger,
        "--settlement-ledger",
        settlementLedger,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { ok: true, text: output };
  } catch (error) {
    const failed = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      text: `${failed.stdout?.toString() ?? ""}${failed.stderr?.toString() ?? ""}${failed.message ?? ""}`,
    };
  }
}

function cases(): CaseSpec[] {
  const locks = baseLocks();
  const valid = withSettlementHashes([
    settlementFor(locks[0]),
    settlementFor(locks[1]),
    settlementFor(locks[2], { actual_stat: 4, result: "PUSH" }),
  ]);
  const correctionBase = withSettlementHashes([settlementFor(locks[0])]);
  const validCorrection = withSettlementHashes([
    correctionBase[0],
    settlementFor(locks[0], {
      settlement_id: "settlement-pick-settle-001-correction",
      settlement_type: "CORRECTED_SETTLEMENT",
      actual_stat: 8,
      result: "LOSS",
      corrects_settlement_hash: correctionBase[0].settlement_hash ?? null,
    }),
  ]);

  return [
    { name: "valid-settlements", locks, settlements: valid, shouldPass: true },
    { name: "valid-correction", locks, settlements: validCorrection, shouldPass: true },
    {
      name: "unknown-pick",
      locks,
      settlements: withSettlementHashes([settlementFor(locks[0], { pick_id: "missing-pick" })]),
      shouldPass: false,
      expectedText: "does not exist in lock ledger",
    },
    {
      name: "wrong-locked-row-hash",
      locks,
      settlements: withSettlementHashes([settlementFor(locks[0], { locked_row_hash: "wrong-hash" })]),
      shouldPass: false,
      expectedText: "locked_row_hash does not match",
    },
    {
      name: "duplicate-final-settlement",
      locks,
      settlements: withSettlementHashes([
        settlementFor(locks[0]),
        settlementFor(locks[0], { settlement_id: "settlement-pick-settle-001-again" }),
      ]),
      shouldPass: false,
      expectedText: "duplicate final settlement",
    },
    {
      name: "bad-correction-hash",
      locks,
      settlements: withSettlementHashes([
        correctionBase[0],
        settlementFor(locks[0], {
          settlement_id: "settlement-pick-settle-001-bad-correction",
          settlement_type: "CORRECTED_SETTLEMENT",
          corrects_settlement_hash: "wrong-prior-hash",
        }),
      ]),
      shouldPass: false,
      expectedText: "does not reference prior settlement_hash",
    },
    {
      name: "missing-actual-stat",
      locks,
      settlements: withSettlementHashes([settlementFor(locks[0], { actual_stat: null })]),
      shouldPass: false,
      expectedText: "requires actual_stat",
    },
    {
      name: "wrong-result-logic",
      locks,
      settlements: withSettlementHashes([settlementFor(locks[0], { actual_stat: 8, result: "WIN" })]),
      shouldPass: false,
      expectedText: "does not match deterministic",
    },
    {
      name: "void-without-reason",
      locks,
      settlements: withSettlementHashes([
        settlementFor(locks[0], {
          settlement_type: "VOIDED_SETTLEMENT",
          actual_stat: null,
          result: "VOID",
          void_reason: null,
        }),
      ]),
      shouldPass: false,
      expectedText: "VOID result requires void_reason",
    },
    {
      name: "settled-before-game-time",
      locks,
      settlements: withSettlementHashes([settlementFor(locks[0], { settled_at_utc: `${locks[0].slate_date}T22:00:00.000Z` })]),
      shouldPass: false,
      expectedText: "settled_at_utc is not after game_time_et",
    },
    {
      name: "bad-settlement-hash",
      locks,
      settlements: valid.map((row, index) => (index === 0 ? { ...row, settlement_hash: "bad-settlement-hash" } : row)),
      shouldPass: false,
      expectedText: "settlement_hash does not match canonical payload",
    },
    {
      name: "bad-prev-settlement-hash",
      locks,
      settlements: valid.map((row, index) => (index === 1 ? { ...row, previous_settlement_hash: "bad-prev-hash" } : row)),
      shouldPass: false,
      expectedText: "previous_settlement_hash does not match prior settlement hash",
    },
  ];
}

function main(): void {
  const fixtureDir = path.resolve("tmp", "locked-forward-settlement-verifier-fixtures");
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });

  const results = cases().map((testCase) => {
    const caseDir = path.join(fixtureDir, testCase.name);
    mkdirSync(caseDir, { recursive: true });
    const lockLedger = path.join(caseDir, "locks.jsonl");
    const settlementLedger = path.join(caseDir, "settlements.jsonl");
    writeJsonl(lockLedger, testCase.locks);
    writeJsonl(settlementLedger, testCase.settlements);
    const result = runVerifier(lockLedger, settlementLedger);
    const textMatches = testCase.expectedText ? result.text.includes(testCase.expectedText) : true;
    const passed = result.ok === testCase.shouldPass && textMatches;
    return {
      name: testCase.name,
      expectedPass: testCase.shouldPass,
      actualPass: result.ok,
      textMatches,
      passed,
      lockLedger,
      settlementLedger,
      output: result.text,
    };
  });

  const failures = results.filter((result) => !result.passed);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: failures.length === 0,
        fixtureDir,
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
        results: results.map(({ output: _output, ...result }) => result),
      },
      null,
      2,
    )}\n`,
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`\n--- ${failure.name} verifier output ---\n${failure.output}\n`);
    }
    process.exitCode = 1;
  }
}

main();
