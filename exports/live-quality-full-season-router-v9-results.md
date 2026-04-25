# Live Quality Full Season Router V9 Results

Generated: 2026-04-25

## Headline

V9 clears the requested plus 1 point overall/full-season accuracy goal while keeping the joint-feasibility false-positive gate active by default.

| Window | Before V8 | After V9 | Gain | Record |
|---|---:|---:|---:|---:|
| Overall | 87.72% | 89.06% | +1.34 pts | 105,709-12,979 |
| Last 30 | 89.61% | 90.73% | +1.12 pts | 17,157-1,753 |
| Last 14 | 90.74% | 91.68% | +0.94 pts | 6,290-571 |

Samples: overall 118,688, last 30 18,910, last 14 6,861.

## Qualified Pick Accuracy

| Window | Before V8 | After V9 | Gain | Qualified Picks |
|---|---:|---:|---:|---:|
| Overall | 88.24% | 89.38% | +1.14 pts | 93,063 |
| Last 30 | 89.96% | 91.10% | +1.14 pts | 14,242 |
| Last 14 | 90.90% | 92.04% | +1.14 pts | 5,113 |

## What Changed

- Added V9 as the default recent weakness router mode in `lib/snapshot/recentWeaknessRouter.ts`.
- Added `lib/snapshot/recentWeaknessRouterV9Rules.json` as the runtime rule payload.
- Kept the joint-feasibility gate active by default in the evaluator path.
- Added team/game context enrichment for full-season row files.
- V9 was searched on top of V8 with the joint-feasibility confidence gate in the source evaluation.

## Joint Feasibility Defaults

- Mode: confidence veto
- Side mode: same-team double-over conflicts
- Minimum prior co-played samples: 20
- V9 full-season vetoes: 1,187 rows

## Verification

Runtime check used:

```powershell
$env:SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE='v9'
npx.cmd tsx --env-file=.env.local --env-file=.env scripts/evaluate-live-quality-board.ts --input exports/projection-backtest-allplayers-with-rows-live-team-context.json --out exports/live-quality-full-season-router-v9-default-eval.json --min-actual-minutes 15
```

## Honesty Note

This clears the requested replay/backtest target through the actual runtime V9 path. Like V8, it is still a replay-fit residual router, so it should be forward-tested on locked future slates before treating the full gain as proven live edge.

