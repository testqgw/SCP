import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type LockRecord = {
  pick_id: string;
  lock_id: string;
  record_hash: string;
  generated_at: string;
  slate_date: string;
  player: string;
  game_time_et: string;
  market: string;
  side: "OVER" | "UNDER";
  line: number;
};

type MarketLineRecord = {
  line_snapshot_id: string;
  line_record_type: "LINE_SNAPSHOT" | "CORRECTED_LINE_SNAPSHOT";
  line_role: "LOCK" | "CLOSE";
  pick_id: string;
  lock_id: string;
  locked_row_hash: string;
  slate_date: string;
  player: string;
  game_time_et: string;
  market: string;
  side: "OVER" | "UNDER";
  model_line: number;
  book: string;
  book_line: number;
  book_odds: number;
  line_timestamp_utc: string;
  captured_at_utc: string;
  source: string;
  source_artifact_sha256: string;
  source_row_sha256: string;
  corrects_line_hash: string | null;
  previous_line_hash?: string | null;
  line_hash?: string;
};

type CaseSpec = {
  name: string;
  locks: LockRecord[];
  lines: MarketLineRecord[];
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

function withLineHashes(rows: MarketLineRecord[]): MarketLineRecord[] {
  let previous: string | null = null;
  return rows.map((row) => {
    const payload = { ...row, previous_line_hash: previous };
    delete payload.line_hash;
    const record = { ...payload, line_hash: sha256(canonicalJson(payload)) };
    previous = record.line_hash;
    return record;
  });
}

function baseLocks(): LockRecord[] {
  const slate = datePlus(1);
  return [
    {
      pick_id: "pick-line-001",
      lock_id: "lock-line-001",
      record_hash: "locked-row-hash-001",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      player: "Fixture Player A",
      game_time_et: `${slate}T23:00:00.000Z`,
      market: "PTS",
      side: "OVER",
      line: 10.5,
    },
    {
      pick_id: "pick-line-002",
      lock_id: "lock-line-001",
      record_hash: "locked-row-hash-002",
      generated_at: `${slate}T12:00:00.000Z`,
      slate_date: slate,
      player: "Fixture Player B",
      game_time_et: `${slate}T23:00:00.000Z`,
      market: "REB",
      side: "UNDER",
      line: 5.5,
    },
  ];
}

function lineFor(lock: LockRecord, overrides: Partial<MarketLineRecord> = {}): MarketLineRecord {
  const role = overrides.line_role ?? "LOCK";
  return {
    line_snapshot_id: `line-${lock.pick_id}-${role}`,
    line_record_type: "LINE_SNAPSHOT",
    line_role: role,
    pick_id: lock.pick_id,
    lock_id: lock.lock_id,
    locked_row_hash: lock.record_hash,
    slate_date: lock.slate_date,
    player: lock.player,
    game_time_et: lock.game_time_et,
    market: lock.market,
    side: lock.side,
    model_line: lock.line,
    book: "DraftKings",
    book_line: lock.line,
    book_odds: -110,
    line_timestamp_utc: `${lock.slate_date}T21:00:00.000Z`,
    captured_at_utc: `${lock.slate_date}T21:01:00.000Z`,
    source: "fixture-market-lines",
    source_artifact_sha256: "fixture-artifact-hash",
    source_row_sha256: "fixture-row-hash",
    corrects_line_hash: null,
    ...overrides,
  };
}

function writeJsonl(filePath: string, rows: Array<Record<string, unknown>>): void {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function runVerifier(lockLedger: string, lineLedger: string): { ok: boolean; text: string } {
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  try {
    const output = execFileSync(
      process.execPath,
      [
        tsxCli,
        "scripts/verify-locked-forward-market-lines.ts",
        "--lock-ledger",
        lockLedger,
        "--market-line-ledger",
        lineLedger,
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
  const valid = withLineHashes([
    lineFor(locks[0], { line_role: "LOCK" }),
    lineFor(locks[0], { line_snapshot_id: "line-pick-line-001-close", line_role: "CLOSE", book_line: 11.5, book_odds: -115 }),
    lineFor(locks[1], { line_role: "LOCK" }),
  ]);
  const correctionBase = withLineHashes([lineFor(locks[0])]);
  const validCorrection = withLineHashes([
    correctionBase[0],
    lineFor(locks[0], {
      line_snapshot_id: "line-pick-line-001-correction",
      line_record_type: "CORRECTED_LINE_SNAPSHOT",
      book_line: 11,
      book_odds: -105,
      corrects_line_hash: correctionBase[0].line_hash ?? null,
    }),
  ]);

  return [
    { name: "valid-market-lines", locks, lines: valid, shouldPass: true },
    { name: "valid-correction", locks, lines: validCorrection, shouldPass: true },
    {
      name: "unknown-pick",
      locks,
      lines: withLineHashes([lineFor(locks[0], { pick_id: "missing-pick" })]),
      shouldPass: false,
      expectedText: "does not exist in lock ledger",
    },
    {
      name: "wrong-locked-row-hash",
      locks,
      lines: withLineHashes([lineFor(locks[0], { locked_row_hash: "wrong-hash" })]),
      shouldPass: false,
      expectedText: "locked_row_hash does not match",
    },
    {
      name: "duplicate-final-line",
      locks,
      lines: withLineHashes([lineFor(locks[0]), lineFor(locks[0], { line_snapshot_id: "line-pick-line-001-again" })]),
      shouldPass: false,
      expectedText: "duplicate final line snapshot",
    },
    {
      name: "bad-correction-hash",
      locks,
      lines: withLineHashes([
        correctionBase[0],
        lineFor(locks[0], {
          line_snapshot_id: "line-pick-line-001-bad-correction",
          line_record_type: "CORRECTED_LINE_SNAPSHOT",
          corrects_line_hash: "wrong-prior-hash",
        }),
      ]),
      shouldPass: false,
      expectedText: "does not reference prior line_hash",
    },
    {
      name: "missing-book",
      locks,
      lines: withLineHashes([lineFor(locks[0], { book: "" })]),
      shouldPass: false,
      expectedText: "missing book",
    },
    {
      name: "missing-odds",
      locks,
      lines: withLineHashes([lineFor(locks[0], { book_odds: Number.NaN })]),
      shouldPass: false,
      expectedText: "missing/invalid book_odds",
    },
    {
      name: "line-after-game-time",
      locks,
      lines: withLineHashes([lineFor(locks[0], { line_timestamp_utc: `${locks[0].slate_date}T23:05:00.000Z` })]),
      shouldPass: false,
      expectedText: "line_timestamp_utc is not before game_time_et",
    },
    {
      name: "captured-after-game-time",
      locks,
      lines: withLineHashes([lineFor(locks[0], { captured_at_utc: `${locks[0].slate_date}T23:05:00.000Z` })]),
      shouldPass: false,
      expectedText: "captured_at_utc is not before game_time_et",
    },
    {
      name: "bad-line-hash",
      locks,
      lines: valid.map((row, index) => (index === 0 ? { ...row, line_hash: "bad-line-hash" } : row)),
      shouldPass: false,
      expectedText: "line_hash does not match canonical payload",
    },
    {
      name: "bad-prev-line-hash",
      locks,
      lines: valid.map((row, index) => (index === 1 ? { ...row, previous_line_hash: "bad-prev-hash" } : row)),
      shouldPass: false,
      expectedText: "previous_line_hash does not match prior line hash",
    },
  ];
}

function main(): void {
  const fixtureDir = path.resolve("tmp", "locked-forward-market-line-verifier-fixtures");
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });

  const results = cases().map((testCase) => {
    const caseDir = path.join(fixtureDir, testCase.name);
    mkdirSync(caseDir, { recursive: true });
    const lockLedger = path.join(caseDir, "locks.jsonl");
    const lineLedger = path.join(caseDir, "market-lines.jsonl");
    writeJsonl(lockLedger, testCase.locks);
    writeJsonl(lineLedger, testCase.lines);
    const result = runVerifier(lockLedger, lineLedger);
    const textMatches = testCase.expectedText ? result.text.includes(testCase.expectedText) : true;
    const passed = result.ok === testCase.shouldPass && textMatches;
    return {
      name: testCase.name,
      expectedPass: testCase.shouldPass,
      actualPass: result.ok,
      textMatches,
      passed,
      lockLedger,
      lineLedger,
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
