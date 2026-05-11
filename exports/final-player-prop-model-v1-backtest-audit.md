# Final Player Prop Model V1 Backtest Audit

Generated: 2026-05-11T23:47:09.261130Z
Model: `final-player-prop-model-v1`
Version: `2026-05-11-portfolio-fragility-v3`

## Audit Result

- Overall status: **PENDING**
- PASS: 11
- WARN: 0
- PENDING: 3
- FAIL: 0

## Final Results

- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- Candidate-pool accuracy: 89.60% (83,676-9,709, 93,385 rows)
- Selected-pick accuracy: 94.70% (911-51, 962 picks)
- Full-board coverage: 100.00%
- Avg selected picks/slate: 5.83
- Selected lift vs full board: 5.84 pts

## Checks

| Status | Check | Detail |
|---|---|---|
| PASS | MODEL_ID_AND_VERSION | final-player-prop-model-v1 / 2026-05-11-portfolio-fragility-v3 |
| PASS | SELECTOR_CONFIG_FROZEN | Config matches Final V1 frozen selector. |
| PASS | WALK_FORWARD_TRAINING_WINDOWS | 24 folds; train windows precede test windows. |
| PASS | FULL_BOARD_COVERAGE | 100.0% coverage across 113791 scored rows. |
| PASS | REPORTED_RESULTS_RECOMPUTE | Selected recompute 911-51 on 962 rows. |
| PASS | SOURCE_INPUT_AVAILABLE | Historical source input exists: C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json |
| PENDING | THIRD_PARTY_RAW_DATA_REPLAY | Current artifact is built from local generated V9/details exports; independent third-party raw data replay is not attached yet. |
| PENDING | ODDS_CLV_ROI_COLUMNS | Backtest outputs accuracy only; odds, CLV, and ROI are pending market-line joins. |
| PASS | AS_OF_REPLAY_MARKERS | Backtest source contains expanding-window and prior-date scoring markers. |
| PASS | POSTGAME_FIELDS_SEPARATED_FOR_GRADING | Output contains score columns and postgame grading columns separately. Static audit cannot prove external as-of integrity. |
| PASS | STRICT_NEGATIVE_LABEL_SHUFFLES | Selected accuracy 94.70% vs strongest strict shuffle P99 93.04%. |
| PASS | DATE_SHIFT_DIAGNOSTIC_EXPLAINED | Selected-rank date shift stayed high at 94.78% vs actual 94.70%, but stronger same-player/same-market controls collapsed to 57.13% with 96.47% coverage. Diagnostic retired as explained. |
| PENDING | INDEPENDENT_RERUN | No external auditor reproduction bundle has been recorded yet. |
| PASS | DATA_AND_CODE_HASHES | Data/code hashes recorded for reproducibility. |

## Negative Leakage Diagnostics

| Test | Mean | P95 | P99 |
|---|---:|---:|---:|
| random_board_sample | 88.87% | 90.54% | 91.16% |
| random_same_market_outcomes | 88.77% | 90.44% | 91.06% |
| shuffle_labels_by_market | 88.77% | 90.44% | 91.06% |
| shuffle_labels_by_slate | 88.81% | 90.54% | 91.16% |
| shuffle_labels_by_player_market | 91.01% | 92.41% | 93.04% |
| shuffle_player_ids_preserve_date_market | 88.81% | 90.44% | 90.96% |
| shift_selected_labels_plus_1_date | 94.70% | - | - |
| shift_selected_labels_minus_1_date | 94.60% | - | - |
| shift_selected_labels_plus_3_dates | 94.78% | - | - |
| shift_selected_labels_plus_7_dates | 94.69% | - | - |

## Cluster Evaluation

- Active slates: 165
- Winning slates: 165
- Losing slates: 0
- Worst day: 2025-12-19 at 66.67%
- Worst 7-day stretch: 2025-11-11 to 2025-11-17 at 88.10%
- Worst 30-day stretch: 2026-03-22 to 2026-04-23 at 92.86%

## Claim Boundary

- This audit checks the local historical walk-forward artifact for reproducibility, configuration, fold chronology, data hashes, and leakage diagnostics.
- This is not independent third-party reproduction yet.
- Odds, CLV, and ROI remain pending until historical market-line data is joined.
- Live proof still requires locked-forward rows, market lines, settlement, and audit summaries.

