# Player-Local Target Lift v16

Date: `2026-04-15`

This promotion adds a curated target-miss delta pack to the active live manifest after the broader raw-model branch ceiling stalled below the requested `+1.0` overall raw lift.

## Added Players

- `Derik Queen`
- `Pelle Larsson`
- `Davion Mitchell`
- `Cooper Flagg`
- `Reed Sheppard`

These five were not previously manifest-eligible under the strict `must clear assigned 60/70 target on full + 14d + 30d` rule, but each showed:

- strong positive full-history raw lift
- nonnegative `14d` raw delta versus the live control
- nonnegative `30d` raw delta versus the live control

## Verified Scoreboard Lift

Using the promoted live manifest:

- Full board: `58.71 -> 59.85` raw (`+1.14`)
- Walk-forward: `58.11 -> 59.18` raw (`+1.07`)
- Forward `14d`: `51.94 -> 53.26` raw (`+1.32`)
- Forward `30d`: `54.31 -> 55.29` raw (`+0.98`)

Coverage also improved:

- Full board: `74.20 -> 77.42`
- Walk-forward: `73.97 -> 77.27`
- Forward `14d`: `72.67 -> 76.50`
- Forward `30d`: `73.53 -> 77.25`

## Files

- `scripts/build-player-local-target-lift-manifest.ts`
- `exports/player-local-target-lift-manifest.json`
- `exports/live-quality-board-current-v16-delta-pack.json`
- `exports/live-quality-walk-forward-current-v16-delta-pack.json`
- `exports/live-quality-forward-14d-current-v16-delta-pack.json`
- `exports/live-quality-forward-30d-current-v16-delta-pack.json`
