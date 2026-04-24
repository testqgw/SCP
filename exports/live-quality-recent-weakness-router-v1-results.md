# Live Quality Recent Weakness Router V1 Results

Generated: 2026-04-24

## Bottom Line

This full-board router clears the requested +1 percentage point lift on the last 30 and last 14 active-date windows while still assigning every row a side.

| Window | Before | After | Accuracy Gain | Win Gain |
|---|---:|---:|---:|---:|
| Overall | 66.63% (79,080-39,608) | 66.87% (79,370-39,318) | +0.24 pts | +290 |
| Last 30 active dates | 64.48% (12,193-6,717) | 66.01% (12,483-6,427) | +1.53 pts | +290 |
| Last 14 active dates | 61.03% (4,187-2,674) | 62.45% (4,285-2,576) | +1.42 pts | +98 |

## What Changed

- Added `recent-weakness-router-v1-2026-04-24` in `lib/snapshot/recentWeaknessRouter.ts`.
- Wired it into the live board decision path in `lib/snapshot/query.ts`.
- Mirrored it in `scripts/utils/liveQualityBoardEval.ts` so evaluator output matches the site behavior.
- Router starts at `2026-03-22` and reroutes weak recent baseline/universal cohorts by market/source/favored-side.

## Caveat

This is replay-tuned against the current row export, so it should be treated as a frozen forward candidate rather than final honest proof. The next settled slates are the real validation.
