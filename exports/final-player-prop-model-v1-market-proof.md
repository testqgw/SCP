# Final V1 Market Proof / ROI / CLV Audit

Generated: 2026-05-12T04:30:46.056603Z
Overall status: **WARN**

## Inputs

- Selected picks: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\final-player-prop-model-v1-walk-forward-selected.csv`
- External line file: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\historical-lines\all-players-all-markets-live.csv`
- Selected SHA256: `d9e4f347936b0aeca7205b4574b83baae1c740d4d566dd573a22e8e67662ec56`
- Line SHA256: `27a70dc138b2dee5ace5315ef9d5711858ffb2d34d214353af0e0daeb10f35af`

## Main Metrics

| Metric | Value |
|---|---:|
| Total selected picks | 962 |
| External line rows | 84065 |
| Strict exact-line matches with valid odds | 397 |
| Strict match coverage | 41.27% |
| Accuracy at external line | 95.97% |
| Profit units at 1u flat stake | 308.89 |
| ROI at odds | 77.81% |
| Avg American odds | -94.84 |
| As-of timestamp coverage | 0.00% |
| Closing line coverage | 0.00% |
| Avg side-aware line CLV | - |

## Match Status

| Status | Count | Share |
|---|---:|---:|
| NO_PLAYER_MARKET_LINE | 312 | 32.43% |
| MATCHED_EXACT_LINE_VALID_ODDS | 397 | 41.27% |
| NO_EXACT_LINE_MATCH | 245 | 25.47% |
| MATCHED_EXACT_LINE_INVALID_ODDS | 8 | 0.83% |

## By Market

| Market | Picks | Strict Matches | Coverage | Accuracy | Profit | ROI |
|---|---:|---:|---:|---:|---:|---:|
| PTS | 319 | 101 | 31.66% | 97.03% | 78.64 | 77.86% |
| REB | 263 | 111 | 42.21% | 95.50% | 82.24 | 74.09% |
| AST | 212 | 116 | 54.72% | 96.55% | 97.88 | 84.38% |
| PRA | 143 | 58 | 40.56% | 93.10% | 41.85 | 72.16% |
| RA | 13 | 8 | 61.54% | 100.00% | 6.43 | 80.41% |
| THREES | 12 | 3 | 25.00% | 100.00% | 1.84 | 61.49% |

## Matched vs Unmatched Bias Diagnostics

Internal accuracy compares the model's historical result labels for exact-line matched picks against the selected picks that did not exact-match the external line file.

### By Side

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| OVER | 510 | 208 | 40.78% | 94.71% | 94.70% | 0.01% | 94.71% | 76.97% | -89.09 |
| UNDER | 452 | 189 | 41.81% | 97.35% | 94.30% | 3.05% | 97.35% | 78.73% | -101.18 |

### By Tier

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 538 | 188 | 34.94% | 94.15% | 94.86% | -0.71% | 94.15% | 73.71% | -104.84 |
| S | 417 | 207 | 49.64% | 97.58% | 93.81% | 3.77% | 97.58% | 81.30% | -86.65 |
| B | 6 | 1 | 16.67% | 100.00% | 100.00% | 0.00% | 100.00% | 73.26% | -136.50 |
| C | 1 | 1 | 100.00% | 100.00% | - | - | 100.00% | 129.50% | 129.50 |

### By Month

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | 186 | 91 | 48.92% | 96.70% | 93.68% | 3.02% | 96.70% | 81.17% | -87.64 |
| 2026-03 | 186 | 29 | 15.59% | 100.00% | 96.18% | 3.82% | 100.00% | 83.08% | -97.43 |
| 2025-11 | 170 | 100 | 58.82% | 98.00% | 91.43% | 6.57% | 98.00% | 81.79% | -94.09 |
| 2025-12 | 168 | 93 | 55.36% | 95.70% | 92.00% | 3.70% | 95.70% | 77.06% | -93.39 |
| 2026-02 | 132 | 76 | 57.58% | 90.79% | 100.00% | -9.21% | 90.79% | 66.97% | -104.65 |
| 2026-04 | 108 | 0 | 0.00% | - | 94.44% | - | - | - | - |
| 2025-10 | 12 | 8 | 66.67% | 100.00% | 75.00% | 25.00% | 100.00% | 82.22% | -100.44 |

