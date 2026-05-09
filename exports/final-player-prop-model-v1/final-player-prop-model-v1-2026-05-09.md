# Final Player Prop Model V1

Generated: 2026-05-09T22:27:22.836Z
Mode: PREVIEW
Slate date ET: 2026-05-09
Current date ET: 2026-05-09

## Model Build

This is a correlation-aware meta-selector with the 2026-05-09 tier-first selection calibration and selectable-live-line gate. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and portfolio guards that veto selected PR/PA legs, cap combo markets to one, require live lines from 3+ books, and rank quality tier before small score differences.

## Claim Boundary

This is a projection-calibrated, portfolio-guarded final-model candidate engine, not a forward-proven betting model. It keeps full-board coverage, but selected picks now require a live line and 3+ books; locked-forward rows, market lines, settlements, and audit PASS are still required before live-edge claims.

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

- Full board rows: 235/235
- Board coverage: 100.00%
- Candidates: 48
- Selectable candidate gate: live line plus 3+ books
- Projection-only board rows: 0
- Selected: 4
- Average estimated accuracy prior: 89.47%
- Average final score: 0.803
- Correlation multiplier: 0.9506
- Selected tiers: {"B":2,"C":2}
- Full-board tiers: {"S":1,"B":13,"C":201,"D":20}
- Actions: {"CANDIDATE":44,"SELECTED":4,"COVERAGE":187}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | B | Marcus Smart | OKC@LAL | AST | UNDER | 3.5 | 90.16% | 0.834 | projection_side_split | live_quality_router_v9; top200_coverage_frontier; top200_recent_form_fade |
| 2 | C | Jarrett Allen | DET@CLE | RA | UNDER | 8.5 | 89.06% | 0.817 | projection_side_split | live_quality_router_v9 |
| 3 | B | Isaiah Joe | OKC@LAL | PTS | OVER | 3.5 | 89.61% | 0.797 | low_projected_minutes | live_quality_router_v9; top200_primary |
| 4 | C | Duncan Robinson | DET@CLE | THREES | OVER | 2.5 | 89.06% | 0.764 | - | live_quality_router_v9 |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| S | Alex Caruso | AST | OVER | 1.5 | 0.517 | same_game_cap |
| C | Chet Holmgren | PRA | UNDER | 27.5 | 0.728 | same_game_cap |
| C | Deandre Ayton | RA | OVER | 9.5 | 0.719 | same_game_cap |
| B | Deandre Ayton | REB | UNDER | 8.5 | 0.721 | same_game_cap |
| B | Ajay Mitchell | AST | UNDER | 3.5 | 0.711 | same_game_cap |
| C | Tobias Harris | PA | UNDER | 20.5 | 0.697 | portfolio_guard_market_veto |
| B | Jaylin Williams | THREES | OVER | 0.5 | 0.706 | same_game_cap |
| C | Isaiah Joe | PRA | OVER | 5.5 | 0.578 | same_player_cap |
| B | LeBron James | AST | UNDER | 7.5 | 0.702 | same_game_cap |
| C | Cade Cunningham | PRA | OVER | 41.5 | 0.69 | same_game_cap |
| C | Chet Holmgren | PA | UNDER | 18.5 | 0.707 | portfolio_guard_market_veto |
| C | Deandre Ayton | PR | OVER | 18.5 | 0.706 | portfolio_guard_market_veto |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Tobias Harris | PR | UNDER | 24.5 | 0.665 | - |
| C | Marcus Smart | PRA | OVER | 18.5 | 0.683 | - |
| C | Isaiah Hartenstein | RA | OVER | 11.5 | 0.547 | - |
| C | Chet Holmgren | PR | OVER | 25.5 | 0.552 | - |
| C | Tobias Harris | PTS | UNDER | 18 | 0.675 | - |
| C | Luguentz Dort | PA | UNDER | 7.5 | 0.681 | projection_side_split |
| C | Jaylon Tyson | PTS | OVER | 7.5 | 0.675 | low_projected_minutes; projection_side_split |
| C | Chet Holmgren | RA | OVER | 10.5 | 0.545 | - |
| C | LeBron James | PTS | UNDER | 22.5 | 0.675 | projection_side_split |
| C | Tobias Harris | PRA | OVER | 26.5 | 0.662 | projection_side_split |
| C | Ajay Mitchell | RA | UNDER | 7.5 | 0.674 | projection_side_split |
| C | Jalen Duren | PA | UNDER | 16.5 | 0.661 | - |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Selected picks must have a live line and 3+ books.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak, unavailable, or correlated picks.
- 3 selected pick(s) carry role, source, gap, or book-depth risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.

