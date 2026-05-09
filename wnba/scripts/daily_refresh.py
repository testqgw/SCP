from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wnba_prop_model import data_scoresandodds, data_theoddsapi
from wnba_prop_model.data_espn import fetch_player_game_logs, write_logs_csv
from wnba_prop_model.model import load_board, load_logs, score_board, write_card
from wnba_prop_model.settlement import settle_card, write_settlement

LOGS_PATH = ROOT / "data/raw/wnba_player_game_logs.csv"
CURRENT_OUTPUT_PREFIX = ROOT / "output/current-card"
CURRENT_SETTLEMENT_PREFIX = ROOT / "output/current-settlement"
REFRESH_SUMMARY_PATH = ROOT / "output/current-refresh-summary.json"


def today_et() -> str:
    return datetime.now(ET).date().isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh the daily WNBA prop model artifacts.")
    parser.add_argument("--date", default=os.getenv("WNBA_CARD_DATE") or None)
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025, 2026])
    parser.add_argument("--fetch-sleep", type=float, default=0.05)
    parser.add_argument("--source", choices=["auto", "scoresandodds", "oddsapi"], default="auto")
    parser.add_argument("--max-picks", type=int, default=6)
    parser.add_argument("--min-score", type=float, default=0.68)
    return parser.parse_args()


def read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def relative_paths(paths: dict[str, str]) -> dict[str, str]:
    clean_paths: dict[str, str] = {}
    for key, value in paths.items():
        path = Path(value)
        try:
            clean_paths[key] = str(path.relative_to(ROOT))
        except ValueError:
            clean_paths[key] = str(path)
    return clean_paths


def archive_existing_card(target_date: str) -> str | None:
    current_card_path = CURRENT_OUTPUT_PREFIX.with_suffix(".json")
    current = read_json(current_card_path)
    if not current:
        return None
    slate_date = str(current.get("slateDate") or "")
    if not slate_date or slate_date == target_date:
        return None
    archive_dir = ROOT / "archive" / slate_date
    archive_dir.mkdir(parents=True, exist_ok=True)
    for prefix, name in [(CURRENT_OUTPUT_PREFIX, "current-card"), (CURRENT_SETTLEMENT_PREFIX, "current-settlement")]:
        for suffix in [".json", ".csv", ".md"]:
            source = prefix.with_suffix(suffix)
            if source.exists():
                shutil.copy2(source, archive_dir / f"{name}{suffix}")
    return slate_date


def refresh_logs(args: argparse.Namespace) -> None:
    if args.skip_fetch:
        return
    rows = fetch_player_game_logs(args.seasons, include_unfinal=False, sleep_seconds=args.fetch_sleep)
    if not rows:
        raise RuntimeError("ESPN log refresh returned zero rows.")
    write_logs_csv(rows, LOGS_PATH)


def settle_existing_card(archived_slate: str | None) -> dict | None:
    current = read_json(CURRENT_OUTPUT_PREFIX.with_suffix(".json"))
    if not current or not LOGS_PATH.exists():
        return None
    logs = load_logs(LOGS_PATH, include_preseason=True)
    result = settle_card(current, logs)
    slate_date = str(result.get("slateDate") or current.get("slateDate") or "")
    if archived_slate and slate_date == archived_slate:
        archive_prefix = ROOT / "archive" / slate_date / "current-settlement"
        write_settlement(result, archive_prefix)
    return result


def generate_from_scoresandodds(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    props = data_scoresandodds.fetch_props(["PTS", "REB", "AST", "THREES"], default_date=target_date)
    rows = data_scoresandodds.props_to_board_rows(props, resolver_logs)
    board_path = ROOT / f"data/current/scoresandodds_board_{target_date}.csv"
    data_scoresandodds.write_board_csv(rows, board_path)
    logs = load_logs(LOGS_PATH, include_preseason=True)
    board = load_board(board_path, default_date=target_date)
    card = score_board(logs, board, slate_date=target_date, limits={"max_picks": args.max_picks, "min_score": args.min_score})
    card["mode"] = "CURRENT_BEST_ODDS_PREVIEW"
    card["sourceUrls"] = sorted({row.get("source_url") for row in rows if row.get("source_url")})
    card["sourceNote"] = "ScoresAndOdds public WNBA prop tables; over and under odds are best available listed prices by side."
    return card, "scoresandodds", board_path


def generate_from_oddsapi(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    api_key = os.getenv("THE_ODDS_API_KEY")
    if not api_key:
        raise RuntimeError("THE_ODDS_API_KEY is not set.")
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    props = data_theoddsapi.fetch_props(api_key, logs=resolver_logs)
    rows = data_theoddsapi.props_to_board_rows(props)
    board_path = ROOT / f"data/current/theoddsapi_board_{target_date}.csv"
    data_theoddsapi.write_board_csv(rows, board_path)
    logs = load_logs(LOGS_PATH, include_preseason=True)
    board = load_board(board_path, default_date=target_date)
    card = score_board(logs, board, slate_date=target_date, limits={"max_picks": args.max_picks, "min_score": args.min_score})
    card["mode"] = "CURRENT_FULL_MARKET_PREVIEW"
    card["sourceUrls"] = ["https://the-odds-api.com/sports/wnba-odds.html"]
    card["sourceNote"] = "The Odds API WNBA event player props; rows use best listed over/under price across returned bookmakers."
    return card, "oddsapi", board_path


def generate_current_card(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    if args.source == "oddsapi" or (args.source == "auto" and os.getenv("THE_ODDS_API_KEY")):
        try:
            return generate_from_oddsapi(target_date, args)
        except Exception as error:
            if args.source == "oddsapi":
                raise
            print(f"Odds API refresh failed, falling back to ScoresAndOdds: {error}")
    return generate_from_scoresandodds(target_date, args)


def main() -> int:
    args = parse_args()
    target_date = args.date or today_et()
    archived_slate = archive_existing_card(target_date)
    refresh_logs(args)
    prior_settlement = settle_existing_card(archived_slate)
    card, source, board_path = generate_current_card(target_date, args)
    paths = write_card(card, CURRENT_OUTPUT_PREFIX)
    logs = load_logs(LOGS_PATH, include_preseason=True)
    current_settlement = settle_card(card, logs)
    settlement_paths = write_settlement(current_settlement, CURRENT_SETTLEMENT_PREFIX)
    summary = {
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "targetDate": target_date,
        "source": source,
        "boardPath": str(board_path.relative_to(ROOT)),
        "archivedSlate": archived_slate,
        "selectedCount": card["summary"]["selectedCount"],
        "totalBoardRows": card["summary"]["totalBoardRows"],
        "priorSettlement": prior_settlement["summary"] if prior_settlement else None,
        "currentSettlement": current_settlement["summary"],
        "cardPaths": relative_paths(paths),
        "settlementPaths": relative_paths(settlement_paths),
    }
    REFRESH_SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
