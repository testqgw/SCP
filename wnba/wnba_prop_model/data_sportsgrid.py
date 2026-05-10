from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import pandas as pd

from .utils import canonical_name, normalize_market, normalize_team, today_et

SPORTSGRID_USER_AGENT = "Mozilla/5.0 (compatible; wnba-prop-model/1.0)"
SPORTSGRID_BASE_URL = "https://www.sportsgrid.com"
SPORTSGRID_WEB_API = "https://web.sportsgrid.com/api/web/v1/getSingleSportGamesData"

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


def fetch_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": SPORTSGRID_USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "User-Agent": SPORTSGRID_USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", errors="ignore"))


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


def _parse_american(value: Any) -> int | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"even", "ev", "evens"}:
        return 100
    match = re.search(r"[+-]?\d+", text)
    return int(match.group(0)) if match else None


def _parse_point(value: Any) -> float | None:
    text = str(value or "").strip()
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def _game_date_from_item(item: dict[str, Any], default_date: str | None) -> str:
    if default_date:
        return default_date
    date_text = str(item.get("date") or "")
    match = re.search(r"(\d{2})/(\d{2})", date_text)
    if not match:
        return today_et()
    year = int(today_et()[:4])
    return f"{year}-{int(match.group(1)):02d}-{int(match.group(2)):02d}"


def _next_data(html: str) -> dict[str, Any] | None:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, flags=re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(unescape(match.group(1)))
    except json.JSONDecodeError:
        return None


def _props_from_next_data(html: str, url: str, default_date: str | None) -> list[SportsGridProp]:
    payload = _next_data(html)
    if not payload:
        return []
    ssr_data = (((payload.get("props") or {}).get("pageProps") or {}).get("ssr_data") or {})
    header = ssr_data.get("header_data") or {}
    game_lines = (ssr_data.get("game_lines") or {}).get("data") or {}
    items = (ssr_data.get("props_picks_data") or {}).get("data") or []
    away_abbr = normalize_team(header.get("away_alias") or game_lines.get("away_name"))
    home_abbr = normalize_team(header.get("home_alias") or game_lines.get("home_name"))
    away_spread = _parse_point(game_lines.get("away_spread_point"))
    home_spread = _parse_point(game_lines.get("home_spread_point"))
    game_total = _parse_point(game_lines.get("away_total_point") or game_lines.get("home_total_point"))
    props: list[SportsGridProp] = []
    for item in items:
        bookmaker = str(item.get("bookmaker_filter") or item.get("bookmaker") or "").strip()
        if bookmaker.lower() != "fanduel":
            continue
        line = _parse_point(item.get("market_points") or item.get("title"))
        source_projection = _parse_point(item.get("projection"))
        source_pick = str(item.get("over_under_filter") or item.get("picks") or "").upper()
        source_odds = _parse_american(item.get("bet"))
        if line is None or source_projection is None or source_pick not in {"OVER", "UNDER"} or source_odds is None:
            continue
        over_odds = source_odds if source_pick == "OVER" else None
        under_odds = source_odds if source_pick == "UNDER" else None
        props.append(
            SportsGridProp(
                game_date=_game_date_from_item(item, default_date),
                away_abbr=away_abbr or normalize_team(str(item.get("game") or "").split("@")[0]),
                home_abbr=home_abbr or normalize_team(str(item.get("game") or "").split("@")[-1]),
                game_time_et=str(item.get("time_filter") or item.get("time") or ""),
                player=str(item.get("player") or "").strip(),
                market=normalize_market(item.get("market")),
                source_market=str(item.get("market") or "").strip(),
                line=line,
                source_pick=source_pick,
                source_projection=source_projection,
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
    return [prop for prop in props if prop.player and prop.market]


def parse_props_from_html(html: str, url: str, default_date: str | None = None) -> list[SportsGridProp]:
    next_props = _props_from_next_data(html, url, default_date)
    if next_props:
        return next_props
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


def _walk_slugs(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        slug = str(value.get("slug") or value.get("game_slug") or "")
        if slug.startswith("wnba/game/") or slug.startswith("/wnba/game/"):
            found.append(value)
        for child in value.values():
            found.extend(_walk_slugs(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(_walk_slugs(child))
    return found


def discover_game_urls(slate_date: str | None = None) -> list[str]:
    target_date = slate_date or today_et()
    date_slug = datetime.strptime(target_date, "%Y-%m-%d").strftime("%B-%d-%Y").lower()
    payload = _post_json(SPORTSGRID_WEB_API, {"sport": "WNBA"})
    urls: list[str] = []
    seen: set[str] = set()
    for item in _walk_slugs(payload):
        slug = str(item.get("slug") or item.get("game_slug") or "").lstrip("/")
        scheduled = str(item.get("scheduled_raw") or item.get("scheduled") or "")
        if not slug.startswith("wnba/game/"):
            continue
        if not (scheduled.startswith(target_date) or date_slug in slug.lower()):
            continue
        url = f"{SPORTSGRID_BASE_URL}/{slug}"
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


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


def _latest_context(logs: pd.DataFrame, prop: SportsGridProp) -> tuple[str, str, str, str, str]:
    teams = {prop.away_abbr, prop.home_abbr}
    candidates = _player_candidates(logs, prop.player)
    if candidates.empty:
        return "", "", "", prop.player, "unresolved_player"
    in_game = candidates[candidates["team_abbr"].astype(str).str.upper().isin(teams)]
    if in_game.empty:
        picked = candidates.sort_values("game_date").iloc[-1]
        return str(picked.get("player_id") or ""), "", "", str(picked.get("player") or prop.player), "not_in_source_game"
    picked = in_game.sort_values("game_date").iloc[-1]
    team = normalize_team(picked.get("team_abbr"))
    opponent = prop.home_abbr if team == prop.away_abbr else prop.away_abbr if team == prop.home_abbr else normalize_team(picked.get("opponent_abbr"))
    player_id = str(picked.get("player_id") or "")
    model_player = str(picked.get("player") or prop.player)
    return player_id, team, opponent, model_player, "source_game_match"


def props_to_board_rows(props: list[SportsGridProp], logs: pd.DataFrame | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    logs = logs if logs is not None else pd.DataFrame()
    for prop in props:
        player_id, team, opponent, model_player, resolution_status = _latest_context(logs, prop)
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
                "source_away_abbr": prop.away_abbr,
                "source_home_abbr": prop.home_abbr,
                "game_time_et": prop.game_time_et,
                "line_last_updated": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "source_status": "live_current",
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
        "game_total",
        "spread",
        "source_pick",
        "source_projection",
        "source_odds",
        "source_book",
        "source_market",
        "source_url",
        "source_away_abbr",
        "source_home_abbr",
        "game_time_et",
        "line_last_updated",
        "source_status",
        "team_resolution_status",
    ]
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
