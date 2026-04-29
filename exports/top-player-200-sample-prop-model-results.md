# Top Player 200-Sample NBA Prop Model

Generated: 2026-04-29

## Decision

Promote the top-200 sample-count lane as the clean 200+ sample model. It clears 80% overall, last 30, and last 14 active-date windows while using all eight prop markets and one selected market per player per slate.

## Primary Lane

| Metric | Value |
|---|---:|
| Accuracy | 82.39% |
| Runtime-side accuracy check | 82.31% |
| Runtime side agreement | 99.92% |
| Player-days | 2,431 |
| Correct / wrong | 2,003 / 428 |
| Runtime correct / wrong | 2,001 / 430 |
| Unique players touched | 195 |
| Avg players per slate | 15.01 |
| Active dates | 162 |
| Last 30 active dates | 80.26% |
| Last 14 active dates | 81.74% |
| Runtime last 30 active dates | 80.26% |
| Runtime last 14 active dates | 81.74% |
| Coverage vs eligible player-days | 19.76% |

Rule: `top200_sample_count: one highest wfConfidence market per player, wfConfidence >= 0.840`

## Comparison Lanes

| Lane | Accuracy | Player-days | Last 30 | Last 14 | Coverage | Correct / wrong |
|---|---:|---:|---:|---:|---:|---:|
| Primary: top200_sample_count | 82.39% | 2,431 | 80.26% | 81.74% | 19.76% | 2,003 / 428 |
| Accuracy-first: top200_sample_count | 86.79% | 212 | 92.59% | 95.24% | 1.72% | 184 / 28 |
| Widest 80 overall: all_min200 | 80.14% | 10,952 | 79.13% | 70.48% | 77.95% | 8,777 / 2,175 |

## Primary Market Mix

| Market | Selected player-days |
|---|---:|
| REB | 576 |
| PTS | 503 |
| AST | 431 |
| PRA | 286 |
| PA | 280 |
| PR | 216 |
| RA | 94 |
| THREES | 45 |

## Search Leaders

| Lane | Threshold | Accuracy | Player-days | Last 30 | Last 14 | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| top200_sample_count | 0.840 | 82.39% | 2,431 | 80.26% | 81.74% | 19.76% |
| all_min200 | 0.845 | 82.64% | 2,292 | 81.63% | 80.41% | 16.31% |
| top200_sample_count | 0.850 | 82.22% | 1,479 | 81.32% | 80.39% | 12.02% |
| top200_sample_count | 0.860 | 82.72% | 949 | 83.33% | 86.36% | 7.71% |
| top200_sample_count | 0.865 | 83.54% | 729 | 83.58% | 81.25% | 5.92% |
| all_min200 | 0.870 | 83.92% | 709 | 81.36% | 80.00% | 5.05% |
| top200_sample_count | 0.880 | 86.69% | 353 | 88.46% | 86.96% | 2.87% |
| all_min200 | 0.885 | 86.35% | 337 | 88.00% | 83.33% | 2.40% |
| top200_sample_count | 0.885 | 86.55% | 275 | 93.18% | 95.45% | 2.23% |
| all_min200 | 0.890 | 86.25% | 269 | 91.30% | 84.21% | 1.91% |
| top200_sample_count | 0.890 | 86.79% | 212 | 92.59% | 95.24% | 1.72% |
| all_min200 | 0.895 | 86.19% | 210 | 91.30% | 90.91% | 1.49% |
| top200_sample_count | 0.895 | 85.63% | 167 | 87.76% | 95.00% | 1.36% |
| all_min200 | 0.900 | 84.24% | 165 | 88.89% | 88.89% | 1.17% |
| top200_sample_count | 0.900 | 83.97% | 131 | 88.64% | 94.44% | 1.06% |

## Player Qualification

- Qualified players with at least 200 row samples: `246`
- Primary pool: top `200` by season row samples
- Markets included: `PTS, REB, AST, THREES, PRA, PA, PR, RA`

