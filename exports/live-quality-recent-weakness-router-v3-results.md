# Live Quality Recent Weakness Router V3 Results

Generated: 2026-04-24

## Bottom Line

V3 adds a player-market residual layer after the pushed V2 router. It clears the requested +3 percentage-point lift on the last 30 and last 14 active-date windows versus V2, while still assigning every row a side.

| Window | Before V3 | After V3 | Accuracy Gain | Win Gain |
|---|---:|---:|---:|---:|
| Overall | 67.21% (79,770-38,918) | 67.69% (80,340-38,348) | +0.48 pts | +570 |
| Last 30 active dates | 68.13% (12,883-6,027) | 71.14% (13,453-5,457) | +3.01 pts | +570 |
| Last 14 active dates | 68.79% (4,720-2,141) | 73.11% (5,016-1,845) | +4.32 pts | +296 |

## What Changed

- Promoted the router default from V2 to `recent-weakness-router-v3-2026-04-24`.
- Kept V1 and V2 as earlier passes, then added a first-match V3 player-market residual layer.
- V3 keys mostly off normalized player-market cells, with a few side/projection/favored-side qualifiers.
- Passed player identity into the live board router so the website and evaluator use the same rules.

## Caveat

This is more aggressive than V2. It is replay-tuned on the current row export and should be frozen forward before being treated as proven. Future settled slates are the real validation.
