# Final V1 Player-Tab Combo Optimizer

Generated: 2026-05-07T01:40:44.246738Z

## Rule

- Use the broader player-tab board, not the tiny Final V1 selected-card subset.
- Pick exactly one best market per player per date using the highest Final V1 board score.
- Two-leg cards group the player-tab picks in rank chunks of 2 and leave only the odd final leg out.
- Three-leg cards group the player-tab picks in rank chunks of 3 and leave only the unavoidable remainder out.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 2-leg | player_tab_rank_pair_cards_all_but_odd_v1 | 99.50% | 8329 | 50.48 | 84.32% | 1.82% |
| 3-leg | player_tab_rank_triplet_cards_all_but_remainder_v1 | 99.18% | 5535 | 33.55 | 77.63% | 1.82% |

## Interpretation

- This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.
- It covers 99.50% of player-tab picks for two-leg cards and 99.18% for three-leg cards; only odd/remainder legs are left out.
- Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