Top primary-pool players by sample count:

1. Desmond Bane - 677 samples, 85 active dates, 33.47 avg projected min
2. Julian Champagnie - 669 samples, 84 active dates, 27.43 avg projected min
3. Toumani Camara - 665 samples, 84 active dates, 32.79 avg projected min
4. Mikal Bridges - 657 samples, 84 active dates, 32.86 avg projected min
5. Kon Knueppel - 651 samples, 82 active dates, 31.01 avg projected min
6. Brandin Podziemski - 651 samples, 82 active dates, 28.31 avg projected min
7. Kris Dunn - 645 samples, 81 active dates, 26.57 avg projected min
8. Reed Sheppard - 645 samples, 81 active dates, 25.75 avg projected min
9. Keldon Johnson - 642 samples, 82 active dates, 23.03 avg projected min
10. Collin Gillespie - 640 samples, 81 active dates, 28.30 avg projected min
11. Bub Carrington - 637 samples, 80 active dates, 27.32 avg projected min
12. Nickeil Alexander-Walker - 636 samples, 80 active dates, 32.70 avg projected min
13. Donte DiVincenzo - 634 samples, 82 active dates, 30.05 avg projected min
14. Scottie Barnes - 628 samples, 81 active dates, 33.06 avg projected min
15. Julius Randle - 625 samples, 80 active dates, 32.69 avg projected min
16. Royce O'Neale - 624 samples, 80 active dates, 28.02 avg projected min
17. Payton Pritchard - 623 samples, 80 active dates, 32.20 avg projected min
18. Bruce Brown - 622 samples, 82 active dates, 24.26 avg projected min
19. Dyson Daniels - 620 samples, 78 active dates, 32.84 avg projected min
20. Donovan Clingan - 620 samples, 78 active dates, 26.78 avg projected min
21. Jeremiah Fears - 620 samples, 78 active dates, 24.75 avg projected min
22. Brandon Ingram - 616 samples, 77 active dates, 33.33 avg projected min
23. Quentin Grimes - 614 samples, 77 active dates, 29.84 avg projected min
24. Duncan Robinson - 609 samples, 77 active dates, 27.18 avg projected min
25. Karl-Anthony Towns - 608 samples, 78 active dates, 30.54 avg projected min
26. Amen Thompson - 605 samples, 80 active dates, 36.90 avg projected min
27. Derrick White - 605 samples, 78 active dates, 34.18 avg projected min
28. Kevin Durant - 604 samples, 78 active dates, 35.58 avg projected min
29. VJ Edgecombe - 598 samples, 77 active dates, 34.57 avg projected min
30. Onyeka Okongwu - 596 samples, 76 active dates, 30.85 avg projected min
31. Jamal Shead - 595 samples, 79 active dates, 22.46 avg projected min
32. Jamal Murray - 591 samples, 76 active dates, 34.53 avg projected min
33. Paolo Banchero - 591 samples, 74 active dates, 34.49 avg projected min
34. Max Christie - 589 samples, 74 active dates, 29.00 avg projected min
35. Sam Hauser - 588 samples, 76 active dates, 24.39 avg projected min
36. Derik Queen - 588 samples, 74 active dates, 24.35 avg projected min
37. Matas Buzelis - 586 samples, 75 active dates, 28.75 avg projected min
38. Tristan da Silva - 585 samples, 74 active dates, 24.30 avg projected min
39. Jalen Brunson - 584 samples, 76 active dates, 34.34 avg projected min
40. De'Aaron Fox - 584 samples, 75 active dates, 30.79 avg projected min

## Honesty Note

This is a strict learned-only walk-forward replay after the first training window. Each fold trains only on earlier dates, then predicts the actual OVER/UNDER side on later dates. The player pool is selected by season row sample count, not by future win rate. No actualValue, actualSide, or correctness fields are used as model inputs.

