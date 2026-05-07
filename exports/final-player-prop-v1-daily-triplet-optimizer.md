# Final V1 Daily Three-Leg Combo Optimizer

Generated: 2026-05-07T01:07:44.322570Z
Recommended all-triplet rule: **daily_top6_under_else_top3_triplets_v1**
High-water one-triplet rule: **daily_top3_no_pts_pra_else_top3_triplets_v1**

## Recommended Rule

- For each slate, take up to the top 6 `UNDER` legs from the Final V1 selected set.
- If fewer than 3 `UNDER` legs exist, fall back to the top 3 overall Final V1 legs.
- Generate and grade **all three-leg combinations** from that daily set.

## Baseline Constraint

- All original selected legs: 111/162 perfect days, 68.52%.
- If a daily selected set contains one losing leg, at least one three-leg combo loses.

## Recommended Result

| Metric | Value |
|---|---:|
| activeDays | 162 |
| skippedDays | 3 |
| selectedLegs | 549 |
| avgSelectedLegsPerActiveDay | 3.39 |
| threeLegCombos | 406 |
| avgCombosPerActiveDay | 2.51 |
| dailyAllCombosHitDays | 131 |
| dailyAllCombosHitPct | 80.86% |
| comboWins | 348 |
| comboLosses | 58 |
| comboAccuracyPct | 85.71% |
| legAccuracyPct | 93.99% |

## High-Water Rule

| Metric | Value |
|---|---:|
| dailyAllCombosHitPct | 83.95% |
| dailyAllCombosHitDays | 136/162 |
| threeLegCombos | 162 |
| avgCombosPerActiveDay | 1.0 |

## Candidate Rules

