# Final V1 Market Proof / ROI / CLV Audit

Generated: 2026-05-09T22:27:47.861607Z
Overall status: **WARN**

## Inputs

- Selected picks: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\final-player-prop-model-v1-walk-forward-selected.csv`
- External line file: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\historical-lines\all-players-all-markets-live.csv`
- Selected SHA256: `cb9c9893498bf99036310075b31deecf2197d0078c482d03aaf25dbd711e9308`
- Line SHA256: `cbfb3c453a4e119972b55d9ab45c21af101f4806d5a50e62197d57a72de83b51`

## Main Metrics

| Metric | Value |
|---|---:|
| Total selected picks | 962 |
| External line rows | 131142 |
| Strict exact-line matches with valid odds | 592 |
| Strict match coverage | 61.54% |
| Accuracy at external line | 95.10% |
| Profit units at 1u flat stake | 449.54 |
| ROI at odds | 75.94% |
| Avg American odds | -95.99 |
| As-of timestamp coverage | 0.00% |
| Closing line coverage | 0.00% |
| Avg side-aware line CLV | - |

## Match Status

| Status | Count | Share |
|---|---:|---:|
| NO_PLAYER_MARKET_LINE | 34 | 3.53% |
| MATCHED_EXACT_LINE_VALID_ODDS | 592 | 61.54% |
| NO_EXACT_LINE_MATCH | 326 | 33.89% |
| MATCHED_EXACT_LINE_INVALID_ODDS | 10 | 1.04% |

## By Market

| Market | Picks | Strict Matches | Coverage | Accuracy | Profit | ROI |
|---|---:|---:|---:|---:|---:|---:|
| PTS | 325 | 133 | 40.92% | 96.24% | 102.07 | 76.75% |
| REB | 264 | 154 | 58.33% | 95.45% | 110.71 | 71.89% |
| AST | 209 | 143 | 68.42% | 95.80% | 120.90 | 84.55% |
| PRA | 132 | 131 | 99.24% | 92.37% | 91.87 | 70.13% |
| RA | 19 | 19 | 100.00% | 94.74% | 13.74 | 72.30% |
| THREES | 13 | 12 | 92.31% | 100.00% | 10.24 | 85.36% |

## Matched vs Unmatched Bias Diagnostics

Internal accuracy compares the model's historical result labels for exact-line matched picks against the selected picks that did not exact-match the external line file.

### By Side

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| UNDER | 533 | 302 | 56.66% | 94.70% | 91.77% | 2.93% | 94.70% | 73.90% | -102.60 |
| OVER | 429 | 290 | 67.60% | 95.52% | 93.53% | 1.99% | 95.52% | 78.06% | -89.12 |

### By Tier

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| S | 491 | 284 | 57.84% | 96.13% | 90.34% | 5.79% | 96.13% | 78.48% | -88.63 |
| A | 470 | 307 | 65.32% | 94.14% | 95.09% | -0.95% | 94.14% | 73.59% | -102.68 |
| B | 1 | 1 | 100.00% | 100.00% | - | - | 100.00% | 73.26% | -136.50 |

### By Month

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | 186 | 106 | 56.99% | 96.23% | 91.25% | 4.98% | 96.23% | 81.58% | -84.52 |
| 2026-03 | 186 | 110 | 59.14% | 93.64% | 93.42% | 0.22% | 93.64% | 73.21% | -93.10 |
| 2025-11 | 170 | 113 | 66.47% | 95.58% | 89.47% | 6.11% | 95.58% | 77.09% | -91.67 |
| 2025-12 | 168 | 108 | 64.29% | 95.37% | 88.33% | 7.04% | 95.37% | 75.04% | -99.31 |
| 2026-02 | 132 | 82 | 62.12% | 96.34% | 98.00% | -1.66% | 96.34% | 77.29% | -105.40 |
| 2026-04 | 108 | 64 | 59.26% | 92.19% | 97.73% | -5.54% | 92.19% | 68.13% | -108.98 |
| 2025-10 | 12 | 9 | 75.00% | 100.00% | 66.67% | 33.33% | 100.00% | 82.23% | -102.78 |

