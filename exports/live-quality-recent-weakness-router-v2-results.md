# Live Quality Recent Weakness Router V2 Results

Generated: 2026-04-24

## Bottom Line

V2 adds a second recent-window router after the pushed V1 router. It clears the requested +2 percentage-point lift on the last 30 and last 14 active-date windows, while keeping every row assigned a side.

| Window | Before V2 | After V2 | Accuracy Gain | Win Gain |
|---|---:|---:|---:|---:|
| Overall | 66.87% (79,370-39,318) | 67.21% (79,770-38,918) | +0.34 pts | +400 |
| Last 30 active dates | 66.01% (12,483-6,427) | 68.13% (12,883-6,027) | +2.12 pts | +400 |
| Last 14 active dates | 62.45% (4,285-2,576) | 68.79% (4,720-2,141) | +6.34 pts | +435 |

## What Changed

- Promoted the router default from V1 to `recent-weakness-router-v2-2026-04-24`.
- Kept V1 as the first pass, then added a first-match V2 layer for late-window weak cells.
- V2 keys off market/source/side plus pre-result model context: minutes role bins, line-gap bins, favored side, model archetype/kind, and universal confidence bins.
- Passed the same V2 inputs through the live board path and evaluator path so the website and backtest stay aligned.

## Caveat

Replay-tuned on the current row export and now frozen forward. Treat future settled slates as the real proof.
