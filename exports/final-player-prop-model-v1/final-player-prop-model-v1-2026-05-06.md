# Final Player Prop Model V1

Generated: 2026-05-07T00:41:08.140Z
Mode: PREVIEW
Slate date ET: 2026-05-06
Current date ET: 2026-05-06

## Model Build

This is a correlation-aware meta-selector with the 2026-05-06 portfolio guard. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and stricter portfolio guards that veto selected PR/PA legs, cap combo markets to one, and raise the selected score floor.

## Claim Boundary

This is a portfolio-guarded final-model candidate engine, not a forward-proven betting model. It keeps full-board coverage but applies a stricter selected-pick guard; locked-forward rows, market lines, settlements, and audit PASS are still required before live-edge claims.

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

- Full board rows: 225/225
- Board coverage: 100.00%
- Candidates: 55
- Selected: 2
- Average estimated accuracy prior: 91.66%
- Average final score: 0.852
- Correlation multiplier: 1
- Selected tiers: {"S":1,"C":1}
- Full-board tiers: {"S":2,"C":185,"B":5,"D":33}
- Actions: {"SELECTED":2,"CANDIDATE":53,"COVERAGE":170}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | S | Luke Kornet | MIN@SAS | REB | OVER | 3.5 | 94.25% | 0.855 | low_projected_minutes | live_quality_router_v9; top200_premium_90; top200_primary |
| 2 | C | Josh Hart | PHI@NYK | PRA | OVER | 25.5 | 89.06% | 0.848 | projection_side_split | live_quality_router_v9 |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| S | Andre Drummond | RA | OVER | 9.5 | 0.8 | combo_market_cap |
| C | Julius Randle | PA | UNDER | 22.5 | 0.828 | portfolio_guard_market_veto |
| B | Anthony Edwards | PTS | UNDER | 20.5 | 0.827 | below_min_score |
| C | Victor Wembanyama | PRA | UNDER | 42.5 | 0.775 | combo_market_cap |
| C | Victor Wembanyama | PTS | UNDER | 26.5 | 0.78 | below_min_score |
| C | Adem Bona | PR | OVER | 7.75 | 0.804 | portfolio_guard_market_veto |
| C | Andre Drummond | PRA | OVER | 16.5 | 0.794 | combo_market_cap |
| C | Andre Drummond | PR | OVER | 15.5 | 0.797 | portfolio_guard_market_veto |
| C | Josh Hart | PR | OVER | 20.5 | 0.619 | portfolio_guard_market_veto |
| C | Rudy Gobert | PA | UNDER | 9.5 | 0.808 | portfolio_guard_market_veto |
| C | Ayo Dosunmu | PTS | OVER | 10.5 | 0.801 | below_min_score |
| C | Victor Wembanyama | PA | UNDER | 30.5 | 0.753 | portfolio_guard_market_veto |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Victor Wembanyama | THREES | UNDER | 2.5 | 0.709 | - |
| C | Jose Alvarado | THREES | OVER | 0.5 | 0.709 | low_projected_minutes |
| C | Julius Randle | THREES | OVER | 1.5 | 0.754 | thin_projection_gap |
| C | De'Aaron Fox | PR | UNDER | 21.25 | 0.708 | projection_side_split |
| C | Jalen Brunson | PR | OVER | 29.5 | 0.56 | projection_side_split |
| C | Naz Reid | RA | OVER | 7.5 | 0.752 | - |
| C | Rudy Gobert | RA | UNDER | 12.5 | 0.752 | projection_side_split |
| C | Victor Wembanyama | RA | UNDER | 15.5 | 0.706 | thin_projection_gap |
| C | Rudy Gobert | PTS | OVER | 7.5 | 0.751 | - |
| C | OG Anunoby | RA | OVER | 7.5 | 0.557 | projection_side_split; thin_projection_gap |
| C | Ayo Dosunmu | RA | UNDER | 6.5 | 0.75 | projection_side_split |
| C | OG Anunoby | PA | OVER | 19.5 | 0.555 | projection_side_split |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak or correlated picks.
- 2 selected pick(s) carry role, source, gap, or book-depth risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.
