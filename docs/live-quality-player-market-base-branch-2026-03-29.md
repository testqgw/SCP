# Live-Quality Player-Market Base Branch

As of: 2026-03-29 UTC
Scope: test whether a broad all-player player-market model layer could act as a genuinely new overall challenger against the current live board

## Why this branch existed

By this point the repo had already exhausted the static feature families around the current live stack.

The remaining honest question was:

- if we train player-market models for the full board, not just the curated override stars, can that broader source beat the current live path?

This was a real overall challenger test, not another local bucket patch.

Source files:

- `scripts/evaluate-live-quality-player-market-base-branch.ts`
- `exports/live-quality-player-market-base-branch-summary.json`
- `exports/live-quality-player-market-base-branch-summary-train-through-2026-03-13.json`
- `exports/live-quality-player-market-base-branch-summary-train-through-2026-02-25.json`

## Evaluator contract

The evaluator now separates replay strength from promotion safety.

- `bestReplayCandidate`: the strongest replay-only candidate on the supplied model file
- `bestPromotionCandidate`: the strongest candidate that clears the honest same-coverage promotion gate
- `bestCandidate`: reserved for the promotion-safe winner only, or `null` if no honest winner exists
- `holdoutAudit`: per-window explanation of whether the supplied model file is clean for `walkForward`, `forward14d`, and `forward30d`
- `officialLiveBaseline`: the current full shipped live-stack audit, included so branch-local control does not get mistaken for the model's true accuracy

This matters because a model file trained through the same dates it is being scored on can still produce an impressive replay leader. That is useful as an overfit diagnostic, but it is not promotion evidence.

## Model source

The branch trained broad all-player player-market model files from the runtime-context rows export:

- full-window training file: `exports/player-market-side-models-runtime-context-2025-10-23-to-2026-03-28.json`
- pre-`14d` holdout file: `exports/player-market-side-models-train-through-2026-03-13.json`
- pre-`30d` holdout file: `exports/player-market-side-models-train-through-2026-02-25.json`

Candidate variants:

- `player_market_additive_balanced_v1`
- `player_market_additive_tight_v1`
- `player_market_replace_headroom_tight_v1`

All three used holdout-gated player-market models, but differed in:

- sample floor
- minimum holdout accuracy
- required edge over projection / final baseline
- whether they only added to the current player-override layer or replaced it on the headroom markets

## Branch-local control

This branch used the refreshed post-`PRA` board-faithful window through `2026-03-27`.

Control:

- walk-forward: `56.88%` raw / `56.73%` blended / `75.21%` coverage
- `14d`: `54.85%` raw / `54.54%` blended / `75.65%` coverage
- `30d`: `55.96%` raw / `55.75%` blended / `75.09%` coverage

## Same-window diagnostic result

The first full-window run looked absurdly strong:

- best candidate: `player_market_additive_balanced_v1`
- walk-forward: `62.46%` raw / `62.40%` blended / `77.94%` coverage
- `14d`: `60.46%` raw
- `30d`: `61.63%` raw

That result was not trusted as promotion evidence because the model file had been trained on the same full window it was being scored on.

Interpretation:

- broad player-market models can memorize the same window extremely well
- the same-window score is a useful overfit diagnostic, not a live decision metric

## Honest forward checks

### Pre-`14d` holdout check

Models were retrained only through `2026-03-13`, then evaluated on the trailing `14d`.

Best candidate:

- `player_market_replace_headroom_tight_v1`
- `14d` raw: `54.75%` vs control `54.85%`

Read:

- same-window strength did not survive the honest `14d` holdout
- even the best variant still regressed

### Pre-`30d` holdout check

Models were retrained only through `2026-02-25`, then evaluated on the trailing `30d`.

Best candidate:

- `player_market_replace_headroom_tight_v1`
- `30d` raw: `55.64%` vs control `55.96%`

Read:

- same-window strength also failed the honest `30d` holdout
- all variants regressed versus control on true forward data

## What this means

This branch answered the question cleanly.

What it proved:

- a broad all-player model family can look spectacular on overlapping history
- that family is too unstable out of sample in its current form
- the current live stack is not being beaten by a naive overall player-market replacement

What it did not prove:

- that a broad player-market challenger can survive honest forward evaluation

## Decision

Status:

- live unchanged
- branch closed as a non-promotion result

Why:

- same-window scores were clearly inflated by fit overlap
- honest pre-holdout `14d` regressed
- honest pre-holdout `30d` regressed

## Bottom line

The all-player player-market base challenger looked like a breakthrough at first glance, but the honest forward checks killed it.

That makes the repo picture cleaner again:

- there is no new overall base-model replacement hiding in broad player-market trees
- same-window spikes in this family should be treated as overfit until proven otherwise
- the close-aware intraday branch remains the only credible path to a real step-change