| Rule | Days | Skipped | Legs | Avg Legs | Triplets | Daily All-Triplet Hit | Triplet Accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|
| daily_top3_no_pts_pra_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.95% | 83.95% |
| daily_top3_non_pts_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.33% | 83.33% |
| daily_top3_reb_ast_threes_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.33% | 83.33% |
| daily_top4_reb_ast_threes_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.33% | 83.33% |
| daily_top5_reb_ast_threes_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.33% | 83.33% |
| daily_top6_reb_ast_threes_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 83.33% | 83.33% |
| daily_top4_no_pts_pra_else_top3_triplets_v1 | 162 | 3 | 502 | 3.1 | 210 | 82.72% | 80.95% |
| daily_top5_no_pts_pra_else_top3_triplets_v1 | 162 | 3 | 502 | 3.1 | 210 | 82.72% | 80.95% |
| daily_top6_no_pts_pra_else_top3_triplets_v1 | 162 | 3 | 502 | 3.1 | 210 | 82.72% | 80.95% |
| daily_top3_singles_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 82.72% | 82.72% |
| daily_top3_non_combo_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 82.72% | 82.72% |
| daily_top3_under_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 82.10% | 82.10% |
| daily_top6_under_else_top3_triplets_v1 | 162 | 3 | 549 | 3.39 | 406 | 80.86% | 85.71% |
| daily_top5_under_else_top3_triplets_v1 | 162 | 3 | 548 | 3.38 | 396 | 80.86% | 85.35% |
| daily_top4_under_else_top3_triplets_v1 | 162 | 3 | 532 | 3.28 | 300 | 80.86% | 82.67% |
| top3_all_selected_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_non_pr_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_tier_a_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_score_0_90_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_score_0_88_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_score_0_86_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.86% | 80.86% |
| daily_top3_over_else_top3_triplets_v1 | 162 | 3 | 486 | 3.0 | 162 | 80.25% | 80.25% |
| daily_top4_non_pts_else_top3_triplets_v1 | 162 | 3 | 619 | 3.82 | 561 | 79.63% | 83.24% |
| daily_top5_non_pts_else_top3_triplets_v1 | 162 | 3 | 619 | 3.82 | 561 | 79.63% | 83.24% |
| daily_top6_non_pts_else_top3_triplets_v1 | 162 | 3 | 619 | 3.82 | 561 | 79.63% | 83.24% |
| daily_top6_score_0_90_else_top3_triplets_v1 | 162 | 3 | 581 | 3.59 | 537 | 79.01% | 81.75% |
| daily_top5_score_0_90_else_top3_triplets_v1 | 162 | 3 | 578 | 3.57 | 507 | 79.01% | 81.46% |
| daily_top4_score_0_90_else_top3_triplets_v1 | 162 | 3 | 555 | 3.43 | 369 | 79.01% | 81.03% |
| daily_top4_tier_a_else_top3_triplets_v1 | 162 | 3 | 628 | 3.88 | 588 | 78.40% | 82.65% |
| daily_top4_score_0_88_else_top3_triplets_v1 | 162 | 3 | 610 | 3.77 | 534 | 78.40% | 82.58% |
| top4_all_selected_triplets_v1 | 162 | 3 | 642 | 3.96 | 630 | 77.78% | 82.54% |
| daily_top4_non_pr_else_top3_triplets_v1 | 162 | 3 | 642 | 3.96 | 630 | 77.78% | 82.54% |
| daily_top4_score_0_86_else_top3_triplets_v1 | 162 | 3 | 634 | 3.91 | 606 | 77.78% | 82.84% |
| daily_top6_score_0_88_else_top3_triplets_v1 | 162 | 3 | 720 | 4.44 | 1322 | 77.16% | 82.98% |
| daily_top5_score_0_88_else_top3_triplets_v1 | 162 | 3 | 688 | 4.25 | 1002 | 77.16% | 82.63% |
| daily_top4_over_else_top3_triplets_v1 | 162 | 3 | 537 | 3.31 | 315 | 77.16% | 75.87% |
| daily_top4_singles_else_top3_triplets_v1 | 162 | 3 | 631 | 3.9 | 597 | 76.54% | 81.57% |
| daily_top4_non_combo_else_top3_triplets_v1 | 162 | 3 | 631 | 3.9 | 597 | 76.54% | 81.57% |
| daily_top5_over_else_top3_triplets_v1 | 162 | 3 | 545 | 3.36 | 363 | 76.54% | 76.58% |
| daily_top6_over_else_top3_triplets_v1 | 162 | 3 | 545 | 3.36 | 363 | 76.54% | 76.58% |
| daily_top5_score_0_86_else_top3_triplets_v1 | 162 | 3 | 762 | 4.7 | 1374 | 73.46% | 82.31% |
| daily_top5_tier_a_else_top3_triplets_v1 | 162 | 3 | 742 | 4.58 | 1272 | 73.46% | 82.39% |
| daily_top5_non_pr_else_top3_triplets_v1 | 162 | 3 | 787 | 4.86 | 1500 | 72.22% | 81.80% |
| daily_top5_singles_else_top3_triplets_v1 | 162 | 3 | 764 | 4.72 | 1395 | 72.22% | 82.22% |
| daily_top5_non_combo_else_top3_triplets_v1 | 162 | 3 | 764 | 4.72 | 1395 | 72.22% | 82.22% |
| daily_top6_singles_else_top3_triplets_v1 | 162 | 3 | 764 | 4.72 | 1395 | 72.22% | 82.22% |
| daily_top6_non_combo_else_top3_triplets_v1 | 162 | 3 | 764 | 4.72 | 1395 | 72.22% | 82.22% |
| daily_top6_score_0_86_else_top3_triplets_v1 | 162 | 3 | 854 | 5.27 | 2294 | 70.99% | 82.61% |
| daily_top6_tier_a_else_top3_triplets_v1 | 162 | 3 | 803 | 4.96 | 1882 | 70.37% | 82.57% |
| baseline_all_selected_all_three_leg_combos | 162 | 3 | 920 | 5.68 | 2830 | 68.52% | 82.23% |
| top6_all_selected_triplets_v1 | 162 | 3 | 920 | 5.68 | 2830 | 68.52% | 82.23% |
| daily_top6_non_pr_else_top3_triplets_v1 | 162 | 3 | 920 | 5.68 | 2830 | 68.52% | 82.23% |

## Interpretation

- This improves the daily all-three-leg-combo hit rate by changing the daily selected-leg set, not by selecting only one hand-picked triplet.
- The recommended rule grades every three-leg combination from the selected daily set and clears the 80% daily all-triplet target historically.
- The high-water top-3 rule has a higher daily hit rate, but it creates only one triplet per active day.
- This is a replay-selected card layer and needs locked-forward validation before being treated as proven live.
