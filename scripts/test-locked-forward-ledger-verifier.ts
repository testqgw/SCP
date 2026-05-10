import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type TestRecord = {
  pick_id: string;
  lock_id: string;
  lock_mode:
    | "LOCKED_FORWARD"
    | "BACKFILL_NOT_FORWARD_PROOF"
    | "AFTER_TIPOFF_NOT_FORWARD_PROOF"
    | "MISSING_GAME_TIME_NOT_FORWARD_PROOF";
  lock_timing_status: "BEFORE_FIRST_GAME" | "AFTER_FIRST_GAME" | "NO_GAME_TIME_IN_ARTIFACT" | "PAST_DATE";
  generated_at: string;
  slate_date: string;
  input_snapshot_id: string;
  game_time_et: string | null;
  previous_record_hash?: string | null;
  record_hash?: string;
  player: string;
  market: string;
  side: "OVER" | "UNDER";
};

type CaseSpec = {
  name: string;
  rows: TestRecord[];
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

function withHashes(rows: TestRecord[]): TestRecord[] {
  let previous: string | null = null;
  return rows.map((row) => {
    const payload = { ...row, previous_record_hash: previous };
    delete payload.record_hash;
    const record = { ...payload, record_hash: sha256(canonicalJson(payload)) };
    previous = record.record_hash;
    return record;
  });
}

function baseRows(): TestRecord[] {
  const slate = datePlus(1);
  return withHashes([
    {
      pick_id: "pick-valid-001",
      lock_id: "lock-valid-001",
      lock_mode: "LOCKED_FORWARD",
      lock_timing_status: "BEFORE_FIRST_GAME",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-valid-001",
      game_time_et: `${slate}T23:00:00.000Z`,
      player: "Fixture Player A",
      market: "PTS",
      side: "OVER",
    },
    {
      pick_id: "pick-valid-002",
      lock_id: "lock-valid-001",
      lock_mode: "LOCKED_FORWARD",
      lock_timing_status: "BEFORE_FIRST_GAME",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-valid-001",
      game_time_et: `${slate}T23:00:00.000Z`,
      player: "Fixture Player B",
      market: "REB",
      side: "UNDER",
    },
    {
      pick_id: "pick-valid-003",
      lock_id: "lock-valid-001",
      lock_mode: "LOCKED_FORWARD",
      lock_timing_status: "BEFORE_FIRST_GAME",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      input_snapshot_id: "snapshot-valid-001",
      game_time_et: `${slate}T23:00:00.000Z`,
      player: "Fixture Player C",
      market: "AST",
      side: "OVER",
    },
  ]);
}

function writeLedger(filePath: string, rows: TestRecord[]): void {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function runVerifier(ledgerPath: string): { ok: boolean; text: string } {
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  try {
    const output = execFileSync(process.execPath, [tsxCli, "scripts/verify-locked-forward-ledger.ts", "--ledger", ledgerPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  const valid = baseRows();
  const stale = datePlus(-1);
  return [
    {
      name: "valid-ledger",
      rows: valid,
      shouldPass: true,
    },
    {
      name: "bad-prev-hash",
      rows: valid.map((row, index) => (index === 1 ? { ...row, previous_record_hash: "bad-prev-hash" } : row)),
      shouldPass: false,
      expectedText: "previous_record_hash does not match prior row hash",
    },
    {
      name: "bad-row-hash",
      rows: valid.map((row, index) => (index === 0 ? { ...row, record_hash: "bad-row-hash" } : row)),
      shouldPass: false,
      expectedText: "record_hash does not match canonical payload",
    },
    {
      name: "duplicate-pick-id",
      rows: withHashes([valid[0], { ...valid[1], pick_id: valid[0].pick_id }, valid[2]]),
      shouldPass: false,
      expectedText: "duplicate pick_id",
    },
    {
      name: "conflicting-lock-id",
      rows: withHashes([valid[0], { ...valid[1], generated_at: `${datePlus(1)}T13:00:00.000Z` }, valid[2]]),
      shouldPass: false,
      expectedText: "is reused with conflicting run metadata",
    },
    {
      name: "stale-forward-row",
      rows: withHashes([
        {
          ...valid[0],
          slate_date: stale,
          generated_at: `${stale}T12:00:00.000Z`,
          game_time_et: `${stale}T23:00:00.000Z`,
        },
      ]),
      shouldPass: false,
      expectedText: "stale slate",
    },
    {
      name: "generated-after-game-time",
      rows: withHashes([
        {
          ...valid[0],
          generated_at: `${datePlus(1)}T23:05:00.000Z`,
          game_time_et: `${datePlus(1)}T23:00:00.000Z`,
        },
      ]),
      shouldPass: false,
      expectedText: "generated at or after listed game_time_et",
    },
    {
      name: "after-tipoff-marked-forward",
      rows: withHashes([
        {
          ...valid[0],
          lock_timing_status: "AFTER_FIRST_GAME",
          generated_at: `${datePlus(1)}T23:05:00.000Z`,
          game_time_et: `${datePlus(1)}T23:00:00.000Z`,
        },
      ]),
      shouldPass: false,
      expectedText: "generated at or after listed game_time_et",
    },
    {
      name: "missing-game-time-backfill",
      rows: withHashes([
        {
          ...valid[0],
          lock_mode: "MISSING_GAME_TIME_NOT_FORWARD_PROOF",
          lock_timing_status: "NO_GAME_TIME_IN_ARTIFACT",
          game_time_et: null,
        },
      ]),
      shouldPass: true,
    },
    {
      name: "missing-game-time-marked-forward",
      rows: withHashes([
        {
          ...valid[0],
          lock_timing_status: "NO_GAME_TIME_IN_ARTIFACT",
          game_time_et: null,
        },
      ]),
      shouldPass: false,
      expectedText: "LOCKED_FORWARD row has no game-time proof in artifact",
    },
  ];
}

function main(): void {
  const fixtureDir = path.resolve("tmp", "locked-forward-ledger-verifier-fixtures");
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });

  const results = cases().map((testCase) => {
    const ledgerPath = path.join(fixtureDir, `${testCase.name}.jsonl`);
    writeLedger(ledgerPath, testCase.rows);
    const result = runVerifier(ledgerPath);
    const textMatches = testCase.expectedText ? result.text.includes(testCase.expectedText) : true;
    const passed = result.ok === testCase.shouldPass && textMatches;
    return {
      name: testCase.name,
      expectedPass: testCase.shouldPass,
      actualPass: result.ok,
      textMatches,
      passed,
      ledgerPath,
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
