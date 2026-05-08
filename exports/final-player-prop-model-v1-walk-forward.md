# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-08T04:53:16.026875+00:00
Model version: `2026-05-08-accuracy90-ladder-v1`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- 90+ qualified-board accuracy: 90.37% (68,630-7,313, 75,943 rows; 66.74% board coverage)
- 90+ score-floor-board accuracy: 90.72% (45,923-4,696, 50,619 rows; 44.48% board coverage)
- Selected-pick accuracy: 93.95% (869-56, 925 picks)
- Candidate-pool accuracy: 89.60% (83,768-9,718, 93,486 rows)
- Avg selected picks per slate: 5.61
- Selected lift vs full board: 5.09 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 88.86% | 90.73% | 91.68% |
| 90+ qualified board | 90.37% | 92.14% | 93.24% |
| 90+ score-floor board | 90.72% | 92.41% | 93.39% |
| Candidate pool | 89.60% | 91.44% | 92.11% |
| Selected picks | 93.95% | 92.81% | 90.48% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 168 | 96.43% | 162-6 |
| PRA | 147 | 93.88% | 138-9 |
| PTS | 325 | 93.54% | 304-21 |
| RA | 17 | 94.12% | 16-1 |
| REB | 244 | 92.62% | 226-18 |
| THREES | 24 | 95.83% | 23-1 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 800 | 93.62% | 749-51 |
| B | 18 | 88.89% | 16-2 |
| C | 10 | 100.00% | 10-0 |
| S | 97 | 96.91% | 94-3 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-08 accuracy ladder keeps the full-board context intact and adds explicit 90+ qualified-board slices rather than relabeling the full board.
- The 2026-05-06 portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, and a selected score floor of 0.84.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.
