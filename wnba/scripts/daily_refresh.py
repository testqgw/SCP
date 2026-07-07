from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wnba_prop_model import data_scoresandodds, data_sportsgrid, data_theoddsapi
from wnba_prop_model.data_espn import fetch_player_game_logs, write_logs_csv
from wnba_prop_model.model import empty_card, load_board, load_logs, score_board, write_card
from wnba_prop_model.settlement import settle_card, write_settlement
from wnba_prop_model.utils import canonical_name, player_id_aliases

LOGS_PATH = ROOT / "data/raw/wnba_player_game_logs.csv"
CURRENT_OUTPUT_PREFIX = ROOT / "output/current-card"
CURRENT_SETTLEMENT_PREFIX = ROOT / "output/current-settlement"
REFRESH_SUMMARY_PATH = ROOT / "output/current-refresh-summary.json"
UNAVAILABLE_PROPS_PATH = ROOT / "data/current/fanduel_unavailable_props.csv"


def today_et() -> str:
    return datetime.now(ET).date().isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh the daily WNBA prop model artifacts.")
    parser.add_argument("--date", default=os.getenv("WNBA_CARD_DATE") or None)
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025, 2026])
    parser.add_argument("--fetch-sleep", type=float, default=0.05)
    parser.add_argument("--source", choices=["auto", "sportsgrid", "scoresandodds", "oddsapi"], default="auto")
    parser.add_argument("--book", choices=["fanduel", "best", "expanded"], default="fanduel")
    parser.add_argument("--bookmakers", default=None)
    parser.add_argument("--sportsgrid-urls", nargs="*", default=None)
    parser.add_argument("--unavailable-props", default=str(UNAVAILABLE_PROPS_PATH))
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


def load_unavailable_candidate_ids(path: str | Path, target_date: str) -> set[str]:
    source_path = Path(path)
    if not source_path.exists():
        return set()
    blocked: set[str] = set()
    with source_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            row_date = str(row.get("game_date") or "").strip()
            if row_date and row_date != target_date:
                continue
            candidate_id = str(row.get("candidate_id") or "").strip()
            if not candidate_id:
                player_key = str(row.get("player_id") or "").strip() or canonical_name(str(row.get("player") or ""))
                market = str(row.get("market") or "").strip().upper()
                line = str(row.get("line") or "").strip()
                if player_key and market and line:
                    candidate_id = f"{target_date}:{player_key}:{market}:{line}"
            if candidate_id:
                blocked.add(candidate_id)
                parts = candidate_id.split(":")
                if len(parts) >= 4:
                    game_date, player_key, market, line = parts[:4]
                    for player_alias in player_id_aliases(player_key) or {player_key}:
                        blocked.add(f"{game_date}:{player_alias}:{market}:{line}")
                        blocked.add(f"{game_date}:{player_alias}:{market}:*")
            player_key = str(row.get("player_id") or "").strip() or canonical_name(str(row.get("player") or ""))
            market = str(row.get("market") or "").strip().upper()
            if player_key and market:
                for player_alias in player_id_aliases(player_key) or {player_key}:
                    blocked.add(f"{target_date}:{player_alias}:{market}:*")
    return blocked


def _board_row_key(row: dict) -> tuple[str, str, str, str, str, str]:
    player_key = str(row.get("player_id") or row.get("player") or "").strip().lower()
    return (
        str(row.get("game_date") or "").strip(),
        player_key,
        str(row.get("market") or "").strip().upper(),
        str(row.get("line") or "").strip(),
        str(row.get("source_market") or "").strip().lower(),
        str(row.get("source_url") or "").strip().lower(),
    )


COMBINED_BOARD_FIELDNAMES = [
    "game_date",
    "player",
    "player_id",
    "team_abbr",
    "opponent_abbr",
    "market",
    "line",
    "over_odds",
    "under_odds",
    "over_book",
    "under_book",
    "sportsbook_count",
    "game_total",
    "spread",
    "source_pick",
    "source_projection",
    "source_odds",
    "source_book",
    "source_market",
    "source_url",
    "source_event_id",
    "source_away_abbr",
    "source_home_abbr",
    "game_time_et",
    "line_last_updated",
    "source_status",
    "team_resolution_status",
]


