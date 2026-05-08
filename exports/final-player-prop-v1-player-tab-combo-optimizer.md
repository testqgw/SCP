# Final V1 Player-Tab Combo Optimizer

Generated: 2026-05-08T04:47:03.297611Z

## Rule

- Use the broader player-tab board, not the tiny Final V1 selected-card subset.
- Pick exactly one best market per player per date using the highest Final V1 board score.
- One-leg player-tab picks use all one-best-prop-per-player rows and clear the 90% historical accuracy target.
- Two-leg 90+ cards use C/S-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 2.
- Three-leg 90+ cards use C-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 3.
- Four-leg 90+ cards use C-tier legs with Final V1 score >= 0.84, sorted by market and score before chunking by 4.
- Five- and six-leg cards use the same C-tier score >= 0.84 pool. They improve accuracy versus the prior wide rules, but do not honestly clear 90% card-hit rate on a meaningful sample.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 1-leg | player_tab_best_market_singles_90_v1 | 100.00% | 16742 | 101.47 | 91.79% | 1.82% |
| 2-leg | player_tab_cs_non_ast_score69_pairs_90_v1 | 24.70% | 2068 | 12.69 | 92.55% | 42.94% |
| 3-leg | player_tab_c_non_ast_score69_triplets_90_v1 | 21.38% | 1193 | 7.41 | 90.19% | 49.69% |
| 4-leg | player_tab_c_score84_market_quartets_90_v1 | 2.56% | 107 | 1.53 | 91.59% | 88.57% |
| 5-leg | player_tab_c_score84_market_quintets_best_v1 | 2.42% | 81 | 1.45 | 88.89% | 83.93% |
| 6-leg | player_tab_c_score84_market_sextets_best_v1 | 1.76% | 49 | 1.36 | 81.63% | 75.00% |

## Interpretation

- This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.
- The 1-leg player-tab layer clears 90% while preserving all one-best-prop-per-player rows.
- The 2-leg, 3-leg, and 4-leg layers now clear the 90% historical card-accuracy target by trading away broad card coverage.
- The 5-leg and 6-leg layers are improved best-available long-card diagnostics, not 90% card-hit claims.
- Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