### By Line Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <5 | 311 | 233 | 74.92% | 96.14% | 93.59% | 2.55% | 96.14% | 81.32% | -58.86 |
| 5-9.5 | 226 | 116 | 51.33% | 95.69% | 94.55% | 1.14% | 95.69% | 72.42% | -120.91 |
| 10-14.5 | 137 | 60 | 43.80% | 95.00% | 89.61% | 5.39% | 95.00% | 73.31% | -121.83 |
| 15-19.5 | 100 | 46 | 46.00% | 97.83% | 94.44% | 3.39% | 97.83% | 79.70% | -119.90 |
| 20-24.5 | 74 | 40 | 54.05% | 92.50% | 85.29% | 7.21% | 92.50% | 70.75% | -118.92 |
| 30+ | 69 | 66 | 95.65% | 90.91% | 100.00% | -9.09% | 90.91% | 67.82% | -118.42 |
| 25-29.5 | 45 | 31 | 68.89% | 93.55% | 92.86% | 0.69% | 93.55% | 72.10% | -119.05 |

### By Prior Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90-92 | 471 | 308 | 65.39% | 94.16% | 95.09% | -0.93% | 94.16% | 73.59% | -102.79 |
| 94+ | 363 | 174 | 47.93% | 94.83% | 89.95% | 4.88% | 94.83% | 77.37% | -86.57 |
| 92-94 | 128 | 110 | 85.94% | 98.18% | 94.44% | 3.74% | 98.18% | 80.23% | -91.89 |

### By Final Score Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.90+ | 399 | 256 | 64.16% | 94.92% | 94.41% | 0.51% | 94.92% | 74.30% | -114.90 |
| 0.85-0.90 | 360 | 188 | 52.22% | 93.62% | 91.86% | 1.76% | 93.62% | 74.66% | -83.82 |
| 0.80-0.85 | 174 | 131 | 75.29% | 96.95% | 86.05% | 10.90% | 96.95% | 79.79% | -78.62 |
| 0.75-0.80 | 29 | 17 | 58.62% | 100.00% | 100.00% | 0.00% | 100.00% | 84.95% | -79.74 |

### By Team

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PHX | 48 | 31 | 64.58% | 96.77% | 94.12% | 2.65% | 96.77% | 85.45% | -57.10 |
| BOS | 43 | 20 | 46.51% | 95.00% | 100.00% | -5.00% | 95.00% | 70.95% | -127.30 |
| SAS | 43 | 19 | 44.19% | 89.47% | 91.67% | -2.20% | 89.47% | 62.64% | -115.32 |
| TOR | 43 | 29 | 67.44% | 93.10% | 92.86% | 0.24% | 93.10% | 74.40% | -83.50 |
| DET | 42 | 29 | 69.05% | 89.66% | 84.62% | 5.04% | 89.66% | 65.20% | -90.03 |
| UTA | 42 | 30 | 71.43% | 100.00% | 91.67% | 8.33% | 100.00% | 81.42% | -99.80 |
| LAC | 38 | 32 | 84.21% | 93.75% | 83.33% | 10.42% | 93.75% | 73.85% | -101.97 |
| ATL | 36 | 23 | 63.89% | 95.65% | 84.62% | 11.03% | 95.65% | 77.73% | -104.57 |
| NYK | 36 | 21 | 58.33% | 90.48% | 93.33% | -2.85% | 90.48% | 61.24% | -128.57 |
| WAS | 36 | 28 | 77.78% | 100.00% | 87.50% | 12.50% | 100.00% | 96.50% | -29.93 |
| MIL | 33 | 21 | 63.64% | 90.48% | 91.67% | -1.19% | 90.48% | 70.31% | -70.19 |
| OKC | 33 | 15 | 45.45% | 100.00% | 94.44% | 5.56% | 100.00% | 85.97% | -80.20 |
| SAC | 33 | 20 | 60.61% | 95.00% | 100.00% | -5.00% | 95.00% | 76.29% | -109.95 |
| CHI | 32 | 16 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 88.17% | -79.88 |
| HOU | 32 | 17 | 53.12% | 100.00% | 80.00% | 20.00% | 100.00% | 80.38% | -126.12 |
| LAL | 31 | 21 | 67.74% | 100.00% | 100.00% | 0.00% | 100.00% | 84.36% | -110.00 |
| CLE | 30 | 21 | 70.00% | 100.00% | 88.89% | 11.11% | 100.00% | 85.60% | -92.55 |
| GSW | 30 | 21 | 70.00% | 100.00% | 88.89% | 11.11% | 100.00% | 77.77% | -130.19 |
| ORL | 30 | 17 | 56.67% | 100.00% | 92.31% | 7.69% | 100.00% | 84.83% | -97.65 |
| POR | 30 | 21 | 70.00% | 95.24% | 77.78% | 17.46% | 95.24% | 72.61% | -116.62 |

