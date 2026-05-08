from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import pandas as pd

from .utils import canonical_name, normalize_market, today_et

SPORTSGRID_USER_AGENT = "Mozilla/5.0 (compatible; wnba-prop-model/1.0)"

TEAM_ALIASES = {
    "GSV": "GS",
    "GSW": "GS",
    "NYL": "NY",
    "NYK": "NY",
    "WAS": "WSH",
    "WSH": "WSH",
    "LVA": "LV",
    "LAS": "LV",
    "PHO": "PHX",
}

PROP_PATTERN = re.compile(
    r"\b(?P<away>[A-Z]{2,4})\s+"
    r"(?P<month>\d{2})/(?P<day>\d{2})\s+-\s+"
    r"(?P<time>[0-9:]+\s+[AP]M)\s+"
    r"(?P<home>[A-Z]{2,4})\s+"
    r"PLAYER\s+(?P<player>.+?)\s+"
    r"MARKET\s+(?P<line>[0-9.]+)\s+(?P<market>.+?)\s+"
    r"PICK\s+(?P<pick>Over|Under)\s+"
    r"RATING\s+PROJECTION\s+(?P<projection>[0-9.]+)\s+"
    r"(?P<side_token>[ou])(?P<book_line>[0-9.]+)\s+(?P<odds>[+-]?\d+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SportsGridProp:
    game_date: str
    away_abbr: str
    home_abbr: str
    game_time_et: str
    player: str
    market: str
    source_market: str
    line: float
    source_pick: str
    source_projection: float
    source_odds: int
    over_odds: int | None
    under_odds: int | None
    sportsbook_count: int
    source_book: str
    source_url: str
    game_total: float | None
    away_spread: float | None
    home_spread: float | None


def normalize_team(value: Any) -> str:
    team = str(value or "").strip().upper()
    return TEAM_ALIASES.get(team, team)


def fetch_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": SPORTSGRID_USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def _html_to_text(html: str) -> str:
    text = re.sub(r"<svg\b.*?</svg>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<script\b.*?</script>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style\b.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _infer_year(url: str, default_date: str | None) -> int:
    if default_date:
        return int(default_date[:4])
    match = re.search(r"(?:jan|feb|mar|apr|may|june?|july?|aug|sep|sept|oct|nov|dec)[a-z]*-\d{1,2}-(\d{4})", url, re.I)
    if match:
        return int(match.group(1))
    return int(today_et()[:4])


def _latest_player_props_segment(html: str) -> str:
    start = html.find("LATEST PLAYER PROPS")
    if start < 0:
        return ""
    end = html.find("LATEST PLAYER PROPS", start + len("LATEST PLAYER PROPS"))
    if end <= start:
        end = start + 80000
    return html[start:end]


def _spread_and_total(html: str) -> tuple[float | None, float | None, float | None]:
    start = html.find("LATEST BETTING LINES")
    end = html.find("LATEST PLAYER PROPS", start + 1)
    if start < 0 or end <= start:
        return None, None, None
    text = _html_to_text(html[start:end])
    spread_match = re.search(r"([+-]\d+(?:\.\d+)?)\s+Spread\s+([+-]\d+(?:\.\d+)?)", text)
    total_match = re.search(r"\bO\s+(\d+(?:\.\d+)?)\s+Total\s+U\s+(\d+(?:\.\d+)?)", text)
    away_spread = float(spread_match.group(1)) if spread_match else None
    home_spread = float(spread_match.group(2)) if spread_match else None
    game_total = float(total_match.group(1)) if total_match else None
    return away_spread, home_spread, game_total


def parse_props_from_html(html: str, url: str, default_date: str | None = None) -> list[SportsGridProp]:
    segment = _latest_player_props_segment(html)
    if not segment:
        return []
    away_spread, home_spread, game_total = _spread_and_total(html)
    year = _infer_year(url, default_date)
    props: list[SportsGridProp] = []
    for chunk in segment.split("player-card-listitems")[1:]:
        text = _html_to_text(chunk)
        match = PROP_PATTERN.search(text)
        if not match:
            continue
        source_pick = match.group("pick").upper()
        source_odds = int(match.group("odds"))
        over_odds = source_odds if source_pick == "OVER" else None
        under_odds = source_odds if source_pick == "UNDER" else None
        game_date = default_date or f"{year}-{int(match.group('month')):02d}-{int(match.group('day')):02d}"
        props.append(
            SportsGridProp(
                game_date=game_date,
                away_abbr=normalize_team(match.group("away")),
                home_abbr=normalize_team(match.group("home")),
                game_time_et=match.group("time").upper(),
                player=match.group("player").strip(),
                market=normalize_market(match.group("market")),
                source_market=match.group("market").strip(),
                line=float(match.group("line")),
                source_pick=source_pick,
                source_projection=float(match.group("projection")),
                source_odds=source_odds,
                over_odds=over_odds,
                under_odds=under_odds,
                sportsbook_count=1,
                source_book="FanDuel",
                source_url=url,
                game_total=game_total,
                away_spread=away_spread,
                home_spread=home_spread,
            )
        )
    return props


def fetch_props(urls: list[str], default_date: str | None = None) -> list[SportsGridProp]:
    props: list[SportsGridProp] = []
    for url in urls:
        props.extend(parse_props_from_html(fetch_page(url), url=url, default_date=default_date))
    return props


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
    if not parts:
        return logs.iloc[0:0]
    fuzzy = logs[
        logs["player_key"].map(
            lambda item: key in str(item) or str(item) in key or len(parts & set(str(item).split())) >= max(2, len(parts))
        )
    ]
    return fuzzy


def _latest_context(logs: pd.DataFrame, prop: SportsGridProp) -> tuple[str, str, str, str]:
    teams = {prop.away_abbr, prop.home_abbr}
    candidates = _player_candidates(logs, prop.player)
    if candidates.empty:
        return "", prop.away_abbr, prop.home_abbr, prop.player
    in_game = candidates[candidates["team_abbr"].astype(str).str.upper().isin(teams)]
    picked = (in_game if not in_game.empty else candidates).sort_values("game_date").iloc[-1]
    team = normalize_team(picked.get("team_abbr"))
    opponent = prop.home_abbr if team == prop.away_abbr else prop.away_abbr if team == prop.home_abbr else normalize_team(picked.get("opponent_abbr"))
    player_id = str(picked.get("player_id") or "")
    model_player = str(picked.get("player") or prop.player)
    return player_id, team, opponent, model_player


def props_to_board_rows(props: list[SportsGridProp], logs: pd.DataFrame | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    logs = logs if logs is not None else pd.DataFrame()
    for prop in props:
        player_id, team, opponent, model_player = _latest_context(logs, prop)
        spread = prop.away_spread if team == prop.away_abbr else prop.home_spread if team == prop.home_abbr else None
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
                "sportsbook_count": prop.sportsbook_count,
                "game_total": prop.game_total,
                "spread": spread,
                "source_pick": prop.source_pick,
                "source_projection": prop.source_projection,
                "source_odds": prop.source_odds,
                "source_book": prop.source_book,
                "source_market": prop.source_market,
                "source_url": prop.source_url,
                "game_time_et": prop.game_time_et,
                "line_last_updated": datetime.utcnow().isoformat(timespec="seconds") + "Z",
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
        "game_total",
        "spread",
        "source_pick",
        "source_projection",
        "source_odds",
        "source_book",
        "source_market",
        "source_url",
        "game_time_et",
        "line_last_updated",
    ]
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
