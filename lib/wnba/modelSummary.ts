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
  modelVersion: "2026-07-06-fanduel-live-model-v13",
  status: "FanDuel-live model selector is primary; unavailable props are vetoed before selection",
  currentDateEt: "2026-07-06",
  repoPath: "wnba/",
  toolkitPath: "wnba/wnba_prop_model/",
  boardTemplatePath: "wnba/data/templates/market_board_template.csv",
  historicalLinesTemplatePath: "wnba/data/templates/historical_lines_template.csv",
  rawLogPath: "wnba/data/raw/wnba_player_game_logs.csv",
  claimBoundary:
    "WNBA V1 ranks sourced player props with historical boxscore evidence, current FanDuel-labeled prices, source projection alignment, and portfolio gates. Archive proof and live FanDuel execution are separated; live use still requires player availability and book availability confirmation.",
  dataSource:
    "ESPN public WNBA scoreboard, roster, and boxscore endpoints for logs and active-player validation; RotoWire/SportsGrid FanDuel-labeled prop cards when available; ScoresAndOdds public tables for non-primary coverage checks; and optional The Odds API support when an API key is supplied.",
  rawRows: "14,796",
  regularRows: "14,796",
  games: "765",
  players: "449",
  dateRange: "2024-05-03 to 2026-06-30",
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

export const WNBA_ARCHIVE_SELECTOR_PROOF: WnbaModelMetric[] = [
  {
    label: "Six-pick coverage",
    value: "41/41",
    note: "Archive-ML walk-forward covered every evaluated slate",
  },
  {
    label: "Settled parlays",
    value: "14/27",
    note: "51.85% archive/cross-source six-pick parlay hit rate",
  },
  {
    label: "Settled legs",
    value: "175/226",
    note: "77.43% archive selected-leg accuracy",
  },
  {
    label: "FanDuel shadow",
    value: "3/5",
    note: "60.00% limited FanDuel availability replay; sample is too small to drive the selector",
  },
] as const;

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
      "Limits exposure by player, team, game, market, combo market, and same-team counting overs, then applies live-mode availability gates and SGP exposure accounting.",
  },
];

export const WNBA_PORTFOLIO_RULES = [
  "Max 6 picks",
  "Max 1 per player per slate",
  "FanDuel-live mode is the primary six-pick path for the website card",
  "Archive-ML proof does not transfer to single-book availability by default",
  "Unavailable user-confirmed FanDuel props are removed before model selection",
  "Soft SGP tax lowers priority for additional same-game legs in FanDuel-live mode",
  "Max 6 per team in live mode",
  "Max 6 per game in live mode",
  "Max 4 per market",
  "Max 4 combo markets",
  "Max 1 same-team counting over",
  "Requires target-date ESPN slate and current ESPN roster match",
  "FanDuel rows require playable side odds and current source context",
  "Live forced fill requires at least 52% model probability",
  "Archive-ML rerank uses only prior archived candidate outcomes",
  "Current archive proof: 41/41 covered, 14/27 settled six-pick parlays, 175/226 legs",
  "Limited FanDuel replay: 3/5 settled six-pick parlays, 73.33% legs",
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
