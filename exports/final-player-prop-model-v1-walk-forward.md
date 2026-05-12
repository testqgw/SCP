# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-12T04:30:28.639223+00:00
Model version: `2026-05-12-context-trap-v4`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- 90+ qualified-board accuracy: 90.37% (68,630-7,313, 75,943 rows; 66.74% board coverage)
- 90+ score-floor-board accuracy: 90.80% (44,174-4,478, 48,652 rows; 42.76% board coverage)
- Selected-pick accuracy: 95.11% (915-47, 962 picks)
- Candidate-pool accuracy: 89.60% (83,676-9,709, 93,385 rows)
- Avg selected picks per slate: 5.83
- Selected lift vs full board: 6.25 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 88.86% | 90.73% | 91.68% |
| 90+ qualified board | 90.37% | 92.14% | 93.24% |
| 90+ score-floor board | 90.80% | 92.69% | 93.77% |
| Candidate pool | 89.60% | 91.44% | 92.11% |
| Selected picks | 95.11% | 94.64% | 93.06% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 212 | 95.75% | 203-9 |
| PRA | 143 | 93.71% | 134-9 |
| PTS | 319 | 95.30% | 304-15 |
| RA | 13 | 92.31% | 12-1 |
| REB | 263 | 95.06% | 250-13 |
| THREES | 12 | 100.00% | 12-0 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 538 | 94.61% | 509-29 |
| B | 6 | 100.00% | 6-0 |
| C | 1 | 100.00% | 1-0 |
| S | 417 | 95.68% | 399-18 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-12 context-trap calibration keeps the tier-first selector, then adds bounded game-context scoring plus explicit guards for thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, and volatile REB OVER rows.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, fragility vetoes, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

