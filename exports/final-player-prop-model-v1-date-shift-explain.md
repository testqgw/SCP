# Final V1 Date-Shift Explainer

Generated: 2026-05-11T23:47:03.826848Z

## Actual Selected Result

- Accuracy: 94.70%
- Record: 911-51
- Picks: 962

## Shift Summary

| Test | Accuracy | Record | Coverage | Same side | Same line bucket |
|---|---:|---:|---:|---:|---:|
| selected-rank date shift +1 | 94.70% | 894-50 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift -1 | 94.60% | 893-51 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift +3 | 94.78% | 889-49 | 97.51% | 0.00% | 0.00% |
| selected-rank date shift +7 | 94.69% | 892-50 | 97.92% | 0.00% | 0.00% |
| same-player same-market shift +1 | 56.65% | 524-401 | 96.47% | 56.25% | 72.63% |
| same-player same-market shift -1 | 51.86% | 488-453 | 98.23% | 52.91% | 69.21% |
| same-player same-market shift +3 | 55.44% | 489-393 | 91.79% | 54.59% | 69.08% |
| same-player same-market shift +7 | 52.45% | 428-388 | 84.93% | 49.08% | 65.36% |
| same-player same-market line-bucket shift +1 | 56.70% | 525-401 | 96.47% | 57.22% | 96.12% |
| same-player same-market line-bucket shift -1 | 52.34% | 492-448 | 98.23% | 53.23% | 94.92% |
| same-player same-market line-bucket shift +3 | 53.23% | 470-413 | 91.79% | 53.91% | 96.83% |
| same-player same-market line-bucket shift +7 | 51.23% | 418-398 | 84.93% | 51.41% | 97.43% |

## Strongest Same-Player Same-Market Shift

- Test: same-player same-market line-bucket shift +1
- Accuracy: 56.70%
- Coverage: 96.47%
- Same line bucket: 96.12%

### By Market

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| PTS | 303 | 164 | 139 | 54.13 |
| REB | 256 | 146 | 110 | 57.03 |
| AST | 206 | 113 | 91 | 55.39 |
| PRA | 138 | 84 | 54 | 60.87 |
| RA | 13 | 9 | 4 | 69.23 |
| THREES | 12 | 9 | 3 | 75.00 |

### By Prior Bucket

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| 90-92 | 514 | 292 | 222 | 56.81 |
| 94+ | 283 | 157 | 125 | 55.67 |
| 92-94 | 130 | 75 | 54 | 58.14 |
| 88-90 | 1 | 1 | 0 | 100.00 |

### Top Shifted Winning Players

| bucket | wins | sharePct |
|---|---|---|
| Ryan Rollins | 10 | 1.90 |
| Justin Champagnie | 10 | 1.90 |
| Ryan Dunn | 9 | 1.71 |
| Payton Pritchard | 8 | 1.52 |
| Scottie Barnes | 8 | 1.52 |
| Quentin Grimes | 8 | 1.52 |
| Luka Dončić | 8 | 1.52 |
| Kawhi Leonard | 8 | 1.52 |
| Kyle Filipowski | 8 | 1.52 |
| VJ Edgecombe | 7 | 1.33 |

## Interpretation

- Selected-rank date shifts preserve the selected slice and are stability diagnostics, not strict leakage tests.
- Same-player same-market shifts regrade the original side/line against nearby actual stat outcomes for the same player and market.
- High same-player same-market shifted accuracy points toward stable player/market pockets; low availability or suspicious exact-row matches would be more concerning.
- This report explains the selected-rank date-shift diagnostic; it does not replace third-party as-of replay, odds/CLV/ROI grading, or live locked-forward proof.

