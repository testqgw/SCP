# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-10T19:02:58.287509+00:00
Model version: `2026-05-10-role-floor-context-v2`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- 90+ qualified-board accuracy: 90.37% (68,630-7,313, 75,943 rows; 66.74% board coverage)
- 90+ score-floor-board accuracy: 90.80% (44,408-4,497, 48,905 rows; 42.98% board coverage)
- Selected-pick accuracy: 94.28% (907-55, 962 picks)
- Candidate-pool accuracy: 89.60% (83,676-9,709, 93,385 rows)
- Avg selected picks per slate: 5.83
- Selected lift vs full board: 5.42 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 88.86% | 90.73% | 91.68% |
| 90+ qualified board | 90.37% | 92.14% | 93.24% |
| 90+ score-floor board | 90.80% | 92.67% | 93.94% |
| Candidate pool | 89.60% | 91.44% | 92.11% |
| Selected picks | 94.28% | 93.45% | 91.67% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 210 | 95.71% | 201-9 |
| PRA | 131 | 93.13% | 122-9 |
| PTS | 326 | 93.25% | 304-22 |
| RA | 20 | 95.00% | 19-1 |
| REB | 261 | 95.02% | 248-13 |
| THREES | 14 | 92.86% | 13-1 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 470 | 94.68% | 445-25 |
| B | 1 | 100.00% | 1-0 |
| S | 491 | 93.89% | 461-30 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-10 role-floor context calibration keeps the tier-first selector, then adds bounded game-context scoring for lineup confidence, minutes stability, spread/total environment, step-up role, stable-starter UNDER risk, and completeness.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

