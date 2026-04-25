# Final Model Pairwise Synergy Validation

Generated: 2026-04-25

## Bottom Line

Pairwise teammate synergy was tested against the final V8 evaluator, not just raw projection side accuracy.

Verdict: do not activate pairwise teammate synergy inside the final pick/projection logic yet. It slightly reduced the final V8 recent-window result.

| Model Input | Samples | Raw Accuracy | Qualified Accuracy | Qualified Picks | Coverage | Blended Accuracy |
|---|---:|---:|---:|---:|---:|---:|
| Baseline final V8 | 6,860 | 59.88% | 76.88% | 5,004 | 72.94% | 74.52% |
| Pairwise synergy final V8 | 6,861 | 59.76% | 76.77% | 4,985 | 72.66% | 74.32% |
| Delta | +1 | -0.12 pts | -0.11 pts | -19 | -0.28 pts | -0.20 pts |

## By Market

| Market | Baseline Blended | Pairwise Blended | Delta | Baseline Qualified | Pairwise Qualified | Delta |
|---|---:|---:|---:|---:|---:|---:|
| PTS | 74.02% | 73.91% | -0.11 pts | 75.41% | 75.33% | -0.08 pts |
| REB | 76.75% | 76.86% | +0.11 pts | 78.73% | 78.76% | +0.03 pts |
| AST | 76.10% | 75.97% | -0.13 pts | 77.13% | 77.13% | 0.00 pts |
| THREES | 75.00% | 75.13% | +0.13 pts | 77.03% | 77.17% | +0.14 pts |
| PRA | 71.81% | 71.70% | -0.11 pts | 74.65% | 74.26% | -0.39 pts |
| PA | 72.79% | 72.24% | -0.55 pts | 76.54% | 76.03% | -0.51 pts |
| PR | 74.80% | 74.35% | -0.45 pts | 77.07% | 77.31% | +0.24 pts |
| RA | 75.20% | 74.74% | -0.46 pts | 78.62% | 78.29% | -0.33 pts |

## What This Means

The teammate synergy signal is real enough to show as player context, but the current adjustment formula is not good enough to improve the final V8 model.

The live code is intentionally gated:

```text
SNAPSHOT_PAIRWISE_TEAMMATE_SYNERGY=1
```

Unless that environment variable is enabled, pairwise teammate synergy does not alter live projections or final pick logic.

## Files

- Baseline rows: `final-model-synergy-baseline-rows-2026-04-07-to-2026-04-23.json`
- Pairwise rows: `final-model-synergy-pairwise-rows-2026-04-07-to-2026-04-23.json`
- Baseline V8 eval: `final-model-synergy-baseline-v8-eval-2026-04-07-to-2026-04-23.json`
- Pairwise V8 eval: `final-model-synergy-pairwise-v8-eval-2026-04-07-to-2026-04-23.json`

