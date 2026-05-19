# Final V1 Market Proof / ROI / CLV Audit

Generated: 2026-05-18T23:43:26.213082Z
Overall status: **WARN**

## Inputs

- Selected picks: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\final-player-prop-model-v1-walk-forward-selected.csv`
- External line file: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\historical-lines\all-players-all-markets-live.csv`
- Selected SHA256: `aadcea9f7b1fe713d23480e2e9dedb46b9034da0a51ffec1ec90d76545a2d914`
- Line SHA256: `27a70dc138b2dee5ace5315ef9d5711858ffb2d34d214353af0e0daeb10f35af`

## Main Metrics

| Metric | Value |
|---|---:|
| Total selected picks | 962 |
| External line rows | 84065 |
| Strict exact-line matches with valid odds | 385 |
| Strict match coverage | 40.02% |
| Accuracy at external line | 96.88% |
| Profit units at 1u flat stake | 305.77 |
| ROI at odds | 79.42% |
| Avg American odds | -94.70 |
| As-of timestamp coverage | 0.00% |
| Closing line coverage | 0.00% |
| Avg side-aware line CLV | - |

## Match Status

| Status | Count | Share |
|---|---:|---:|
| NO_PLAYER_MARKET_LINE | 318 | 33.06% |
| MATCHED_EXACT_LINE_VALID_ODDS | 385 | 40.02% |
| NO_EXACT_LINE_MATCH | 250 | 25.99% |
| MATCHED_EXACT_LINE_INVALID_ODDS | 9 | 0.94% |

## By Market

| Market | Picks | Strict Matches | Coverage | Accuracy | Profit | ROI |
|---|---:|---:|---:|---:|---:|---:|
| PTS | 317 | 94 | 29.65% | 97.87% | 74.70 | 79.47% |
| REB | 260 | 113 | 43.46% | 96.46% | 85.53 | 75.69% |
| AST | 216 | 115 | 53.24% | 96.52% | 96.68 | 84.07% |
| PRA | 148 | 54 | 36.49% | 96.30% | 42.19 | 78.13% |
| THREES | 13 | 3 | 23.08% | 100.00% | 1.84 | 61.49% |
| RA | 8 | 6 | 75.00% | 100.00% | 4.82 | 80.35% |

## Matched vs Unmatched Bias Diagnostics

Internal accuracy compares the model's historical result labels for exact-line matched picks against the selected picks that did not exact-match the external line file.

### By Side

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| UNDER | 499 | 198 | 39.68% | 97.98% | 94.35% | 3.63% | 97.98% | 79.76% | -101.34 |
| OVER | 463 | 187 | 40.39% | 95.72% | 95.65% | 0.07% | 95.72% | 79.07% | -87.67 |

### By Tier

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 538 | 176 | 32.71% | 96.02% | 95.58% | 0.44% | 96.02% | 76.96% | -105.21 |
| S | 417 | 207 | 49.64% | 97.58% | 93.81% | 3.77% | 97.58% | 81.30% | -86.65 |
| B | 6 | 1 | 16.67% | 100.00% | 100.00% | 0.00% | 100.00% | 73.26% | -136.50 |
| C | 1 | 1 | 100.00% | 100.00% | - | - | 100.00% | 129.50% | 129.50 |

### By Month

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | 186 | 89 | 47.85% | 97.75% | 94.85% | 2.90% | 97.75% | 82.30% | -92.29 |
| 2026-03 | 186 | 27 | 14.52% | 100.00% | 96.86% | 3.14% | 100.00% | 83.25% | -95.44 |
| 2025-11 | 170 | 96 | 56.47% | 97.92% | 91.89% | 6.03% | 97.92% | 81.61% | -93.22 |
| 2025-12 | 168 | 93 | 55.36% | 96.77% | 92.00% | 4.77% | 96.77% | 79.67% | -90.35 |
| 2026-02 | 132 | 72 | 54.55% | 93.06% | 100.00% | -6.94% | 93.06% | 70.87% | -104.35 |
| 2026-04 | 108 | 0 | 0.00% | - | 94.44% | - | - | - | - |
| 2025-10 | 12 | 8 | 66.67% | 100.00% | 75.00% | 25.00% | 100.00% | 82.22% | -100.44 |

