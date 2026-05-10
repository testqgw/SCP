# Locked Forward Top Player Expanded 90 Premium

This workflow freezes the `holdout_stable_premium_90_six_per_day` lane before results are known. It is for forward proof, not for tuning.

## Claim Boundary

- The historical champion remains a backtest champion until locked-forward rows are generated before the slate settles.
- A past-date lock is marked `BACKFILL_NOT_FORWARD_PROOF` and must not be counted as forward evidence.
- A same-day lock after the first known game time is refused unless explicitly marked `AFTER_TIPOFF_NOT_FORWARD_PROOF`.
- The current score artifact does not include real sportsbook odds or closing lines, so ROI and CLV require a later settlement/join step.
- The ledger is append-only JSONL with a hash chain. It is tamper-evident, not a substitute for external timestamping.
- Every lock records score/model/exporter/rule hashes and relevant git dirtiness so the same lane name cannot silently point at different code.

## Daily Lock

Refresh the current slate score artifact first:

```bash
python scripts/export-top-player-200-current-slate-scores.py
npm run projection:locked-forward:top200-premium -- --dry-run
npm run projection:locked-forward:top200-premium
npm run projection:locked-forward:top200-premium:verify-ledger
```

Then lock the frozen premium lane:

```bash
npm run projection:locked-forward:top200-premium
```

Outputs:

- `exports/locked-forward/top-player-expanded-90-premium-ledger.jsonl`
- `exports/locked-forward/top-player-expanded-90-premium-YYYY-MM-DD.json`
- `exports/locked-forward/top-player-expanded-90-premium-YYYY-MM-DD.md`
- `exports/locked-forward/top-player-expanded-90-premium-YYYY-MM-DD.csv`

The non-dry lock refuses stale dates. If `firstGameTimeEt` is available in the score artifact, it also refuses after-tipoff locks unless `--allow-after-tipoff` is supplied. Rows written with that override are not forward proof.

## Dry Run

Use this when inspecting stale artifacts or testing the selector. It does not append to the ledger:

```bash
npm run projection:locked-forward:top200-premium -- --dry-run
```

To inspect a past slate artifact explicitly:

```bash
npm run projection:locked-forward:top200-premium -- --dry-run --allow-past
```

## Ledger Verification

```bash
npm run projection:locked-forward:top200-premium:verify-ledger
```

The verifier checks:

- `record_hash` matches the canonical row payload
- `previous_record_hash` links to the prior row hash
- duplicate `pick_id` values are rejected
- `lock_id` is not reused with conflicting run metadata
- stale rows are not marked `LOCKED_FORWARD`
- rows generated after listed game time are not marked `LOCKED_FORWARD`

Adversarial verifier fixtures:

```bash
npm run projection:locked-forward:top200-premium:test-verifier
```

This generates temporary valid/corrupted ledgers under `tmp/locked-forward-ledger-verifier-fixtures` and asserts the verifier catches bad previous hashes, bad row hashes, duplicate picks, conflicting lock IDs, stale forward rows, and after-tipoff forward rows.

## Settlement

Settlement is separate from the pregame lock ledger. The exporter reads a settlement source artifact, resolves each row against the immutable lock ledger, and appends settlement rows to:

```text
exports/locked-forward/top-player-expanded-90-premium/settlements.jsonl
```

Default settlement input:

```text
exports/locked-forward/top-player-expanded-90-premium/settlement-input.json
```

Expected input shape:

```json
{
  "generatedAtUtc": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "source": "box-score-and-closing-lines",
  "rows": [
    {
      "pick_id": "locked-pick-id",
      "box_score": {
        "points": 24,
        "rebounds": 7,
        "assists": 5,
        "threes": 3
      },
      "closing_line": 22.5,
      "closing_odds": -115,
      "book_odds_at_lock": -110,
      "settled_at_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "settlement_source": "nba-box-score-provider"
    }
  ]
}
```

Run:

```bash
npm run projection:locked-forward:top200-premium:settle -- --dry-run
npm run projection:locked-forward:top200-premium:settle
npm run projection:locked-forward:top200-premium:verify-settlements
```

Settlement rows include:

