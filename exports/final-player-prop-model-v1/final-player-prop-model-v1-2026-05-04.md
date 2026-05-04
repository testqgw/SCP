# Final Player Prop Model V1

Generated: 2026-05-04T21:39:35.850Z
Mode: PREVIEW
Slate date ET: 2026-05-04
Current date ET: 2026-05-04

## Model Build

This is a new correlation-aware meta-selector. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and Precision Parlay portfolio rules for correlation control.

## Claim Boundary

This is a new final-model candidate engine, not a forward-proven betting model. It combines the strongest existing model components with portfolio correlation controls, but its own lock ledger/backtest must be established before claims move beyond research preview.

## Component Evidence

| Component | Role | Accuracy | Samples | Last 30 | Last 14 |
|---|---|---:|---:|---:|---:|
| holdout_stable_premium_90_six_per_day | candidate_source | 93.15% | 1065 | 94.86% | 93.44% |
| all_min200_premium_pts_over_agreement_sweet_spot | candidate_source | 91.00% | 100 | 94.87% | 100.00% |
| top200_sample_count | candidate_source | 86.32% | 212 | 92.59% | 95.24% |
| top200_meta_reliability_expanded | candidate_source | 83.11% | 4215 | 84.44% | 81.97% |
| all_min200_coverage_frontier_projection_disagreement | candidate_source | 82.73% | 1922 | 82.64% | 82.40% |
| top200_recent_form_projection_fade_under | candidate_source | 82.68% | 739 | 85.82% | 85.45% |
| top200_sample_count | candidate_source | 82.31% | 2431 | 80.26% | 81.74% |
| Precision Parlay / snapshot-parlay-precision-v1 | portfolio_advisor | 90.25% | 318 | 90.00% | 91.67% |
| Live Quality Full Season Router V9 | quality_router | 89.06% | 118688 | - | - |

## Portfolio Summary

- Full board rows: 226/226
- Board coverage: 100.00%
- Candidates: 49
- Selected: 4
- Average estimated accuracy prior: 89.33%
- Average final score: 0.83
- Correlation multiplier: 0.9411
- Selected tiers: {"B":1,"C":3}
- Full-board tiers: {"A":1,"B":7,"C":186,"D":32}
- Actions: {"CANDIDATE":45,"SELECTED":4,"COVERAGE":177}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | B | Luke Kornet | MIN@SAS | REB | OVER | 3.5 | 90.16% | 0.863 | low_projected_minutes | live_quality_router_v9; top200_meta_reliability; top200_primary |
| 2 | C | Andre Drummond | PHI@NYK | REB | OVER | 3.5 | 89.06% | 0.842 | low_projected_minutes | live_quality_router_v9 |
| 3 | C | Julius Randle | MIN@SAS | PA | UNDER | 22.5 | 89.06% | 0.828 | projection_side_split | live_quality_router_v9 |
| 4 | C | Mitchell Robinson | PHI@NYK | PR | OVER | 12.5 | 89.06% | 0.788 | low_projected_minutes; projection_side_split | live_quality_router_v9 |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| A | Harrison Barnes | THREES | OVER | 0.5 | 0.709 | same_game_cap |
| C | Victor Wembanyama | PTS | UNDER | 27.5 | 0.748 | same_game_cap |
| C | De'Aaron Fox | PA | UNDER | 23.5 | 0.711 | same_game_cap |
| C | Luke Kornet | RA | OVER | 4.5 | 0.705 | same_player_cap |
| C | Victor Wembanyama | PR | OVER | 39.5 | 0.699 | same_game_cap |
| C | Victor Wembanyama | PA | UNDER | 30.5 | 0.698 | same_game_cap |
| C | Andre Drummond | PR | OVER | 6 | 0.698 | same_player_cap |
| B | Anthony Edwards | PTS | UNDER | 21.5 | 0.718 | same_game_cap |
| C | Dylan Harper | PRA | UNDER | 15.5 | 0.697 | same_game_cap |
| C | Victor Wembanyama | PRA | OVER | 42.5 | 0.694 | same_game_cap |
| B | VJ Edgecombe | PTS | UNDER | 12.5 | 0.712 | same_game_cap |
| B | De'Aaron Fox | AST | UNDER | 5.5 | 0.706 | same_game_cap |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| D | Paul George | PA | UNDER | 18.5 | 0.661 | projection_side_split |
| C | Miles McBride | PTS | OVER | 7.5 | 0.555 | low_projected_minutes; projection_side_split |
| C | Joel Embiid | PR | UNDER | 35.5 | 0.66 | projection_side_split |
| C | Jose Alvarado | THREES | OVER | 0.5 | 0.684 | low_projected_minutes |
| C | Naz Reid | RA | OVER | 7.5 | 0.666 | - |
| C | Josh Hart | PA | UNDER | 16.5 | 0.66 | - |
| C | Stephon Castle | THREES | OVER | 1.5 | 0.684 | thin_projection_gap |
| C | Miles McBride | PA | UNDER | 8.5 | 0.659 | low_projected_minutes |
| C | Victor Wembanyama | AST | UNDER | 3.5 | 0.683 | thin_projection_gap |
| C | Karl-Anthony Towns | REB | OVER | 11.5 | 0.67 | projection_side_split; thin_projection_gap |
| C | Stephon Castle | REB | OVER | 5.5 | 0.67 | projection_side_split |
| C | Anthony Edwards | PRA | UNDER | 29.5 | 0.663 | projection_side_split |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak or correlated picks.
- 4 selected pick(s) carry role, source, gap, or book-depth risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.
