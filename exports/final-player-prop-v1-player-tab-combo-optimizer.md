# Final V1 Player-Tab Combo Optimizer

Generated: 2026-05-09T22:29:29.249013Z

## Rule

- Use the broader player-tab board, not the tiny Final V1 selected-card subset.
- Pick exactly one best market per player per date using the highest Final V1 board score.
- One-leg player-tab picks use all one-best-prop-per-player rows and clear the 90% historical accuracy target.
- Two-leg 90+ cards use C/S-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 2.
- Three-leg 90+ cards use C-tier non-AST legs with Final V1 score >= 0.69, then cluster by tier/score/component signature before chunking by 3.
- Four-, five-, and six-leg 90+ cards use the stricter long-card lane: C/S-tier OVER legs in PTS/REB/PRA/PA/PR/RA with Final V1 score >= 0.82, clustered by tier/score/component before chunking.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 1-leg | player_tab_best_market_singles_90_v1 | 100.00% | 16742 | 101.47 | 91.53% | 1.21% |
| 2-leg | player_tab_cs_non_ast_score69_pairs_90_v1 | 25.17% | 2107 | 12.93 | 92.26% | 42.33% |
| 3-leg | player_tab_c_non_ast_score69_triplets_90_v1 | 21.04% | 1174 | 7.29 | 90.03% | 51.55% |
| 4-leg | player_tab_cs_over_long_reb_score82_quartets_90_v3 | 2.99% | 125 | 1.49 | 91.20% | 86.90% |
| 5-leg | player_tab_cs_over_long_reb_score82_quintets_90_v3 | 2.78% | 93 | 1.33 | 91.40% | 88.57% |
| 6-leg | player_tab_cs_over_long_reb_score82_sextets_90_v3 | 2.33% | 65 | 1.18 | 90.77% | 89.09% |

## Interpretation

- This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.
- The 1-leg player-tab layer clears 90% while preserving all one-best-prop-per-player rows.
- The 2-leg, 3-leg, 4-leg, 5-leg, and 6-leg layers now clear the 90% historical card-accuracy target by trading away broad card coverage.
- The 4-leg through 6-leg layers are strict long-card lanes, not full-board coverage claims.
- Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