### By Line Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <5 | 313 | 172 | 54.95% | 95.93% | 95.04% | 0.89% | 95.93% | 80.90% | -61.15 |
| 5-9.5 | 236 | 86 | 36.44% | 97.67% | 94.00% | 3.67% | 97.67% | 76.47% | -123.03 |
| 10-14.5 | 119 | 36 | 30.25% | 100.00% | 93.98% | 6.02% | 100.00% | 83.36% | -120.42 |
| 15-19.5 | 100 | 31 | 31.00% | 93.55% | 97.10% | -3.55% | 93.55% | 71.59% | -120.29 |
| 20-24.5 | 71 | 25 | 35.21% | 96.00% | 93.48% | 2.52% | 96.00% | 76.99% | -118.38 |
| 30+ | 68 | 27 | 39.71% | 92.59% | 92.68% | -0.09% | 92.59% | 71.63% | -117.37 |
| 25-29.5 | 55 | 20 | 36.36% | 90.00% | 94.29% | -4.29% | 90.00% | 65.97% | -118.12 |

### By Prior Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90-92 | 543 | 189 | 34.81% | 94.18% | 94.92% | -0.74% | 94.18% | 73.71% | -105.01 |
| 94+ | 284 | 116 | 40.85% | 97.41% | 92.86% | 4.55% | 97.41% | 82.32% | -81.82 |
| 92-94 | 133 | 91 | 68.42% | 97.80% | 97.62% | 0.18% | 97.80% | 79.98% | -92.80 |
| 88-90 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 129.50% | 129.50 |

### By Final Score Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.90+ | 457 | 168 | 36.76% | 95.83% | 93.43% | 2.40% | 95.83% | 76.23% | -113.90 |
| 0.85-0.90 | 307 | 116 | 37.79% | 93.10% | 95.29% | -2.19% | 93.10% | 74.01% | -83.97 |
| 0.80-0.85 | 174 | 104 | 59.77% | 99.04% | 95.71% | 3.33% | 99.04% | 82.41% | -83.17 |
| 0.75-0.80 | 24 | 9 | 37.50% | 100.00% | 100.00% | 0.00% | 100.00% | 102.85% | -14.22 |

### By Team

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PHX | 50 | 23 | 46.00% | 100.00% | 96.30% | 3.70% | 100.00% | 94.80% | -41.39 |
| UTA | 46 | 29 | 63.04% | 96.55% | 94.12% | 2.43% | 96.55% | 75.09% | -98.76 |
| SAS | 45 | 11 | 24.44% | 90.91% | 94.12% | -3.21% | 90.91% | 62.63% | -130.41 |
| BOS | 40 | 15 | 37.50% | 100.00% | 100.00% | 0.00% | 100.00% | 78.96% | -129.47 |
| DET | 39 | 14 | 35.90% | 85.71% | 96.00% | -10.29% | 85.71% | 54.80% | -115.68 |
| TOR | 38 | 13 | 34.21% | 100.00% | 92.00% | 8.00% | 100.00% | 88.94% | -82.88 |
| WAS | 38 | 25 | 65.79% | 100.00% | 92.31% | 7.69% | 100.00% | 94.26% | -47.54 |
| LAC | 37 | 22 | 59.46% | 100.00% | 93.33% | 6.67% | 100.00% | 85.41% | -101.18 |
| MIL | 37 | 12 | 32.43% | 100.00% | 96.00% | 4.00% | 100.00% | 85.31% | -71.88 |
| SAC | 36 | 19 | 52.78% | 94.74% | 100.00% | -5.26% | 94.74% | 81.32% | -93.39 |
| NYK | 35 | 11 | 31.43% | 81.82% | 100.00% | -18.18% | 81.82% | 48.23% | -123.41 |
| PHI | 34 | 12 | 35.29% | 91.67% | 95.45% | -3.78% | 91.67% | 70.24% | -103.25 |
| ATL | 33 | 14 | 42.42% | 100.00% | 84.21% | 15.79% | 100.00% | 80.98% | -112.46 |
| LAL | 33 | 11 | 33.33% | 90.91% | 100.00% | -9.09% | 90.91% | 68.68% | -99.82 |
| HOU | 32 | 13 | 40.62% | 84.62% | 89.47% | -4.85% | 84.62% | 53.04% | -124.27 |
| NOP | 31 | 15 | 48.39% | 100.00% | 87.50% | 12.50% | 100.00% | 84.03% | -108.40 |
| CHI | 30 | 13 | 43.33% | 92.31% | 100.00% | -7.69% | 92.31% | 76.37% | -67.92 |
| CLE | 30 | 12 | 40.00% | 100.00% | 94.44% | 5.56% | 100.00% | 76.99% | -132.46 |
| GSW | 30 | 13 | 43.33% | 100.00% | 94.12% | 5.88% | 100.00% | 78.92% | -128.23 |
| OKC | 30 | 12 | 40.00% | 100.00% | 88.89% | 11.11% | 100.00% | 83.75% | -89.42 |

