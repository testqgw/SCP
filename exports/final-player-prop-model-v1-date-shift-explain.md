# Final V1 Date-Shift Explainer

Generated: 2026-05-10T19:03:13.527233Z

## Actual Selected Result

- Accuracy: 94.28%
- Record: 907-55
- Picks: 962

## Shift Summary

| Test | Accuracy | Record | Coverage | Same side | Same line bucket |
|---|---:|---:|---:|---:|---:|
| selected-rank date shift +1 | 94.39% | 891-53 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift -1 | 94.17% | 889-55 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift +3 | 94.67% | 888-50 | 97.51% | 0.00% | 0.00% |
| selected-rank date shift +7 | 94.37% | 889-53 | 97.92% | 0.00% | 0.00% |
| same-player same-market shift +1 | 57.08% | 528-397 | 96.47% | 56.79% | 71.44% |
| same-player same-market shift -1 | 50.64% | 475-463 | 98.13% | 54.03% | 70.66% |
| same-player same-market shift +3 | 54.65% | 482-400 | 91.79% | 54.59% | 69.08% |
| same-player same-market shift +7 | 52.58% | 428-386 | 84.72% | 47.98% | 66.38% |
| same-player same-market line-bucket shift +1 | 57.13% | 529-397 | 96.47% | 57.87% | 95.80% |
| same-player same-market line-bucket shift -1 | 50.05% | 470-469 | 98.13% | 52.65% | 95.44% |
| same-player same-market line-bucket shift +3 | 52.21% | 461-422 | 91.79% | 53.91% | 96.49% |
| same-player same-market line-bucket shift +7 | 52.83% | 430-384 | 84.72% | 51.78% | 96.93% |

## Strongest Same-Player Same-Market Shift

- Test: same-player same-market line-bucket shift +1
- Accuracy: 57.13%
- Coverage: 96.47%
- Same line bucket: 95.80%

### By Market

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| PTS | 311 | 177 | 134 | 56.91 |
| REB | 255 | 146 | 109 | 57.25 |
| AST | 203 | 111 | 90 | 55.22 |
| PRA | 126 | 71 | 55 | 56.35 |
| RA | 19 | 15 | 4 | 78.95 |
| THREES | 14 | 9 | 5 | 64.29 |

### By Prior Bucket

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| 90-92 | 443 | 251 | 192 | 56.66 |
| 94+ | 361 | 207 | 153 | 57.50 |
| 92-94 | 124 | 71 | 52 | 57.72 |

### Top Shifted Winning Players

| bucket | wins | sharePct |
|---|---|---|
| Kawhi Leonard | 12 | 2.27 |
| Scottie Barnes | 11 | 2.08 |
| Collin Gillespie | 9 | 1.70 |
| Justin Champagnie | 9 | 1.70 |
| Khris Middleton | 8 | 1.51 |
| Payton Pritchard | 8 | 1.51 |
| Quentin Grimes | 8 | 1.51 |
| Ryan Dunn | 8 | 1.51 |
| Kyle Filipowski | 8 | 1.51 |
| Nickeil Alexander-Walker | 7 | 1.32 |

## Interpretation

- Selected-rank date shifts preserve the selected slice and are stability diagnostics, not strict leakage tests.
- Same-player same-market shifts regrade the original side/line against nearby actual stat outcomes for the same player and market.
- High same-player same-market shifted accuracy points toward stable player/market pockets; low availability or suspicious exact-row matches would be more concerning.
- This report explains the selected-rank date-shift diagnostic; it does not replace third-party as-of replay, odds/CLV/ROI grading, or live locked-forward proof.

