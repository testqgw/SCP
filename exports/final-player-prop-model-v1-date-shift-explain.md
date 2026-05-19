# Final V1 Date-Shift Explainer

Generated: 2026-05-18T23:42:31.018061Z

## Actual Selected Result

- Accuracy: 95.74%
- Record: 921-41
- Picks: 962

## Shift Summary

| Test | Accuracy | Record | Coverage | Same side | Same line bucket |
|---|---:|---:|---:|---:|---:|
| selected-rank date shift +1 | 95.76% | 904-40 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift -1 | 95.66% | 903-41 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift +3 | 95.74% | 898-40 | 97.51% | 0.00% | 0.00% |
| selected-rank date shift +7 | 95.75% | 902-40 | 97.92% | 0.00% | 0.00% |
| same-player same-market shift +1 | 56.59% | 524-402 | 96.67% | 56.45% | 71.61% |
| same-player same-market shift -1 | 51.86% | 488-453 | 98.13% | 53.18% | 68.22% |
| same-player same-market shift +3 | 54.37% | 479-402 | 91.79% | 54.70% | 67.38% |
| same-player same-market shift +7 | 51.72% | 421-393 | 84.72% | 49.33% | 65.15% |
| same-player same-market line-bucket shift +1 | 55.66% | 516-411 | 96.67% | 57.63% | 96.24% |
| same-player same-market line-bucket shift -1 | 51.54% | 484-455 | 98.13% | 53.07% | 95.13% |
| same-player same-market line-bucket shift +3 | 51.98% | 459-424 | 91.79% | 54.25% | 96.94% |
| same-player same-market line-bucket shift +7 | 50.12% | 408-406 | 84.72% | 51.17% | 97.30% |

## Strongest Same-Player Same-Market Shift

- Test: same-player same-market shift +1
- Accuracy: 56.59%
- Coverage: 96.67%
- Same line bucket: 71.61%

### By Market

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| PTS | 302 | 159 | 143 | 52.65 |
| REB | 253 | 146 | 107 | 57.71 |
| AST | 209 | 115 | 90 | 56.10 |
| PRA | 145 | 89 | 56 | 61.38 |
| THREES | 13 | 10 | 3 | 76.92 |
| RA | 8 | 5 | 3 | 62.50 |

### By Prior Bucket

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| 90-92 | 518 | 288 | 228 | 55.81 |
| 94+ | 283 | 159 | 123 | 56.38 |
| 92-94 | 128 | 76 | 51 | 59.84 |
| 88-90 | 1 | 1 | 0 | 100.00 |

### Top Shifted Winning Players

| bucket | wins | sharePct |
|---|---|---|
| Jeremiah Fears | 10 | 1.91 |
| Ryan Dunn | 9 | 1.72 |
| VJ Edgecombe | 8 | 1.53 |
| Scottie Barnes | 8 | 1.53 |
| Ryan Rollins | 8 | 1.53 |
| Kawhi Leonard | 8 | 1.53 |
| Kyle Filipowski | 8 | 1.53 |
| Justin Champagnie | 8 | 1.53 |
| Nickeil Alexander-Walker | 7 | 1.34 |
| Svi Mykhailiuk | 7 | 1.34 |

## Interpretation

- Selected-rank date shifts preserve the selected slice and are stability diagnostics, not strict leakage tests.
- Same-player same-market shifts regrade the original side/line against nearby actual stat outcomes for the same player and market.
- High same-player same-market shifted accuracy points toward stable player/market pockets; low availability or suspicious exact-row matches would be more concerning.
- This report explains the selected-rank date-shift diagnostic; it does not replace third-party as-of replay, odds/CLV/ROI grading, or live locked-forward proof.