### Top Player Buckets

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Justin Champagnie | 19 | 14 | 73.68% | 100.00% | 100.00% | 0.00% | 100.00% | 106.13% | 2.54 |
| Kawhi Leonard | 18 | 10 | 55.56% | 100.00% | 87.50% | 12.50% | 100.00% | 85.53% | -117.05 |
| Payton Pritchard | 16 | 5 | 31.25% | 100.00% | 100.00% | 0.00% | 100.00% | 79.97% | -126.20 |
| Ryan Dunn | 16 | 13 | 81.25% | 100.00% | 100.00% | 0.00% | 100.00% | 104.37% | -7.96 |
| Ryan Rollins | 16 | 5 | 31.25% | 100.00% | 100.00% | 0.00% | 100.00% | 83.37% | -81.20 |
| VJ Edgecombe | 14 | 3 | 21.43% | 100.00% | 100.00% | 0.00% | 100.00% | 78.23% | -131.17 |
| Luka Dončić | 13 | 6 | 46.15% | 83.33% | 100.00% | -16.67% | 83.33% | 53.02% | -120.25 |
| Quentin Grimes | 13 | 5 | 38.46% | 80.00% | 87.50% | -7.50% | 80.00% | 46.85% | -120.90 |
| Evan Mobley | 12 | 4 | 33.33% | 100.00% | 100.00% | 0.00% | 100.00% | 82.71% | -121.75 |
| Kyle Filipowski | 12 | 7 | 58.33% | 85.71% | 100.00% | -14.29% | 85.71% | 58.36% | -90.29 |
| Scottie Barnes | 12 | 4 | 33.33% | 100.00% | 87.50% | 12.50% | 100.00% | 84.16% | -118.88 |
| Corey Kispert | 11 | 9 | 81.82% | 100.00% | 100.00% | 0.00% | 100.00% | 79.35% | -107.94 |
| Jeremiah Fears | 11 | 5 | 45.45% | 100.00% | 83.33% | 16.67% | 100.00% | 85.97% | -116.40 |
| Nikola Jokić | 11 | 2 | 18.18% | 100.00% | 88.89% | 11.11% | 100.00% | 84.59% | -118.25 |
| Svi Mykhailiuk | 11 | 11 | 100.00% | 100.00% | - | - | 100.00% | 75.61% | -119.95 |
| Victor Wembanyama | 11 | 1 | 9.09% | 100.00% | 90.00% | 10.00% | 100.00% | 78.43% | -127.50 |
| Bobby Portis | 10 | 3 | 30.00% | 100.00% | 85.71% | 14.29% | 100.00% | 96.08% | -40.67 |
| Deni Avdija | 10 | 5 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 84.63% | -118.30 |
| Nickeil Alexander-Walker | 10 | 4 | 40.00% | 100.00% | 83.33% | 16.67% | 100.00% | 74.46% | -136.50 |
| Russell Westbrook | 10 | 8 | 80.00% | 100.00% | 100.00% | 0.00% | 100.00% | 81.39% | -123.50 |

