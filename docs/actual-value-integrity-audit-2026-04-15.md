# ActualValue Integrity Audit

- Generated: 2026-04-16T04:04:40.678Z
- Range: 2025-10-23 to 2026-04-14
- Played rows audited: 8138
- Source: `player_game_logs`

## Hard Threshold Flags

- Points above 70: 1
- Rebounds above 25: 0
- Assists above 20: 1
- Minutes above 53: 0

## Share Flags

- High point-share rows: 1
- High rebound-share rows: 4
- High assist-share rows: 5

## Verdict

- Integrity risk looks narrow and isolated. The source table is not broadly poisoned, but the few hard-anomaly rows should be corrected or excluded before using great-game examples as literal box-score evidence.
- Projection/backtest actualValue is derived from PlayerGameLog points, rebounds, and assists, so this audit covers the source that feeds those actualValue fields.

## Hard Anomaly Rows

- 2026-03-10 Bam Adebayo (MIA): PTS 83, REB 9, AST 3, MIN 41.9; team totals 150 pts / 48 reb / 31 ast; shares 55.33% pts / 18.75% reb / 9.68% ast; flags points>70, pointShare>=55%.
- 2026-04-12 Ryan Nembhard (DAL): PTS 15, REB 9, AST 23, MIN 38.28333333333333; team totals 149 pts / 57 reb / 35 ast; shares 10.07% pts / 15.79% reb / 65.71% ast; flags assists>20, assistShare>=55%.

## Share Watchlist

- These rows are extreme but can still be legitimate star outcomes, so they are a watchlist rather than hard data-integrity failures.
- 2026-03-09 Shai Gilgeous-Alexander (OKC): PTS 35, REB 9, AST 15; shares 27.13% pts / 24.32% reb / 55.56% ast; flags assistShare>=55%.
- 2026-03-21 Bam Adebayo (MIA): PTS 32, REB 21, AST 4; shares 26.23% pts / 51.22% reb / 12.9% ast; flags reboundShare>=45%.
- 2026-03-25 Nikola Jokić (DEN): PTS 23, REB 21, AST 19; shares 16.2% pts / 46.67% reb / 52.78% ast; flags reboundShare>=45%.
- 2026-02-24 Luka Dončić (LAL): PTS 22, REB 9, AST 15; shares 20.18% pts / 23.08% reb / 62.5% ast; flags assistShare>=55%.
- 2026-03-05 Julian Reese (WAS): PTS 18, REB 20, AST 2; shares 16.07% pts / 46.51% reb / 9.09% ast; flags reboundShare>=45%.
- 2026-03-04 Jalen Brunson (NYK): PTS 16, REB 3, AST 15; shares 16% pts / 6.25% reb / 65.22% ast; flags assistShare>=55%.
- 2026-02-24 Rudy Gobert (MIN): PTS 10, REB 19, AST 4; shares 8.06% pts / 46.34% reb / 15.38% ast; flags reboundShare>=45%.
- 2026-03-19 Josh Giddey (CHI): PTS 9, REB 6, AST 19; shares 8.18% pts / 12.77% reb / 70.37% ast; flags assistShare>=55%.
