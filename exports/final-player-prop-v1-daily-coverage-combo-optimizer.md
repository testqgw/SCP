# Final V1 Daily Coverage Combo Optimizer

Generated: 2026-05-07T01:20:57.880925Z

## Rule

- Use the Final V1 selected picks in rank order.
- Two-leg cards: group rank chunks of 2 and leave only the odd final leg out.
- Three-leg cards: group rank chunks of 3 and leave only the unavoidable remainder out.
- This is a coverage-first card layer, not a filtered high-water combo layer.

## Coverage Results

| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |
|---|---|---:|---:|---:|---:|---:|
| 2-leg | rank_pair_cards_all_but_odd_v1 | 97.95% | 453 | 2.76 | 88.08% | 69.51% |
| 3-leg | rank_triplet_cards_all_but_remainder_v1 | 95.68% | 295 | 1.82 | 82.71% | 69.75% |

## Candidate Grouping Rules

| Rule | Size | Coverage | Used Legs | Unused Legs | Cards | Card Accuracy | Daily All-Card Hit |
|---|---:|---:|---:|---:|---:|---:|---:|
| rank_pair_cards_all_but_odd_v1 | 2 | 97.95% | 906 | 19 | 453 | 88.08% | 69.51% |
| top_bottom_pair_cards_all_but_odd_v1 | 2 | 97.95% | 906 | 19 | 453 | 88.08% | 69.51% |
| rank_triplet_cards_all_but_remainder_v1 | 3 | 95.68% | 885 | 40 | 295 | 82.71% | 69.75% |
| snake_triplet_cards_all_but_remainder_v1 | 3 | 95.68% | 885 | 40 | 295 | 82.37% | 69.75% |

## Interpretation

- This corrected layer uses almost the whole Final V1 selected card: 97.95% of legs for two-leg cards and 95.68% for three-leg cards.
- The daily all-card hit rate is lower than the filtered high-water layer because one used losing leg makes that day fail the all-card test.
- Pairing/grouping order can change card-level accuracy slightly, but it cannot change daily all-card hit unless different legs are excluded.
- This is historical replay evidence and still needs locked-forward tracking before live-edge claims.
