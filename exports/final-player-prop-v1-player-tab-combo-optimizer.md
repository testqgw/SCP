# Final V1 Player-Tab Combo Optimizer

Generated: 2026-05-07T02:35:12.817681Z

## Rule

- Use the broader player-tab board, not the tiny Final V1 selected-card subset.
- Pick exactly one best market per player per date using the highest Final V1 board score.
- Two-leg cards group the player-tab picks in rank chunks of 2 and leave only the odd final leg out.
- Three-leg premium cards require Final V1 score >= 0.70, remove tier B, 3PM, and baseline-source rows, then cluster by tier/score-bucket/component signature before chunking by 3.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 2-leg | player_tab_rank_pair_cards_all_but_odd_v1 | 99.50% | 8329 | 50.48 | 84.32% | 1.82% |
| 3-leg | player_tab_premium_game_component_triplets_v2 | 79.26% | 4423 | 26.81 | 80.58% | 3.64% |

## Interpretation

- This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.
- It covers 99.50% of player-tab picks for two-leg cards.
- The 3-leg layer is now a premium guard: score < 0.70, tier B, 3PM, and baseline-source rows are excluded before tier/score/component clustering, so coverage drops but card accuracy clears the 80% target.
- Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
