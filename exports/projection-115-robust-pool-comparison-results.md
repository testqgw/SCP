# Projection 115 Robust Pool Comparison

Generated: 2026-04-29

## Decision

The current 115-player pool is accuracy-best, but it is not sample-robust. A robust no-tiny-sample pool gives more daily candidates, but the replay accuracy drops. I would not replace the live pool unless you prefer cleaner samples and more slate coverage over the current best hit rate.

## Summary

| Pool | Accuracy | Player-days | Correct / wrong | Warm accuracy | Tiny players <10 days | Avg warm days | Today shown | Today pool/slate | New players vs current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| current_quality_top115 | 83.54% | 3,154 | 2,635 / 519 | 84.22% | 35 | 26.29 | 5 | 12 | 0 |
| shrink35_min10warm12eligible | 82.46% | 5,062 | 4,174 / 888 | 83.18% | 0 | 42.14 | 11 | 17 | 38 |
| shrink50_min15warm20eligible | 82.04% | 5,557 | 4,559 / 998 | 82.70% | 0 | 46.33 | 13 | 22 | 53 |
| raw_quality_min30warm35eligible | 81.65% | 6,481 | 5,292 / 1,189 | 82.30% | 0 | 53.95 | 13 | 17 | 73 |
| raw_quality_min20warm25eligible | 81.43% | 6,022 | 4,904 / 1,118 | 82.02% | 0 | 50.16 | 12 | 18 | 63 |
| role_quality_min20warm10highmin | 81.30% | 6,690 | 5,439 / 1,251 | 81.86% | 0 | 55.70 | 13 | 16 | 78 |
| sample_weighted_min10warm12eligible | 81.10% | 7,445 | 6,038 / 1,407 | 81.60% | 0 | 62.03 | 19 | 21 | 80 |

## Best Robust Tradeoff

Best no-tiny-sample pool: `shrink35_min10warm12eligible`

- Accuracy: `82.46%` on `5,062` player-days
- Correct / wrong: `4,174 / 888`
- Tiny sample players: `0`
- Average warm eligible days: `42.14`
- New players vs current pool: `38`

On the live `2026-04-29` slate, this robust pool would show `11` players instead of the current pool's `5`.

Shown names in best robust pool:

- Anthony Black
- Cade Cunningham
- Daniss Jenkins
- Franz Wagner
- Goga Bitadze
- Javonte Green
- Collin Murray-Boyles
- Evan Mobley
- Sandro Mamukelashvili
- Dorian Finney-Smith
- Jaxson Hayes

## Why The Current Pool Looked Weird

The current formula trusted quality score too much and sample size too little. It has `35` players with fewer than `10` eligible days. That includes tiny-sample names near the top. The robust variants fix that, but the historical replay says those tiny-sample quality names helped the hit rate more than they hurt it.

## Recommendation

Keep the current pool live for now because it is the accuracy-best backtest. Add the robust pool as a candidate/research pool if you want a more intuitive daily slate with more familiar high-sample players. The best robust replacement is `shrink35_min10warm12eligible`, but it drops from `83.54%` to `82.46%`.
