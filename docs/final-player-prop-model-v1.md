# Final Player Prop Model V1

This is now a new model, not a rename of the old champion lane.

```text
Model ID: final-player-prop-model-v1
Model name: Final Correlation-Aware Player Prop Model V1
Version: 2026-05-25-team-stability-v6
Role: full-board player prop model with a slate-safe top-pick portfolio
```

## Core Idea

The old backtest champion becomes the precision core. The final model now scores the full prop board first, then separately chooses a clean top-pick portfolio.

| Layer | Source | Role |
|---|---|---|
| Precision core | Top Player 200 Expanded 90 Premium | Tier S candidate source |
| Premium expansion | Premium PTS Over / Accuracy-First | Tier A candidate source |
| Controlled volume | Meta reliability / coverage frontier / recent-form fade / primary lane | Tier B candidate source |
| Quality router | Live Quality Router V9 | Runtime side and quality context |
| Full-board base | Live Quality Router V9 | Coverage side/score for every playable row |
| Correlation layer | Precision Parlay v1 rules | Top-pick portfolio construction and exposure caps |
| Game-context layer | Lineup, availability, minutes, team form, synergy, stake-level context | Current-slate awareness, role-floor risk, and hard-risk guardrails |
| Soft context rerank layer | Blowout-spread and minutes-lift context | Nudges candidate order before the portfolio fills without forcing extra picks |
| Portfolio-fragility / context-trap layer | Team-stability watchlist, thin-gap, side-pocket, counter-projection, low-total, and volatility guards | Rejects historically fragile top-pick shapes before the portfolio fills |
| Proof layer | locked-forward ledgers | Model-specific lock, market-line, settlement, report, and audit-summary lifecycle |

## Claim Boundary

- This model is a research-preview candidate engine until it has real locked-forward rows.
- Existing Final V1 proof infrastructure validates the evidence path, but empty or stale-preview ledgers do not prove a live edge.
- Component accuracy priors are not calibrated forward probabilities.
- The model gives every scored row a side, tier, score, and action.
- The selected-pick portfolio never force-fills to six picks; underfilling is allowed when correlation or quality rules reject the rest.
- The model should not be called forward-proven until it has real locked rows, market lines, settlements, CLV, ROI, and drawdown.

## Run

Build the current card from the current slate score artifact:

```bash
npm run projection:final-player-prop:v1
```

Outputs:

```text
exports/final-player-prop-model-v1/final-player-prop-model-v1-YYYY-MM-DD.json
exports/final-player-prop-model-v1/final-player-prop-model-v1-YYYY-MM-DD.md
exports/final-player-prop-model-v1/final-player-prop-model-v1-YYYY-MM-DD.csv
exports/final-player-prop-model-v1/final-player-prop-model-v1-YYYY-MM-DD.board.csv
```

The `.csv` file is the selected top portfolio. The `.board.csv` file is the full model coverage board.

## Walk-Forward Backtest

Run the dedicated historical replay for the final selector:

```bash
npm run projection:final-player-prop:v1:walk-forward
```

Alias:

```bash
npm run projection:final-player-prop-v1:walk-forward
```

Latest reviewed replay:

```text
Input: exports/projection-backtest-allplayers-with-rows-live.json
Context input: exports/projection-backtest-allplayers-with-rows-live-team-context.json
Range: 2025-10-30 through 2026-03-02
Full-board rows scored: 67,873
Full-board coverage: 100.00%
Full-board accuracy: 53.69% (36,439-31,434)
90+ qualified-board accuracy: 56.60% (6,770-5,192; 17.62% board coverage)
90+ score-floor-board accuracy: 73.55% (698-251; 1.40% board coverage)
Candidate-pool accuracy: 68.49% (1,504-692)
Selected-pick accuracy: 79.15% (186-49)
Average selected picks per slate: 2.03
Selected lift vs full board: +25.46 points
Context layer: team-stability watchlist plus bounded game-context scoring, soft rerank, selectable-line requirements, and portfolio-fragility/context-trap vetoes.
```

Recent selected-pick windows:

```text
Last 30 active dates: 81.25%
Last 14 active dates: 90.00%
```

The full-board recent windows:

```text
Last 30 active dates: 52.78%
Last 14 active dates: 52.57%
```

Outputs:

```text
exports/final-player-prop-model-v1-walk-forward.json
exports/final-player-prop-model-v1-walk-forward.md
exports/final-player-prop-model-v1-walk-forward-selected.csv
exports/final-player-prop-model-v1-walk-forward-board.csv
exports/final-player-prop-model-v1-walk-forward-daily.csv
```

Useful options:

```bash
npm run projection:final-player-prop:v1 -- --max-picks 6
npm run projection:final-player-prop:v1 -- --min-score 0.75
npm run projection:final-player-prop:v1 -- --scores exports/top-player-200-sample-current-slate-scores.json
```

## Selection Rules

The model builds candidates from:

```text
top200_premium_90
top200_premium_pts_over
top200_accuracy_first
top200_meta_reliability
top200_coverage_frontier
top200_recent_form_fade
top200_primary
```

Every scored prop row receives:

```text
tier
model_action
final_score
context_score
context_adjustment
estimated_accuracy_prior_pct
risk_flags
context_flags
source_components
```

The context layer reads lineup/availability status, minutes volatility, minutes trend, projected role range, data completeness, teammate-synergy direction, team/opponent recent form, and playoff/high-leverage stake level when the current board provides it. Soft context is reported as `context_score` and `context_flags`; only hard live risks such as injury/availability red flags, unstable high-stakes bench roles, or wide projected-minutes ranges can penalize the selector.

Actions:

```text
SELECTED  = selected top portfolio pick
CANDIDATE = model likes the row, but it was not selected because of score/correlation/caps
COVERAGE  = full-board model side, not a top-pick recommendation
```

Then the top-pick portfolio applies controls:

```text
one pick per player
max 2 per team
max 2 per game
max 2 per market
max 1 combo market
max 1 same-team counting over
reject team-stability watchlist rows before selected portfolio fill
reject selected PR/PA portfolio rows
reject RA UNDER / THREES OVER auxiliary side pockets
reject thin counter-projection PTS UNDERs at <= 1.0 projected-stat gap
reject ultra-thin non-premium projection gaps
reject low-total counting UNDER context traps
reject volatile REB OVER rows
selected rows require live lines from 3+ books in the current-slate exporter
no forced fill
```

## Daily Research Flow

Pregame research preview:

```bash
python scripts/export-top-player-200-current-slate-scores.py
npm run projection:final-player-prop:v1
```

Read the generated markdown card and check:

```text
selected count
full board coverage
selected tiers
full-board tier/action counts
correlation multiplier
risk flags
watchlist rejection reasons
```

## Locked-Forward Proof Stack

The final model now has its own pregame lock layer:

```bash
npm run projection:locked-forward:final-player-prop-v1 -- --dry-run
npm run projection:final-player-prop:v1:lock
npm run projection:locked-forward:final-player-prop-v1:verify-ledger
npm run projection:locked-forward:final-player-prop-v1:test-verifier
```

Source ledger:

```text
exports/locked-forward/final-player-prop-model-v1-ledger.jsonl
```

The lock exporter appends the selected-pick portfolio and references the full-board final card artifact by SHA-256, preserving the full coverage board without appending hundreds of coverage rows to the pick ledger.

Market-line capture is separate:

```bash
npm run projection:locked-forward:final-player-prop-v1:capture-lines -- --dry-run
npm run projection:locked-forward:final-player-prop-v1:capture-lines
npm run projection:locked-forward:final-player-prop-v1:verify-market-lines
npm run projection:locked-forward:final-player-prop-v1:test-market-line-verifier
```

Market-line source and ledger:

```text
exports/locked-forward/final-player-prop-model-v1/market-lines-input.json
exports/locked-forward/final-player-prop-model-v1/market-lines.jsonl
```

Postgame settlement is also separate:

```bash
npm run projection:locked-forward:final-player-prop-v1:settle -- --dry-run
npm run projection:locked-forward:final-player-prop-v1:settle
npm run projection:locked-forward:final-player-prop-v1:verify-settlements
npm run projection:locked-forward:final-player-prop-v1:test-settlement-verifier
```

Settlement source and ledger:

```text
exports/locked-forward/final-player-prop-model-v1/settlement-input.json
exports/locked-forward/final-player-prop-model-v1/settlements.jsonl
```

The joined report and audit summary are derived artifacts:

```bash
npm run projection:locked-forward:final-player-prop-v1:report
npm run projection:locked-forward:final-player-prop-v1:audit-summary
```

Derived outputs:

```text
exports/locked-forward/final-player-prop-model-v1/performance-report.json
exports/locked-forward/final-player-prop-model-v1/performance-report.md
exports/locked-forward/final-player-prop-model-v1/performance-report.csv
exports/locked-forward/final-player-prop-model-v1/audit-summary.json
exports/locked-forward/final-player-prop-model-v1/audit-summary.md
```

Claim boundary: source truth remains the lock ledger, market-line ledger, and settlement ledger. The report can be regenerated and should not be treated as a source ledger.

The old Top Player premium ledger can still be used for Tier S research comparison, but the full final model needs its own ledger because it includes additional candidate sources and correlation decisions.