### By Line Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <5 | 323 | 170 | 52.63% | 95.88% | 94.77% | 1.11% | 95.88% | 80.69% | -61.82 |
| 5-9.5 | 229 | 87 | 37.99% | 98.85% | 94.37% | 4.48% | 98.85% | 78.50% | -123.02 |
| 10-14.5 | 113 | 33 | 29.20% | 100.00% | 95.00% | 5.00% | 100.00% | 83.01% | -120.92 |
| 15-19.5 | 101 | 27 | 26.73% | 96.30% | 97.30% | -1.00% | 96.30% | 76.82% | -119.96 |
| 20-24.5 | 73 | 22 | 30.14% | 100.00% | 94.12% | 5.88% | 100.00% | 84.31% | -118.84 |
| 30+ | 68 | 25 | 36.76% | 96.00% | 95.35% | 0.65% | 96.00% | 78.05% | -117.22 |
| 25-29.5 | 55 | 21 | 38.18% | 90.48% | 94.12% | -3.64% | 90.48% | 67.13% | -117.74 |

### By Prior Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90-92 | 543 | 177 | 32.60% | 96.05% | 95.63% | 0.42% | 96.05% | 76.94% | -105.38 |
| 94+ | 284 | 116 | 40.85% | 97.41% | 92.86% | 4.55% | 97.41% | 82.32% | -81.82 |
| 92-94 | 133 | 91 | 68.42% | 97.80% | 97.62% | 0.18% | 97.80% | 79.98% | -92.80 |
| 88-90 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 129.50% | 129.50 |

### By Final Score Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.90+ | 446 | 155 | 34.75% | 97.42% | 93.81% | 3.61% | 97.42% | 79.26% | -113.32 |
| 0.85-0.90 | 315 | 115 | 36.51% | 93.91% | 96.50% | -2.59% | 93.91% | 75.47% | -85.15 |
| 0.80-0.85 | 179 | 107 | 59.78% | 99.07% | 94.44% | 4.63% | 99.07% | 81.99% | -84.96 |
| 0.75-0.80 | 22 | 8 | 36.36% | 100.00% | 100.00% | 0.00% | 100.00% | 104.83% | -1.62 |

### By Team

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PHX | 49 | 22 | 44.90% | 100.00% | 100.00% | 0.00% | 100.00% | 95.32% | -37.82 |
| SAS | 44 | 11 | 25.00% | 90.91% | 96.97% | -6.06% | 90.91% | 61.74% | -132.05 |
| WAS | 43 | 25 | 58.14% | 100.00% | 88.89% | 11.11% | 100.00% | 94.81% | -46.50 |
| UTA | 42 | 27 | 64.29% | 96.30% | 93.33% | 2.97% | 96.30% | 73.58% | -105.67 |
| LAC | 39 | 23 | 58.97% | 100.00% | 100.00% | 0.00% | 100.00% | 85.38% | -101.91 |
| TOR | 39 | 11 | 28.21% | 100.00% | 92.86% | 7.14% | 100.00% | 89.81% | -76.41 |
| BOS | 37 | 14 | 37.84% | 100.00% | 100.00% | 0.00% | 100.00% | 78.48% | -130.36 |
| SAC | 37 | 15 | 40.54% | 93.33% | 100.00% | -6.67% | 93.33% | 80.42% | -86.17 |
| MIL | 36 | 12 | 33.33% | 100.00% | 95.83% | 4.17% | 100.00% | 85.59% | -71.46 |
| ATL | 35 | 15 | 42.86% | 100.00% | 85.00% | 15.00% | 100.00% | 80.92% | -113.30 |
| DET | 35 | 13 | 37.14% | 84.62% | 100.00% | -15.38% | 84.62% | 52.27% | -115.81 |
| LAL | 34 | 12 | 35.29% | 91.67% | 100.00% | -8.33% | 91.67% | 69.53% | -102.25 |
| PHI | 34 | 11 | 32.35% | 90.91% | 91.30% | -0.39% | 90.91% | 69.05% | -101.73 |
| GSW | 33 | 14 | 42.42% | 100.00% | 94.74% | 5.26% | 100.00% | 78.28% | -129.29 |
| NYK | 33 | 12 | 36.36% | 83.33% | 100.00% | -16.67% | 83.33% | 51.52% | -122.62 |
| MIA | 31 | 9 | 29.03% | 100.00% | 95.45% | 4.55% | 100.00% | 88.34% | -93.22 |
| MIN | 31 | 9 | 29.03% | 100.00% | 100.00% | 0.00% | 100.00% | 86.89% | -72.67 |
| OKC | 31 | 13 | 41.94% | 100.00% | 88.89% | 11.11% | 100.00% | 82.43% | -94.08 |
| NOP | 30 | 14 | 46.67% | 100.00% | 87.50% | 12.50% | 100.00% | 83.26% | -108.93 |
| CHA | 29 | 17 | 58.62% | 100.00% | 100.00% | 0.00% | 100.00% | 80.04% | -117.56 |

