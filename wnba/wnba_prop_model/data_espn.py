from __future__ import annotations

import csv
import json
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from .utils import MARKET_COMPONENTS, parse_made_attempted, parse_minutes, season_phase_for_date

ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard"
ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary"
USER_AGENT = "Mozilla/5.0 (compatible; WNBAPropModel/1.0; +local)"
ET = ZoneInfo("America/New_York")


def _fetch_json(url: str, retries: int = 3, timeout: int = 30) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Could not fetch JSON from {url}: {last_error}")


def _event_date_et(value: str | None) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(ET).date().isoformat()


def _event_time_et(value: str | None) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(ET).isoformat(timespec="minutes")


def fetch_scoreboard_events(season: int, season_type: int = 2, limit: int = 1000) -> list[dict[str, Any]]:
    url = f"{ESPN_SCOREBOARD_URL}?dates={season}&seasontype={season_type}&limit={limit}"
    payload = _fetch_json(url)
    return list(payload.get("events") or [])


def fetch_event_summary(event_id: str) -> dict[str, Any]:
    return _fetch_json(f"{ESPN_SUMMARY_URL}?event={event_id}")


def _team_meta(event: dict[str, Any]) -> dict[str, dict[str, Any]]:
    competition = (event.get("competitions") or [{}])[0]
    teams: dict[str, dict[str, Any]] = {}
    for competitor in competition.get("competitors") or []:
        team = competitor.get("team") or {}
        abbr = str(team.get("abbreviation") or "").upper()
        if not abbr:
            continue
        teams[abbr] = {
            "team_id": str(team.get("id") or ""),
            "team_abbr": abbr,
            "team_name": team.get("displayName") or team.get("name") or abbr,
            "home_away": competitor.get("homeAway"),
            "is_home": competitor.get("homeAway") == "home",
            "score": competitor.get("score"),
        }
    return teams


def _opponent_for(team_abbr: str, teams: dict[str, dict[str, Any]]) -> dict[str, Any]:
    for abbr, meta in teams.items():
        if abbr != team_abbr:
            return meta
    return {}


def _status_completed(event: dict[str, Any]) -> bool:
    status_type = ((event.get("status") or {}).get("type") or {})
    return bool(status_type.get("completed")) or str(status_type.get("name") or "").upper() == "STATUS_FINAL"


def _stat_map(stat_group: dict[str, Any], athlete_row: dict[str, Any]) -> dict[str, Any]:
    names = stat_group.get("names") or stat_group.get("labels") or []
    stats = athlete_row.get("stats") or []
    return {str(name): stats[index] for index, name in enumerate(names) if index < len(stats)}


def _market_value(row: dict[str, Any], market: str) -> float:
    return float(sum(row.get(component, 0) or 0 for component in MARKET_COMPONENTS[market]))


