# WNBA Player Prop Model

Standalone WNBA player prop model built from the NBA snapshot stack's useful ideas: projection gaps, walk-forward scoring, probability calibration, risk flags, and correlation-aware portfolio selection.

## What It Uses

- ESPN public WNBA scoreboard and boxscore endpoints for historical player game logs.
- Current prop board CSV supplied by you, public ScoresAndOdds best-odds tables, or public SportsGrid prop cards when available.
- Optional The Odds API import for full WNBA player-prop market coverage when `THE_ODDS_API_KEY` is supplied.
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

Or import the public SportsGrid prop cards for a current slate and score them directly:

```powershell
python -m wnba_prop_model sportsgrid --urls "SPORTSGRID_GAME_URL_1" "SPORTSGRID_GAME_URL_2" --date 2026-05-08 --board-out data/current/sportsgrid_board_2026-05-08.csv --out-prefix output/current-card --min-score 0.60
```

The SportsGrid path records source pick, source projection, source URL, and the pick-side FanDuel price shown on the page. Rows with only one side of the price are flagged as approximate price-edge rows.

For the best free current board, import the ScoresAndOdds WNBA prop tables. This captures points, rebounds, assists, and 3-pointers with the best listed over and under prices by side:

```powershell
python -m wnba_prop_model scoresandodds --date 2026-05-08 --include-preseason --board-out data/current/scoresandodds_board_2026-05-08.csv --out-prefix output/current-card
```

If you have a The Odds API key, use the full event player-prop endpoint for points, rebounds, assists, threes, and combo markets:

```powershell
$env:THE_ODDS_API_KEY="your_key"
python -m wnba_prop_model oddsapi --regions us --out-prefix output/current-card
```

Outputs:

- `output/wnba-prop-card-YYYY-MM-DD.json`
- `output/wnba-prop-card-YYYY-MM-DD.csv`
- `output/wnba-prop-card-YYYY-MM-DD.md`

## Daily Automation

The site card is refreshed by `.github/workflows/wnba-daily-card.yml`. The workflow runs every day at `15:20 UTC` and `19:20 UTC`, refreshes ESPN player logs, pulls the current WNBA prop board, settles the prior card when final boxscores are available, writes new `wnba/output/current-*` artifacts, commits them, and then lets Vercel serve the updated `/wnba` section.

Daily cards run in FanDuel-strict mode. If `THE_ODDS_API_KEY` is set, the refresh asks The Odds API for `fanduel` WNBA props only. Without that key, it auto-discovers SportsGrid WNBA game pages and imports only the FanDuel player props shown there. ScoresAndOdds is now only a fallback coverage source in this mode; it will not produce selected picks unless the source book is FanDuel.

You can run the same refresh locally from the repo root:

```powershell
python wnba/scripts/daily_refresh.py --book fanduel
```

Use `--date YYYY-MM-DD` to rebuild a specific slate. Use `--book best` only when you intentionally want best-odds research that is not constrained to FanDuel availability.

## Board Columns

Required: `game_date`, `player`, `team`, `opponent`, `market`, `line`.

Recommended: `over_odds`, `under_odds`, `sportsbook_count`, `projected_minutes`, `starter_expected`, `injury_note`, `game_total`, `spread`.

Markets: `PTS`, `REB`, `AST`, `THREES`, `PRA`, `PA`, `PR`, `RA`.

## Model Logic

The projection engine blends player per-minute form, EWMA, last-3/last-10 form, season baseline, position/league fallback, opponent allowance, home/away splits, and projected minutes. It then estimates over/under probability with a normal residual model blended with empirical recent hit rate.

The selector ranks by model probability, projection gap, data confidence, source projection alignment, and no-vig or best-price edge. Current source projections are blended into the model projection and rows are blocked when the source projection disagrees, is too close to the line, or is missing from a source that normally provides it. It also penalizes injury notes, volatile minutes, short rest, thin markets, unresolved players, source-pick disagreement, and combo-market correlation. Final picks are constrained by player, team, game, market, combo markets, and same-team counting overs.

## Backtesting

True betting backtests need historical prop lines. Put them in a CSV with the same board columns plus `actual`, or let the script match actuals from the game logs:

```powershell
python -m wnba_prop_model backtest --logs data/raw/wnba_player_game_logs.csv --lines data/my_historical_wnba_lines.csv --out output/wnba-backtest.json
```

To settle a generated current card after games go final and the ESPN logs are refreshed:

```powershell
python -m wnba_prop_model fetch --seasons 2024 2025 2026 --include-unfinal --out data/raw/wnba_player_game_logs.csv
python -m wnba_prop_model settle --card output/current-card.json --out-prefix output/current-settlement
```

The website shows verified accuracy only from settled rows. If games are not final or logs have not been refreshed, accuracy remains `pending`.

## Claim Boundary

This is a ranking and calibration model. Do not treat it as a guarantee. Before using any output, confirm current player status, starting lineup, books available, and current odds.
