# Final V1 Date-Shift Explainer

Generated: 2026-05-12T04:30:45.486709Z

## Actual Selected Result

- Accuracy: 95.11%
- Record: 915-47
- Picks: 962

## Shift Summary

| Test | Accuracy | Record | Coverage | Same side | Same line bucket |
|---|---:|---:|---:|---:|---:|
| selected-rank date shift +1 | 95.13% | 898-46 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift -1 | 95.02% | 897-47 | 98.13% | 0.00% | 0.00% |
| selected-rank date shift +3 | 95.20% | 893-45 | 97.51% | 0.00% | 0.00% |
| selected-rank date shift +7 | 95.12% | 896-46 | 97.92% | 0.00% | 0.00% |
| same-player same-market shift +1 | 56.43% | 522-403 | 96.47% | 56.36% | 72.41% |
| same-player same-market shift -1 | 51.70% | 487-455 | 98.23% | 52.91% | 69.21% |
| same-player same-market shift +3 | 55.38% | 489-394 | 91.89% | 54.64% | 69.34% |
| same-player same-market shift +7 | 52.81% | 432-386 | 85.14% | 49.33% | 65.81% |
| same-player same-market line-bucket shift +1 | 56.48% | 523-403 | 96.47% | 57.33% | 96.01% |
| same-player same-market line-bucket shift -1 | 51.43% | 484-457 | 98.23% | 52.70% | 95.03% |
| same-player same-market line-bucket shift +3 | 53.17% | 470-414 | 91.89% | 53.96% | 96.72% |
| same-player same-market line-bucket shift +7 | 51.59% | 422-396 | 85.14% | 51.65% | 97.31% |

## Strongest Same-Player Same-Market Shift

- Test: same-player same-market line-bucket shift +1
- Accuracy: 56.48%
- Coverage: 96.47%
- Same line bucket: 96.01%

### By Market

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| PTS | 303 | 162 | 141 | 53.47 |
| REB | 255 | 147 | 108 | 57.65 |
| AST | 206 | 112 | 92 | 54.90 |
| PRA | 139 | 84 | 55 | 60.43 |
| RA | 13 | 9 | 4 | 69.23 |
| THREES | 12 | 9 | 3 | 75.00 |

### By Prior Bucket

| bucket | samples | wins | losses | accuracyPct |
|---|---|---|---|---|
| 90-92 | 516 | 291 | 225 | 56.40 |
| 94+ | 283 | 157 | 125 | 55.67 |
| 92-94 | 128 | 74 | 53 | 58.27 |
| 88-90 | 1 | 1 | 0 | 100.00 |

### Top Shifted Winning Players

| bucket | wins | sharePct |
|---|---|---|
| Justin Champagnie | 10 | 1.91 |
| Ryan Rollins | 9 | 1.72 |
| Ryan Dunn | 9 | 1.72 |
| Kawhi Leonard | 9 | 1.72 |
| Scottie Barnes | 8 | 1.53 |
| Quentin Grimes | 8 | 1.53 |
| Luka Dončić | 8 | 1.53 |
| Evan Mobley | 8 | 1.53 |
| Kyle Filipowski | 8 | 1.53 |
| VJ Edgecombe | 7 | 1.34 |

## Interpretation

- Selected-rank date shifts preserve the selected slice and are stability diagnostics, not strict leakage tests.
- Same-player same-market shifts regrade the original side/line against nearby actual stat outcomes for the same player and market.
- High same-player same-market shifted accuracy points toward stable player/market pockets; low availability or suspicious exact-row matches would be more concerning.
- This report explains the selected-rank date-shift diagnostic; it does not replace third-party as-of replay, odds/CLV/ROI grading, or live locked-forward proof.

