from __future__ import annotations

import math
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any

MARKETS = ("PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA")
BASE_MARKETS = ("PTS", "REB", "AST", "THREES")
COMBO_MARKETS = {"PRA", "PA", "PR", "RA"}
COUNTING_OVER_MARKETS = {"PTS", "AST", "PRA", "PA", "PR", "RA"}
MARKET_COMPONENTS = {
    "PTS": ("points",),
    "REB": ("rebounds",),
    "AST": ("assists",),
    "THREES": ("threes",),
    "PRA": ("points", "rebounds", "assists"),
    "PA": ("points", "assists"),
    "PR": ("points", "rebounds"),
    "RA": ("rebounds", "assists"),
}

TEAM_NAMES = {
    "ATL": "Atlanta Dream",
    "CHI": "Chicago Sky",
    "CON": "Connecticut Sun",
    "DAL": "Dallas Wings",
    "GS": "Golden State Valkyries",
    "IND": "Indiana Fever",
    "LA": "Los Angeles Sparks",
    "LV": "Las Vegas Aces",
    "MIN": "Minnesota Lynx",
    "NY": "New York Liberty",
    "PHX": "Phoenix Mercury",
    "POR": "Portland Fire",
    "SEA": "Seattle Storm",
    "TOR": "Toronto Tempo",
    "WSH": "Washington Mystics",
}

TEAM_ALIASES = {
    "ATLANTA DREAM": "ATL",
    "CHICAGO SKY": "CHI",
    "CONNECTICUT SUN": "CON",
    "DALLAS WINGS": "DAL",
    "GOLDEN STATE VALKYRIES": "GS",
    "GSV": "GS",
    "GSW": "GS",
    "INDIANA FEVER": "IND",
    "LAS VEGAS ACES": "LV",
    "LVA": "LV",
    "LOS ANGELES SPARKS": "LA",
    "LAS": "LA",
    "MINNESOTA LYNX": "MIN",
    "NEW YORK LIBERTY": "NY",
    "NYL": "NY",
    "NYK": "NY",
    "PHOENIX MERCURY": "PHX",
    "PHO": "PHX",
    "PORTLAND FIRE": "POR",
    "PDX": "POR",
    "TORONTO TEMPO": "TOR",
    "SEATTLE STORM": "SEA",
    "WASHINGTON MYSTICS": "WSH",
    "WAS": "WSH",
}

MARKET_ALIASES = {
    "P": "PTS",
    "PT": "PTS",
    "PTS": "PTS",
    "POINT": "PTS",
    "POINTS": "PTS",
    "R": "REB",
    "REB": "REB",
    "REBOUND": "REB",
    "REBOUNDS": "REB",
    "A": "AST",
    "AST": "AST",
    "ASSIST": "AST",
    "ASSISTS": "AST",
    "3PM": "THREES",
    "3P": "THREES",
    "THREE": "THREES",
    "THREES": "THREES",
    "3 POINT FG MADE": "THREES",
    "3 PTS FG MADE": "THREES",
    "3-POINT FG MADE": "THREES",
    "3 POINTERS": "THREES",
    "MADE THREES": "THREES",
    "PRA": "PRA",
    "PTS AST REB": "PRA",
    "PTS REB AST": "PRA",
    "PTS + REB + AST": "PRA",
    "PTS + AST + REB": "PRA",
    "POINTS REBOUNDS ASSISTS": "PRA",
    "POINTS + REBOUNDS + ASSISTS": "PRA",
    "PA": "PA",
    "PTS AST": "PA",
    "PTS + AST": "PA",
    "POINTS ASSISTS": "PA",
    "POINTS + ASSISTS": "PA",
    "PR": "PR",
    "PTS REB": "PR",
    "PTS + REB": "PR",
    "POINTS REBOUNDS": "PR",
    "POINTS + REBOUNDS": "PR",
    "RA": "RA",
    "REB AST": "RA",
    "REB + AST": "RA",
    "REBOUNDS ASSISTS": "RA",
    "REBOUNDS + ASSISTS": "RA",
}
REGULAR_SEASON_WINDOWS = {
    2024: ("2024-05-14", "2024-09-19"),
    2025: ("2025-05-16", "2025-09-11"),
    2026: ("2026-05-08", "2026-09-24"),
}


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def season_phase_for_date(date_text: str | None) -> str:
    if not date_text:
        return "unknown"
    day = str(date_text)[:10]
    try:
        year = int(day[:4])
    except ValueError:
        return "unknown"
    window = REGULAR_SEASON_WINDOWS.get(year)
    if not window:
        return "regular"
    start, end = window
    if day < start:
        return "preseason"
    if day > end:
        return "postseason"
    return "regular"


def clean_number(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return default
        value = stripped.replace("%", "")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def parse_minutes(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    text = str(value).strip()
    if not text or text in {"-", "--"}:
        return None
    if ":" in text:
        left, right = text.split(":", 1)
        minutes = clean_number(left)
        seconds = clean_number(right)
        if minutes is None or seconds is None:
            return None
        return minutes + seconds / 60.0
    return clean_number(text)


def parse_made_attempted(value: Any) -> tuple[int | None, int | None]:
    if value is None:
        return None, None
    text = str(value).strip()
    if not text or "-" not in text:
        return None, None
    made, attempted = text.split("-", 1)
    made_num = clean_number(made)
    attempted_num = clean_number(attempted)
    return (
        int(made_num) if made_num is not None else None,
        int(attempted_num) if attempted_num is not None else None,
    )


def canonical_name(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.lower().replace(".", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def normalize_team(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.strip().upper()
    if not text or text in {"NAN", "NONE", "NULL"}:
        return ""
    return TEAM_ALIASES.get(text, text)


def team_display_name(value: Any) -> str:
    team = normalize_team(value)
    return TEAM_NAMES.get(team, team or "Team TBD")


def normalize_market(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.upper().replace("&", "+")
    text = re.sub(r"\bPOINTS?\b", "PTS", text)
    text = re.sub(r"\bREBOUNDS?\b", "REB", text)
    text = re.sub(r"\bASSISTS?\b", "AST", text)
    text = re.sub(r"\b3\s*POINT\s*FG\s*MADE\b", "3 POINT FG MADE", text)
    text = re.sub(r"\s*\+\s*", " + ", text)
    text = re.sub(r"[^A-Z0-9+]+", " ", text)
    text = " ".join(text.split())
    return MARKET_ALIASES.get(text, text)


def as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "home", "starter"}:
        return True
    if text in {"0", "false", "no", "n", "away", "bench"}:
        return False
    return None


def american_to_prob(odds: Any) -> float | None:
    number = clean_number(odds)
    if number is None or number == 0:
        return None
    if number < 0:
        return -number / (-number + 100.0)
    return 100.0 / (number + 100.0)


def no_vig_probability(over_odds: Any, under_odds: Any, side: str) -> float | None:
    over = american_to_prob(over_odds)
    under = american_to_prob(under_odds)
    if over is None and under is None:
        return None
    if over is None:
        return under if side == "UNDER" else None
    if under is None:
        return over if side == "OVER" else None
    total = over + under
    if total <= 0:
        return None
    return (over / total) if side == "OVER" else (under / total)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def round_or_none(value: Any, digits: int = 4) -> float | None:
    number = clean_number(value)
    return None if number is None else round(number, digits)
