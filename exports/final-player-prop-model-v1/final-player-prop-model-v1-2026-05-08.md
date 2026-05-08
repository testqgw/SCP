# Final Player Prop Model V1

Generated: 2026-05-08T23:01:51.434Z
Mode: PREVIEW
Slate date ET: 2026-05-08
Current date ET: 2026-05-08

## Model Build

This is a correlation-aware meta-selector with the 2026-05-07 projection/confidence calibration and the 2026-05-06 portfolio guard. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and stricter portfolio guards that veto selected PR/PA legs, cap combo markets to one, and raise the selected score floor.

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

- Full board rows: 218/218
- Board coverage: 100.00%
- Candidates: 40
- Selectable candidate gate: live line plus 3+ books
- Projection-only board rows: 0
- Selected: 1
- Average estimated accuracy prior: 89.06%
- Average final score: 0.842
- Correlation multiplier: 1
- Selected tiers: {"C":1}
- Full-board tiers: {"S":2,"C":180,"B":2,"D":34}
- Actions: {"CANDIDATE":39,"SELECTED":1,"COVERAGE":178}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | C | Victor Wembanyama | SAS@MIN | PRA | UNDER | 41.5 | 89.06% | 0.842 | - | live_quality_router_v9 |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| S | Mikal Bridges | PA | UNDER | 17.5 | 0.787 | portfolio_guard_market_veto |
| S | Naz Reid | PA | OVER | 13.5 | 0.694 | portfolio_guard_market_veto |
| C | Miles McBride | PR | OVER | 13.5 | 0.836 | portfolio_guard_market_veto |
| C | Anthony Edwards | PRA | OVER | 31.5 | 0.782 | combo_market_cap |
| C | Anthony Edwards | PA | OVER | 26.5 | 0.787 | portfolio_guard_market_veto |
| C | Anthony Edwards | PR | OVER | 27.5 | 0.779 | portfolio_guard_market_veto |
| C | Victor Wembanyama | PTS | UNDER | 25.5 | 0.747 | same_player_cap |
| C | Victor Wembanyama | PR | OVER | 38.5 | 0.727 | portfolio_guard_market_veto |
| C | Anthony Edwards | PTS | OVER | 22.5 | 0.787 | below_min_score |
| C | De'Aaron Fox | PA | UNDER | 22.5 | 0.72 | portfolio_guard_market_veto |
| C | Miles McBride | PA | OVER | 12.5 | 0.807 | portfolio_guard_market_veto |
| B | Mitchell Robinson | PR | OVER | 11.5 | 0.805 | portfolio_guard_market_veto |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Julian Champagnie | PR | OVER | 13.5 | 0.69 | - |
| C | VJ Edgecombe | RA | UNDER | 8.5 | 0.777 | projection_side_split |
| C | Quentin Grimes | PA | UNDER | 8.5 | 0.777 | projection_side_split |
| C | Victor Wembanyama | THREES | UNDER | 2.5 | 0.706 | - |
| C | Keldon Johnson | RA | OVER | 4.5 | 0.685 | low_projected_minutes |
| C | Naz Reid | PRA | UNDER | 20 | 0.724 | thin_projection_gap |
| C | Joel Embiid | PRA | OVER | 38.5 | 0.767 | - |
| C | Quentin Grimes | RA | UNDER | 4.5 | 0.772 | projection_side_split |
| C | Victor Wembanyama | AST | UNDER | 3.5 | 0.702 | thin_projection_gap |
| C | VJ Edgecombe | PA | OVER | 16.5 | 0.772 | - |
| C | Dylan Harper | RA | OVER | 6.5 | 0.684 | - |
| C | Naz Reid | THREES | UNDER | 1.5 | 0.745 | projection_side_split; thin_projection_gap |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Selected picks must have a live line and 3+ books.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak, unavailable, or correlated picks.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.