### Top Player Buckets

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Kawhi Leonard | 20 | 15 | 75.00% | 86.67% | 80.00% | 6.67% | 86.67% | 60.97% | -117.00 |
| Justin Champagnie | 17 | 15 | 88.24% | 100.00% | 100.00% | 0.00% | 100.00% | 111.03% | 29.93 |
| Payton Pritchard | 16 | 11 | 68.75% | 90.91% | 100.00% | -9.09% | 90.91% | 64.96% | -123.64 |
| Evan Mobley | 15 | 10 | 66.67% | 100.00% | 100.00% | 0.00% | 100.00% | 89.66% | -94.20 |
| Ryan Dunn | 15 | 14 | 93.33% | 100.00% | 100.00% | 0.00% | 100.00% | 106.20% | 1.89 |
| Ryan Rollins | 15 | 10 | 66.67% | 80.00% | 100.00% | -20.00% | 80.00% | 48.52% | -98.20 |
| Scottie Barnes | 15 | 11 | 73.33% | 90.91% | 100.00% | -9.09% | 90.91% | 68.54% | -102.00 |
| Kyle Filipowski | 13 | 8 | 61.54% | 100.00% | 100.00% | 0.00% | 100.00% | 84.14% | -95.12 |
| Svi Mykhailiuk | 12 | 12 | 100.00% | 100.00% | - | - | 100.00% | 75.58% | -121.04 |
| VJ Edgecombe | 12 | 5 | 41.67% | 100.00% | 100.00% | 0.00% | 100.00% | 85.94% | -80.70 |
| Bobby Portis | 11 | 5 | 45.45% | 100.00% | 83.33% | 16.67% | 100.00% | 99.24% | -24.80 |
| Corey Kispert | 11 | 10 | 90.91% | 100.00% | 100.00% | 0.00% | 100.00% | 79.51% | -109.50 |
| Deni Avdija | 11 | 9 | 81.82% | 100.00% | 100.00% | 0.00% | 100.00% | 85.22% | -117.39 |
| Luka Dončić | 11 | 7 | 63.64% | 100.00% | 100.00% | 0.00% | 100.00% | 84.27% | -119.21 |
| Nickeil Alexander-Walker | 11 | 9 | 81.82% | 88.89% | 50.00% | 38.89% | 88.89% | 58.82% | -131.67 |
| Nikola Jokić | 11 | 8 | 72.73% | 75.00% | 100.00% | -25.00% | 75.00% | 37.36% | -120.12 |
| Quentin Grimes | 11 | 9 | 81.82% | 88.89% | 50.00% | 38.89% | 88.89% | 66.09% | -95.61 |
| Russell Westbrook | 11 | 9 | 81.82% | 100.00% | 100.00% | 0.00% | 100.00% | 81.76% | -122.89 |
| Collin Gillespie | 10 | 3 | 30.00% | 100.00% | 100.00% | 0.00% | 100.00% | 73.83% | -136.00 |
| Jeremiah Fears | 10 | 6 | 60.00% | 100.00% | 75.00% | 25.00% | 100.00% | 83.70% | -119.83 |