def parse_summary_player_rows(event: dict[str, Any], summary: dict[str, Any]) -> list[dict[str, Any]]:
    event_id = str(event.get("id") or summary.get("id") or "")
    game_date = _event_date_et(event.get("date") or summary.get("date"))
    game_time_et = _event_time_et(event.get("date") or summary.get("date"))
    teams = _team_meta(event)
    rows: list[dict[str, Any]] = []

    for team_block in ((summary.get("boxscore") or {}).get("players") or []):
        team = team_block.get("team") or {}
        team_abbr = str(team.get("abbreviation") or "").upper()
        team_info = teams.get(team_abbr, {"team_abbr": team_abbr})
        opponent_info = _opponent_for(team_abbr, teams)
        opponent_abbr = str(opponent_info.get("team_abbr") or "").upper()
        matchup_key = "-".join(sorted([abbr for abbr in [team_abbr, opponent_abbr] if abbr]))

        for stat_group in team_block.get("statistics") or []:
            names = {str(name).upper() for name in (stat_group.get("names") or [])}
            if "MIN" not in names or "PTS" not in names:
                continue
            for athlete_row in stat_group.get("athletes") or []:
                if athlete_row.get("didNotPlay"):
                    continue
                stat_values = _stat_map(stat_group, athlete_row)
                minutes = parse_minutes(stat_values.get("MIN"))
                if minutes is None or minutes <= 0:
                    continue
                athlete = athlete_row.get("athlete") or {}
                fg_made, fg_attempts = parse_made_attempted(stat_values.get("FG"))
                three_made, three_attempts = parse_made_attempted(stat_values.get("3PT"))
                ft_made, ft_attempts = parse_made_attempted(stat_values.get("FT"))
                base_row: dict[str, Any] = {
                    "season": game_date[:4] if game_date else None,
                    "game_id": event_id,
                    "game_date": game_date,
                    "season_phase": season_phase_for_date(game_date),
                    "game_time_et": game_time_et,
                    "matchup_key": matchup_key,
                    "player_id": str(athlete.get("id") or ""),
                    "player": athlete.get("displayName") or athlete.get("shortName"),
                    "team_abbr": team_abbr,
                    "opponent_abbr": opponent_abbr,
                    "is_home": bool(team_info.get("is_home")),
                    "starter": bool(athlete_row.get("starter")),
                    "position": ((athlete.get("position") or {}).get("abbreviation") or ""),
                    "minutes": minutes,
                    "points": int(float(stat_values.get("PTS") or 0)),
                    "rebounds": int(float(stat_values.get("REB") or 0)),
                    "assists": int(float(stat_values.get("AST") or 0)),
                    "three_made": int(three_made or 0),
                    "threes": int(three_made or 0),
                    "three_attempts": int(three_attempts or 0),
                    "turnovers": int(float(stat_values.get("TO") or 0)),
                    "steals": int(float(stat_values.get("STL") or 0)),
                    "blocks": int(float(stat_values.get("BLK") or 0)),
                    "oreb": int(float(stat_values.get("OREB") or 0)),
                    "dreb": int(float(stat_values.get("DREB") or 0)),
                    "personal_fouls": int(float(stat_values.get("PF") or 0)),
                    "fgm": fg_made,
                    "fga": fg_attempts,
                    "ftm": ft_made,
                    "fta": ft_attempts,
                    "plus_minus": stat_values.get("+/-"),
                    "team_score": team_info.get("score"),
                    "opponent_score": opponent_info.get("score"),
                    "source": "espn_site_api",
                }
                for market in MARKET_COMPONENTS:
                    base_row[market] = _market_value(base_row, market)
                rows.append(base_row)
    return rows


def fetch_player_game_logs(
    seasons: Iterable[int],
    include_unfinal: bool = False,
    sleep_seconds: float = 0.12,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_events: set[str] = set()
    for season in seasons:
        events = fetch_scoreboard_events(int(season))
        for event in events:
            event_id = str(event.get("id") or "")
            if not event_id or event_id in seen_events:
                continue
            seen_events.add(event_id)
            if not include_unfinal and not _status_completed(event):
                continue
            summary = fetch_event_summary(event_id)
            rows.extend(parse_summary_player_rows(event, summary))
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)
    return rows


def write_logs_csv(rows: list[dict[str, Any]], path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "season",
        "game_id",
        "game_date",
        "season_phase",
        "game_time_et",
        "matchup_key",
        "player_id",
        "player",
        "team_abbr",
        "opponent_abbr",
        "is_home",
        "starter",
        "position",
        "minutes",
        "points",
        "rebounds",
        "assists",
        "three_made",
        "three_attempts",
        "turnovers",
        "steals",
        "blocks",
        "oreb",
        "dreb",
        "personal_fouls",
        "fgm",
        "fga",
        "ftm",
        "fta",
        "plus_minus",
        "team_score",
        "opponent_score",
        "PTS",
        "REB",
        "AST",
        "THREES",
        "PRA",
        "PA",
        "PR",
        "RA",
        "source",
    ]
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
