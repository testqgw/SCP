# Final V1 Market Proof / ROI / CLV Audit

Generated: 2026-05-11T23:47:15.611007Z
Overall status: **WARN**

## Inputs

- Selected picks: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\final-player-prop-model-v1-walk-forward-selected.csv`
- External line file: `C:\Users\quinc\Desktop\Sports Betting Snapshot\compliance-reminder-saas\exports\historical-lines\all-players-all-markets-live.csv`
- Selected SHA256: `fa1091c26232c4937854717d5ae2d83a2749d2219ddba9cfa42efe5be6e1bde9`
- Line SHA256: `27a70dc138b2dee5ace5315ef9d5711858ffb2d34d214353af0e0daeb10f35af`

## Main Metrics

| Metric | Value |
|---|---:|
| Total selected picks | 962 |
| External line rows | 84065 |
| Strict exact-line matches with valid odds | 398 |
| Strict match coverage | 41.37% |
| Accuracy at external line | 95.98% |
| Profit units at 1u flat stake | 309.84 |
| ROI at odds | 77.85% |
| Avg American odds | -94.38 |
| As-of timestamp coverage | 0.00% |
| Closing line coverage | 0.00% |
| Avg side-aware line CLV | - |

## Match Status

| Status | Count | Share |
|---|---:|---:|
| NO_PLAYER_MARKET_LINE | 312 | 32.43% |
| MATCHED_EXACT_LINE_VALID_ODDS | 398 | 41.37% |
| NO_EXACT_LINE_MATCH | 244 | 25.36% |
| MATCHED_EXACT_LINE_INVALID_ODDS | 8 | 0.83% |

## By Market

| Market | Picks | Strict Matches | Coverage | Accuracy | Profit | ROI |
|---|---:|---:|---:|---:|---:|---:|
| PTS | 320 | 101 | 31.56% | 97.03% | 78.56 | 77.78% |
| REB | 263 | 112 | 42.59% | 95.54% | 82.77 | 73.91% |
| AST | 212 | 116 | 54.72% | 96.55% | 98.39 | 84.82% |
| PRA | 142 | 58 | 40.85% | 93.10% | 41.84 | 72.13% |
| RA | 13 | 8 | 61.54% | 100.00% | 6.43 | 80.41% |
| THREES | 12 | 3 | 25.00% | 100.00% | 1.84 | 61.49% |

## Matched vs Unmatched Bias Diagnostics

Internal accuracy compares the model's historical result labels for exact-line matched picks against the selected picks that did not exact-match the external line file.

### By Side

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| OVER | 503 | 209 | 41.55% | 94.74% | 93.88% | 0.86% | 94.74% | 77.01% | -88.32 |
| UNDER | 459 | 189 | 41.18% | 97.35% | 93.70% | 3.65% | 97.35% | 78.78% | -101.10 |

### By Tier

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 536 | 187 | 34.89% | 94.12% | 93.70% | 0.42% | 94.12% | 73.78% | -103.56 |
| S | 419 | 209 | 49.88% | 97.61% | 93.81% | 3.80% | 97.61% | 81.26% | -87.05 |
| B | 6 | 1 | 16.67% | 100.00% | 100.00% | 0.00% | 100.00% | 73.26% | -136.50 |
| C | 1 | 1 | 100.00% | 100.00% | - | - | 100.00% | 129.50% | 129.50 |

### By Month

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | 186 | 90 | 48.39% | 96.67% | 93.75% | 2.92% | 96.67% | 81.09% | -87.36 |
| 2026-03 | 186 | 29 | 15.59% | 100.00% | 94.90% | 5.10% | 100.00% | 83.08% | -97.43 |
| 2025-11 | 170 | 100 | 58.82% | 98.00% | 91.43% | 6.57% | 98.00% | 81.79% | -94.09 |
| 2025-12 | 168 | 95 | 56.55% | 95.79% | 91.78% | 4.01% | 95.79% | 77.27% | -91.86 |
| 2026-02 | 132 | 76 | 57.58% | 90.79% | 100.00% | -9.21% | 90.79% | 67.09% | -104.44 |
| 2026-04 | 108 | 0 | 0.00% | - | 92.59% | - | - | - | - |
| 2025-10 | 12 | 8 | 66.67% | 100.00% | 75.00% | 25.00% | 100.00% | 82.22% | -100.44 |

### By Line Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <5 | 315 | 174 | 55.24% | 95.98% | 94.33% | 1.65% | 95.98% | 81.14% | -60.45 |
| 5-9.5 | 232 | 85 | 36.64% | 97.65% | 93.88% | 3.77% | 97.65% | 76.20% | -123.29 |
| 10-14.5 | 118 | 35 | 29.66% | 100.00% | 92.77% | 7.23% | 100.00% | 83.22% | -120.61 |
| 15-19.5 | 101 | 32 | 31.68% | 93.75% | 97.10% | -3.35% | 93.75% | 71.88% | -120.41 |
| 20-24.5 | 75 | 26 | 34.67% | 96.15% | 89.80% | 6.35% | 96.15% | 77.47% | -118.13 |
| 30+ | 65 | 26 | 40.00% | 92.31% | 92.31% | 0.00% | 92.31% | 70.89% | -117.65 |
| 25-29.5 | 56 | 20 | 35.71% | 90.00% | 94.44% | -4.44% | 90.00% | 65.97% | -118.12 |

### By Prior Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90-92 | 541 | 188 | 34.75% | 94.15% | 93.77% | 0.38% | 94.15% | 73.78% | -103.73 |
| 94+ | 284 | 116 | 40.85% | 97.41% | 92.86% | 4.55% | 97.41% | 82.32% | -81.82 |
| 92-94 | 135 | 93 | 68.89% | 97.85% | 97.62% | 0.23% | 97.85% | 79.94% | -93.57 |
| 88-90 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 129.50% | 129.50 |

### By Final Score Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.90+ | 460 | 169 | 36.74% | 95.86% | 92.78% | 3.08% | 95.86% | 76.25% | -113.97 |
| 0.85-0.90 | 301 | 114 | 37.87% | 92.98% | 94.12% | -1.14% | 92.98% | 74.08% | -81.31 |
| 0.80-0.85 | 177 | 106 | 59.89% | 99.06% | 95.77% | 3.29% | 99.06% | 82.33% | -84.03 |
| 0.75-0.80 | 24 | 9 | 37.50% | 100.00% | 100.00% | 0.00% | 100.00% | 102.85% | -14.22 |

### By Team

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PHX | 49 | 23 | 46.94% | 100.00% | 96.15% | 3.85% | 100.00% | 94.80% | -41.39 |
| UTA | 48 | 29 | 60.42% | 96.55% | 89.47% | 7.08% | 96.55% | 75.09% | -98.76 |
| SAS | 45 | 11 | 24.44% | 90.91% | 94.12% | -3.21% | 90.91% | 62.63% | -130.41 |
| BOS | 41 | 15 | 36.59% | 100.00% | 92.31% | 7.69% | 100.00% | 78.96% | -129.47 |
| DET | 39 | 14 | 35.90% | 85.71% | 92.00% | -6.29% | 85.71% | 54.80% | -115.68 |
| MIL | 38 | 12 | 31.58% | 100.00% | 96.15% | 3.85% | 100.00% | 85.31% | -71.88 |
| WAS | 38 | 25 | 65.79% | 100.00% | 92.31% | 7.69% | 100.00% | 94.26% | -47.54 |
| LAC | 37 | 22 | 59.46% | 100.00% | 93.33% | 6.67% | 100.00% | 84.53% | -102.55 |
| TOR | 37 | 12 | 32.43% | 100.00% | 92.00% | 8.00% | 100.00% | 89.01% | -80.33 |
| SAC | 36 | 19 | 52.78% | 94.74% | 100.00% | -5.26% | 94.74% | 81.32% | -93.39 |
| ATL | 34 | 14 | 41.18% | 100.00% | 85.00% | 15.00% | 100.00% | 80.98% | -112.46 |
| NYK | 34 | 11 | 32.35% | 81.82% | 100.00% | -18.18% | 81.82% | 48.23% | -123.41 |
| LAL | 33 | 11 | 33.33% | 90.91% | 100.00% | -9.09% | 90.91% | 68.68% | -99.82 |
| PHI | 33 | 12 | 36.36% | 91.67% | 95.24% | -3.57% | 91.67% | 70.24% | -103.25 |
| HOU | 32 | 13 | 40.62% | 84.62% | 89.47% | -4.85% | 84.62% | 53.04% | -124.27 |
| NOP | 31 | 15 | 48.39% | 100.00% | 87.50% | 12.50% | 100.00% | 84.03% | -108.40 |
| GSW | 30 | 13 | 43.33% | 100.00% | 94.12% | 5.88% | 100.00% | 78.92% | -128.23 |
| OKC | 30 | 12 | 40.00% | 100.00% | 88.89% | 11.11% | 100.00% | 84.52% | -88.08 |
| CHA | 29 | 16 | 55.17% | 100.00% | 100.00% | 0.00% | 100.00% | 79.75% | -117.53 |
| CHI | 29 | 13 | 44.83% | 92.31% | 100.00% | -7.69% | 92.31% | 76.37% | -67.92 |

### Top Player Buckets

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Justin Champagnie | 19 | 14 | 73.68% | 100.00% | 100.00% | 0.00% | 100.00% | 106.13% | 2.54 |
| Payton Pritchard | 18 | 5 | 27.78% | 100.00% | 84.62% | 15.38% | 100.00% | 79.97% | -126.20 |
| Kawhi Leonard | 17 | 9 | 52.94% | 100.00% | 87.50% | 12.50% | 100.00% | 84.93% | -117.83 |
| Ryan Rollins | 17 | 5 | 29.41% | 100.00% | 100.00% | 0.00% | 100.00% | 83.37% | -81.20 |
| Ryan Dunn | 16 | 13 | 81.25% | 100.00% | 100.00% | 0.00% | 100.00% | 104.37% | -7.96 |
| VJ Edgecombe | 14 | 3 | 21.43% | 100.00% | 100.00% | 0.00% | 100.00% | 78.23% | -131.17 |
| Kyle Filipowski | 13 | 7 | 53.85% | 85.71% | 100.00% | -14.29% | 85.71% | 58.36% | -90.29 |
| Luka Dončić | 13 | 6 | 46.15% | 83.33% | 100.00% | -16.67% | 83.33% | 53.02% | -120.25 |
| Evan Mobley | 12 | 5 | 41.67% | 100.00% | 100.00% | 0.00% | 100.00% | 84.03% | -119.80 |
| Quentin Grimes | 12 | 5 | 41.67% | 80.00% | 85.71% | -5.71% | 80.00% | 46.85% | -120.90 |
| Scottie Barnes | 12 | 4 | 33.33% | 100.00% | 87.50% | 12.50% | 100.00% | 84.16% | -118.88 |
| Corey Kispert | 11 | 9 | 81.82% | 100.00% | 100.00% | 0.00% | 100.00% | 79.35% | -107.94 |
| Jeremiah Fears | 11 | 5 | 45.45% | 100.00% | 83.33% | 16.67% | 100.00% | 85.97% | -116.40 |
| Svi Mykhailiuk | 11 | 11 | 100.00% | 100.00% | - | - | 100.00% | 75.61% | -119.95 |
| Victor Wembanyama | 11 | 1 | 9.09% | 100.00% | 90.00% | 10.00% | 100.00% | 78.43% | -127.50 |
| Bobby Portis | 10 | 3 | 30.00% | 100.00% | 85.71% | 14.29% | 100.00% | 96.08% | -40.67 |
| Deni Avdija | 10 | 5 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 84.63% | -118.30 |
| Nickeil Alexander-Walker | 10 | 4 | 40.00% | 100.00% | 83.33% | 16.67% | 100.00% | 74.46% | -136.50 |
| Nikola Jokić | 10 | 2 | 20.00% | 100.00% | 87.50% | 12.50% | 100.00% | 84.59% | -118.25 |
| Russell Westbrook | 10 | 8 | 80.00% | 100.00% | 100.00% | 0.00% | 100.00% | 81.39% | -123.50 |

### By Book

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bet365 | 167 | 122 | 73.05% | 97.54% | 93.33% | 4.21% | 97.54% | 85.03% | -67.88 |
| draftkings | 126 | 100 | 79.37% | 96.00% | 96.15% | -0.15% | 96.00% | 75.55% | -111.48 |
| hardrock | 94 | 30 | 31.91% | 100.00% | 96.88% | 3.12% | 100.00% | 84.73% | -99.45 |
| fanatics | 93 | 53 | 56.99% | 94.34% | 100.00% | -5.66% | 94.34% | 74.21% | -88.72 |
| riverscasino | 52 | 28 | 53.85% | 92.86% | 87.50% | 5.36% | 92.86% | 70.49% | -108.34 |
| fanduel | 41 | 28 | 68.29% | 92.86% | 100.00% | -7.14% | 92.86% | 71.80% | -111.46 |
| underdog | 25 | 13 | 52.00% | 100.00% | 91.67% | 8.33% | 100.00% | 71.87% | -141.88 |
| prizepicks | 20 | 0 | 0.00% | - | 95.00% | - | - | - | - |
| betmgm | 13 | 12 | 92.31% | 100.00% | 100.00% | 0.00% | 100.00% | 87.77% | -82.17 |
| caesars | 9 | 8 | 88.89% | 75.00% | 100.00% | -25.00% | 75.00% | 37.62% | -118.06 |
| sleeper | 8 | 3 | 37.50% | 100.00% | 80.00% | 20.00% | 100.00% | 76.02% | -131.67 |
| rivers-casino | 2 | 1 | 50.00% | 100.00% | 0.00% | 100.00% | 100.00% | 80.00% | -125.00 |

### By Price Bucket

| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| -149 to -120 | 285 | 188 | 65.96% | 95.21% | 94.85% | 0.36% | 95.21% | 69.36% | -129.05 |
| -119 to -100 | 216 | 119 | 55.09% | 95.80% | 93.81% | 1.99% | 95.80% | 80.50% | -113.23 |
| +100 to +149 | 81 | 46 | 56.79% | 97.83% | 97.14% | 0.69% | 97.83% | 110.04% | 115.37 |
| -199 to -150 | 39 | 37 | 94.87% | 97.30% | 100.00% | -2.70% | 97.30% | 56.45% | -164.93 |
| +150 to +199 | 7 | 7 | 100.00% | 100.00% | - | - | 100.00% | 166.43% | 166.43 |
| <=-200 | 2 | 1 | 50.00% | 100.00% | 100.00% | 0.00% | 100.00% | 50.00% | -200.00 |

## Full Coverage Diagnostic Layer

This section grades every selected pick using a tiered ladder. Only `EXACT_EXTERNAL_LINE_VALID_ODDS` is exact external market proof.

| Metric | Value |
|---|---:|
| Full coverage rows | 962 |
| Full coverage | 100.00% |
| Full coverage accuracy | 94.48% |
| Full coverage profit | 743.51 |
| Full coverage ROI | 77.29% |
| External priced coverage | 65.49% |
| Assumed/internal fallback rows | 332 |
| Avg nearest external abs line gap | 1.26 |
| Max nearest external abs line gap | 12.00 |

### By Coverage Tier

| Tier | Rows | Share | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|---:|
| EXACT_EXTERNAL_LINE_VALID_ODDS | 398 | 41.37% | 95.98% | 309.84 | 77.85% | 0.00 |
| INTERNAL_MODEL_LINE_ASSUMED_ODDS | 332 | 34.51% | 93.07% | 257.91 | 77.68% | 0.00 |
| NEAREST_EXTERNAL_LINE_VALID_ODDS | 232 | 24.12% | 93.94% | 175.76 | 75.76% | 1.26 |

### Full Coverage By Market

| Market | Rows | Accuracy | Profit | ROI | Avg Abs Line Gap |
|---|---:|---:|---:|---:|---:|
| PTS | 320 | 95.31% | 246.96 | 77.17% | 0.48 |
| REB | 263 | 94.30% | 200.22 | 76.13% | 0.23 |
| AST | 212 | 96.21% | 179.28 | 84.57% | 0.13 |
| PRA | 142 | 90.14% | 98.87 | 69.62% | 0.32 |
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