### Top Player Buckets

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Justin Champagnie | 19 | 14 | 73.68% | 100.00% | 100.00% | 0.00% | 100.00% | 106.13% | 2.54 |
| Kawhi Leonard | 18 | 11 | 61.11% | 100.00% | 100.00% | 0.00% | 100.00% | 85.46% | -117.14 |
| Ryan Rollins | 17 | 5 | 29.41% | 100.00% | 100.00% | 0.00% | 100.00% | 84.04% | -80.20 |
| Ryan Dunn | 16 | 13 | 81.25% | 100.00% | 100.00% | 0.00% | 100.00% | 104.37% | -7.96 |
| Payton Pritchard | 14 | 4 | 28.57% | 100.00% | 100.00% | 0.00% | 100.00% | 79.13% | -127.75 |
| Luka Dončić | 13 | 7 | 53.85% | 85.71% | 100.00% | -14.29% | 85.71% | 56.39% | -121.93 |
| Nikola Jokić | 13 | 1 | 7.69% | 100.00% | 91.67% | 8.33% | 100.00% | 85.84% | -116.50 |
| Quentin Grimes | 13 | 4 | 30.77% | 75.00% | 88.89% | -13.89% | 75.00% | 37.73% | -121.12 |
| VJ Edgecombe | 13 | 3 | 23.08% | 100.00% | 100.00% | 0.00% | 100.00% | 78.23% | -131.17 |
| Jeremiah Fears | 12 | 5 | 41.67% | 100.00% | 85.71% | 14.29% | 100.00% | 85.97% | -116.40 |
| Scottie Barnes | 12 | 4 | 33.33% | 100.00% | 87.50% | 12.50% | 100.00% | 82.56% | -121.38 |
| Corey Kispert | 11 | 9 | 81.82% | 100.00% | 100.00% | 0.00% | 100.00% | 79.35% | -107.94 |
| Evan Mobley | 11 | 4 | 36.36% | 100.00% | 100.00% | 0.00% | 100.00% | 82.71% | -121.75 |
| Kyle Filipowski | 11 | 7 | 63.64% | 85.71% | 100.00% | -14.29% | 85.71% | 58.36% | -90.29 |
| Svi Mykhailiuk | 11 | 11 | 100.00% | 100.00% | - | - | 100.00% | 75.61% | -119.95 |
| Victor Wembanyama | 11 | 2 | 18.18% | 100.00% | 100.00% | 0.00% | 100.00% | 82.69% | -121.25 |
| Nickeil Alexander-Walker | 10 | 4 | 40.00% | 100.00% | 83.33% | 16.67% | 100.00% | 74.46% | -136.50 |
| Bobby Portis | 9 | 3 | 33.33% | 100.00% | 83.33% | 16.67% | 100.00% | 96.08% | -40.67 |
| Brandin Podziemski | 9 | 4 | 44.44% | 100.00% | 80.00% | 20.00% | 100.00% | 77.58% | -131.12 |
| Daniss Jenkins | 9 | 6 | 66.67% | 83.33% | 100.00% | -16.67% | 83.33% | 40.28% | -145.92 |

