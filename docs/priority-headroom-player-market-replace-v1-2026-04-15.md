# Priority Headroom Player-Market Replace v1

As of: 2026-04-15 UTC
Scope: add a pre-manifest priority player-model layer that can replace the current player-local recovery manifest on the strongest headroom markets

## What changed

- Trained fresh all-player player-market models on `exports/projection-backtest-allplayers-with-rows-2025-10-23-to-2026-04-14-current.json`
- Built a priority override file at `exports/live-player-model-priority-replace-headroom-tight-v1-2026-04-14.json`
- Promoted that file ahead of the manifest in `lib/snapshot/livePlayerSideModels.ts`

## Selection rule

The promoted file uses the `player_market_replace_headroom_tight_v1` gate:

- markets: `PTS`, `REB`, `PRA`, `PR`, `RA`
- minimum samples: `24`
- minimum holdout accuracy: `60`
- minimum edge vs projection baseline: `+4`
- minimum edge vs final baseline: `+4`

Resulting file:

- approved player-market models: `252`
- approved players: `167`

## Why this was needed

The active `v20` player-local manifest already exhausted the additive player-local path.
The remaining broad branch with real upside was the all-player player-market challenger.

The additive versions only created small gains on top of the manifest because the manifest already covered many recoverable rows.
The strongest current branch was the replacement variant on the headroom markets, which needed a new pre-manifest priority layer to take effect.

## Verified metrics

Compared against the manifest-on `v20` live baseline on the same through-`2026-04-14` rows file:

- replay raw: `64.94 -> 67.61` (`+2.67`)
- walk-forward raw: `63.30 -> 66.04` (`+2.74`)
- forward `14d` raw: `55.03 -> 58.50` (`+3.47`)
- forward `30d` raw: `56.92 -> 60.09` (`+3.17`)

Verified outputs:

- `exports/live-quality-board-priority-headroom-through-2026-04-14.json`
- `exports/live-quality-walk-forward-priority-headroom-through-2026-04-14.json`
- `exports/live-quality-forward-14d-priority-headroom-through-2026-04-14.json`
- `exports/live-quality-forward-30d-priority-headroom-through-2026-04-14.json`

## Caution

This is a same-window player-market promotion.
The underlying player-market models were trained on the same through-`2026-04-14` window used for the replay score.
The replay gain is real on the board-faithful current window, but it should be treated as a same-window optimization result rather than an honest retrain-through-older-date holdout proof.

## Honest holdout check

To test whether the gain was a false flag, the same priority-pack rule was retrained only on data available before each recent holdout:

- pre-`14d` retrain through `2026-03-31`
- pre-`30d` retrain through `2026-03-15`
- pre-latest-fold retrain through `2026-04-02`

Honest results versus the saved `v20` manifest-on baseline:

- forward `14d`: `55.03 -> 57.08` (`+2.05`)
- forward `30d`: `56.92 -> 58.95` (`+2.03`)
- latest fold `2026-04-03` to `2026-04-14`: `54.77 -> 56.96` (`+2.19`)

Same-window inflation is still present:

- same-window `14d`: `58.50` vs honest `57.08`
- same-window `30d`: `60.09` vs honest `58.95`

Decision read:

- not a pure overfit mirage
- same-window replay is optimistic by roughly `1.1` to `1.4` points on the recent windows
- the branch still survives honest recent holdout checks with meaningful positive lift
