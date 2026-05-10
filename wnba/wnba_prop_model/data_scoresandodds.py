from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import pandas as pd

from .data_sportsgrid import normalize_team
from .utils import canonical_name, normalize_market, today_et

SCORESANDODDS_BASE_URL = "https://www.scoresandodds.com"
SCORESANDODDS_USER_AGENT = "Mozilla/5.0 (compatible; wnba-prop-model/1.0)"

MARKET_PATHS = {
    "PTS": "points",
    "REB": "rebounds",
    "AST": "assists",
    "THREES": "3-pointers",
}


@dataclass(frozen=True)
class ScoresAndOddsProp:
    game_date: str
    player: str
    market: str
    source_market: str
    line: float
    over_odds: int | None
    under_odds: int | None
    source_projection: float | None
    source_url: str
    source_event_id: str


def fetch_page(path_or_url: str) -> str:
    url = path_or_url if path_or_url.startswith("http") else urljoin(SCORESANDODDS_BASE_URL, path_or_url)
    request = Request(url, headers={"User-Agent": SCORESANDODDS_USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def _clean_text(value: str) -> str:
    text = re.sub(r"<svg\b.*?</svg>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _parse_american(value: str | None) -> int | None:
    if not value:
        return None
    text = value.strip().lower()
    if text in {"even", "ev", "evens"}:
        return 100
    match = re.search(r"[+-]?\d+", text)
    return int(match.group(0)) if match else None


def _market_from_path(path_or_url: str, fallback: str | None) -> str:
    if fallback:
        return normalize_market(fallback)
    lower = path_or_url.lower().rstrip("/")
    for market, path in MARKET_PATHS.items():
        if lower.endswith(path):
            return market
    return "PTS"


def _event_id(row_html: str) -> str:
    match = re.search(r'data-event="wnba/([^"]+)"', row_html)
    return match.group(1) if match else ""


def parse_props_from_html(
    html: str,
    path_or_url: str,
    default_date: str | None = None,
    fallback_market: str | None = None,
) -> list[ScoresAndOddsProp]:
    market = _market_from_path(path_or_url, fallback_market)
    source_market = _clean_text(market)
    rows = re.findall(r'<li class="border"(?P<attrs>[^>]*)>(?P<body>.*?)</li>', html, flags=re.IGNORECASE | re.DOTALL)
    props: list[ScoresAndOddsProp] = []
    source_url = path_or_url if path_or_url.startswith("http") else urljoin(SCORESANDODDS_BASE_URL, path_or_url)
    for attrs, body in rows:
        name_match = re.search(r'data-name="([^"]+)"', attrs, flags=re.IGNORECASE)
        if not name_match:
            continue
        player = " ".join(part.capitalize() for part in unescape(name_match.group(1)).split())
        filter_match = re.search(r'data-filter="([^"]+)"', body, flags=re.IGNORECASE)
        if filter_match:
            player = unescape(filter_match.group(1)).strip()
        projection_match = re.search(r'data-proj="([^"]+)"', attrs, flags=re.IGNORECASE)
        source_projection = float(projection_match.group(1)) if projection_match else None
        prices = re.findall(
            r'<span class="data-moneyline">([ou])([0-9.]+)</span>\s*<small class="data-odds(?: best)?">([^<]+)</small>',
            body,
            flags=re.IGNORECASE,
        )
        over_line = under_line = None
        over_odds = under_odds = None
        for side, line_text, odds_text in prices:
            if side.lower() == "o" and over_line is None:
                over_line = float(line_text)
                over_odds = _parse_american(odds_text)
            elif side.lower() == "u" and under_line is None:
                under_line = float(line_text)
                under_odds = _parse_american(odds_text)
        line = over_line if over_line is not None else under_line
        if line is None:
            continue
        if under_line is not None and abs(under_line - line) > 0.001:
            continue
        props.append(
            ScoresAndOddsProp(
                game_date=default_date or today_et(),
                player=player,
                market=market,
                source_market=source_market,
                line=line,
                over_odds=over_odds,
                under_odds=under_odds,
                source_projection=source_projection,
                source_url=source_url,
                source_event_id=_event_id(body),
            )
        )
    return props


def fetch_props(markets: list[str] | None = None, default_date: str | None = None) -> list[ScoresAndOddsProp]:
    active_markets = markets or list(MARKET_PATHS)
    props: list[ScoresAndOddsProp] = []
    for market in active_markets:
        normalized = normalize_market(market)
        path = MARKET_PATHS.get(normalized)
        if not path:
            continue
        url = f"{SCORESANDODDS_BASE_URL}/wnba/props/{path}"
        props.extend(parse_props_from_html(fetch_page(url), url, default_date=default_date, fallback_market=normalized))
    return props


def _current_team_matchups(slate_date: str) -> dict[str, str]:
    date_key = slate_date.replace("-", "")
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates={date_key}&limit=100"
    try:
        import json

        payload = json.loads(fetch_page(url))
    except Exception:
        return {}
    matchups: dict[str, str] = {}
    for event in payload.get("events") or []:
        competitors = (((event.get("competitions") or [{}])[0]).get("competitors") or [])
        teams = [normalize_team(((competitor.get("team") or {}).get("abbreviation") or "")) for competitor in competitors]
        teams = [team for team in teams if team]
        if len(teams) == 2:
            matchups[teams[0]] = teams[1]
            matchups[teams[1]] = teams[0]
    return matchups


def _player_candidates(logs: pd.DataFrame, player: str) -> pd.DataFrame:
    if logs.empty:
        return logs
    key = canonical_name(player)
    if "player_key" not in logs.columns:
        logs = logs.copy()
        logs["player_key"] = logs["player"].map(canonical_name)
    exact = logs[logs["player_key"] == key]
    if not exact.empty:
        return exact
    parts = set(key.split())
    return logs[
        logs["player_key"].map(
            lambda item: key in str(item) or str(item) in key or len(parts & set(str(item).split())) >= max(2, len(parts))
        )
    ]


def _latest_context(logs: pd.DataFrame, player: str, team_matchups: dict[str, str]) -> tuple[str, str, str, str, str]:
    candidates = _player_candidates(logs, player)
    if candidates.empty:
        return "", "", "", player, "unresolved_player"
    current_teams = set(team_matchups)
    in_slate = candidates[candidates["team_abbr"].astype(str).str.upper().map(normalize_team).isin(current_teams)]
    if in_slate.empty and team_matchups:
        picked = candidates.sort_values("game_date").iloc[-1]
        return str(picked.get("player_id") or ""), "", "", str(picked.get("player") or player), "not_in_slate_matchup"
    picked = (in_slate if not in_slate.empty else candidates).sort_values("game_date").iloc[-1]
    team = normalize_team(picked.get("team_abbr"))
    opponent = team_matchups.get(team) or normalize_team(picked.get("opponent_abbr"))
    return str(picked.get("player_id") or ""), team, opponent, str(picked.get("player") or player), "slate_matchup_match" if not in_slate.empty else "historical_fallback"


def props_to_board_rows(props: list[ScoresAndOddsProp], logs: pd.DataFrame | None = None) -> list[dict[str, Any]]:
    logs = logs if logs is not None else pd.DataFrame()
    date = props[0].game_date if props else today_et()
    team_matchups = _current_team_matchups(date)
    rows: list[dict[str, Any]] = []
    for prop in props:
        player_id, team, opponent, model_player, resolution_status = _latest_context(logs, prop.player, team_matchups)
        rows.append(
            {
                "game_date": prop.game_date,
                "player": model_player,
                "player_id": player_id,
                "team_abbr": team,
                "opponent_abbr": opponent,
                "market": prop.market,
                "line": prop.line,
                "over_odds": prop.over_odds,
                "under_odds": prop.under_odds,
                "sportsbook_count": 2 if prop.over_odds is not None and prop.under_odds is not None else 1,
                "source_projection": prop.source_projection,
                "source_book": "ScoresAndOdds Best Odds",
                "source_market": prop.source_market,
                "source_url": prop.source_url,
                "source_event_id": prop.source_event_id,
                "line_last_updated": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "team_resolution_status": resolution_status,
            }
        )
    return rows


def write_board_csv(rows: list[dict[str, Any]], path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "game_date",
        "player",
        "player_id",
        "team_abbr",
        "opponent_abbr",
        "market",
        "line",
        "over_odds",
        "under_odds",
        "sportsbook_count",
        "source_projection",
        "source_book",
        "source_market",
        "source_url",
        "source_event_id",
        "line_last_updated",
        "team_resolution_status",
    ]
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