```text
settlement_id
settlement_type
pick_id
lock_id
locked_row_hash
actual_stat
result
void_reason
settled_at_utc
settlement_source
settlement_source_sha256
closing_line
closing_odds
book_line_at_lock
book_odds_at_lock
clv
roi_at_odds
previous_settlement_hash
settlement_hash
```

Rules enforced by the settlement exporter:

- every settlement row must reference an existing locked `pick_id`
- every row preserves `pick_id`, `lock_id`, and `locked_row_hash`
- already-settled picks are refused unless `--allow-correction` is used
- correction rows append `CORRECTED_SETTLEMENT` and reference the prior settlement hash
- `OVER` / `UNDER` results are calculated deterministically from side, line, and actual stat
- combo markets `PR`, `PA`, `RA`, and `PRA` are calculated from raw box-score fields
- voids require a reason
- `settled_at_utc` must be after the locked `game_time_et`

Settlement verifier:

```bash
npm run projection:locked-forward:top200-premium:verify-settlements
```

The verifier checks the settlement hash chain, joins every settlement row back to the lock ledger, verifies `locked_row_hash`, rejects duplicate final settlements, checks deterministic result logic, requires postgame settlement timing, and requires a settlement source hash.

Adversarial settlement verifier fixtures:

```bash
npm run projection:locked-forward:top200-premium:test-settlement-verifier
```

This generates temporary fixtures under `tmp/locked-forward-settlement-verifier-fixtures` and asserts the verifier catches unknown picks, wrong lock hashes, duplicate settlements, bad corrections, missing actual stats, bad result logic, voids without reasons, pregame settlements, and broken settlement hashes.

## Market Lines

Market lines are a separate evidence stream. They prove a locked pick had a real observed book price/line before game time. They do not settle picks and they do not rewrite either the lock ledger or settlement ledger.

Default line input:

```text
exports/locked-forward/top-player-expanded-90-premium/market-lines-input.json
```

Market-line ledger:

```text
exports/locked-forward/top-player-expanded-90-premium/market-lines.jsonl
```

Expected input shape:

```json
{
  "generatedAtUtc": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "source": "sportsbook-line-snapshot",
  "rows": [
    {
      "pick_id": "locked-pick-id",
      "line_role": "LOCK",
      "book": "DraftKings",
      "book_line": 22.5,
      "book_odds": -110,
      "line_timestamp_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "captured_at_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "stake_units": 1,
      "source": "draftkings-snapshot"
    },
    {
      "pick_id": "locked-pick-id",
      "line_role": "CLOSE",
      "book": "DraftKings",
      "book_line": 23.5,
      "book_odds": -115,
      "line_timestamp_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "captured_at_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "source": "draftkings-close"
    }
  ]
}
```

Run:

```bash
npm run projection:locked-forward:top200-premium:capture-lines -- --dry-run
npm run projection:locked-forward:top200-premium:capture-lines
npm run projection:locked-forward:top200-premium:verify-market-lines
```

Market-line rows include:

```text
line_snapshot_id
line_record_type
line_role
pick_id
lock_id
locked_row_hash
book
book_line
book_odds
line_timestamp_utc
captured_at_utc
source_artifact_sha256
source_row_sha256
stake_units
previous_line_hash
line_hash
```

Rules enforced by the market-line exporter:

- every line row must reference an existing locked `pick_id`
- every row preserves `pick_id`, `lock_id`, and `locked_row_hash`
- `LOCK` and `CLOSE` rows must be captured before the locked `game_time_et`
- every row requires a book, line, odds, timestamp, and source hash
- only one final row is allowed per `pick_id` / `book` / `line_role`
- corrections append `CORRECTED_LINE_SNAPSHOT` and reference the prior line hash

Market-line verifier:

```bash
npm run projection:locked-forward:top200-premium:verify-market-lines
```

The verifier checks the market-line hash chain, joins every line row back to the lock ledger, verifies `locked_row_hash`, rejects duplicate final book/role snapshots, checks correction references, and rejects any lock/close line captured at or after game time.

Adversarial market-line verifier fixtures:

