# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-22T03:07:05.137221+00:00
Model version: `2026-05-18-soft-context-rerank-v5`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\projection-backtest-allplayers-with-rows-live.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 53.69% (36,439-31,434, 67,873 rows)
- 90+ qualified-board accuracy: 56.60% (6,770-5,192, 11,962 rows; 17.62% board coverage)
- 90+ score-floor-board accuracy: 73.55% (698-251, 949 rows; 1.40% board coverage)
- Selected-pick accuracy: 79.15% (186-49, 235 picks)
- Candidate-pool accuracy: 68.49% (1,504-692, 2,196 rows)
- Avg selected picks per slate: 2.03
- Selected lift vs full board: 25.46 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 53.69% | 52.78% | 52.57% |
| 90+ qualified board | 56.60% | 54.45% | 53.57% |
| 90+ score-floor board | 73.55% | 72.81% | 74.42% |
| Candidate pool | 68.49% | 69.90% | 75.00% |
| Selected picks | 79.15% | 81.25% | 90.00% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 4 | 75.00% | 3-1 |
| PRA | 95 | 86.32% | 82-13 |
| PTS | 129 | 73.64% | 95-34 |
| RA | 1 | 100.00% | 1-0 |
| REB | 6 | 83.33% | 5-1 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 48 | 77.08% | 37-11 |
| B | 68 | 85.29% | 58-10 |
| C | 118 | 77.12% | 91-27 |
| S | 1 | 0.00% | 0-1 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-18 soft-context rerank keeps the tier-first selector, then adds bounded game-context scoring, a small A-tier blowout-OVER downgrade, a small minutes-lift UNDER bump, plus explicit guards for thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, and volatile REB OVER rows.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, fragility vetoes, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