### By Book

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bet365 | 248 | 191 | 77.02% | 95.81% | 94.74% | 1.07% | 95.81% | 80.95% | -75.25 |
| draftkings | 166 | 130 | 78.31% | 95.38% | 94.44% | 0.94% | 95.38% | 75.07% | -106.67 |
| hardrock | 161 | 67 | 41.61% | 95.52% | 95.74% | -0.22% | 95.52% | 74.43% | -111.57 |
| fanatics | 119 | 65 | 54.62% | 90.77% | 88.89% | 1.88% | 90.77% | 68.03% | -84.35 |
| riverscasino | 71 | 40 | 56.34% | 97.50% | 87.10% | 10.40% | 97.50% | 78.98% | -106.53 |
| fanduel | 51 | 45 | 88.24% | 88.89% | 100.00% | -11.11% | 88.89% | 65.39% | -104.63 |
| underdog | 37 | 19 | 51.35% | 100.00% | 94.44% | 5.56% | 100.00% | 71.24% | -142.92 |
| prizepicks | 30 | 2 | 6.67% | 100.00% | 89.29% | 10.71% | 100.00% | 75.41% | -132.75 |
| betmgm | 19 | 18 | 94.74% | 100.00% | 100.00% | 0.00% | 100.00% | 85.68% | -95.92 |
| sleeper | 13 | 4 | 30.77% | 100.00% | 88.89% | 11.11% | 100.00% | 75.81% | -132.00 |
| caesars | 12 | 11 | 91.67% | 100.00% | 100.00% | 0.00% | 100.00% | 79.40% | -129.59 |
| rivers-casino | 1 | 0 | 0.00% | - | 0.00% | - | - | - | - |

### By Price Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| -149 to -120 | 405 | 279 | 68.89% | 93.91% | 93.65% | 0.26% | 93.91% | 66.97% | -128.83 |
| -119 to -100 | 319 | 181 | 56.74% | 96.13% | 89.86% | 6.27% | 96.13% | 80.81% | -113.69 |
| +100 to +149 | 111 | 66 | 59.46% | 96.97% | 95.56% | 1.41% | 96.97% | 108.98% | 115.85 |
| -199 to -150 | 55 | 55 | 100.00% | 94.55% | - | - | 94.55% | 52.26% | -163.95 |
| +150 to +199 | 9 | 9 | 100.00% | 100.00% | - | - | 100.00% | 164.44% | 164.44 |
| <=-200 | 2 | 2 | 100.00% | 100.00% | - | - | 100.00% | 48.42% | -206.75 |

## Full Coverage Diagnostic Layer

This section grades every selected pick using a tiered ladder. Only `EXACT_EXTERNAL_LINE_VALID_ODDS` is exact external market proof.

| Metric | Value |
|---|---:|
| Full coverage rows | 962 |
| Full coverage | 100.00% |
| Full coverage accuracy | 94.48% |
| Full coverage profit | 729.44 |
| Full coverage ROI | 75.83% |
| External priced coverage | 93.66% |
| Assumed/internal fallback rows | 61 |
| Avg nearest external abs line gap | 1.11 |
| Max nearest external abs line gap | 6.00 |

### By Coverage Tier

| Tier | Rows | Share | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|---:|
| EXACT_EXTERNAL_LINE_VALID_ODDS | 592 | 61.54% | 95.10% | 449.54 | 75.94% | 0.00 |
| NEAREST_EXTERNAL_LINE_VALID_ODDS | 309 | 32.12% | 93.49% | 232.08 | 75.11% | 1.11 |
| INTERNAL_MODEL_LINE_ASSUMED_ODDS | 61 | 6.34% | 93.44% | 47.82 | 78.39% | 0.00 |

### Full Coverage By Market

| Market | Rows | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|
| PTS | 325 | 92.92% | 231.53 | 71.24% | 0.68 |
| REB | 264 | 96.20% | 203.45 | 77.06% | 0.30 |
| AST | 209 | 96.15% | 178.70 | 85.50% | 0.20 |
| PRA | 132 | 92.42% | 92.78 | 70.29% | 0.00 |
| RA | 19 | 94.74% | 13.74 | 72.30% | 0.00 |
| THREES | 13 | 92.31% | 9.24 | 71.10% | 0.00 |

## Interpretation

- Strict proof requires an exact player/date/market/side/line match with valid American odds.
- ROI is graded only on strict exact-line matches, using the external line and external odds.
- The full-coverage diagnostic layer grades all selected picks using exact external lines first, nearest same-side external lines second, and internal model-line assumed odds only when no valid external line exists.
- Full-coverage diagnostic ROI is useful for coverage inspection, but it is not a replacement for exact-line as-of market proof.
- Matched-vs-unmatched diagnostics compare internal historical accuracy between the exact-line matched subset and the selected picks that did not exact-match the external line file.
- CLV remains pending unless the external file includes closeLine/closeOdds or equivalent closing fields.
- As-of safety remains pending unless the external file includes lineTimestampUtc/snapshotAtUtc and gameTimeUtc/commenceTimeUtc.
- This is market-proof grading, not live forward proof and not an independent as-of feature replay.
