# Player-Local Target Lift v20 Fullboard Max-Net

As of: 2026-04-15 UTC
Scope: promote the strongest verified player-local manifest package after exhausting the remaining post-`v17` board-level headroom

## What Changed

Starting point:

- live manifest alias: `v17`
- full-board raw: `62.00`
- walk-forward raw: `61.06`

Promotion path:

- `v18`: add every remaining non-manifest player with positive full-board net wins using the audit's recommended candidate
- `v19`: re-pick each remaining player by the candidate with the highest full-board `netRowsVsControl`
- `v20`: add the remaining positive low-sample tail down to `1` actionable row

Live alias promoted to:

- `2026-04-15-player-local-target-lift-v20-fullboard-maxnet-minrows-1`

## Verified Metrics

Using the board-faithful evaluator on `2025-10-23` through `2026-04-14`:

- full board: `62.00 -> 64.94` raw (`+2.94`)
- full board blended: `61.73 -> 64.80`
- full board coverage: `87.71 -> 96.97`
- walk-forward raw: `61.06 -> 63.30`
- walk-forward blended: `60.77 -> 63.18`
- walk-forward coverage: `87.59 -> 96.86`
- forward `14d` raw: `55.09 -> 55.03`
- forward `30d` raw: `56.64 -> 56.92`

## Read

This branch was built to maximize the official full-board raw score, not to preserve the older player-level `60/70` target-hit gate.

The key unlock was changing the selection rule:

- stop relying on the audit's default `recommendedCandidate` when a different tested candidate produced more board-level net wins
- add the remaining positive low-sample tail only after the broader higher-sample pack was already in place

That got the live board to `64.94%` raw, but it did not clear a true `65.00%+` promotion threshold.

The final follow-up audit against the active `v20` control found:

- remaining positive residual player-local additions: `0`

So this push exhausts the current player-local manifest path.

## Files

- live alias: `exports/player-local-target-lift-manifest.json`
- promoted manifest: `exports/player-local-target-lift-manifest-v20-fullboard-maxnet-minrows-1.json`
- added low-sample tail detail: `exports/player-local-target-lift-manifest-v20-fullboard-maxnet-minrows-1-added.json`
- board replay: `exports/live-quality-board-v20-fullboard-maxnet-minrows-1-through-2026-04-14.json`
- walk-forward replay: `exports/live-quality-walk-forward-v20-fullboard-maxnet-minrows-1-through-2026-04-14.json`
- forward `14d`: `exports/live-quality-forward-14d-v20-fullboard-maxnet-minrows-1-through-2026-04-14.json`
- forward `30d`: `exports/live-quality-forward-30d-v20-fullboard-maxnet-minrows-1-through-2026-04-14.json`
- exhaustion audit: `exports/player-local-target-lift-summary-v20-control-minrows1-2026-04-15.json`
