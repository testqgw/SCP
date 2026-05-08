# Final V1 Player-Tab Combo Optimizer

Generated: 2026-05-08T22:31:05.709465Z

## Rule

- Use the broader player-tab board, not the tiny Final V1 selected-card subset.
- Pick exactly one best market per player per date using the highest Final V1 board score.
- One-leg player-tab picks use all one-best-prop-per-player rows and clear the 90% historical accuracy target.
- Two-leg 90+ cards use C/S-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 2.
- Three-leg 90+ cards use C-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 3.
- Four-, five-, and six-leg 90+ cards use the stricter long-card lane: C/S-tier OVER legs in PTS/PRA/PA/PR/RA with Final V1 score >= 0.80, sorted by market and score before chunking.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 1-leg | player_tab_best_market_singles_90_v1 | 100.00% | 16742 | 101.47 | 91.79% | 1.82% |
| 2-leg | player_tab_cs_non_ast_score69_pairs_90_v1 | 24.70% | 2068 | 12.69 | 92.55% | 42.94% |
| 3-leg | player_tab_c_non_ast_score69_triplets_90_v1 | 21.38% | 1193 | 7.41 | 90.19% | 49.69% |
| 4-leg | player_tab_cs_over_pts_combo_score80_quartets_90_v2 | 4.28% | 179 | 1.72 | 91.06% | 84.62% |
| 5-leg | player_tab_cs_over_pts_combo_score80_quintets_90_v2 | 3.79% | 127 | 1.46 | 90.55% | 86.21% |
| 6-leg | player_tab_cs_over_pts_combo_score80_sextets_90_v2 | 3.55% | 99 | 1.3 | 90.91% | 88.16% |

## Interpretation

- This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.
- The 1-leg player-tab layer clears 90% while preserving all one-best-prop-per-player rows.
- The 2-leg, 3-leg, 4-leg, 5-leg, and 6-leg layers now clear the 90% historical card-accuracy target by trading away broad card coverage.
- The 4-leg through 6-leg layers are strict long-card lanes, not full-board coverage claims.
- Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
