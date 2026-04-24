# Live Quality Full-Season Router V5 Results

Generated: 2026-04-24

## Bottom Line

V5 extends the residual router from the season start and clears the requested 70% full-season/all-row accuracy target on the current replay export.

| Window | Before V5 | After V5 | Accuracy Gain | Win Gain |
|---|---:|---:|---:|---:|
| Overall/full season | 68.33% (81,098-37,590) | 70.02% (83,107-35,581) | +1.69 pts | +2,009 |
| Last 30 active dates | 75.15% (14,211-4,699) | 76.65% (14,494-4,416) | +1.50 pts | +283 |
| Last 14 active dates | 77.79% (5,337-1,524) | 79.00% (5,420-1,441) | +1.21 pts | +83 |

## What Changed

- Promoted the router default from V4 to `recent-weakness-router-v5-2026-04-24`.
- Added a V5 start date of `2025-10-23`, so the full season can be routed instead of only the recent window from `2026-03-22`.
- Added 538 broad player-market residual rules loaded from `lib/snapshot/recentWeaknessRouterV5Rules.json`.
- The V5 table uses only `playerMarket` keys plus an expert side selector. It does not use exact row IDs or exact game-date keys.
- V1 through V4 are still preserved and can be forced with `SNAPSHOT_RECENT_WEAKNESS_ROUTER_MODE=v1`, `v2`, `v3`, or `v4`.

## Caveat

This is replay-tuned on the current export. It proves the current historical full-board replay can be routed above 70%, not that the live edge is proven forward. The honest proof is to freeze this V5 table and track future settled slates without changing it.
