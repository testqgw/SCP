# Projection 115 Base V2 Market Selector

Generated: 2026-04-28

## Readout

| Model | Accuracy | Player-days | Correct / wrong | Warm accuracy | Last 30 | Last 14 |
|---|---:|---:|---:|---:|---:|---:|
| Existing base 115 | 80.75% | 3,154 | 2,547 / 607 | - | 83.23% | 77.13% |
| Existing source router | 81.10% | 3,154 | 2,558 / 596 | 82.93% | 83.86% | 74.47% |
| Base V2 market selector | 82.78% | 3,154 | 2,611 / 543 | 84.87% | 85.12% | 75.53% |
| Current-final market oracle | 98.42% | 2,730 | 2,687 / 43 | - | - | - |

## Conclusion

Base V2 improves the full 115-player replay, but it is not a 90% base model yet. Do not promote this as a 90% model; treat it as the strongest honest base-direction move found so far.

## Base V2 Rule

`cold current-final by projectionWinScore, then honest walk-forward HGB market ranker trained to predict whether the current-final side is correct`

The first 21 active dates stay cold-start and use the current-final side ranked by projectionWinScore. Every later fold is trained only on earlier dates.

## Base V2 Market Mix

| Market | Selected player-days |
|---|---:|
| REB | 729 |
| AST | 709 |
| PTS | 674 |
| PR | 321 |
| PRA | 243 |
| RA | 171 |
| THREES | 157 |
| PA | 150 |

## Why This Was The Next Move

The warm current-final market oracle is still far above the learned selector, so the blocker is not simply side vocabulary. The base model needs a better market-choice signal before a true full-coverage 90% claim is honest.

