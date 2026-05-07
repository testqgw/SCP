# Final Player Prop Model V1

Generated: 2026-05-07T23:37:05.125Z
Mode: PREVIEW
Slate date ET: 2026-05-07
Current date ET: 2026-05-07

## Model Build

This is a correlation-aware meta-selector with the 2026-05-07 projection/confidence calibration and the 2026-05-06 portfolio guard. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and stricter portfolio guards that veto selected PR/PA legs, cap combo markets to one, and raise the selected score floor.

## Claim Boundary

This is a projection-calibrated, portfolio-guarded final-model candidate engine, not a forward-proven betting model. It keeps full-board coverage but applies a stricter selected-pick guard; locked-forward rows, market lines, settlements, and audit PASS are still required before live-edge claims.

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

- Full board rows: 243/243
- Board coverage: 100.00%
- Candidates: 36
- Selected: 1
- Average estimated accuracy prior: 94.80%
- Average final score: 0.843
- Correlation multiplier: 1
- Selected tiers: {"S":1}
- Full-board tiers: {"S":2,"B":10,"C":211,"D":20}
- Actions: {"SELECTED":1,"CANDIDATE":35,"COVERAGE":207}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---|---|
| 1 | S | Deandre Ayton | LAL@OKC | REB | UNDER | 8.5 | 94.80% | 0.843 | projection_side_split | live_quality_router_v9; top200_premium_90; top200_coverage_frontier; top200_recent_form_fade |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| S | Alex Caruso | AST | OVER | 1.5 | 0.712 | below_min_score |
| B | Deandre Ayton | PTS | UNDER | 9.5 | 0.76 | same_player_cap |
| C | Deandre Ayton | RA | OVER | 9.5 | 0.749 | same_player_cap |
| C | Deandre Ayton | PRA | UNDER | 19.5 | 0.744 | same_player_cap |
| C | Evan Mobley | PRA | UNDER | 27.5 | 0.808 | below_min_score |
| B | Isaiah Joe | THREES | OVER | 1.5 | 0.782 | below_min_score |
| B | LeBron James | PTS | UNDER | 20.5 | 0.736 | below_min_score |
| C | Deandre Ayton | PR | OVER | 18.5 | 0.733 | portfolio_guard_market_veto |
| B | Marcus Smart | AST | UNDER | 3.5 | 0.731 | below_min_score |
| C | Cade Cunningham | PA | UNDER | 37.5 | 0.8 | portfolio_guard_market_veto |
| C | Isaiah Hartenstein | RA | OVER | 11.5 | 0.774 | below_min_score |
| B | Jaylin Williams | THREES | OVER | 0.5 | 0.773 | below_min_score |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Evan Mobley | THREES | OVER | 0.5 | 0.78 | thin_projection_gap |
| C | Jared McCain | PTS | OVER | 4.5 | 0.754 | low_projected_minutes; projection_side_split; thin_projection_gap |
| C | Caris LeVert | PRA | OVER | 4.5 | 0.779 | low_projected_minutes; minimum_book_depth |
| C | Jalen Duren | PR | UNDER | 26.5 | 0.779 | - |
| C | LeBron James | PR | UNDER | 27.5 | 0.706 | projection_side_split |
| C | Dean Wade | THREES | OVER | 1 | 0.776 | thin_projection_gap |
| C | Isaiah Stewart | PR | OVER | 6.5 | 0.775 | low_projected_minutes |
| C | Caris LeVert | PTS | OVER | 2.5 | 0.775 | low_projected_minutes |
| C | Rui Hachimura | RA | OVER | 4.5 | 0.704 | - |
| C | Jaylon Tyson | RA | OVER | 4.5 | 0.774 | low_projected_minutes |
| C | Austin Reaves | THREES | OVER | 1.5 | 0.703 | - |
| C | Luke Kennard | RA | UNDER | 4.5 | 0.703 | projection_side_split |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- The model intentionally underfilled rather than force weak or correlated picks.
- 1 selected pick(s) carry role, source, gap, or book-depth risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.

