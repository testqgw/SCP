# Final V1 Daily Two-Leg Combo Optimizer

Generated: 2026-05-04T23:42:17.042294Z
Recommended rule: **daily_top3_non_pts_else_top2_combo_v1**

## Rule

- For each slate, remove `PTS` from the Final V1 selected set.
- Take the top 3 remaining legs by Final V1 rank.
- If fewer than 2 non-PTS legs remain, fall back to the top 2 overall Final V1 legs.
- Generate and grade **all two-leg combinations** from that daily set.

## Baseline Constraint

- All original selected legs: 112/165 perfect days, 67.88%.
- If a daily selected set contains one losing leg, at least one two-leg combo loses.

## Recommended Result

| Metric | Value |
|---|---:|
| activeDays | 165 |
| skippedDays | 0 |
| selectedLegs | 488 |
| avgSelectedLegsPerActiveDay | 2.96 |
| twoLegCombos | 481 |
| avgCombosPerActiveDay | 2.92 |
| dailyAllCombosHitDays | 135 |
| dailyAllCombosHitPct | 81.82% |
| comboWins | 419 |
| comboLosses | 62 |
| comboAccuracyPct | 87.11% |
| legAccuracyPct | 93.24% |

## Candidate Rules

| Rule | Days | Skipped | Legs | Avg Legs | Combos | Daily All-Combo Hit | Combo Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|
| daily_top3_singles_else_top2_combo_v1 | 162 | 3 | 478 | 2.95 | 470 | 82.10% | 87.66% |
| daily_top3_non_pts_else_top2_combo_v1 | 165 | 0 | 488 | 2.96 | 481 | 81.82% | 87.11% |
| daily_top3_under_else_top2_combo_v1 | 165 | 0 | 447 | 2.71 | 399 | 81.82% | 85.71% |
| daily_top3_non_pr_else_top2_combo_v1 | 165 | 0 | 491 | 2.98 | 487 | 81.21% | 87.27% |
| daily_top3_over_else_top2_combo_v1 | 165 | 0 | 423 | 2.56 | 351 | 81.21% | 85.47% |
| daily_top3_tier_a_else_top2_combo_v1 | 165 | 0 | 489 | 2.96 | 483 | 80.00% | 86.54% |
| daily_top3_score_0_90_else_top2_combo_v1 | 165 | 0 | 481 | 2.92 | 467 | 80.00% | 86.08% |
| top3_all_selected_combo_v1 | 165 | 0 | 492 | 2.98 | 489 | 78.79% | 85.89% |
| top4_all_selected_combo_v1 | 165 | 0 | 654 | 3.96 | 975 | 73.33% | 86.26% |
| baseline_all_selected_all_two_leg_combos | 165 | 0 | 962 | 5.83 | 2361 | 67.88% | 87.08% |
| top6_all_selected_combo_v1 | 165 | 0 | 962 | 5.83 | 2361 | 67.88% | 87.08% |

## Interpretation

- This improves the daily all-two-leg-combo hit rate by changing the daily selected-leg set, not by using only one pair.
- The recommended rule still fires on every historical active date and grades every two-leg combination from the selected daily set.
- This is a replay-selected card layer and needs locked-forward validation before being treated as proven live.
