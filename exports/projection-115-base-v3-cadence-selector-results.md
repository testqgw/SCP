# Projection 115 Base V3 Cadence Selector

Generated: 2026-04-28

## Readout

| Model | Accuracy | Player-days | Correct / wrong | Warm accuracy | Last 30 | Last 14 |
|---|---:|---:|---:|---:|---:|---:|
| Existing base 115 | 80.75% | 3,154 | 2,547 / 607 | - | 83.23% | 77.13% |
| Source router | 81.10% | 3,154 | 2,558 / 596 | 82.93% | 83.86% | 74.47% |
| Base V2 market selector | 82.78% | 3,154 | 2,611 / 543 | 84.87% | 85.12% | 75.53% |
| Base V3 cadence selector | 83.54% | 3,154 | 2,635 / 519 | 84.22% | 85.12% | 76.06% |

## Cadence Search

| Cadence | Accuracy | Correct / wrong | Warm accuracy | Cold player-days | Last 30 | Last 14 |
|---|---:|---:|---:|---:|---:|---:|
| 21 train / 7 test | 82.75% | 2,610 / 544 | 84.84% | 424 | 85.12% | 76.06% |
| 14 train / 7 test | 83.39% | 2,630 / 524 | 84.72% | 267 | 85.12% | 76.06% |
| 7 train / 7 test | 83.54% | 2,635 / 519 | 84.22% | 131 | 85.12% | 76.06% |
| 5 train / 7 test | 82.72% | 2,609 / 545 | 83.21% | 93 | 83.23% | 73.40% |

## Conclusion

The 7-date warmup / 7-date retrain cadence is the best full 115-player base replay found in this pass at 83.54%. It improves the base but is still not a 90% base model.

## Best Rule

`cold current-final by projectionWinScore for 7 active dates, then honest 7-date walk-forward HGB market ranker trained to predict whether the current-final side is correct`

This is still full 115-player coverage, one market per player per slate. It is not the narrow 90% research lane.

## Market Mix

| Market | Selected player-days |
|---|---:|
| REB | 721 |
| AST | 716 |
| PTS | 702 |
| PR | 309 |
| PRA | 237 |
| RA | 167 |
| THREES | 151 |
| PA | 151 |

## Honesty Note

Features are limited to row/model/context fields available in the source snapshots plus rolling reliability computed only from earlier dates. actualValue, actualSide, correctness flags, and actualMinutes are not used as model inputs.
