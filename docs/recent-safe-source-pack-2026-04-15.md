# Recent-Safe Source Pack Study

Date: `2026-04-15`

## What This Found

The honest path to improve the bad recent `14d` / `30d` side-pick numbers is not another broad full-board raw retrain.

The signal is in the `shown-pick source mix`.

The recent windows are being dragged down mainly by weak `universal_qualified` pools in several markets, while `player_override` remains very strong.

That means the better move is to create a recent-safe board policy that decides, by market, whether to allow:

- `player_override` only
- `universal_qualified` only
- both non-baseline sources
- neither

This was tested with a stricter time split:

- `pre` selection study: through `2026-02-15`
- `validation`: `2026-02-16` to `2026-03-15`
- honest holdout `30d`: `2026-03-16` to `2026-04-14`
- honest holdout `14d`: `2026-04-01` to `2026-04-14`

## Best Practical Packs

### 1. Recent-Safe Mid Coverage

Rule:

- `PTS`: allow `player_override` and `universal_qualified`
- `REB`: allow `player_override` only
- `AST`: allow `player_override` and `universal_qualified`
- `THREES`: allow `player_override` and `universal_qualified`
- `PRA`: allow `player_override` only
- `PA`: exclude
- `PR`: allow `player_override` and `universal_qualified`
- `RA`: allow `player_override` and `universal_qualified`

Results:

- `pre`: `66.14%` on `35,074` picks, `52.02%` board coverage
- `validation`: `66.55%` on `8,864` picks, `50.87%` board coverage
- honest `30d`: `62.04%` on `10,869` picks, `50.21%` board coverage
- honest `14d`: `60.38%` on `4,531` picks, `49.77%` board coverage
- latest fold `2026-04-03` to `2026-04-14`: `60.14%` on `3,768` picks, `49.67%` board coverage

This is the best balanced option found. It clears `60%` on both recent windows while still covering about half the board.
As of `2026-04-16`, this pack was promoted as the primary board mode because it stayed above `60%` on the honest `14d`, `30d`, and latest-fold checks without changing the split.

### 2. Recent-Safe Tight

Rule:

- `PTS`: allow `player_override` only
- `REB`: allow `player_override` only
- `AST`: allow `player_override` only
- `THREES`: exclude
- `PRA`: allow `player_override` only
- `PA`: allow `player_override` only
- `PR`: allow `player_override` and `universal_qualified`
- `RA`: allow `player_override` only

Results:

- `pre`: `79.05%` on `13,608` picks, `20.18%` board coverage
- `validation`: `76.70%` on `3,369` picks, `19.33%` board coverage
- honest `30d`: `72.70%` on `4,092` picks, `18.90%` board coverage
- honest `14d`: `72.40%` on `1,692` picks, `18.59%` board coverage

This is the strongest recent-safe pack by hit rate with still-usable volume.

### 3. Pure Override, No THREES

Rule:

- allow `player_override` only
- exclude `THREES`

Results:

- `pre`: `85.83%` on `10,110` picks, `15.00%` board coverage
- `validation`: `84.52%` on `2,416` picks, `13.86%` board coverage
- honest `30d`: `82.53%` on `2,685` picks, `12.40%` board coverage
- honest `14d`: `82.74%` on `1,101` picks, `12.09%` board coverage

This is the highest-confidence pack, but it is much tighter.

## Main Takeaway

The reason the full model can look strong on broad history while recent full-board accuracy is weaker is that the board is mixing:

- a still-strong override layer
- a weaker recent universal-qualified layer in several markets

So the honest improvement path is:

1. keep the current full board for broad coverage
2. add a recent-safe board mode using source-aware market filtering
3. treat recent performance targets as a packaging / selection problem, not only a raw-model retrain problem

## Recommendation

If the goal is to get recent shown-pick accuracy above `60%` without cheating the split:

- promote `Recent-Safe Mid Coverage` if you want a usable half-board mode
- promote `Recent-Safe Tight` if you want the strongest recent hit rate with moderate volume

If the next step is product work, the cleanest implementation is a board mode toggle instead of replacing the default full board.

## Follow-Up Resweep

On `2026-04-16`, the full source-policy space was re-searched again using only the original `pre` and `validation` windows for selection, then checked on the honest holdouts. The exported resweep is in:

- `exports/recent-safe-policy-exhaustive-search-2026-04-16.json`

That follow-up did not produce a meaningfully cleaner balanced winner than the promoted mid-coverage pack, so the existing recent-safe policy remained the primary honest-safe board.