def _combined_source_priority(row: dict[str, Any]) -> int:
    source_book = str(row.get("source_book") or "").lower()
    source_url = str(row.get("source_url") or "").lower()
    if "fanduel" in source_book:
        return 0
    if "sportsgrid" in source_url:
        return 1
    if "odds api" in source_book or "the-odds-api" in source_url:
        return 2
    return 3


def _combined_row_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    player_key = str(row.get("player_id") or "").strip()
    if not player_key:
        player_key = canonical_name(str(row.get("player") or ""))
    return (
        str(row.get("game_date") or "").strip(),
        player_key,
        str(row.get("market") or "").strip().upper(),
        str(row.get("line") or "").strip(),
    )


def dedupe_combined_board_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in sorted(rows, key=_combined_source_priority):
        key = _combined_row_key(row)
        if key not in deduped:
            deduped[key] = row
    return sorted(
        deduped.values(),
        key=lambda row: (
            _combined_source_priority(row),
            str(row.get("game_time_et") or ""),
            str(row.get("team_abbr") or ""),
            str(row.get("player") or ""),
            str(row.get("market") or ""),
        ),
    )


def write_combined_board_csv(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COMBINED_BOARD_FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def merge_same_day_board_rows(board_path: Path, target_date: str, fresh_rows: list[dict]) -> list[dict]:
    merged: dict[tuple[str, str, str, str, str, str, str], dict] = {}
    if board_path.exists():
        with board_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                if str(row.get("game_date") or "") == target_date:
                    row["source_status"] = "preserved_same_day"
                    merged[_board_row_key(row)] = row
    for row in fresh_rows:
        if str(row.get("game_date") or "") == target_date:
            row["source_status"] = "live_current"
            merged[_board_row_key(row)] = row
    return sorted(
        merged.values(),
        key=lambda row: (
            str(row.get("game_time_et") or ""),
            str(row.get("team_abbr") or ""),
            str(row.get("player") or ""),
            str(row.get("market") or ""),
        ),
    )


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


def build_score_limits(args: argparse.Namespace, target_date: str, source: str = "") -> dict[str, object]:
    limits: dict[str, object] = {"max_picks": args.max_picks, "min_score": args.min_score}
    blocked_candidate_ids = load_unavailable_candidate_ids(args.unavailable_props, target_date)
    if blocked_candidate_ids:
        limits["blocked_candidate_ids"] = blocked_candidate_ids
    if args.book == "fanduel":
        limits["required_source_book"] = "FanDuel"
        limits["require_direct_source_book"] = True
        limits["require_playable_side_odds"] = True
        limits["allow_source_consensus_leans"] = True
        limits["min_consensus_price_edge"] = 0.0
        limits["allow_forced_six_pick_fill"] = True
        limits["forced_fill_min_probability"] = 0.52
        limits["forced_fill_min_price_edge"] = 0.0
        limits["max_per_game"] = 6
        limits["sgp_tax_penalty_per_same_game_pair"] = 0.035
        limits["exclude_single_side_prices"] = True
        limits["exclude_rebound_unders"] = True
        limits["market_side_score_adjustments"] = {"THREES:UNDER": 0.55}
        if source == "sportsgrid-fanduel":
            limits["allow_pick_side_only_prices"] = True
    elif args.book == "expanded":
        limits.update(
            {
                "target_picks": args.max_picks,
                "require_playable_side_odds": True,
                "allow_expanded_fill": True,
                "expanded_min_score": 0.58,
                "expanded_min_probability": 0.62,
                "expanded_min_price_edge": 0.04,
                "allow_forced_six_pick_fill": True,
                "forced_fill_min_probability": 0.60,
                "max_per_player": 1,
                "max_per_team": 6,
                "max_per_game": 6,
                "max_per_market": 4,
                "max_combo_markets": 4,
            }
        )
    return limits


def score_current_board(logs_path: Path, board_path: Path, target_date: str, args: argparse.Namespace, source: str = "") -> dict:
    logs = load_logs(logs_path, include_preseason=True)
    board = load_board(board_path, default_date=target_date)
    limits = build_score_limits(args, target_date, source=source)
    return score_board(logs, board, slate_date=target_date, limits=limits)


def generate_from_sportsgrid(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    urls = args.sportsgrid_urls or data_sportsgrid.discover_game_urls(target_date)
    if not urls:
        raise RuntimeError(f"No SportsGrid WNBA game URLs discovered for {target_date}.")
    props = data_sportsgrid.fetch_props(urls, default_date=target_date)
    rows = data_sportsgrid.props_to_board_rows(props, resolver_logs)
    if not rows:
        raise RuntimeError(f"No SportsGrid FanDuel WNBA player props found for {target_date}.")
    board_path = ROOT / f"data/current/sportsgrid_fanduel_board_{target_date}.csv"
    rows = merge_same_day_board_rows(board_path, target_date, rows)
    data_sportsgrid.write_board_csv(rows, board_path)
    card = score_current_board(LOGS_PATH, board_path, target_date, args, source="sportsgrid-fanduel")
    card["mode"] = "CURRENT_FANDUEL_PREVIEW"
    card["sourceUrls"] = urls
    card["sourceNote"] = "SportsGrid public WNBA game pages showing FanDuel player props; selected rows require FanDuel source and playable side odds."
    return card, "sportsgrid-fanduel", board_path


def generate_from_scoresandodds(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    props = data_scoresandodds.fetch_props(list(data_scoresandodds.MARKET_PATHS), default_date=target_date)
    rows = data_scoresandodds.props_to_board_rows(props, resolver_logs)
    board_path = ROOT / f"data/current/scoresandodds_board_{target_date}.csv"
    data_scoresandodds.write_board_csv(rows, board_path)
    card = score_current_board(LOGS_PATH, board_path, target_date, args)
    card["mode"] = "CURRENT_FANDUEL_MARKET_PREVIEW" if args.book == "fanduel" else "CURRENT_BEST_ODDS_PREVIEW"
    card["sourceUrls"] = sorted({row.get("source_url") for row in rows if row.get("source_url")})
    if args.book == "fanduel":
        card["sourceNote"] = "ScoresAndOdds public WNBA prop tables for coverage only; FanDuel-strict selected rows are blocked unless a FanDuel source is present."
    else:
        card["sourceNote"] = "ScoresAndOdds public WNBA prop tables; over and under odds are best available listed prices by side."
    return card, "scoresandodds", board_path


def generate_from_oddsapi(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    api_key = os.getenv("THE_ODDS_API_KEY")
    if not api_key:
        raise RuntimeError("THE_ODDS_API_KEY is not set.")
    bookmakers = args.bookmakers or ("fanduel" if args.book == "fanduel" else None)
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    props = data_theoddsapi.fetch_props(api_key, logs=resolver_logs, bookmakers=bookmakers)
    rows = data_theoddsapi.props_to_board_rows(props)
    if not rows:
        raise RuntimeError("The Odds API returned zero WNBA prop rows.")
    board_path = ROOT / f"data/current/theoddsapi_board_{target_date}.csv"
    data_theoddsapi.write_board_csv(rows, board_path)
    card = score_current_board(LOGS_PATH, board_path, target_date, args)
    card["mode"] = "CURRENT_FANDUEL_MARKET_PREVIEW" if args.book == "fanduel" else "CURRENT_FULL_MARKET_PREVIEW"
    card["sourceUrls"] = ["https://the-odds-api.com/sports/wnba-odds.html"]
    if args.book == "fanduel":
        card["sourceNote"] = "The Odds API WNBA event player props filtered to FanDuel; selected rows require FanDuel source and playable side odds."
    else:
        card["sourceNote"] = "The Odds API WNBA event player props; rows use best listed over/under price across returned bookmakers."
    return card, "oddsapi-fanduel" if args.book == "fanduel" else "oddsapi", board_path


def generate_from_expanded(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    resolver_logs = load_logs(LOGS_PATH, include_preseason=True)
    rows: list[dict[str, Any]] = []
    source_urls: set[str] = set()
    source_names: list[str] = []

    api_key = os.getenv("THE_ODDS_API_KEY")
    if api_key:
        try:
            bookmakers = args.bookmakers or None
            props = data_theoddsapi.fetch_props(api_key, logs=resolver_logs, bookmakers=bookmakers)
            odds_rows = data_theoddsapi.props_to_board_rows(props)
            rows.extend(odds_rows)
            if odds_rows:
                source_names.append("oddsapi")
                source_urls.add("https://the-odds-api.com/sports/wnba-odds.html")
        except Exception as error:
            print(f"Odds API expanded refresh skipped: {error}")

    try:
        urls = args.sportsgrid_urls or data_sportsgrid.discover_game_urls(target_date)
        if urls:
            props = data_sportsgrid.fetch_props(urls, default_date=target_date)
            sportsgrid_rows = data_sportsgrid.props_to_board_rows(props, resolver_logs)
            for row in sportsgrid_rows:
                if str(row.get("game_date") or "") == target_date:
                    row["source_status"] = "live_current"
                    rows.append(row)
            if sportsgrid_rows:
                source_names.append("sportsgrid-fanduel")
                source_urls.update(urls)
    except Exception as error:
        print(f"SportsGrid expanded refresh skipped: {error}")

    try:
        props = data_scoresandodds.fetch_props(list(data_scoresandodds.MARKET_PATHS), default_date=target_date)
        scores_rows = data_scoresandodds.props_to_board_rows(props, resolver_logs)
        rows.extend(row for row in scores_rows if str(row.get("game_date") or "") == target_date)
        if scores_rows:
            source_names.append("scoresandodds")
            source_urls.update(row.get("source_url") for row in scores_rows if row.get("source_url"))
    except Exception as error:
        print(f"ScoresAndOdds expanded refresh skipped: {error}")

    rows = dedupe_combined_board_rows(rows)
    board_path = ROOT / f"data/current/expanded_board_{target_date}.csv"
    if not rows:
        write_combined_board_csv([], board_path)
        card = empty_card(
            target_date,
            limits={
                "max_picks": args.max_picks,
                "target_picks": args.max_picks,
                "min_score": args.min_score,
                "require_playable_side_odds": True,
                "allow_expanded_fill": True,
                "expanded_min_score": 0.58,
                "expanded_min_probability": 0.62,
                "expanded_min_price_edge": 0.04,
                "max_per_player": 1,
                "max_per_team": 6,
                "max_per_game": 6,
                "max_per_market": 4,
                "max_combo_markets": 4,
            },
            mode="NO_ESPN_MATCHED_SLATE",
            warnings=[
                "No ESPN-matched WNBA slate rows were available for this date; stale public prop rows were ignored."
            ],
            source_note=(
                "No selected WNBA props were published because the source rows did not match an ESPN scoreboard slate "
                "and current ESPN rosters for the target date."
            ),
        )
        card["sourceUrls"] = sorted(source_urls)
        return card, "+".join(dict.fromkeys(source_names)) or "expanded", board_path
    write_combined_board_csv(rows, board_path)
    card = score_current_board(LOGS_PATH, board_path, target_date, args)
    card["mode"] = "CURRENT_EXPANDED_6_PICK_PREVIEW"
    card["sourceUrls"] = sorted(source_urls)
    card["sourceNote"] = (
        "Expanded board: FanDuel-sourced rows are preferred when available, then broader best-odds public rows fill the 6-pick target. "
        "The portfolio allows only one selected prop per player per slate. Confirm the listed book and current odds before betting."
    )
    source = "+".join(dict.fromkeys(source_names)) or "expanded"
    return card, source, board_path


def generate_current_card(target_date: str, args: argparse.Namespace) -> tuple[dict, str, Path]:
    if args.book == "expanded":
        return generate_from_expanded(target_date, args)
    if args.source == "oddsapi" or (args.source == "auto" and os.getenv("THE_ODDS_API_KEY")):
        try:
            return generate_from_oddsapi(target_date, args)
        except Exception as error:
            if args.source == "oddsapi":
                raise
            print(f"Odds API refresh failed, falling back to ScoresAndOdds: {error}")
    if args.source == "sportsgrid" or (args.source == "auto" and args.book == "fanduel"):
        try:
            return generate_from_sportsgrid(target_date, args)
        except Exception as error:
            if args.source == "sportsgrid":
                raise
            print(f"SportsGrid FanDuel refresh failed, falling back to ScoresAndOdds coverage: {error}")
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
