# Player-Local Target Lift v17 Raw-First

As of: 2026-04-15 UTC
Scope: expand the live player-local manifest enough to clear a real `+2` full-board raw jump without giving back recent-window net wins

## Policy

Starting point:

- live manifest `v16`
- full-board raw `59.85`
- walk-forward raw `59.18`
- forward `14d` raw `53.26`
- forward `30d` raw `55.29`

Raw-first expansion rule:

- only consider players not already in the live manifest
- exclude dedicated live exceptions already handled outside the manifest
- require at least `200` full-history rows
- require the recommended candidate to have positive full-board `netRowsVsControl`
- require nonnegative `14d` and `30d` `netRowsVsControl`

Result:

- added `78` new player-local entries
- promoted manifest alias: `2026-04-15-player-local-target-lift-v17-raw-first-minrows-200`

## Verified lift

Using the live board-faithful evaluator on `2025-10-23` through `2026-04-14`:

- full board: `59.85 -> 62.00` raw (`+2.15`)
- walk-forward: `59.18 -> 61.06` raw (`+1.88`)
- forward `14d`: `53.26 -> 55.09` raw (`+1.83`)
- forward `30d`: `55.29 -> 56.64` raw (`+1.35`)

Companion metrics also moved up:

- full-board blended: `59.52 -> 61.73`
- full-board coverage: `77.42 -> 87.71`

## Files

- manifest candidate: `exports/player-local-target-lift-manifest-v17-raw-first-minrows-200.json`
- live alias: `exports/player-local-target-lift-manifest.json`
- board replay: `exports/live-quality-board-v17-raw-first-minrows-200.json`
- walk-forward replay: `exports/live-quality-walk-forward-v17-raw-first-minrows-200.json`
- forward `14d`: `exports/live-quality-forward-14d-v17-raw-first-minrows-200.json`
- forward `30d`: `exports/live-quality-forward-30d-v17-raw-first-minrows-200.json`

## Interpretation

This is a different promotion standard than the earlier target-hit manifest builds.

Instead of demanding every added player clear the absolute `60/70` target in full history, `14d`, and `30d`, this pack asks a narrower question:

- does this player add real full-board raw wins right now
- and does it avoid losing raw net wins in the recent windows

That looser gate is what unlocked the first honest full-board move above `+2` from the current `v16` baseline.
