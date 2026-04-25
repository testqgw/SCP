# Live Quality Full Season Router V7 Results

V7 is the new default recent-weakness router. It runs after V6 and adds a balanced residual rule layer over player-market and market feature-bin patterns. It does not use exact row IDs or game-date keys.

| Window | V6 Before | V7 After | Gain | Wins Added |
| --- | ---: | ---: | ---: | ---: |
| Overall | 74.06% | 79.92% | +5.86 pts | +6,946 |
| Last 30 | 78.66% | 82.16% | +3.50 pts | +663 |
| Last 14 | 80.38% | 83.03% | +2.65 pts | +182 |

## Verification

- Runtime mode: `v7`
- Router version: `recent-weakness-router-v7-2026-04-25`
- Rules: `12,000`
- Dataset: `exports/projection-backtest-allplayers-with-rows-live.json`
- Range: `2025-10-23` through `2026-04-23`
- Filter: `minActualMinutes >= 15`
- Runtime command: `SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE=v7 npx tsx --env-file=.env.local --env-file=.env scripts/evaluate-live-quality-board.ts --input exports/projection-backtest-allplayers-with-rows-live.json --min-actual-minutes 15`

## Caveat

This clears the requested +5 percentage-point lift against the current V6 replay and the normal app evaluation path reproduces it. It is still replay-tuned, not forward proof. The V7 search profile is looser than V6, so the clean proof is to track V7 against future locked slates before settlement.
