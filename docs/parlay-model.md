# Precision Parlay Model

The parlay layer wraps the existing Precision v6 board into a daily six-leg card.

## Daily Command

```bash
npm run projection:parlay:daily
```

Useful options:

```bash
npm run projection:parlay:daily -- --date 2026-05-01 --legs 6 --max-legs 6 --refresh
```

Outputs:

- `exports/daily-parlay-card-YYYY-MM-DD.json`
- `exports/daily-parlay-card-YYYY-MM-DD.md`
- `exports/daily-parlay-card-YYYY-MM-DD.csv`

## API

```text
GET /api/snapshot/parlay?date=YYYY-MM-DD&legs=6&maxLegs=6
```

Add `refresh=1` to rebuild the board first.

## Rules

- Starts from the promoted Precision card and eligible precision signals.
- Requires live line depth from at least three books by default.
- Blocks confirmed out, doubtful, and very low availability players.
- Keeps one pick per player.
- Caps exposure by game, team, and market.
- Penalizes same-game, same-team, and same-team counting-stat over correlation.
- Defers fragile legs with low minutes, high volatility, minimum book depth, and weak scores until all cleaner cap-relaxed options are exhausted.
- Force-fills to six legs when portfolio caps would otherwise underfill, while tagging those legs with `forced_daily_six_fill`.
- Returns `UNDERFILLED` only when there are not enough unique playable candidates.

## Current Backtest Baseline

The locked Precision v6 replay in `exports/precision-locked-pregame-results.json` covers 53 slates from 2026-02-19 through 2026-04-14:

- 318 total picks
- 287 wins
- 90.25% individual leg accuracy
- 27 full six-leg hits
- 50.94% full-card hit rate
- 49 of 53 cards had at least five wins

This is a strong historical replay, but it is not a guarantee. The model should be treated as a disciplined ranking and risk-control system, with the final card locked before the first game.

## Leakage-Resistant Parlay Backtest

```bash
npm run projection:backtest:parlay
```

Outputs:

- `exports/parlay-backtest-results.json`
- `exports/parlay-backtest-results.md`
- `exports/parlay-backtest-results-daily.csv`
- `exports/parlay-backtest-results-picks.csv`

The primary result is the honest walk-forward section: for each historical date, the script chooses the best policy using only prior dates, then applies it to that date. The same-window winner is included only as an overfit diagnostic.

Useful options:

```bash
npm run projection:backtest:parlay -- --legs 6 --odds -110 --warmup-dates 14 --min-train-coverage-pct 80
```

Backtest guardrails:

- Replays from the full candidate history, not only the already-picked six.
- Keeps one pick per player and the Precision v6 market caps.
- Reuses the Precision v6 overlay veto rules.
- Searches policy thresholds, then validates by walk-forward selection.
- Reports card hit rate, leg accuracy, Wilson intervals, assumed-unit ROI, drawdown, losing streak, markets, daily cards, and pick-level results.
- Forces every evaluated slate to six legs by default, matching the operating goal.
- Labels any leg added after the primary filters as a forced-fill leg, so quality tradeoffs remain visible.

Known limitation: the candidate history does not include full game/team identifiers, so same-game and same-team correlation caps cannot be replayed perfectly. The live card still applies those controls at runtime.

For research-only comparisons that allow no-bet days:

```bash
npm run projection:backtest:parlay -- --allow-underfilled
```
