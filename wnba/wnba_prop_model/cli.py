from __future__ import annotations

import argparse
import json
from pathlib import Path

from .data_sportsgrid import fetch_props, props_to_board_rows, write_board_csv
from .data_espn import fetch_player_game_logs, write_logs_csv
from .model import backtest_historical_lines, load_board, load_logs, score_board, write_card


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="wnba_prop_model", description="WNBA player prop model toolkit")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch = subparsers.add_parser("fetch", help="Fetch WNBA player game logs from ESPN public endpoints")
    fetch.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025, 2026])
    fetch.add_argument("--out", default="data/raw/wnba_player_game_logs.csv")
    fetch.add_argument("--include-unfinal", action="store_true")
    fetch.add_argument("--sleep", type=float, default=0.12)

    score = subparsers.add_parser("score", help="Score a current prop board CSV")
    score.add_argument("--logs", default="data/raw/wnba_player_game_logs.csv")
    score.add_argument("--board", default="data/templates/market_board_template.csv")
    score.add_argument("--date", default=None)
    score.add_argument("--out-prefix", default="output/wnba-prop-card")
    score.add_argument("--max-picks", type=int, default=6)
    score.add_argument("--min-score", type=float, default=0.68)
    score.add_argument("--include-preseason", action="store_true")

    sportsgrid = subparsers.add_parser("sportsgrid", help="Import SportsGrid WNBA prop cards and score them")
    sportsgrid.add_argument("--urls", nargs="+", required=True)
    sportsgrid.add_argument("--logs", default="data/raw/wnba_player_game_logs.csv")
    sportsgrid.add_argument("--date", default=None)
    sportsgrid.add_argument("--board-out", default="data/current/sportsgrid_board.csv")
    sportsgrid.add_argument("--out-prefix", default="output/current-card")
    sportsgrid.add_argument("--max-picks", type=int, default=6)
    sportsgrid.add_argument("--min-score", type=float, default=0.62)
    sportsgrid.add_argument("--include-preseason", action="store_true")

    backtest = subparsers.add_parser("backtest", help="Walk-forward backtest with historical prop lines")
    backtest.add_argument("--logs", default="data/raw/wnba_player_game_logs.csv")
    backtest.add_argument("--lines", default="data/templates/historical_lines_template.csv")
    backtest.add_argument("--out", default="output/wnba-backtest.json")
    backtest.add_argument("--max-picks", type=int, default=6)
    backtest.add_argument("--min-score", type=float, default=0.68)
    backtest.add_argument("--include-preseason", action="store_true")

    audit = subparsers.add_parser("audit-data", help="Summarize local player log coverage")
    audit.add_argument("--logs", default="data/raw/wnba_player_game_logs.csv")
    audit.add_argument("--include-preseason", action="store_true")
    return parser.parse_args()


def cmd_fetch(args: argparse.Namespace) -> int:
    rows = fetch_player_game_logs(args.seasons, include_unfinal=args.include_unfinal, sleep_seconds=args.sleep)
    write_logs_csv(rows, args.out)
    print(f"Wrote {len(rows)} player-game rows to {args.out}")
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    logs = load_logs(args.logs, include_preseason=args.include_preseason)
    board = load_board(args.board, default_date=args.date)
    limits = {"max_picks": args.max_picks, "min_score": args.min_score}
    card = score_board(logs, board, slate_date=args.date, limits=limits)
    paths = write_card(card, args.out_prefix)
    print(f"Scored {card['summary']['totalBoardRows']} rows; selected {card['summary']['selectedCount']}.")
    print(f"JSON: {paths['json']}")
    print(f"CSV: {paths['csv']}")
    print(f"MD: {paths['md']}")
    return 0


def cmd_sportsgrid(args: argparse.Namespace) -> int:
    resolver_logs = load_logs(args.logs, include_preseason=True)
    props = fetch_props(args.urls, default_date=args.date)
    rows = props_to_board_rows(props, resolver_logs)
    write_board_csv(rows, args.board_out)
    logs = load_logs(args.logs, include_preseason=args.include_preseason)
    board = load_board(args.board_out, default_date=args.date)
    limits = {"max_picks": args.max_picks, "min_score": args.min_score}
    card = score_board(logs, board, slate_date=args.date, limits=limits)
    card["mode"] = "CURRENT_SOURCED_PREVIEW"
    card["sourceUrls"] = args.urls
    card["sourceNote"] = "SportsGrid public player-prop cards; odds are pick-side FanDuel prices when available."
    paths = write_card(card, args.out_prefix)
    print(f"Imported {len(rows)} sourced rows from {len(args.urls)} SportsGrid pages.")
    print(f"Scored {card['summary']['totalBoardRows']} rows; selected {card['summary']['selectedCount']}.")
    print(f"Board: {args.board_out}")
    print(f"JSON: {paths['json']}")
    print(f"CSV: {paths['csv']}")
    print(f"MD: {paths['md']}")
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    logs = load_logs(args.logs, include_preseason=args.include_preseason)
    lines = load_board(args.lines)
    result = backtest_historical_lines(logs, lines, limits={"max_picks": args.max_picks, "min_score": args.min_score})
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    selected = result["summary"]["selected"]
    print(f"Backtest selected samples: {selected['samples']}, accuracy: {selected['accuracyPct']}")
    print(f"Wrote {out}")
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    logs = load_logs(args.logs, include_preseason=args.include_preseason)
    print(f"Rows: {len(logs)}")
    print(f"Games: {logs['game_id'].nunique() if 'game_id' in logs.columns else 'unknown'}")
    print(f"Players: {logs['player_id'].nunique()}")
    print(f"Dates: {logs['game_date'].min().date()} to {logs['game_date'].max().date()}")
    print("Rows by season:")
    print(logs.groupby(logs["game_date"].dt.year).size().to_string())
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "fetch":
        return cmd_fetch(args)
    if args.command == "score":
        return cmd_score(args)
    if args.command == "sportsgrid":
        return cmd_sportsgrid(args)
    if args.command == "backtest":
        return cmd_backtest(args)
    if args.command == "audit-data":
        return cmd_audit(args)
    raise RuntimeError(f"Unknown command {args.command}")