```bash
npm run projection:locked-forward:top200-premium:test-market-line-verifier
```

This generates temporary fixtures under `tmp/locked-forward-market-line-verifier-fixtures` and asserts the verifier catches unknown picks, wrong lock hashes, duplicate final line rows, bad corrections, missing books, missing odds, after-game timestamps, and broken line hashes.

## Performance Report

The joined report reads the three evidence ledgers and writes JSON/MD/CSV outputs:

```bash
npm run projection:locked-forward:top200-premium:verify-ledger
npm run projection:locked-forward:top200-premium:verify-market-lines
npm run projection:locked-forward:top200-premium:verify-settlements
npm run projection:locked-forward:top200-premium:report
```

Default outputs:

```text
exports/locked-forward/top-player-expanded-90-premium/performance-report.json
exports/locked-forward/top-player-expanded-90-premium/performance-report.md
exports/locked-forward/top-player-expanded-90-premium/performance-report.csv
```

Report fields include:

```text
pick_id
lock_id
locked_row_hash
result
actual_stat
book
lock_book_line
lock_book_odds
close_book_line
close_book_odds
clv
stake_units
profit_loss_units
roi_at_odds
settlement_hash
lock_line_hash
close_line_hash
```

The report is not a source of truth. It should be trusted only after all three verifiers pass. Multiple books create multiple priced book-slot rows for the same pick.

## Daily Audit Summary

The daily audit summary runs the three verifiers, regenerates the derived performance report, and writes a blunt status artifact:

```bash
npm run projection:locked-forward:top200-premium:audit-summary
```

Default outputs:

```text
exports/locked-forward/top-player-expanded-90-premium/audit-summary.json
exports/locked-forward/top-player-expanded-90-premium/audit-summary.md
```

The summary prints:

```text
LOCK LEDGER: PASS|FAIL
MARKET LINE LEDGER: PASS|FAIL
SETTLEMENT LEDGER: PASS|FAIL
PERFORMANCE REPORT GENERATED: PASS|FAIL
FORWARD PICKS: N
SETTLED PICKS: N
PRICED BOOK SLOTS: N
ROI: X%
CLV: X
OVERALL: PASS|FAIL
```

Pre-live daily sequence:

```bash
python scripts/export-top-player-200-current-slate-scores.py
npm run projection:locked-forward:top200-premium -- --dry-run
npm run projection:locked-forward:top200-premium
npm run projection:locked-forward:top200-premium:verify-ledger
npm run projection:locked-forward:top200-premium:capture-lines -- --dry-run
npm run projection:locked-forward:top200-premium:capture-lines
npm run projection:locked-forward:top200-premium:verify-market-lines
npm run projection:locked-forward:top200-premium:audit-summary
```

Postgame sequence:

```bash
npm run projection:locked-forward:top200-premium:settle -- --dry-run
npm run projection:locked-forward:top200-premium:settle
npm run projection:locked-forward:top200-premium:verify-settlements
npm run projection:locked-forward:top200-premium:report
npm run projection:locked-forward:top200-premium:audit-summary
```

The audit summary is also derived. If it changes while the three source ledgers do not, inspect report/audit code before making a model claim.

## Ledger Columns

Each locked pick includes:

```text
pick_id
lock_id
lock_mode
generated_at
slate_date
player
team
opponent
market
side
line
odds
sportsbook_source
model_lane
confidence_bucket
input_snapshot_id
input_score_artifact_sha256
model_artifact_sha256
rule_version
rule_source_sha256
exporter_script_sha256
git_commit_sha
git_branch
git_dirty
git_dirty_relevant_paths
result
win_loss_push_void
closing_line
closing_odds
clv
premium_pockets
previous_record_hash
record_hash
```

`result`, `win_loss_push_void`, `closing_line`, `closing_odds`, and `clv` stay pending until settled by a separate timestamped result/line-close join.

## Freeze Rule

```text
Model: Top Player 200 Expanded 90 Premium
Lane: holdout_stable_premium_90_six_per_day
No lane, pocket, threshold, or manual-exclusion changes during the forward window.
All picks must be logged before results.
Past-date rows are backfill only and do not count as locked-forward proof.
```
