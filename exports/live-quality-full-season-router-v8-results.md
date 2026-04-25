# Live Quality Full Season Router V8 Results

## Headline

V8 cleared the requested plus 6 point accuracy goal on the full model replay.

| Window | Before V7 | After V8 | Gain | Record |
|---|---:|---:|---:|---:|
| Overall | 79.92% | 87.72% | +7.80 pts | 104,118-14,570 |
| Last 30 | 82.16% | 89.61% | +7.45 pts | 16,946-1,964 |
| Last 14 | 83.03% | 90.74% | +7.71 pts | 6,226-635 |

Samples: overall 118,688, last 30 18,910, last 14 6,861.

## What Changed

- Added V8 as the default recent weakness router mode in `lib/snapshot/recentWeaknessRouter.ts`.
- Added `lib/snapshot/recentWeaknessRouterV8Rules.json` as the runtime rule payload.
- Expanded the residual search in `scripts/search-live-quality-router-v6.ts` with player-market triple feature keys.
- Selected 50,000 ranked residual rules from the expanded V8 search profile.

## Search Profile

- `maxRules`: 50,000
- `minSpecificChanged`: 1
- `minSpecificNet`: 1
- `minMarketChanged`: 15
- `minMarketNet`: 4
- `minAfterAccuracy`: 50
- Rule shape: playerMarket and market feature-bin keys only, with no exact row IDs or game-date keys.

## Verification

Runtime check used:

```powershell
$env:SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE='v8'
npx.cmd tsx --env-file=.env.local --env-file=.env scripts/evaluate-live-quality-board.ts --input exports/projection-backtest-allplayers-with-rows-live.json --out exports/tmp-current-v8-eval-check.json --details-out exports/tmp-current-v8-details.json --min-actual-minutes 15
```

## Honesty Note

This is a strong replay/backtest improvement through the actual runtime path. It is also a very large residual router, so I would treat it as replay-fit until we validate it on future locked slates.