### By Book

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bet365 | 171 | 126 | 73.68% | 98.41% | 93.33% | 5.08% | 98.41% | 85.38% | -74.14 |
| draftkings | 124 | 98 | 79.03% | 96.94% | 96.15% | 0.79% | 96.94% | 77.55% | -110.79 |
| hardrock | 96 | 29 | 30.21% | 100.00% | 97.01% | 2.99% | 100.00% | 84.31% | -106.09 |
| fanatics | 94 | 51 | 54.26% | 94.12% | 100.00% | -5.88% | 94.12% | 74.14% | -86.95 |
| riverscasino | 50 | 25 | 50.00% | 92.00% | 88.00% | 4.00% | 92.00% | 67.83% | -108.42 |
| fanduel | 35 | 25 | 71.43% | 96.00% | 100.00% | -4.00% | 96.00% | 79.90% | -99.60 |
| underdog | 26 | 11 | 42.31% | 100.00% | 93.33% | 6.67% | 100.00% | 71.21% | -143.32 |
| prizepicks | 20 | 0 | 0.00% | - | 95.00% | - | - | - | - |
| betmgm | 13 | 12 | 92.31% | 100.00% | 100.00% | 0.00% | 100.00% | 87.95% | -81.92 |
| sleeper | 7 | 2 | 28.57% | 100.00% | 80.00% | 20.00% | 100.00% | 75.71% | -132.25 |
| caesars | 6 | 5 | 83.33% | 80.00% | 100.00% | -20.00% | 80.00% | 45.98% | -120.10 |
| rivers-casino | 2 | 1 | 50.00% | 100.00% | 0.00% | 100.00% | 100.00% | 80.00% | -125.00 |

### By Price Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| -149 to -120 | 270 | 174 | 64.44% | 95.98% | 94.79% | 1.19% | 95.98% | 70.43% | -129.49 |
| -119 to -100 | 226 | 121 | 53.54% | 97.52% | 94.29% | 3.23% | 97.52% | 83.72% | -113.25 |
| +100 to +149 | 76 | 44 | 57.89% | 97.73% | 96.88% | 0.85% | 97.73% | 109.66% | 115.23 |
| -199 to -150 | 41 | 38 | 92.68% | 97.37% | 100.00% | -2.63% | 97.37% | 56.65% | -164.71 |
| +150 to +199 | 7 | 7 | 100.00% | 100.00% | - | - | 100.00% | 166.43% | 166.43 |
| <=-200 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 50.00% | -200.00 |

## Full Coverage Diagnostic Layer

This section grades every selected pick using a tiered ladder. Only `EXACT_EXTERNAL_LINE_VALID_ODDS` is exact external market proof.

| Metric | Value |
|---|---:|
| Full coverage rows | 962 |
| Full coverage | 100.00% |
| Full coverage accuracy | 95.63% |
| Full coverage profit | 764.26 |
| Full coverage ROI | 79.44% |
| External priced coverage | 64.66% |
| Assumed/internal fallback rows | 340 |
| Avg nearest external abs line gap | 1.19 |
| Max nearest external abs line gap | 11.00 |

### By Coverage Tier

| Tier | Rows | Share | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|---:|
| EXACT_EXTERNAL_LINE_VALID_ODDS | 385 | 40.02% | 96.88% | 305.77 | 79.42% | 0.00 |
| INTERNAL_MODEL_LINE_ASSUMED_ODDS | 340 | 35.34% | 95.00% | 276.64 | 81.36% | 0.00 |
| NEAREST_EXTERNAL_LINE_VALID_ODDS | 237 | 24.64% | 94.49% | 181.86 | 76.73% | 1.19 |

### Full Coverage By Market

| Market | Rows | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|
| PTS | 317 | 95.58% | 246.49 | 77.76% | 0.50 |
| REB | 260 | 95.77% | 205.05 | 78.87% | 0.22 |
| AST | 216 | 96.28% | 182.13 | 84.32% | 0.13 |
| PRA | 148 | 93.92% | 113.92 | 76.97% | 0.24 |
| THREES | 13 | 100.00% | 10.03 | 77.18% | 0.31 |
| RA | 8 | 100.00% | 6.64 | 82.99% | 0.00 |

## Interpretation

- Strict proof requires an exact player/date/market/side/line match with valid American odds.
- ROI is graded only on strict exact-line matches, using the external line and external odds.
- The full-coverage diagnostic layer grades all selected picks using exact external lines first, nearest same-side external lines second, and internal model-line assumed odds only when no valid external line exists.
- Full-coverage diagnostic ROI is useful for coverage inspection, but it is not a replacement for exact-line as-of market proof.
- Matched-vs-unmatched diagnostics compare internal historical accuracy between the exact-line matched subset and the selected picks that did not exact-match the external line file.
- CLV remains pending unless the external file includes closeLine/closeOdds or equivalent closing fields.
- As-of safety remains pending unless the external file includes lineTimestampUtc/snapshotAtUtc and gameTimeUtc/commenceTimeUtc.
- This is market-proof grading, not live forward proof and not an independent as-of feature replay.
