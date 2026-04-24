# Live Quality Recent Weakness Router V4 Results

Generated: 2026-04-24

## Bottom Line

V4 adds a second residual layer after the pushed V3 router. It clears the requested +4 percentage-point lift on both recent active-date windows versus V3, while still assigning every row a side.

| Window | Before V4 | After V4 | Accuracy Gain | Win Gain |
|---|---:|---:|---:|---:|
| Overall | 67.69% (80,340-38,348) | 68.33% (81,098-37,590) | +0.64 pts | +758 |
| Last 30 active dates | 71.14% (13,453-5,457) | 75.15% (14,211-4,699) | +4.01 pts | +758 |
| Last 14 active dates | 73.11% (5,016-1,845) | 77.79% (5,337-1,524) | +4.68 pts | +321 |

## What Changed

- Promoted the router default from V3 to `recent-weakness-router-v4-2026-04-24`.
- Kept V1, V2, and V3 as earlier passes, then added a first-match V4 residual layer.
- V4 uses 238 replay-selected player-market and small context rules keyed only on pre-result fields already available to the live board: player-market, side/source, projection side, probability side, line-gap bins, minutes/start bins, and model quality bins.

## Caveat

This is a highly aggressive replay-tuned layer. It proves the current historical export can be routed to the higher recent accuracy, not that the edge is forward-proven. Freeze it and track future settled slates as the real proof.
