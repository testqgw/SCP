# WNBA Player Prop Model

Standalone WNBA player prop model built from the NBA snapshot stack's useful ideas: projection gaps, walk-forward scoring, probability calibration, risk flags, and correlation-aware portfolio selection.

## What It Uses

- ESPN public WNBA scoreboard and boxscore endpoints for historical player game logs.
- Current prop board CSV supplied by you, because complete WNBA player prop feeds are not reliably available for free without a sportsbook or odds API key.
- Optional historical prop-line CSV for true walk-forward backtesting.

## Quick Start

Run these from this `wnba` folder:

```powershell
python -m pip install -r requirements.txt
python -m wnba_prop_model fetch --seasons 2024 2025 2026 --out data/raw/wnba_player_game_logs.csv
python -m wnba_prop_model audit-data --logs data/raw/wnba_player_game_logs.csv
```

The raw file keeps preseason/postseason rows with `season_phase`, but scoring and backtesting default to regular-season logs only. Add `--include-preseason` to `score`, `backtest`, or `audit-data` only when you intentionally want those games included.

Fill in `data/templates/market_board_template.csv` with today's props, then score:

```powershell
python -m wnba_prop_model score --logs data/raw/wnba_player_game_logs.csv --board data/templates/market_board_template.csv --date 2026-05-08 --out-prefix output/wnba-prop-card-2026-05-08
```

Outputs:

- `output/wnba-prop-card-YYYY-MM-DD.json`
- `output/wnba-prop-card-YYYY-MM-DD.csv`
- `output/wnba-prop-card-YYYY-MM-DD.md`

## Board Columns

Required: `game_date`, `player`, `team`, `opponent`, `market`, `line`.

Recommended: `over_odds`, `under_odds`, `sportsbook_count`, `projected_minutes`, `starter_expected`, `injury_note`, `game_total`, `spread`.

Markets: `PTS`, `REB`, `AST`, `THREES`, `PRA`, `PA`, `PR`, `RA`.

## Model Logic

The projection engine blends player per-minute form, EWMA, last-3/last-10 form, season baseline, position/league fallback, opponent allowance, home/away splits, and projected minutes. It then estimates over/under probability with a normal residual model blended with empirical recent hit rate.

The selector ranks by model probability, projection gap, data confidence, and no-vig price edge. It penalizes injury notes, volatile minutes, short rest, thin markets, unresolved players, and combo-market correlation. Final picks are constrained by player, team, game, market, combo markets, and same-team counting overs.

## Backtesting

True betting backtests need historical prop lines. Put them in a CSV with the same board columns plus `actual`, or let the script match actuals from the game logs:

```powershell
python -m wnba_prop_model backtest --logs data/raw/wnba_player_game_logs.csv --lines data/my_historical_wnba_lines.csv --out output/wnba-backtest.json
```

## Claim Boundary

This is a ranking and calibration model. Do not treat it as a guarantee. Before using any output, confirm current player status, starting lineup, books available, and current odds.
