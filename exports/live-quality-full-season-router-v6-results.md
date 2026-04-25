# Live Quality Full Season Router V6 Results

V6 is now the default recent-weakness router. It runs after V5 and uses a ranked residual rule layer over player-market and market feature-bin patterns. It does not use exact row IDs or game-date keys.

| Window | Before | After | Gain | Wins Added |
| --- | ---: | ---: | ---: | ---: |
| Overall | 70.02% | 74.06% | +4.04 pts | +4,798 |
| Last 30 | 76.65% | 78.66% | +2.01 pts | +380 |
| Last 14 | 79.00% | 80.38% | +1.38 pts | +95 |

## Verification

- Runtime mode: `v6`
- Router version: `recent-weakness-router-v6-2026-04-25`
- Rules: `3,500`
- Dataset: `exports/projection-backtest-allplayers-with-rows-live.json`
- Range: `2025-10-23` through `2026-04-23`
- Filter: `minActualMinutes >= 15`
- Runtime command: `SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE=v6 npx tsx --env-file=.env.local --env-file=.env scripts/evaluate-live-quality-board.ts --input exports/projection-backtest-allplayers-with-rows-live.json --min-actual-minutes 15`

## Caveat

This clears the requested +4 percentage-point lift on the current replay, and the normal app evaluation path reproduces it. It is still replay-tuned, not forward proof. The clean proof is to track V6 on future locked slates and compare it against V5 before settlement.
