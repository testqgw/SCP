# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-21T20:00:28.660216+00:00
Model version: `2026-05-18-soft-context-rerank-v5`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\projection-backtest-allplayers-with-rows-live-team-context.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 53.69% (36,439-31,434, 67,873 rows)
- 90+ qualified-board accuracy: 55.09% (2,821-2,300, 5,121 rows; 7.54% board coverage)
- 90+ score-floor-board accuracy: 64.56% (204-112, 316 rows; 0.47% board coverage)
- Selected-pick accuracy: 60.98% (50-32, 82 picks)
- Candidate-pool accuracy: 62.37% (348-210, 558 rows)
- Avg selected picks per slate: 0.71
- Selected lift vs full board: 7.29 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 53.69% | 52.78% | 52.57% |
| 90+ qualified board | 55.09% | 65.89% | 75.51% |
| 90+ score-floor board | 64.56% | 60.00% | N/A |
| Candidate pool | 62.37% | 60.00% | N/A |
| Selected picks | 60.98% | 33.33% | N/A |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 1 | 0.00% | 0-1 |
| PRA | 51 | 62.75% | 32-19 |
| PTS | 25 | 56.00% | 14-11 |
| RA | 5 | 80.00% | 4-1 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 5 | 100.00% | 5-0 |
| B | 21 | 61.90% | 13-8 |
| C | 56 | 57.14% | 32-24 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-18 soft-context rerank keeps the tier-first selector, then adds bounded game-context scoring, a small A-tier blowout-OVER downgrade, a small minutes-lift UNDER bump, plus explicit guards for thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, and volatile REB OVER rows.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, fragility vetoes, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

