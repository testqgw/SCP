# Joint Feasibility Gate V1 Results

Generated: 2026-04-25

## Bottom Line

The original final V8 model was strong row-by-row, but it could still create false positives by treating same-team overs as independent.

V1 adds a walk-forward same-team double-over feasibility check. It does not flip the pick side. It only removes the weaker leg from the qualified/high-confidence bucket when prior same-team co-hit evidence is poor.

## Conservative V1 Setting

- Mode: confidence veto only
- Side mode: same-team double-over conflicts only
- Minimum prior co-played samples: 20
- Uses only earlier dates before each tested slate
- Conflict example shape: Player A OVER + Player B OVER co-hit 4/34 when independence expected about 21%

## Full Season V8 Comparison

| Window | Baseline Qualified | V1 Qualified | Gain | Qualified Picks | Coverage | Blended |
|---|---:|---:|---:|---:|---:|---:|
| Overall | 88.24% | 88.26% | +0.02 pts | 92,818 (-1,120) | 78.20% (-0.95 pts) | 87.72% |
| Last 30 active dates | 89.96% | 89.98% | +0.02 pts | 14,276 (-209) | 75.49% (-1.11 pts) | 89.61% |
| Last 14 active dates | 90.90% | 90.93% | +0.03 pts | 5,135 (-64) | 74.84% (-0.94 pts) | 90.74% |

## Why This Matters

This is not a raw accuracy booster yet. It is a false-positive control layer.

The important improvement is that the model now has a way to say:

```text
This individual prop may still be the right side,
but it is not clean when paired with another same-team over.
```

That is the missing logic for examples like two teammates both projected over high scoring lines when they almost never both clear those thresholds together.

## Artifacts

- Enriched full-season rows: `projection-backtest-allplayers-with-rows-live-team-context.json`
- Baseline V8 eval: `joint-feasibility-v1-full-season-v8-baseline-eval.json`
- Conservative V1 eval: `joint-feasibility-v1-full-season-v8-double-over-ms20-eval.json`
- Conservative V1 details: `joint-feasibility-v1-full-season-v8-double-over-ms20-details.json`

## Implementation Notes

- Added team/game context to emitted backtest rows.
- Added `scripts/enrich-live-quality-rows-with-team-context.ts` for enriching existing full-season row files from DB logs.
- Added `scripts/utils/liveQualityJointFeasibility.ts` for walk-forward pair feasibility scoring.
- Added `--joint-feasibility-gate` and `--joint-feasibility-min-samples` to `scripts/evaluate-live-quality-board.ts`.

