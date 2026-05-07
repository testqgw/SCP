# Final V1 Daily Two-Leg Combo Optimizer

Generated: 2026-05-07T00:37:25.278719Z
Recommended rule: **daily_top3_non_pts_else_top2_combo_v1**

## Rule

- For each slate, remove `PTS` from the Final V1 selected set.
- Take the top 3 remaining legs by Final V1 rank.
- If fewer than 2 non-PTS legs remain, fall back to the top 2 overall Final V1 legs.
- Generate and grade **all two-leg combinations** from that daily set.

## Baseline Constraint

- All original selected legs: 113/164 perfect days, 68.90%.
- If a daily selected set contains one losing leg, at least one two-leg combo loses.

## Recommended Result

| Metric | Value |
|---|---:|
| activeDays | 164 |
| skippedDays | 1 |
| selectedLegs | 473 |
| avgSelectedLegsPerActiveDay | 2.88 |
| twoLegCombos | 454 |
| avgCombosPerActiveDay | 2.77 |
| dailyAllCombosHitDays | 139 |
| dailyAllCombosHitPct | 84.76% |
| comboWins | 402 |
| comboLosses | 52 |
| comboAccuracyPct | 88.55% |
| legAccuracyPct | 94.29% |

## Candidate Rules

| Rule | Days | Skipped | Legs | Avg Legs | Combos | Daily All-Combo Hit | Combo Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|
| daily_top3_under_else_top2_combo_v1 | 164 | 1 | 425 | 2.59 | 358 | 87.80% | 90.22% |
| daily_top3_non_pts_else_top2_combo_v1 | 164 | 1 | 473 | 2.88 | 454 | 84.76% | 88.55% |
| daily_top3_over_else_top2_combo_v1 | 164 | 1 | 424 | 2.59 | 356 | 84.15% | 86.24% |
| daily_top3_singles_else_top2_combo_v1 | 162 | 3 | 480 | 2.96 | 474 | 82.72% | 88.19% |
| daily_top3_tier_a_else_top2_combo_v1 | 164 | 1 | 483 | 2.95 | 474 | 81.71% | 86.92% |
| daily_top3_non_pr_else_top2_combo_v1 | 164 | 1 | 490 | 2.99 | 488 | 81.10% | 87.09% |
| top3_all_selected_combo_v1 | 164 | 1 | 490 | 2.99 | 488 | 81.10% | 87.09% |
| daily_top3_score_0_90_else_top2_combo_v1 | 164 | 1 | 471 | 2.87 | 450 | 81.10% | 86.44% |
| top4_all_selected_combo_v1 | 164 | 1 | 646 | 3.94 | 956 | 78.05% | 88.28% |
| baseline_all_selected_all_two_leg_combos | 164 | 1 | 924 | 5.63 | 2201 | 68.90% | 87.96% |
| top6_all_selected_combo_v1 | 164 | 1 | 924 | 5.63 | 2201 | 68.90% | 87.96% |

## Interpretation

- This improves the daily all-two-leg-combo hit rate by changing the daily selected-leg set, not by using only one pair.
- The recommended rule still fires on every historical active date and grades every two-leg combination from the selected daily set.
- This is a replay-selected card layer and needs locked-forward validation before being treated as proven live.
