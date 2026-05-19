# Final V1 Third-Party As-Of Replay Audit

Generated: 2026-05-18T23:43:29.853354Z
Overall status: **PENDING**

## Checks

| Status | Check | Detail |
|---|---|---|
| PASS | SELECTED_BACKTEST_FILE | Selected-pick walk-forward file is present. |
| PASS | THIRD_PARTY_MARKET_LINES | External market-line report exists and found strict line/odds matches. |
| PENDING | MARKET_LINE_AS_OF_TIMESTAMPS | Matched market lines do not yet prove as-of timing with snapshot/game-time timestamps. |
| PENDING | CLOSING_LINE_CLV_FIELDS | Closing line/odds fields are missing or sparse, so CLV remains pending. |
| PENDING | AS_OF_REPLAY_MANIFEST | No as-of replay manifest exists yet. |
| PENDING | EXTERNAL_BOXSCORE_FILE | External box-score file is missing; independent result replay cannot run yet. |

## External Box-Score Replay

| Metric | Value |
|---|---:|
| selectedPicks | 962 |
| externalBoxscoreRows | 0 |
| matchedPicks | 0 |
| matchCoveragePct | 0.00% |
| actualValueAgreementPct | - |
| resultAgreementPct | - |
| externalAccuracyPct | - |

## Interpretation

- This command is intentionally strict: missing third-party box scores, missing as-of timestamps, or missing closing lines keep the audit PENDING.
- A PASS requires independent result replay plus market lines with timestamp evidence that the snapshots were available before game start.
- The command does not claim third-party as-of replay until external raw data and provenance are present.
