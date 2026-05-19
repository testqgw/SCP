# Final Player Prop Model V1 Walk-Forward Backtest

Generated: 2026-05-18T23:42:15.269369+00:00
Model version: `2026-05-18-soft-context-rerank-v5`
Input: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\live-quality-full-season-router-v9-details.json`

## Headline

- Full-board coverage: 100.00%
- Full-board accuracy: 88.86% (101,113-12,678, 113,791 rows)
- 90+ qualified-board accuracy: 90.37% (68,630-7,313, 75,943 rows; 66.74% board coverage)
- 90+ score-floor-board accuracy: 90.75% (44,074-4,495, 48,569 rows; 42.68% board coverage)
- Selected-pick accuracy: 95.74% (921-41, 962 picks)
- Candidate-pool accuracy: 89.61% (83,834-9,719, 93,553 rows)
- Avg selected picks per slate: 5.83
- Selected lift vs full board: 6.88 pts

## Recent Windows

| Slice | Overall | Last 30 | Last 14 |
|---|---:|---:|---:|
| Full board | 88.86% | 90.73% | 91.68% |
| 90+ qualified board | 90.37% | 92.14% | 93.24% |
| 90+ score-floor board | 90.75% | 92.64% | 93.92% |
| Candidate pool | 89.61% | 91.45% | 92.13% |
| Selected picks | 95.74% | 94.64% | 94.44% |

## Selected By Market

| Market | Picks | Accuracy | Record |
|---|---:|---:|---:|
| AST | 216 | 95.83% | 207-9 |
| PRA | 148 | 95.27% | 141-7 |
| PTS | 317 | 95.58% | 303-14 |
| RA | 8 | 100.00% | 8-0 |
| REB | 260 | 95.77% | 249-11 |
| THREES | 13 | 100.00% | 13-0 |

## Selected By Tier

| Tier | Picks | Accuracy | Record |
|---|---:|---:|---:|
| A | 538 | 95.72% | 515-23 |
| B | 6 | 100.00% | 6-0 |
| C | 1 | 100.00% | 1-0 |
| S | 417 | 95.68% | 399-18 |

## Claim Boundary

- This is the first dedicated replay for the final selector as written.
- The 2026-05-18 soft-context rerank keeps the tier-first selector, then adds bounded game-context scoring, a small A-tier blowout-OVER downgrade, a small minutes-lift UNDER bump, plus explicit guards for thin counter-projection PTS unders, tiny auxiliary side pockets, ultra-thin non-premium projection gaps, low-total counting-under traps, and volatile REB OVER rows.
- The portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, selectable live-line requirements in production, fragility vetoes, and a selected score floor of 0.75.
- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.
- This is still historical replay, not locked-forward proof.
- ROI and CLV require the market-line and settlement ledgers.