### By Book

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bet365 | 169 | 121 | 71.60% | 97.52% | 93.75% | 3.77% | 97.52% | 84.89% | -69.24 |
| draftkings | 126 | 101 | 80.16% | 96.04% | 96.00% | 0.04% | 96.04% | 75.61% | -111.61 |
| fanatics | 93 | 54 | 58.06% | 94.44% | 100.00% | -5.56% | 94.44% | 74.16% | -89.67 |
| hardrock | 93 | 30 | 32.26% | 100.00% | 96.83% | 3.17% | 100.00% | 84.73% | -99.45 |
| riverscasino | 51 | 26 | 50.98% | 92.31% | 88.00% | 4.31% | 92.31% | 69.73% | -106.98 |
| fanduel | 40 | 29 | 72.50% | 93.10% | 100.00% | -6.90% | 93.10% | 72.45% | -111.41 |
| underdog | 25 | 13 | 52.00% | 100.00% | 91.67% | 8.33% | 100.00% | 71.87% | -141.88 |
| prizepicks | 22 | 0 | 0.00% | - | 95.45% | - | - | - | - |
| betmgm | 13 | 12 | 92.31% | 100.00% | 100.00% | 0.00% | 100.00% | 87.77% | -82.17 |
| caesars | 9 | 8 | 88.89% | 75.00% | 100.00% | -25.00% | 75.00% | 37.62% | -118.06 |
| sleeper | 7 | 2 | 28.57% | 100.00% | 80.00% | 20.00% | 100.00% | 75.71% | -132.25 |
| rivers-casino | 2 | 1 | 50.00% | 100.00% | 0.00% | 100.00% | 100.00% | 80.00% | -125.00 |

### By Price Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| -149 to -120 | 282 | 186 | 65.96% | 95.16% | 94.79% | 0.37% | 95.16% | 69.23% | -129.11 |
| -119 to -100 | 219 | 121 | 55.25% | 95.87% | 93.88% | 1.99% | 95.87% | 80.73% | -113.11 |
| +100 to +149 | 81 | 45 | 55.56% | 97.78% | 97.22% | 0.56% | 97.78% | 109.78% | 115.22 |
| -199 to -150 | 39 | 37 | 94.87% | 97.30% | 100.00% | -2.70% | 97.30% | 56.45% | -164.93 |
| +150 to +199 | 7 | 7 | 100.00% | 100.00% | - | - | 100.00% | 166.43% | 166.43 |
| <=-200 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 50.00% | -200.00 |

## Full Coverage Diagnostic Layer

This section grades every selected pick using a tiered ladder. Only `EXACT_EXTERNAL_LINE_VALID_ODDS` is exact external market proof.

| Metric | Value |
|---|---:|
| Full coverage rows | 962 |
| Full coverage | 100.00% |
| Full coverage accuracy | 94.90% |
| Full coverage profit | 751.62 |
| Full coverage ROI | 78.13% |
| External priced coverage | 65.49% |
| Assumed/internal fallback rows | 332 |
| Avg nearest external abs line gap | 1.25 |
| Max nearest external abs line gap | 12.00 |

### By Coverage Tier

| Tier | Rows | Share | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|---:|
| EXACT_EXTERNAL_LINE_VALID_ODDS | 397 | 41.27% | 95.97% | 308.89 | 77.81% | 0.00 |
| INTERNAL_MODEL_LINE_ASSUMED_ODDS | 332 | 34.51% | 94.28% | 265.55 | 79.98% | 0.00 |
| NEAREST_EXTERNAL_LINE_VALID_ODDS | 233 | 24.22% | 93.97% | 177.18 | 76.04% | 1.25 |

### Full Coverage By Market

| Market | Rows | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|
| PTS | 319 | 95.30% | 246.15 | 77.16% | 0.48 |
| REB | 263 | 95.06% | 204.76 | 77.86% | 0.23 |
| AST | 212 | 96.21% | 178.97 | 84.42% | 0.12 |
| PRA | 143 | 91.61% | 103.53 | 72.40% | 0.33 |
| RA | 13 | 92.31% | 9.07 | 69.76% | 0.00 |
| THREES | 12 | 100.00% | 9.12 | 76.04% | 0.33 |

## Interpretation

- Strict proof requires an exact player/date/market/side/line match with valid American odds.
- ROI is graded only on strict exact-line matches, using the external line and external odds.
- The full-coverage diagnostic layer grades all selected picks using exact external lines first, nearest same-side external lines second, and internal model-line assumed odds only when no valid external line exists.
- Full-coverage diagnostic ROI is useful for coverage inspection, but it is not a replacement for exact-line as-of market proof.
- Matched-vs-unmatched diagnostics compare internal historical accuracy between the exact-line matched subset and the selected picks that did not exact-match the external line file.
- CLV remains pending unless the external file includes closeLine/closeOdds or equivalent closing fields.
- As-of safety remains pending unless the external file includes lineTimestampUtc/snapshotAtUtc and gameTimeUtc/commenceTimeUtc.
- This is market-proof grading, not live forward proof and not an independent as-of feature replay.
