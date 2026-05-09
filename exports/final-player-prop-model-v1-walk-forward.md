# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-09T22:26:13.542982+00:00
Model version: `2026-05-09-tier-first-selectable-live-lines-v2`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- 90+ qualified-board accuracy: 90.37% (68,630-7,313, 75,943 rows; 66.74% board coverage)
- 90+ score-floor-board accuracy: 90.79% (45,381-4,602, 49,983 rows; 43.93% board coverage)
- Selected-pick accuracy: 94.07% (905-57, 962 picks)
- Candidate-pool accuracy: 89.60% (83,768-9,718, 93,486 rows)
- Avg selected picks per slate: 5.83
- Selected lift vs full board: 5.21 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 88.86% | 90.73% | 91.68% |
| 90+ qualified board | 90.37% | 92.14% | 93.24% |
| 90+ score-floor board | 90.79% | 92.45% | 93.89% |
| Candidate pool | 89.60% | 91.44% | 92.11% |
| Selected picks | 94.07% | 93.45% | 94.44% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 209 | 95.69% | 200-9 |
| PRA | 132 | 92.42% | 122-10 |
| PTS | 325 | 92.92% | 302-23 |
| RA | 19 | 94.74% | 18-1 |
| REB | 264 | 95.08% | 251-13 |
| THREES | 13 | 92.31% | 12-1 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 470 | 94.47% | 444-26 |
| B | 1 | 100.00% | 1-0 |
| S | 491 | 93.69% | 460-31 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-09 tier-first calibration keeps the full-board context intact and ranks quality tier before small score differences in the final selected portfolio.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

