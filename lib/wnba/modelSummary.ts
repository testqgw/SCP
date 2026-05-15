export type WnbaModelMetric = {
  label: string;
  value: string;
  note: string;
};

export type WnbaModelStage = {
  label: string;
  detail: string;
};

export const WNBA_MODEL_SUMMARY = {
  modelId: "wnba-player-prop-model-v1",
  modelName: "WNBA Correlation-Aware Player Prop Model V1",
  modelVersion: "2026-05-14-expanded-slate-v8",
  status: "Current expanded WNBA card published",
  currentDateEt: "2026-05-14",
  repoPath: "wnba/",
  toolkitPath: "wnba/wnba_prop_model/",
  boardTemplatePath: "wnba/data/templates/market_board_template.csv",
  historicalLinesTemplatePath: "wnba/data/templates/historical_lines_template.csv",
  rawLogPath: "wnba/data/raw/wnba_player_game_logs.csv",
  claimBoundary:
    "WNBA V1 ranks sourced player props with historical boxscore evidence, best available over/under prices, source projection alignment, and portfolio gates. It is not a guarantee, and live use still requires player availability confirmation.",
  dataSource:
    "ESPN public WNBA scoreboard and boxscore endpoints for logs, SportsGrid FanDuel prop cards when available, ScoresAndOdds public best-odds prop tables for expanded coverage, and optional The Odds API support when an API key is supplied.",
  rawRows: "11,926",
  regularRows: "9,969",
  games: "530",
  players: "218",
  dateRange: "2024-05-14 to 2025-09-11",
  markets: ["PTS", "REB", "AST", "3PM", "PRA", "PA", "PR", "RA"],
  regularSeasonWindows: [
    "2024: May 14 to September 19",
    "2025: May 16 to September 11",
    "2026: May 8 to September 24",
  ],
} as const;

export const WNBA_MODEL_METRICS: WnbaModelMetric[] = [
  {
    label: "Regular logs",
    value: WNBA_MODEL_SUMMARY.regularRows,
    note: "Default scoring sample",
  },
  {
    label: "Player pool",
    value: WNBA_MODEL_SUMMARY.players,
    note: "Resolved WNBA players",
  },
  {
    label: "Games",
    value: WNBA_MODEL_SUMMARY.games,
    note: "Regular-season games",
  },
  {
    label: "Markets",
    value: String(WNBA_MODEL_SUMMARY.markets.length),
    note: "Core and combo props",
  },
];

export const WNBA_MODEL_STAGES: WnbaModelStage[] = [
  {
    label: "Projection engine",
    detail:
      "Blends player per-minute form, EWMA, last-3/last-10 production, season baseline, position fallback, opponent allowance, home/away splits, and expected minutes.",
  },
  {
    label: "Probability layer",
    detail:
      "Converts projection gap into an over/under probability with market-specific residuals and a recency-weighted empirical hit-rate blend.",
  },
  {
    label: "Price edge",
    detail:
      "Normalizes supplied American odds to no-vig fair probability, then compares book price against model probability.",
  },
  {
    label: "Portfolio gates",
    detail:
      "Limits exposure by player, team, game, market, combo market, and same-team counting overs, then uses controlled expanded-fill gates to reach the six-pick target when enough valid rows exist.",
  },
];

export const WNBA_PORTFOLIO_RULES = [
  "Max 6 picks",
  "Max 3 per player in expanded mode",
  "Max 6 per team in expanded mode",
  "Max 6 per game in expanded mode",
  "Max 4 per market",
  "Max 4 combo markets",
  "Max 1 same-team counting over",
  "Expanded fill requires probability, edge, and clean team context",
] as const;

export const WNBA_INPUT_COLUMNS = [
  "game_date",
  "player",
  "team",
  "opponent",
  "market",
  "line",
  "over_odds",
  "under_odds",
  "sportsbook_count",
  "projected_minutes",
  "starter_expected",
  "injury_note",
  "source_pick",
  "source_projection",
  "source_url",
] as const;
