from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

from .data_scoresandodds import _latest_context, _current_team_matchups
from .data_sportsgrid import normalize_team

API_BASE = "https://api.the-odds-api.com/v4"
SPORT_KEY = "basketball_wnba"
USER_AGENT = "Mozilla/5.0 (compatible; wnba-prop-model/1.0)"

TEAM_NAME_TO_ABBR = {
    "Atlanta Dream": "ATL",
    "Chicago Sky": "CHI",
    "Connecticut Sun": "CON",
    "Dallas Wings": "DAL",
    "Golden State Valkyries": "GS",
    "Indiana Fever": "IND",
    "Las Vegas Aces": "LV",
    "Los Angeles Sparks": "LA",
    "Minnesota Lynx": "MIN",
    "New York Liberty": "NY",
    "Phoenix Mercury": "PHX",
    "Seattle Storm": "SEA",
    "Toronto Tempo": "TOR",
    "Washington Mystics": "WSH",
}

MARKET_TO_API = {
    "PTS": "player_points",
    "REB": "player_rebounds",
    "AST": "player_assists",
    "THREES": "player_threes",
    "PRA": "player_points_rebounds_assists",
    "PA": "player_points_assists",
    "PR": "player_points_rebounds",
    "RA": "player_rebounds_assists",
}

API_TO_MARKET = {value: key for key, value in MARKET_TO_API.items()}


@dataclass(frozen=True)
class OddsApiProp:
    game_date: str
    player: str
    team_abbr: str
    opponent_abbr: str
    market: str
    line: float
    over_odds: int | None
    under_odds: int | None
    sportsbook_count: int
    source_book: str
    source_event_id: str
    source_url: str


def _fetch_json(path: str, params: dict[str, str]) -> Any:
    url = f"{API_BASE}{path}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_events(api_key: str, date_format: str = "iso") -> list[dict[str, Any]]:
    payload = _fetch_json(f"/sports/{SPORT_KEY}/events", {"apiKey": api_key, "dateFormat": date_format})
    return list(payload or [])


def fetch_event_odds(
    api_key: str,
    event_id: str,
    markets: list[str],
    regions: str = "us",
    bookmakers: str | None = None,
) -> dict[str, Any]:
    params = {
        "apiKey": api_key,
        "regions": regions,
        "markets": ",".join(MARKET_TO_API[market] for market in markets if market in MARKET_TO_API),
        "oddsFormat": "american",
        "dateFormat": "iso",
    }
    if bookmakers:
        params["bookmakers"] = bookmakers
    return dict(_fetch_json(f"/sports/{SPORT_KEY}/events/{event_id}/odds", params))


def _event_date(event: dict[str, Any]) -> str:
    return str(event.get("commence_time") or "")[:10] or datetime.utcnow().date().isoformat()


def _event_matchups(event: dict[str, Any]) -> dict[str, str]:
    home = normalize_team(TEAM_NAME_TO_ABBR.get(str(event.get("home_team") or ""), str(event.get("home_team") or "")))
    away = normalize_team(TEAM_NAME_TO_ABBR.get(str(event.get("away_team") or ""), str(event.get("away_team") or "")))
    if home and away:
        return {home: away, away: home}
    return {}


def _better_price(current: int | None, candidate: Any) -> int | None:
    try:
        price = int(candidate)
    except (TypeError, ValueError):
        return current
    if current is None:
        return price
    return max(current, price)


def parse_event_odds(event_odds: dict[str, Any], logs: pd.DataFrame | None = None) -> list[OddsApiProp]:
    logs = logs if logs is not None else pd.DataFrame()
    slate_date = _event_date(event_odds)
    event_matchups = _event_matchups(event_odds) or _current_team_matchups(slate_date)
    grouped: dict[tuple[str, str, float], dict[str, Any]] = {}
    for bookmaker in event_odds.get("bookmakers") or []:
        book_title = str(bookmaker.get("title") or bookmaker.get("key") or "book")
        for market in bookmaker.get("markets") or []:
            market_key = str(market.get("key") or "")
            model_market = API_TO_MARKET.get(market_key)
            if not model_market:
                continue
            for outcome in market.get("outcomes") or []:
                side = str(outcome.get("name") or "").upper()
                player = str(outcome.get("description") or "").strip()
                point = outcome.get("point")
                if side not in {"OVER", "UNDER"} or not player or point is None:
                    continue
                key = (player, model_market, float(point))
                row = grouped.setdefault(
                    key,
                    {
                        "player": player,
                        "market": model_market,
                        "line": float(point),
                        "over_odds": None,
                        "under_odds": None,
                        "books": set(),
                    },
                )
                if side == "OVER":
                    row["over_odds"] = _better_price(row["over_odds"], outcome.get("price"))
                else:
                    row["under_odds"] = _better_price(row["under_odds"], outcome.get("price"))
                row["books"].add(book_title)
    props: list[OddsApiProp] = []
    for row in grouped.values():
        player_id, team, opponent, model_player = _latest_context(logs, row["player"], event_matchups)
        if not team:
            continue
        props.append(
            OddsApiProp(
                game_date=slate_date,
                player=model_player,
                team_abbr=team,
                opponent_abbr=opponent,
                market=row["market"],
                line=float(row["line"]),
                over_odds=row["over_odds"],
                under_odds=row["under_odds"],
                sportsbook_count=len(row["books"]),
                source_book="The Odds API best odds",
                source_event_id=str(event_odds.get("id") or ""),
                source_url="https://the-odds-api.com/sports/wnba-odds.html",
            )
        )
    return props


def fetch_props(
    api_key: str,
    markets: list[str] | None = None,
    regions: str = "us",
    bookmakers: str | None = None,
    logs: pd.DataFrame | None = None,
) -> list[OddsApiProp]:
    active_markets = markets or list(MARKET_TO_API)
    events = fetch_events(api_key)
    props: list[OddsApiProp] = []
    for event in events:
        event_id = str(event.get("id") or "")
        if not event_id:
            continue
        odds = fetch_event_odds(api_key, event_id, active_markets, regions=regions, bookmakers=bookmakers)
        props.extend(parse_event_odds(odds, logs=logs))
    return props


def props_to_board_rows(props: list[OddsApiProp]) -> list[dict[str, Any]]:
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    return [
        {
            "game_date": prop.game_date,
            "player": prop.player,
            "team_abbr": prop.team_abbr,
            "opponent_abbr": prop.opponent_abbr,
            "market": prop.market,
            "line": prop.line,
            "over_odds": prop.over_odds,
            "under_odds": prop.under_odds,
            "sportsbook_count": prop.sportsbook_count,
            "source_book": prop.source_book,
            "source_market": prop.market,
            "source_url": prop.source_url,
            "source_event_id": prop.source_event_id,
            "line_last_updated": now,
        }
        for prop in props
    ]


def write_board_csv(rows: list[dict[str, Any]], path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "game_date",
        "player",
        "team_abbr",
        "opponent_abbr",
        "market",
        "line",
        "over_odds",
        "under_odds",
        "sportsbook_count",
        "source_book",
        "source_market",
        "source_url",
        "source_event_id",
        "line_last_updated",
    ]
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
