# Final Player Prop Model V1

Generated: 2026-05-05T22:58:35.493Z
Mode: PREVIEW
Slate date ET: 2026-05-05
Current date ET: 2026-05-05

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

- Full board rows: 245/245
- Board coverage: 100.00%
- Candidates: 50
- Selected: 4
- Average estimated accuracy prior: 90.50%
- Average final score: 0.82
- Correlation multiplier: 0.9411
- Selected tiers: {"C":2,"S":1,"B":1}
- Full-board tiers: {"S":5,"C":212,"B":11,"D":17}
- Actions: {"SELECTED":4,"CANDIDATE":46,"COVERAGE":195}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | C | Marcus Smart | LAL@OKC | PRA | UNDER | 15.5 | 89.06% | 0.856 | projection_side_split | live_quality_router_v9 |
| 2 | S | Jarrett Allen | CLE@DET | REB | OVER | 7.5 | 93.70% | 0.828 | - | live_quality_router_v9; top200_premium_90 |
| 3 | B | Jaylin Williams | LAL@OKC | REB | OVER | 2.5 | 90.16% | 0.81 | low_projected_minutes | live_quality_router_v9; top200_meta_reliability; top200_primary |
| 4 | C | Cade Cunningham | CLE@DET | PA | UNDER | 37.5 | 89.06% | 0.786 | - | live_quality_router_v9 |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| S | Daniss Jenkins | RA | OVER | 4.5 | 0.675 | same_game_cap |
| S | Luguentz Dort | PTS | OVER | 7.5 | 0.69 | same_game_cap |
| S | Luguentz Dort | PA | OVER | 8.5 | 0.624 | same_game_cap |
| S | Alex Caruso | AST | OVER | 1.5 | 0.631 | same_game_cap |
| C | Marcus Smart | PA | UNDER | 12.5 | 0.729 | same_player_cap |
| C | Luke Kennard | PA | UNDER | 9.5 | 0.723 | same_game_cap |
| B | Deandre Ayton | REB | UNDER | 7.5 | 0.733 | same_game_cap |
| B | Marcus Smart | AST | UNDER | 2.5 | 0.739 | same_player_cap |
| C | Deandre Ayton | RA | UNDER | 8.5 | 0.721 | same_game_cap |
| C | Marcus Smart | RA | OVER | 5.5 | 0.72 | same_player_cap |
| B | Jaylon Tyson | THREES | OVER | 0.5 | 0.724 | same_game_cap |
| C | Deandre Ayton | PTS | OVER | 9.5 | 0.723 | same_game_cap |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Jalen Duren | PRA | OVER | 28.5 | 0.66 | projection_side_split |
| C | Jarrett Allen | PR | UNDER | 20.5 | 0.666 | projection_side_split |
| C | Chet Holmgren | PA | UNDER | 17.5 | 0.659 | projection_side_split; thin_projection_gap |
| C | Rui Hachimura | RA | OVER | 4.5 | 0.665 | - |
| C | Evan Mobley | RA | UNDER | 11.5 | 0.664 | projection_side_split |
| C | Ajay Mitchell | AST | UNDER | 3.5 | 0.682 | projection_side_split |
| C | James Harden | PR | UNDER | 23.5 | 0.664 | projection_side_split |
| C | James Harden | PRA | OVER | 30.5 | 0.657 | - |
| C | Cade Cunningham | PTS | UNDER | 27.5 | 0.68 | - |
| C | Cason Wallace | PA | UNDER | 9.5 | 0.656 | low_projected_minutes |
| C | Marcus Smart | PR | OVER | 12.5 | 0.661 | - |
| C | Ausar Thompson | PRA | UNDER | 19.5 | 0.655 | thin_projection_gap |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak or correlated picks.
- 2 selected pick(s) carry role, source, gap, or book-depth risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.

