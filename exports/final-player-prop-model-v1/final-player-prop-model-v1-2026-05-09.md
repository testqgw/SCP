# Final Player Prop Model V1

Generated: 2026-05-22T00:07:01.230Z
Mode: PREVIEW
Slate date ET: 2026-05-09
Current date ET: 2026-05-21

## Model Build

This is a correlation-aware meta-selector with the 2026-05-18 soft-context rerank calibration and selectable-live-line gate. It uses the Top Player 200 premium pockets as the precision core, controlled Top Player expansion lanes for extra volume, V9 as the quality-router context, and a bounded game-context layer plus soft score reranking for A-tier blowout OVERs and minutes-supported UNDERs, plus explicit guards for thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, volatile REB OVER rows, lineup status, availability, minutes stability, team form, teammate synergy, and high-stakes rotation risk.

## Claim Boundary

This is a projection-calibrated, context-aware, portfolio-guarded final-model candidate engine, not a forward-proven betting model. It keeps full-board coverage, but selected picks now require a live line and 3+ books; locked-forward rows, market lines, settlements, and audit PASS are still required before live-edge claims.

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
| Precision Parlay / snapshot-parlay-precision-v1 | portfolio_advisor | - | - | - | - |
| Live Quality Full Season Router V9 | quality_router | - | - | - | - |

## Portfolio Summary

- Full board rows: 235/235
- Board coverage: 100.00%
- Candidates: 7
- Selectable candidate gate: live line plus 3+ books
- Projection-only board rows: 0
- Selected: 2
- Average estimated accuracy prior: 83.00%
- Average final score: 0.78
- Average context score: 0.588
- Correlation multiplier: 1
- Selected tiers: {"B":2}
- Full-board tiers: {"B":7,"C":144,"D":84}
- Actions: {"SELECTED":2,"CANDIDATE":5,"COVERAGE":228}

## Selected Picks

| # | Tier | Player | Matchup | Market | Side | Line | Prior | Score | Context | Risk | Components |
|---:|---|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | B | Marcus Smart | OKC@LAL | AST | UNDER | 3.5 | 83.28% | 0.801 | 0.565 | projection_side_split; recent_form_mismatch | live_quality_router_v9; top200_coverage_frontier; top200_recent_form_fade |
| 2 | B | Cade Cunningham | DET@CLE | PTS | OVER | 26.5 | 82.73% | 0.759 | 0.61 | projection_side_split; recent_form_mismatch | live_quality_router_v9; top200_coverage_frontier |

## Watchlist

| Tier | Player | Market | Side | Line | Score | Rejection |
|---|---|---|---|---:|---:|---|
| B | Isaiah Joe | PTS | OVER | 3.5 | 0.731 | below_min_score |
| B | Jarrett Allen | PTS | UNDER | 11.5 | 0.726 | below_min_score |
| B | Donovan Mitchell | PTS | OVER | 26.5 | 0.725 | below_min_score |
| B | Ajay Mitchell | AST | UNDER | 3.5 | 0.723 | below_min_score |
| B | Isaiah Stewart | PR | OVER | 6.5 | 0.536 | portfolio_guard_market_veto |

## Full Coverage Board

Every scored row is included in the JSON and board CSV. The rows below are the top coverage rows after selected picks and candidates.

| Tier | Player | Market | Side | Line | Score | Risk |
|---|---|---|---|---:|---:|---|
| C | Chet Holmgren | PRA | UNDER | 27.5 | 0.73 | projection_side_split; minutes_trend_against_side; recent_form_mismatch |
| C | Deandre Ayton | RA | OVER | 9.5 | 0.683 | minutes_trend_against_side; recent_form_mismatch |
| C | Jarrett Allen | RA | UNDER | 8.5 | 0.724 | projection_side_split; auxiliary_side_sample_risk; recent_form_mismatch |
| C | Tobias Harris | PA | UNDER | 20.5 | 0.672 | minutes_trend_against_side; teammate_synergy_against_side; recent_form_mismatch |
| C | Isaiah Hartenstein | RA | OVER | 11.5 | 0.714 | recent_form_mismatch |
| C | Cade Cunningham | PRA | OVER | 41.5 | 0.535 | projection_side_split; recent_form_mismatch |
| C | Chet Holmgren | PA | UNDER | 18.5 | 0.709 | projection_side_split; minutes_trend_against_side; recent_form_mismatch |
| C | Luke Kennard | THREES | OVER | 1.5 | 0.662 | auxiliary_side_sample_risk; volatile_minutes; minutes_trend_against_side; recent_form_mismatch |
| C | Evan Mobley | PA | UNDER | 18.5 | 0.699 | projection_side_split; recent_form_mismatch |
| C | James Harden | RA | OVER | 11.5 | 0.698 | recent_form_mismatch |
| C | Deandre Ayton | PTS | OVER | 9.5 | 0.646 | minutes_trend_against_side; recent_form_mismatch |
| C | Cade Cunningham | PA | UNDER | 35.5 | 0.652 | minutes_trend_against_side; recent_form_mismatch |

## Correlation Rules

- One pick per player.
- Cap same team, same game, same market, and combo-market exposure.
- Selected picks must have a live line and 3+ books.
- Reject same-team double counting overs beyond the configured cap.
- Never force-fill to six picks if the clean portfolio underfills.

## Warnings

- Input score artifact is stale: slate 2026-05-09, current ET date 2026-05-21. Preview only.
- The model intentionally underfilled rather than force weak, unavailable, or correlated picks.
- 2 selected pick(s) carry role, source, gap, book-depth, or game-context risk flags.
- Estimated accuracy priors are component priors, not calibrated forward probabilities.

