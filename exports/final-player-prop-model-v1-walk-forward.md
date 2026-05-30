# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-30T20:38:55.594159+00:00
Model version: `2026-05-30-context-trap-v8`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\projection-backtest-allplayers-with-rows-live.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 53.69% (36,439-31,434, 67,873 rows)
- 90+ qualified-board accuracy: 56.80% (7,256-5,518, 12,774 rows; 18.82% board coverage)
- 90+ score-floor-board accuracy: 71.34% (1,195-480, 1,675 rows; 2.47% board coverage)
- Selected-pick accuracy: 90.32% (56-6, 62 picks)
- Candidate-pool accuracy: 68.66% (1,593-727, 2,320 rows)
- Avg selected picks per slate: 0.53
- Selected lift vs full board: 36.63 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 53.69% | 52.78% | 52.57% |
| 90+ qualified board | 56.80% | 56.01% | 56.31% |
| 90+ score-floor board | 71.34% | 72.57% | 87.50% |
| Candidate pool | 68.66% | 69.44% | 75.44% |
| Selected picks | 90.32% | 87.50% | 100.00% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| PRA | 40 | 95.00% | 38-2 |
| PTS | 22 | 81.82% | 18-4 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 26 | 96.15% | 25-1 |
| B | 32 | 87.50% | 28-4 |
| C | 4 | 75.00% | 3-1 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-30 context-trap v8 rerank keeps the tier-first selector, then adds projected-minutes fallback, bounded game-context scoring, a small A-tier blowout-OVER downgrade, a small minutes-lift UNDER bump, plus explicit guards for unstable team-context nodes, projection-side splits, C-tier PTS unders, thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, and volatile REB OVER rows.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, fragility vetoes, and a selected score floor of 0.825.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

