from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .utils import (
    COMBO_MARKETS,
    COUNTING_OVER_MARKETS,
    MARKET_COMPONENTS,
    MARKETS,
    as_bool,
    canonical_name,
    clamp,
    clean_number,
    no_vig_probability,
    normal_cdf,
    normalize_market,
    normalize_team,
    player_id_aliases,
    round_or_none,
    season_phase_for_date,
    team_display_name,
    today_et,
)

MODEL_ID = "wnba-player-prop-model-v1"
MODEL_VERSION = "2026-07-06-fanduel-live-model-v13"
CLAIM_BOUNDARY = (
    "WNBA V1 uses historical boxscore logs plus supplied prop lines. It is a ranking and calibration model, "
    "not a guarantee. Live betting claims require current lines, player availability, and settled forward audit."
)
TARGET_PARLAY_PROBABILITY = 0.70

ARCHIVE_SELECTOR_PROOF = {
    "label": "Archive-ML selector proof",
    "cardsEvaluated": 41,
    "sixPickCoveredDates": 41,
    "sixPickSettledDates": 27,
    "sixPickParlayWins": 14,
    "sixPickParlayAccuracyPct": 51.85,
    "settledLegs": 226,
    "legWins": 175,
    "legAccuracyPct": 77.43,
    "proofBoundary": "Archive/cross-source proof; not automatically transferable to live FanDuel availability.",
}

FANDUEL_STRICT_SHADOW_PROOF = {
    "label": "Limited FanDuel availability replay",
    "sixPickSettledDates": 5,
    "sixPickParlayWins": 3,
    "sixPickParlayAccuracyPct": 60.0,
    "settledLegAccuracyPct": 73.33,
    "proofBoundary": "Small FanDuel-only replay after availability gates; too few settled six-pick dates to replace archive proof.",
}

PORTFOLIO_LIMITS = {
    "max_picks": 6,
    "target_picks": 6,
    "min_score": 0.68,
    "max_per_player": 1,
    "max_per_team": 4,
    "max_per_game": 4,
    "max_per_market": 4,
    "max_same_team_counting_overs": 1,
    "max_combo_markets": 2,
    "required_source_book": "",
    "require_playable_side_odds": False,
    "allow_source_consensus_leans": False,
    "min_consensus_probability": 0.60,
    "min_consensus_score": 0.25,
    "allow_expanded_fill": True,
    "expanded_min_score": 0.58,
    "expanded_min_probability": 0.62,
    "expanded_min_price_edge": 0.04,
    "allow_forced_six_pick_fill": False,
    "forced_fill_min_score": 0.0,
    "forced_fill_min_probability": 0.52,
    "volatile_short_rest_min_score": 0.82,
    "standard_pra_under_penalty": 0.04,
    "standard_volatile_penalty": 0.04,
    "sgp_tax_penalty_per_same_game_pair": 0.0,
    "mqi_score_floor": 0.0,
    "mqi_quiet_boost": 1.0,
}

MARKET_CONFIG = {
    "PTS": {"alpha": 0.45, "sigma_floor": 4.4, "opp_weight": 0.10, "line_gap_scale": 5.0},
    "REB": {"alpha": 0.40, "sigma_floor": 2.5, "opp_weight": 0.11, "line_gap_scale": 3.2},
    "AST": {"alpha": 0.42, "sigma_floor": 2.2, "opp_weight": 0.10, "line_gap_scale": 2.8},
    "THREES": {"alpha": 0.50, "sigma_floor": 1.25, "opp_weight": 0.08, "line_gap_scale": 1.6},
    "PRA": {"alpha": 0.43, "sigma_floor": 6.2, "opp_weight": 0.10, "line_gap_scale": 7.0},
    "PA": {"alpha": 0.44, "sigma_floor": 5.4, "opp_weight": 0.10, "line_gap_scale": 6.0},
    "PR": {"alpha": 0.42, "sigma_floor": 5.3, "opp_weight": 0.10, "line_gap_scale": 6.0},
    "RA": {"alpha": 0.40, "sigma_floor": 3.5, "opp_weight": 0.10, "line_gap_scale": 4.2},
}

MQI_FEATURE_COLUMNS = [
    "market_quiescence_score",
    "is_quiet_market",
    "minutes_since_line_movement",
    "juice_drift",
    "cross_book_line_std",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean_text(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text


def _rename_columns(df: pd.DataFrame) -> pd.DataFrame:
    mapping: dict[str, str] = {}
    for column in df.columns:
        stripped = column.strip()
        if stripped in MARKETS:
            mapping[column] = stripped
            continue
        key = column.strip().lower().replace(" ", "_")
        aliases = {
            "date": "game_date",
            "slate_date": "game_date",
            "player_name": "player",
            "name": "player",
            "team": "team_abbr",
            "opponent": "opponent_abbr",
            "opp": "opponent_abbr",
            "home": "is_home",
            "projected_min": "projected_minutes",
            "proj_minutes": "projected_minutes",
            "book_count": "sportsbook_count",
            "books": "sportsbook_count",
            "last_updated": "line_last_updated",
        }
        mapping[column] = aliases.get(key, key)
    return df.rename(columns=mapping)


def load_logs(path: str | Path, include_preseason: bool = False) -> pd.DataFrame:
    df = _rename_columns(pd.read_csv(path))
    if "threes" not in df.columns:
        if "three_made" in df.columns:
            df["threes"] = df["three_made"]
        elif "THREES" in df.columns:
            df["threes"] = df["THREES"]
    required = {"game_date", "player", "team_abbr", "opponent_abbr", "minutes", "points", "rebounds", "assists", "threes"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required log columns: {sorted(missing)}")
    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    df = df[df["game_date"].notna()].copy()
    df["season_phase"] = df["game_date"].dt.date.astype(str).map(season_phase_for_date)
    if not include_preseason:
        df = df[df["season_phase"] == "regular"].copy()
    for column in [
        "minutes",
        "points",
        "rebounds",
        "assists",
        "threes",
        "PTS",
        "REB",
        "AST",
        "THREES",
        "PRA",
        "PA",
        "PR",
        "RA",
        "team_score",
        "opponent_score",
    ]:
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce")
    for market, components in MARKET_COMPONENTS.items():
        if market not in df.columns:
            df[market] = sum(df[component] for component in components)
    if "player_id" in df.columns:
        df["player_id"] = df["player_id"].astype(str)
    else:
        df["player_id"] = ""
    df["player_key"] = df["player"].map(canonical_name)
    df["team_abbr"] = df["team_abbr"].map(normalize_team)
    df["opponent_abbr"] = df["opponent_abbr"].map(normalize_team)
    if "is_home" in df.columns:
        df["is_home"] = df["is_home"].map(as_bool).fillna(False).astype(bool)
    if "starter" in df.columns:
        df["starter"] = df["starter"].map(as_bool).fillna(False).astype(bool)
    if "position" not in df.columns:
        df["position"] = ""
    return df.sort_values(["game_date", "game_id", "team_abbr", "player"]).reset_index(drop=True)


def load_board(path: str | Path, default_date: str | None = None) -> pd.DataFrame:
    df = _rename_columns(pd.read_csv(path))
    required = {"player", "team_abbr", "opponent_abbr", "market", "line"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required board columns: {sorted(missing)}")
    if "game_date" not in df.columns:
        df["game_date"] = default_date or today_et()
    df["game_date"] = pd.to_datetime(df["game_date"].fillna(default_date or today_et()), errors="coerce")
    df["market"] = df["market"].map(normalize_market)
    df = df[df["market"].isin(MARKETS)].copy()
    df["line"] = pd.to_numeric(df["line"], errors="coerce")
    df = df[df["line"].notna()].copy()
    for column in ["over_odds", "under_odds", "sportsbook_count", "projected_minutes", "game_total", "spread"]:
        if column not in df.columns:
            df[column] = np.nan
        df[column] = pd.to_numeric(df[column], errors="coerce")
    for column in [
        "player_id",
        "injury_note",
        "line_last_updated",
        "source_pick",
        "source_book",
        "source_market",
        "source_url",
        "source_event_id",
        "game_time_et",
        "source_status",
        "team_resolution_status",
        "source_away_abbr",
        "source_home_abbr",
        "over_book",
        "under_book",
    ]:
        if column not in df.columns:
            df[column] = ""
    for column in ["source_projection", "source_odds"]:
        if column not in df.columns:
            df[column] = np.nan
        df[column] = pd.to_numeric(df[column], errors="coerce")
    if "is_home" not in df.columns:
        df["is_home"] = np.nan
    if "starter_expected" not in df.columns:
        df["starter_expected"] = np.nan
    df["player_id"] = df["player_id"].fillna("").astype(str)
    df["player_key"] = df["player"].map(canonical_name)
    df["team_abbr"] = df["team_abbr"].map(normalize_team)
    df["opponent_abbr"] = df["opponent_abbr"].map(normalize_team)
    df["source_away_abbr"] = df["source_away_abbr"].map(normalize_team)
    df["source_home_abbr"] = df["source_home_abbr"].map(normalize_team)
    return df.reset_index(drop=True)


def apply_market_quiescence_features(board: pd.DataFrame, mqi_features: pd.DataFrame) -> pd.DataFrame:
    if board.empty:
        return board.copy()
    df = board.copy()
    for column in MQI_FEATURE_COLUMNS:
        if column not in df.columns:
            df[column] = 0.0
    if mqi_features.empty:
        df["is_quiet_market"] = df["is_quiet_market"].fillna(0).astype(int)
        return df

    features = mqi_features.copy()
    features["snapshot_timestamp"] = pd.to_datetime(features["snapshot_timestamp"], utc=True, errors="coerce")
    features = features[features["snapshot_timestamp"].notna()].copy()
    if features.empty:
        df["is_quiet_market"] = df["is_quiet_market"].fillna(0).astype(int)
        return df

    board_key = df.assign(
        _mqi_game_date=pd.to_datetime(df["game_date"], errors="coerce").dt.date.astype(str),
        _mqi_player_id=df["player_id"].fillna("").astype(str),
        _mqi_market=df["market"].astype(str).str.upper(),
    )
    latest = (
        features.assign(
            _mqi_game_date=pd.to_datetime(features["game_date"], errors="coerce").dt.date.astype(str),
            _mqi_player_id=features["player_id"].fillna("").astype(str),
            _mqi_market=features["market_type"].astype(str).str.upper(),
        )
        .sort_values("snapshot_timestamp")
        .groupby(["_mqi_game_date", "_mqi_player_id", "_mqi_market"], as_index=False)
        .tail(1)
    )
    merge_columns = ["_mqi_game_date", "_mqi_player_id", "_mqi_market", *MQI_FEATURE_COLUMNS]
    merged = board_key.drop(columns=MQI_FEATURE_COLUMNS, errors="ignore").merge(
        latest[merge_columns],
        on=["_mqi_game_date", "_mqi_player_id", "_mqi_market"],
        how="left",
    )
    merged = merged.drop(columns=["_mqi_game_date", "_mqi_player_id", "_mqi_market"])
    for column in MQI_FEATURE_COLUMNS:
        merged[column] = pd.to_numeric(merged[column], errors="coerce").fillna(0.0)
    merged["is_quiet_market"] = merged["is_quiet_market"].astype(int)
    return merged


def resolve_player_ids(board: pd.DataFrame, logs: pd.DataFrame) -> pd.DataFrame:
    latest = (
        logs.sort_values("game_date")
        .dropna(subset=["player"])
        .groupby(["player_key", "team_abbr"], as_index=False)
        .tail(1)[["player_key", "team_abbr", "player_id"]]
    )
    by_team = {(row.player_key, row.team_abbr): str(row.player_id) for row in latest.itertuples()}
    by_name = (
        logs.sort_values("game_date")
        .dropna(subset=["player"])
        .groupby("player_key", as_index=False)
        .tail(1)[["player_key", "player_id"]]
    )
    name_map = {row.player_key: str(row.player_id) for row in by_name.itertuples()}
    fuzzy_keys = list(name_map.keys())
    df = board.copy()
    resolved: list[str] = []
    for row in df.itertuples():
        current = str(row.player_id or "").strip()
        fuzzy_match = ""
        if not current and row.player_key not in name_map:
            parts = set(str(row.player_key).split())
            for key in fuzzy_keys:
                if str(row.player_key) in key or key in str(row.player_key) or len(parts & set(key.split())) >= max(2, len(parts)):
                    fuzzy_match = name_map[key]
                    break
        resolved.append(current or by_team.get((row.player_key, row.team_abbr), "") or name_map.get(row.player_key, "") or fuzzy_match)
    df["player_id"] = resolved
    return df


def _player_history(history: pd.DataFrame, row: pd.Series) -> pd.DataFrame:
    player_id = str(row.get("player_id") or "").strip()
    if player_id:
        matched = history[history["player_id"].astype(str) == player_id]
        if not matched.empty:
            return matched.sort_values("game_date")
    return history[history["player_key"] == row["player_key"]].sort_values("game_date")


def _ewma(values: pd.Series, alpha: float) -> float | None:
    values = pd.to_numeric(values, errors="coerce").dropna()
    if values.empty:
        return None
    result = float(values.iloc[0])
    for value in values.iloc[1:]:
        result = alpha * float(value) + (1.0 - alpha) * result
    return result


def _weighted_average(items: list[tuple[float | None, float]]) -> float | None:
    clean = [(value, weight) for value, weight in items if value is not None and math.isfinite(value) and weight > 0]
    total_weight = sum(weight for _, weight in clean)
    if total_weight <= 0:
        return None
    return sum(float(value) * weight for value, weight in clean) / total_weight


def _expected_minutes(player_logs: pd.DataFrame, row: pd.Series) -> tuple[float, float, list[str]]:
    override = clean_number(row.get("projected_minutes"))
    risk_flags: list[str] = []
    minutes = pd.to_numeric(player_logs.get("minutes", pd.Series(dtype=float)), errors="coerce").dropna()
    if override is not None and override > 0:
        expected = override
        confidence = 0.88
        if len(minutes) >= 5:
            recent_std = float(minutes.tail(5).std(ddof=0) or 0)
            confidence -= clamp(recent_std / max(expected, 1) * 0.35, 0, 0.22)
        return clamp(expected, 0, 42), clamp(confidence, 0.45, 0.95), risk_flags
    if minutes.empty:
        return 18.0, 0.25, ["missing_player_minutes"]
    expected = _weighted_average(
        [
            (_ewma(minutes, 0.45), 0.35),
            (float(minutes.tail(3).mean()) if len(minutes) >= 3 else None, 0.20),
            (float(minutes.tail(10).mean()) if len(minutes) >= 5 else None, 0.25),
            (float(minutes.mean()), 0.20),
        ]
    )
    expected = expected if expected is not None else float(minutes.mean())
    starter_expected = as_bool(row.get("starter_expected"))
    if starter_expected is True and "starter" in player_logs.columns:
        recent_start_rate = player_logs["starter"].tail(5).astype(bool).mean()
        if recent_start_rate < 0.5:
            expected += 2.0
            risk_flags.append("starter_role_change")
    recent_std = float(minutes.tail(min(8, len(minutes))).std(ddof=0) or 0)
    confidence = 0.55 + min(0.35, len(minutes) / 60.0) - clamp(recent_std / max(expected, 1) * 0.38, 0, 0.28)
    if len(minutes) < 8:
        risk_flags.append("low_player_sample")
    if recent_std >= max(5.5, expected * 0.22):
        risk_flags.append("volatile_minutes")
    return clamp(expected, 0, 42), clamp(confidence, 0.20, 0.92), risk_flags


def _team_rest_days(history: pd.DataFrame, row: pd.Series) -> int | None:
    team = row.get("team_abbr")
    slate_date = row.get("game_date")
    if pd.isna(slate_date):
        return None
    team_dates = history.loc[history["team_abbr"] == team, "game_date"].dropna().drop_duplicates().sort_values()
    prior = team_dates[team_dates < slate_date]
    if prior.empty:
        return None
    return int((slate_date - prior.iloc[-1]).days)


def _opponent_adjustment(history: pd.DataFrame, row: pd.Series, market: str) -> float:
    opponent = str(row.get("opponent_abbr") or "").upper()
    if not opponent or history.empty:
        return 1.0
    team_game = history.groupby(["game_id", "team_abbr"], dropna=False)[market].sum()
    league_allowed = float(team_game.mean()) if not team_game.empty else None
    if not league_allowed or not math.isfinite(league_allowed) or league_allowed <= 0:
        return 1.0
    vs_opponent = history[history["opponent_abbr"] == opponent].groupby(["game_id", "team_abbr"], dropna=False)[market].sum()
    if len(vs_opponent) < 8:
        return 1.0
    ratio_delta = clamp(float(vs_opponent.mean()) / league_allowed - 1.0, -0.16, 0.16)
    return 1.0 + ratio_delta * MARKET_CONFIG[market]["opp_weight"]


def _project_direct_market(history: pd.DataFrame, player_logs: pd.DataFrame, row: pd.Series, market: str, minutes: float) -> dict[str, Any]:
    config = MARKET_CONFIG[market]
    player_values = pd.to_numeric(player_logs[market], errors="coerce").dropna()
    player_minutes = pd.to_numeric(player_logs["minutes"], errors="coerce").replace(0, np.nan)
    per_minute = (pd.to_numeric(player_logs[market], errors="coerce") / player_minutes).replace([np.inf, -np.inf], np.nan).dropna()
    league_per_minute = (
        pd.to_numeric(history[market], errors="coerce").sum() / pd.to_numeric(history["minutes"], errors="coerce").replace(0, np.nan).sum()
        if not history.empty
        else np.nan
    )
    position_values = player_logs["position"].dropna() if not player_logs.empty and "position" in player_logs.columns else pd.Series(dtype=str)
    position = str(position_values.iloc[-1]) if not position_values.empty else ""
    position_rows = history[history["position"].astype(str) == position] if position else history.iloc[0:0]
    position_per_minute = (
        pd.to_numeric(position_rows[market], errors="coerce").sum()
        / pd.to_numeric(position_rows["minutes"], errors="coerce").replace(0, np.nan).sum()
        if not position_rows.empty
        else np.nan
    )
    per_min_projection = _weighted_average(
        [
            (_ewma(per_minute, config["alpha"]), 0.34),
            (float(per_minute.tail(3).mean()) if len(per_minute) >= 3 else None, 0.14),
            (float(per_minute.tail(10).mean()) if len(per_minute) >= 5 else None, 0.24),
            (float(per_minute.mean()) if len(per_minute) else None, 0.18),
            (float(position_per_minute) if math.isfinite(position_per_minute) else None, 0.05),
            (float(league_per_minute) if math.isfinite(league_per_minute) else None, 0.05),
        ]
    )
    if per_min_projection is None:
        per_min_projection = float(league_per_minute) if math.isfinite(league_per_minute) else 0.35
    projection = minutes * per_min_projection
    if len(player_values) >= 5:
        direct_form = _weighted_average(
            [
                (_ewma(player_values, config["alpha"]), 0.35),
                (float(player_values.tail(3).mean()), 0.18),
                (float(player_values.tail(10).mean()) if len(player_values) >= 10 else None, 0.22),
                (float(player_values.mean()), 0.25),
            ]
        )
        if direct_form is not None:
            projection = 0.78 * projection + 0.22 * direct_form
    projection *= _opponent_adjustment(history, row, market)
    if as_bool(row.get("is_home")) is not None and "is_home" in player_logs.columns and len(player_logs) >= 10:
        split = player_logs[player_logs["is_home"].astype(bool) == bool(as_bool(row.get("is_home")))]
        if len(split) >= 4:
            split_mean = float(split[market].mean())
            overall_mean = float(player_values.mean()) if len(player_values) else split_mean
            projection += clamp(split_mean - overall_mean, -config["line_gap_scale"] * 0.18, config["line_gap_scale"] * 0.18)
    return {
        "projection": max(0.0, float(projection)),
        "sample_size": int(len(player_values)),
        "position": position,
        "league_per_minute": float(league_per_minute) if math.isfinite(league_per_minute) else None,
    }


def _project_market(history: pd.DataFrame, player_logs: pd.DataFrame, row: pd.Series, market: str, minutes: float) -> dict[str, Any]:
    if market not in COMBO_MARKETS:
        return _project_direct_market(history, player_logs, row, market, minutes)
    component_projection = 0.0
    component_samples: list[int] = []
    for component_market in [m for m in ("PTS", "REB", "AST") if MARKET_COMPONENTS[m][0] in MARKET_COMPONENTS[market]]:
        component = _project_direct_market(history, player_logs, row, component_market, minutes)
        component_projection += float(component["projection"])
        component_samples.append(int(component["sample_size"]))
    direct = _project_direct_market(history, player_logs, row, market, minutes)
    if int(direct["sample_size"]) >= 6:
        projection = 0.82 * component_projection + 0.18 * float(direct["projection"])
    else:
        projection = component_projection
    return {**direct, "projection": projection, "sample_size": min(component_samples or [0])}


def _sigma(history: pd.DataFrame, player_logs: pd.DataFrame, market: str, position: str | None, minutes_confidence: float) -> float:
    config = MARKET_CONFIG[market]
    player_values = pd.to_numeric(player_logs[market], errors="coerce").dropna()
    league_values = pd.to_numeric(history[market], errors="coerce").dropna()
    position_values = (
        pd.to_numeric(history.loc[history["position"].astype(str) == str(position), market], errors="coerce").dropna()
        if position
        else pd.Series(dtype=float)
    )
    player_std = float(player_values.std(ddof=0)) if len(player_values) >= 6 else None
    position_std = float(position_values.std(ddof=0)) if len(position_values) >= 30 else None
    league_std = float(league_values.std(ddof=0)) if len(league_values) >= 30 else config["sigma_floor"]
    blended = _weighted_average([(player_std, 0.58), (position_std, 0.18), (league_std, 0.24)])
    sigma = max(float(blended or league_std), config["sigma_floor"])
    sigma *= 1.0 + (1.0 - minutes_confidence) * 0.28
    return sigma


def _empirical_over_probability(player_logs: pd.DataFrame, market: str, line: float) -> float | None:
    values = pd.to_numeric(player_logs[market], errors="coerce").dropna().tail(24)
    if len(values) < 4:
        return None
    hits = (values > line).astype(float).to_numpy()
    weights = np.array([0.93 ** i for i in range(len(hits) - 1, -1, -1)], dtype=float)
    raw = float(np.average(hits, weights=weights))
    shrink = len(values) / (len(values) + 8.0)
    return 0.5 + (raw - 0.5) * shrink


def _risk_flags(row: pd.Series, player_logs: pd.DataFrame, sample_size: int, rest_days: int | None) -> list[str]:
    flags: list[str] = []
    injury_note = str(row.get("injury_note") or "").strip()
    if injury_note:
        flags.append("injury_or_status_note")
    if sample_size < 8:
        flags.append("thin_player_history")
    sportsbook_count = clean_number(row.get("sportsbook_count"))
    if sportsbook_count is not None and sportsbook_count < 2:
        flags.append("thin_market_count")
    if clean_number(row.get("over_odds")) is None or clean_number(row.get("under_odds")) is None:
        flags.append("single_side_price")
    if rest_days is not None and rest_days <= 1:
        flags.append("short_rest_or_b2b")
    spread = clean_number(row.get("spread"))
    if spread is not None and abs(spread) >= 10.5:
        flags.append("blowout_spread")
    if player_logs.empty:
        flags.append("unresolved_player")
    if str(row.get("source_status") or "").strip().lower() == "preserved_same_day":
        flags.append("not_current_source_snapshot")
    team = normalize_team(row.get("team_abbr"))
    opponent = normalize_team(row.get("opponent_abbr"))
    if not team or not opponent:
        flags.append("unknown_team_context")
    resolution_status = str(row.get("team_resolution_status") or "").strip().lower()
    if resolution_status in {"not_in_source_game", "not_in_slate_matchup", "unresolved_player", "not_on_current_roster"}:
        flags.append("team_resolution_mismatch")
    source_teams = {normalize_team(row.get("source_away_abbr")), normalize_team(row.get("source_home_abbr"))} - {""}
    if source_teams and team and team not in source_teams:
        flags.append("team_source_game_mismatch")
    return flags


def _score_row(history: pd.DataFrame, row: pd.Series) -> dict[str, Any]:
    player_logs = _player_history(history, row)
    minutes, minutes_confidence, minute_flags = _expected_minutes(player_logs, row)
    market = str(row["market"]).upper()
    line = float(row["line"])
    projected = _project_market(history, player_logs, row, market, minutes)
    projection = float(projected["projection"])
    sample_size = int(projected["sample_size"])
    source_projection = clean_number(row.get("source_projection"))
    if source_projection is not None and source_projection <= 0:
        source_projection = None
    if source_projection is not None:
        projection = 0.72 * projection + 0.28 * source_projection
    sigma = _sigma(history, player_logs, market, projected.get("position"), minutes_confidence)
    normal_over = 1.0 - normal_cdf((line - projection) / sigma)
    empirical = _empirical_over_probability(player_logs, market, line)
    over_prob = 0.68 * normal_over + 0.32 * empirical if empirical is not None else normal_over
    sample_confidence = clamp(math.log1p(sample_size) / math.log1p(28), 0.0, 1.0)
    data_confidence = clamp(0.18 + 0.54 * sample_confidence + 0.28 * minutes_confidence, 0.0, 1.0)
    over_prob = 0.5 + (over_prob - 0.5) * (0.58 + 0.42 * data_confidence)
    over_prob = clamp(over_prob, 0.02, 0.98)
    side = "OVER" if over_prob >= 0.5 else "UNDER"
    model_prob = over_prob if side == "OVER" else 1.0 - over_prob
    side_book_value = row.get("over_book") if side == "OVER" else row.get("under_book")
    side_source_book = _clean_text(side_book_value)
    source_board_book = _clean_text(row.get("source_book"))
    source_book = side_source_book or source_board_book
    fair_prob = no_vig_probability(row.get("over_odds"), row.get("under_odds"), side)
    edge = model_prob - fair_prob if fair_prob is not None else None
    line_gap = projection - line
    gap_sigma = abs(line_gap) / max(sigma, 0.01)
    rest_days = _team_rest_days(history, row)
    risk_flags = minute_flags + _risk_flags(row, player_logs, sample_size, rest_days)
    if fair_prob is None:
        risk_flags.append("no_price_edge")
    if market in COMBO_MARKETS:
        risk_flags.append("combo_market_correlation")
    source_pick = str(row.get("source_pick") or "").strip().upper()
    source_alignment_bonus = 0.0
    if source_pick in {"OVER", "UNDER"}:
        if source_pick == side:
            source_alignment_bonus = 0.02
        else:
            risk_flags.append("source_pick_disagreement")
    if source_projection is not None:
        source_projection_side = "OVER" if source_projection >= line else "UNDER"
        if source_projection_side == side:
            source_alignment_bonus += 0.025
        else:
            risk_flags.append("source_projection_disagreement")
        if abs(source_projection - line) <= max(0.25, line * 0.025):
            risk_flags.append("source_projection_near_line")
    elif str(row.get("source_book") or "").lower().startswith("scoresandodds"):
        risk_flags.append("missing_source_projection")
    prob_strength = clamp((model_prob - 0.52) / 0.18, 0.0, 1.0)
    gap_strength = clamp(gap_sigma / 1.15, 0.0, 1.0)
    edge_strength = clamp(((edge or 0.0) - 0.005) / 0.055, 0.0, 1.0) if fair_prob is not None else 0.35
    risk_penalty = 0.025 * len(set(risk_flags))
    if "injury_or_status_note" in risk_flags:
        risk_penalty += 0.07
    if "unresolved_player" in risk_flags:
        risk_penalty += 0.12
    if "source_pick_disagreement" in risk_flags:
        risk_penalty += 0.06
    if "source_projection_disagreement" in risk_flags:
        risk_penalty += 0.16
    if "source_projection_near_line" in risk_flags:
        risk_penalty += 0.04
    if "missing_source_projection" in risk_flags:
        risk_penalty += 0.05
    base_score = 0.42 * prob_strength + 0.24 * gap_strength + 0.20 * data_confidence + 0.14 * edge_strength + source_alignment_bonus
    final_score = clamp(base_score - risk_penalty, 0.0, 1.0)
    if final_score >= 0.82 and model_prob >= 0.61 and "injury_or_status_note" not in risk_flags:
        tier = "S"
    elif final_score >= 0.74 and model_prob >= 0.58:
        tier = "A"
    elif final_score >= 0.66:
        tier = "B"
    elif final_score >= 0.56:
        tier = "C"
    else:
        tier = "D"
    reasons = [
        f"projection {projection:.2f} vs line {line:.2f}",
        f"{side.lower()} probability {model_prob:.1%}",
        f"gap {line_gap:+.2f} ({gap_sigma:.2f} sigma)",
        f"history sample {sample_size}",
    ]
    if edge is not None:
        reasons.append(f"no-vig edge {edge:+.1%}")
    if source_pick in {"OVER", "UNDER"}:
        reasons.append(f"source pick {source_pick.lower()} {'agrees' if source_pick == side else 'disagrees'}")
    if source_projection is not None:
        reasons.append(f"source projection {source_projection:.2f}")
    return {
        "candidate_id": f"{row.get('game_date').date().isoformat()}:{row.get('player_id') or row.get('player_key')}:{market}:{line}",
        "slate_date": row.get("game_date").date().isoformat(),
        "player_id": str(row.get("player_id") or ""),
        "player": row.get("player"),
        "team": row.get("team_abbr"),
        "team_name": team_display_name(row.get("team_abbr")),
        "opponent": row.get("opponent_abbr"),
        "opponent_name": team_display_name(row.get("opponent_abbr")),
        "matchup_key": "-".join(sorted([str(row.get("team_abbr")), str(row.get("opponent_abbr"))])),
        "market": market,
        "side": side,
        "line": round(line, 3),
        "over_odds": round_or_none(row.get("over_odds"), 0),
        "under_odds": round_or_none(row.get("under_odds"), 0),
        "over_book": str(row.get("over_book") or ""),
        "under_book": str(row.get("under_book") or ""),
        "projected_value": round(projection, 3),
        "line_gap": round(line_gap, 3),
        "abs_line_gap": round(abs(line_gap), 3),
        "sigma": round(sigma, 3),
        "over_probability": round(over_prob, 5),
        "model_probability": round(model_prob, 5),
        "fair_probability": round_or_none(fair_prob, 5),
        "price_edge": round_or_none(edge, 5),
        "projected_minutes": round(minutes, 2),
        "minutes_confidence": round(minutes_confidence, 4),
        "data_confidence": round(data_confidence, 4),
        "sample_size": sample_size,
        "rest_days": rest_days,
        "sportsbook_count": round_or_none(row.get("sportsbook_count"), 0),
        "source_pick": source_pick or None,
        "source_projection": round_or_none(source_projection, 3),
        "source_odds": round_or_none(row.get("source_odds"), 0),
        "source_book": source_book,
        "source_board_book": source_board_book,
        "source_market": str(row.get("source_market") or ""),
        "source_url": str(row.get("source_url") or ""),
        "source_event_id": str(row.get("source_event_id") or ""),
        "source_away": str(row.get("source_away_abbr") or ""),
        "source_home": str(row.get("source_home_abbr") or ""),
        "game_time_et": str(row.get("game_time_et") or ""),
        "line_last_updated": str(row.get("line_last_updated") or ""),
        "source_status": str(row.get("source_status") or ""),
        "team_resolution_status": str(row.get("team_resolution_status") or ""),
        "market_quiescence_score": round_or_none(row.get("market_quiescence_score"), 4) or 0.0,
        "is_quiet_market": int(clean_number(row.get("is_quiet_market")) or 0),
        "minutes_since_line_movement": round_or_none(row.get("minutes_since_line_movement"), 2) or 0.0,
        "juice_drift": round_or_none(row.get("juice_drift"), 4) or 0.0,
        "cross_book_line_std": round_or_none(row.get("cross_book_line_std"), 4) or 0.0,
        "tier": tier,
        "base_score": round(base_score, 5),
        "final_score": round(final_score, 5),
        "selection_model_probability": round(model_prob, 5),
        "selection_score": round(final_score, 5),
        "selection_score_adjustment": 0.0,
        "model_action": "COVERAGE",
        "selected_rank": None,
        "risk_flags": sorted(set(risk_flags)),
        "reasons": reasons,
        "rejection_reason": None,
    }


def _passes_price_gate(row: dict[str, Any]) -> bool:
    if row["fair_probability"] is None:
        return True
    return (row["price_edge"] or 0.0) >= 0.005


def _allows_pick_side_only_price(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    if not limits.get("allow_pick_side_only_prices"):
        return False
    required_book = str(limits.get("required_source_book") or "").strip().lower()
    source_book = _clean_text(row.get("source_book")).lower()
    if required_book and required_book not in source_book:
        return False
    source_pick = str(row.get("source_pick") or "").strip().upper()
    if source_pick != str(row.get("side") or "").strip().upper():
        return False
    return row.get("source_odds") is not None


def _passes_book_gate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    required_book = str(limits.get("required_source_book") or "").strip().lower()
    side_book = row.get("over_book") if row["side"] == "OVER" else row.get("under_book")
    source_book = _clean_text(row.get("source_book")).lower()
    direct_source_book = _clean_text(
        row.get("source_board_book") or row.get("raw_source_book") or row.get("source_book")
    ).lower()
    pick_side_book = _clean_text(side_book).lower()
    if required_book and limits.get("require_direct_source_book") and required_book not in direct_source_book:
        row["rejection_reason"] = f"not_{required_book}_sourced"
        return False
    if required_book and required_book not in source_book and required_book not in pick_side_book:
        row["rejection_reason"] = f"not_{required_book}_sourced"
        return False
    if limits.get("require_playable_side_odds"):
        side_odds = row.get("over_odds") if row["side"] == "OVER" else row.get("under_odds")
        if side_odds is None and not _allows_pick_side_only_price(row, limits):
            if row.get("source_odds") is not None:
                row["rejection_reason"] = "source_pick_disagreement"
                return False
            row["rejection_reason"] = "missing_playable_side_odds"
            return False
    if required_book and "source_pick_disagreement" in row["risk_flags"]:
        row["rejection_reason"] = "source_pick_disagreement"
        return False
    return True


def _passes_context_gate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    blocked_ids = {str(value) for value in limits.get("blocked_candidate_ids", set()) or set()}
    candidate_id = str(row.get("candidate_id") or "")
    candidate_parts = candidate_id.split(":")
    candidate_wildcards = {candidate_id}
    if len(candidate_parts) >= 4:
        candidate_date, candidate_player, candidate_market, candidate_line = candidate_parts[:4]
        for player_alias in player_id_aliases(candidate_player) or {candidate_player}:
            candidate_wildcards.add(f"{candidate_date}:{player_alias}:{candidate_market}:{candidate_line}")
            candidate_wildcards.add(f"{candidate_date}:{player_alias}:{candidate_market}:*")
    game_date = str(row.get("game_date") or "").split(" ")[0]
    player_key = str(row.get("player_id") or "").strip() or canonical_name(str(row.get("player") or ""))
    player_name_key = canonical_name(str(row.get("player") or ""))
    market = str(row.get("market") or "").strip().upper()
    if len(candidate_parts) >= 4 and player_name_key:
        candidate_date, _candidate_player, candidate_market, _candidate_line = candidate_parts[:4]
        candidate_wildcards.add(f"{candidate_date}:{player_name_key}:{candidate_market}:*")
    if game_date and player_key and market:
        for player_alias in player_id_aliases(player_key) or {player_key}:
            candidate_wildcards.add(f"{game_date}:{player_alias}:{market}:*")
    if game_date and player_name_key and market:
        candidate_wildcards.add(f"{game_date}:{player_name_key}:{market}:*")
    if candidate_wildcards & blocked_ids:
        row["rejection_reason"] = "unavailable_live_prop"
        return False
    if limits.get("exclude_single_side_prices") and {"single_side_price", "thin_market_count"} & set(row.get("risk_flags") or []):
        if not _allows_pick_side_only_price(row, limits):
            row["rejection_reason"] = "single_side_price_excluded"
            return False
    if limits.get("exclude_rebound_unders") and row.get("market") == "REB" and row.get("side") == "UNDER":
        row["rejection_reason"] = "rebound_under_excluded"
        return False
    mqi_score_floor = float(limits.get("mqi_score_floor", 0.0) or 0.0)
    if mqi_score_floor > 0 and float(row.get("market_quiescence_score") or 0.0) < mqi_score_floor:
        row["rejection_reason"] = "below_mqi_score_floor"
        return False
    risk_flags = set(row.get("risk_flags") or [])
    if {"volatile_minutes", "short_rest_or_b2b"}.issubset(risk_flags):
        min_score = float(limits.get("volatile_short_rest_min_score", 0.82))
        if row["final_score"] < min_score:
            row["rejection_reason"] = "volatile_short_rest"
            return False
    return True


def _is_standard_candidate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    return (
        row["final_score"] >= limits["min_score"]
        and row["tier"] in {"S", "A", "B"}
        and _passes_price_gate(row)
        and _passes_book_gate(row, limits)
        and _passes_context_gate(row, limits)
        and "injury_or_status_note" not in row["risk_flags"]
        and "unresolved_player" not in row["risk_flags"]
        and "source_projection_disagreement" not in row["risk_flags"]
        and "source_projection_near_line" not in row["risk_flags"]
        and "missing_source_projection" not in row["risk_flags"]
        and "not_current_source_snapshot" not in row["risk_flags"]
        and "unknown_team_context" not in row["risk_flags"]
        and "team_resolution_mismatch" not in row["risk_flags"]
        and "team_source_game_mismatch" not in row["risk_flags"]
    )


def _is_source_consensus_candidate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    if not limits.get("allow_source_consensus_leans"):
        return False
    source_pick = str(row.get("source_pick") or "").upper()
    source_projection = clean_number(row.get("source_projection"))
    if source_pick not in {"OVER", "UNDER"} or source_projection is None:
        return False
    if source_pick != row["side"]:
        row["rejection_reason"] = "source_pick_disagreement"
        return False
    if "source_projection_disagreement" in row["risk_flags"] or "source_projection_near_line" in row["risk_flags"]:
        return False
    if "injury_or_status_note" in row["risk_flags"] or "unresolved_player" in row["risk_flags"]:
        return False
    if "not_current_source_snapshot" in row["risk_flags"]:
        row["rejection_reason"] = "not_current_source_snapshot"
        return False
    if "unknown_team_context" in row["risk_flags"] or "team_resolution_mismatch" in row["risk_flags"] or "team_source_game_mismatch" in row["risk_flags"]:
        row["rejection_reason"] = "team_resolution_mismatch"
        return False
    if not _passes_context_gate(row, limits):
        return False
    if row["model_probability"] < float(limits.get("min_consensus_probability", 0.60)):
        row["rejection_reason"] = "below_consensus_probability"
        return False
    if row["final_score"] < float(limits.get("min_consensus_score", 0.25)):
        row["rejection_reason"] = "below_consensus_score"
        return False
    min_consensus_price_edge = limits.get("min_consensus_price_edge")
    if min_consensus_price_edge is not None:
        if row["fair_probability"] is not None and (row["price_edge"] or 0.0) < float(min_consensus_price_edge):
            row["rejection_reason"] = "below_consensus_price_edge"
            return False
    if not _passes_book_gate(row, limits):
        return False
    return True


def _is_expanded_fill_candidate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    if not limits.get("allow_expanded_fill"):
        return False
    if not _passes_context_gate(row, limits):
        return False
    if row["final_score"] < float(limits.get("expanded_min_score", 0.58)):
        return False
    if row["model_probability"] < float(limits.get("expanded_min_probability", 0.62)):
        row["rejection_reason"] = "below_expanded_probability"
        return False
    if row["tier"] not in {"S", "A", "B", "C"}:
        return False
    if row["fair_probability"] is not None and (row["price_edge"] or 0.0) < float(limits.get("expanded_min_price_edge", 0.04)):
        row["rejection_reason"] = "below_expanded_price_edge"
        return False
    hard_flags = {
        "injury_or_status_note",
        "unresolved_player",
        "thin_player_history",
        "source_pick_disagreement",
        "source_projection_disagreement",
        "source_projection_near_line",
        "missing_source_projection",
        "not_current_source_snapshot",
        "unknown_team_context",
        "team_resolution_mismatch",
        "team_source_game_mismatch",
    }
    if hard_flags & set(row.get("risk_flags") or []):
        return False
    if not _passes_book_gate(row, limits):
        return False
    return True


def _is_forced_fill_candidate(row: dict[str, Any], limits: dict[str, Any]) -> bool:
    if not limits.get("allow_forced_six_pick_fill"):
        return False
    if not _passes_context_gate(row, limits):
        return False
    if row["final_score"] < float(limits.get("forced_fill_min_score", 0.0)):
        return False
    if row["model_probability"] < float(limits.get("forced_fill_min_probability", 0.52)):
        row["rejection_reason"] = "below_forced_fill_probability"
        return False
    forced_fill_min_price_edge = limits.get("forced_fill_min_price_edge")
    if forced_fill_min_price_edge is not None:
        if row["fair_probability"] is not None and (row["price_edge"] or 0.0) < float(forced_fill_min_price_edge):
            row["rejection_reason"] = "below_forced_fill_price_edge"
            return False
    hard_flags = {
        "injury_or_status_note",
        "unresolved_player",
        "not_current_source_snapshot",
        "unknown_team_context",
        "team_resolution_mismatch",
        "team_source_game_mismatch",
    }
    if hard_flags & set(row.get("risk_flags") or []):
        return False
    if not _passes_book_gate(row, limits):
        return False
    return True


def _candidate_sort_key(row: dict[str, Any], limits: dict[str, Any]) -> tuple[float, float, float]:
    stability_penalty = 0.0
    if row["market"] == "PRA" and row["side"] == "UNDER":
        stability_penalty += float(limits.get("standard_pra_under_penalty", 0.04))
    if "volatile_minutes" in row.get("risk_flags", []):
        stability_penalty += float(limits.get("standard_volatile_penalty", 0.04))
    return (
        float(row.get("selection_score", row["final_score"])) - stability_penalty,
        float(row.get("selection_model_probability", row["model_probability"])),
        float(row["abs_line_gap"]),
    )


def _candidate_state_sort_key(
    row: dict[str, Any],
    limits: dict[str, Any],
    game_counts: Counter[str],
    *,
    forced_fill: bool = False,
) -> tuple[float, float, float]:
    base_score, probability, gap = _forced_fill_sort_key(row) if forced_fill else _candidate_sort_key(row, limits)
    same_game_pairs_added = int(game_counts[row["matchup_key"]])
    sgp_penalty = same_game_pairs_added * float(limits.get("sgp_tax_penalty_per_same_game_pair", 0.0) or 0.0)
    return (base_score - sgp_penalty, probability, gap)


def _forced_fill_sort_key(row: dict[str, Any]) -> tuple[float, float, float]:
    stability_penalty = 0.0
    if row["market"] == "THREES":
        stability_penalty += 0.06
        if row["side"] == "OVER":
            stability_penalty += 0.07
    if row["market"] in COMBO_MARKETS:
        stability_penalty += 0.03
    if row["market"] == "PRA":
        stability_penalty += 0.04
    if row["market"] == "PTS" and row["side"] == "UNDER":
        stability_penalty += 0.04
    if "volatile_minutes" in row.get("risk_flags", []):
        stability_penalty += 0.03
    if "source_projection_disagreement" in row.get("risk_flags", []):
        stability_penalty += 0.06
    if "source_projection_near_line" in row.get("risk_flags", []):
        stability_penalty += 0.04
    return (
        float(row.get("selection_score", row["final_score"])) - stability_penalty,
        float(row.get("selection_model_probability", row["model_probability"])),
        float(row["abs_line_gap"]),
    )


def _prepare_selection_scores(rows: list[dict[str, Any]], limits: dict[str, Any]) -> None:
    quiet_boost = max(0.0, float(limits.get("mqi_quiet_boost", 1.0) or 1.0))
    market_side_adjustments = limits.get("market_side_score_adjustments") or {}
    for row in rows:
        base_probability = float(row.get("model_probability") or 0.0)
        selection_probability = base_probability
        if int(row.get("is_quiet_market") or 0) == 1:
            selection_probability = clamp(base_probability * quiet_boost, 0.0, 1.0)
        adjustment = selection_probability - base_probability
        market_side_key = f"{row.get('market')}:{row.get('side')}"
        adjustment += float(market_side_adjustments.get(market_side_key, 0.0) or 0.0)
        row["selection_model_probability"] = round(selection_probability, 5)
        row["selection_score_adjustment"] = round(adjustment, 5)
        row["selection_score"] = round(clamp(float(row.get("final_score") or 0.0) + adjustment, 0.0, 1.0), 5)


def _dedupe_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        candidate_id = str(row.get("candidate_id") or id(row))
        if candidate_id in seen:
            continue
        seen.add(candidate_id)
        deduped.append(row)
    return deduped


def _mark_candidate_rows(rows: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> None:
    candidate_ids = {row["candidate_id"] for row in candidates}
    for row in rows:
        if row["candidate_id"] in candidate_ids and row["model_action"] == "COVERAGE":
            row["model_action"] = "CANDIDATE"


def _try_select_row(
    row: dict[str, Any],
    limits: dict[str, Any],
    selected: int,
    player_counts: Counter[str],
    team_counts: Counter[str],
    game_counts: Counter[str],
    market_counts: Counter[str],
    same_team_counting_overs: Counter[tuple[str, str]],
    combo_count: int,
    relax_correlation_limits: bool = False,
) -> tuple[bool, int]:
    rejection = None
    player_key = row["player_id"] or str(row["player"]).lower()
    if selected >= int(limits["max_picks"]):
        rejection = "portfolio_full"
    elif player_counts[player_key] >= int(limits["max_per_player"]):
        rejection = "max_per_player"
    elif team_counts[row["team"]] >= int(limits["max_per_team"]):
        rejection = "max_per_team"
    elif game_counts[row["matchup_key"]] >= int(limits["max_per_game"]):
        rejection = "max_per_game"
    elif not relax_correlation_limits and market_counts[row["market"]] >= int(limits["max_per_market"]):
        rejection = "max_per_market"
    elif not relax_correlation_limits and row["market"] in COMBO_MARKETS and combo_count >= int(limits["max_combo_markets"]):
        rejection = "max_combo_markets"
    elif (
        not relax_correlation_limits
        and row["side"] == "OVER"
        and row["market"] in COUNTING_OVER_MARKETS
        and same_team_counting_overs[(row["matchup_key"], row["team"])] >= int(limits["max_same_team_counting_overs"])
    ):
        rejection = "same_team_counting_over_correlation"
    if rejection:
        row["rejection_reason"] = rejection
        return False, combo_count
    selected += 1
    row["model_action"] = "SELECTED"
    row["selected_rank"] = selected
    row["rejection_reason"] = None
    player_counts[player_key] += 1
    team_counts[row["team"]] += 1
    game_counts[row["matchup_key"]] += 1
    market_counts[row["market"]] += 1
    if row["market"] in COMBO_MARKETS:
        combo_count += 1
    if row["side"] == "OVER" and row["market"] in COUNTING_OVER_MARKETS:
        same_team_counting_overs[(row["matchup_key"], row["team"])] += 1
    return True, combo_count


def _select_portfolio(rows: list[dict[str, Any]], limits: dict[str, Any]) -> None:
    _prepare_selection_scores(rows, limits)
    standard_candidates = [row for row in rows if _is_standard_candidate(row, limits) or _is_source_consensus_candidate(row, limits)]
    expanded_candidates = [row for row in rows if row not in standard_candidates and _is_expanded_fill_candidate(row, limits)]
    forced_fill_candidates = [row for row in rows if _is_forced_fill_candidate(row, limits)]
    standard_candidates.sort(key=lambda row: _candidate_sort_key(row, limits), reverse=True)
    expanded_candidates.sort(key=lambda row: _candidate_sort_key(row, limits), reverse=True)
    forced_fill_candidates.sort(key=_forced_fill_sort_key, reverse=True)
    candidates = _dedupe_candidates(standard_candidates + expanded_candidates + forced_fill_candidates)
    player_counts: Counter[str] = Counter()
    team_counts: Counter[str] = Counter()
    game_counts: Counter[str] = Counter()
    market_counts: Counter[str] = Counter()
    same_team_counting_overs: Counter[tuple[str, str]] = Counter()
    combo_count = 0
    selected = 0
    _mark_candidate_rows(rows, candidates)
    target = min(int(limits.get("target_picks") or limits["max_picks"]), int(limits["max_picks"]))
    def select_from_pool(
        pool: list[dict[str, Any]],
        *,
        fill_flag: str | None = None,
        forced_fill: bool = False,
        relax_correlation_limits: bool = False,
    ) -> None:
        nonlocal selected, combo_count
        remaining = [row for row in pool if row["model_action"] != "SELECTED"]
        while selected < target and remaining:
            remaining.sort(
                key=lambda row: _candidate_state_sort_key(row, limits, game_counts, forced_fill=forced_fill),
                reverse=True,
            )
            picked_any = False
            for row in list(remaining):
                remaining.remove(row)
                if row["model_action"] == "SELECTED":
                    continue
                picked, combo_count = _try_select_row(
                    row,
                    limits,
                    selected,
                    player_counts,
                    team_counts,
                    game_counts,
                    market_counts,
                    same_team_counting_overs,
                    combo_count,
                    relax_correlation_limits=relax_correlation_limits,
                )
                selected = sum(1 for candidate in candidates if candidate["model_action"] == "SELECTED")
                if picked:
                    if fill_flag:
                        row["risk_flags"] = sorted(set((row.get("risk_flags") or []) + [fill_flag]))
                    picked_any = True
                    break
            if not picked_any:
                break
        if selected >= target:
            for row in remaining:
                if row["model_action"] != "SELECTED" and not row.get("rejection_reason"):
                    row["rejection_reason"] = "portfolio_full"

    select_from_pool(standard_candidates)
    if selected < target:
        select_from_pool(expanded_candidates, fill_flag="expanded_card_fill")
    if selected < target:
        select_from_pool(
            forced_fill_candidates,
            fill_flag="forced_six_pick_fill",
            forced_fill=True,
            relax_correlation_limits=True,
        )
    selected_rows = [row for row in rows if row["model_action"] == "SELECTED"]
    selected_player_counts = Counter(row["player_id"] or str(row["player"]).lower() for row in selected_rows)
    selected_game_counts = Counter(row["matchup_key"] for row in selected_rows)
    for row in selected_rows:
        flags = set(row.get("risk_flags") or [])
        player_key = row["player_id"] or str(row["player"]).lower()
        if selected_player_counts[player_key] > 1:
            flags.add("same_player_correlation")
        if selected_game_counts[row["matchup_key"]] > 2:
            flags.add("same_game_concentration")
        row["risk_flags"] = sorted(flags)


def _sgp_exposure(selected_rows: list[dict[str, Any]], target_picks: int = 6) -> dict[str, Any]:
    legs = sorted(selected_rows, key=lambda row: row.get("selected_rank") or 999)[:target_picks]
    game_counts = Counter(row["matchup_key"] for row in legs)
    same_game_pairs = sum(count * (count - 1) // 2 for count in game_counts.values())
    max_same_game_legs = max(game_counts.values(), default=0)
    if max_same_game_legs >= 3 or same_game_pairs >= 6:
        risk_level = "HIGH"
    elif max_same_game_legs == 2 or same_game_pairs > 0:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"
    clusters = [
        {
            "matchupKey": matchup_key,
            "legCount": count,
            "sameGamePairs": count * (count - 1) // 2,
        }
        for matchup_key, count in sorted(game_counts.items(), key=lambda item: (-item[1], item[0]))
        if count > 1
    ]
    return {
        "requiresSameGameParlayPricing": same_game_pairs > 0,
        "riskLevel": risk_level,
        "sameGamePairs": int(same_game_pairs),
        "maxSameGameLegs": int(max_same_game_legs),
        "uniqueGames": len(game_counts),
        "clusters": clusters,
        "note": (
            "FanDuel can reprice cards with multiple legs from one game as SGP/SGP-plus, so archive hit rate and "
            "standard parlay payout math should not be assumed."
        ),
    }


def _parlay_plan(
    selected_rows: list[dict[str, Any]],
    target_picks: int = 6,
    target_probability: float = TARGET_PARLAY_PROBABILITY,
) -> dict[str, Any]:
    legs = sorted(selected_rows, key=lambda row: row.get("selected_rank") or 999)[:target_picks]
    probabilities = [float(row.get("selection_model_probability", row["model_probability"])) for row in legs]
    complete = len(legs) == target_picks
    independent_probability = math.prod(probabilities) if complete else None
    required_average = target_probability ** (1.0 / target_picks)
    exposure = _sgp_exposure(legs, target_picks)
    estimated_tax_multiplier = max(0.50, 1.0 - (0.025 * float(exposure["sameGamePairs"])))
    exposure["estimatedSgpTaxMultiplier"] = round(estimated_tax_multiplier, 5)
    exposure["estimatedTaxedIndependentProbability"] = (
        round(independent_probability * estimated_tax_multiplier, 5) if independent_probability is not None else None
    )
    warnings = [
        "Independent parlay probability assumes leg independence; same-game and same-team correlation can change realized results."
    ]
    if not complete:
        warnings.append(f"Only {len(legs)} of {target_picks} target legs selected.")
    if exposure["requiresSameGameParlayPricing"]:
        warnings.append("Selected card has same-game overlap; check FanDuel SGP/SGP-plus pricing before betting.")
    return {
        "targetLegs": target_picks,
        "selectedLegs": len(legs),
        "isComplete": complete,
        "targetParlayProbability": round(target_probability, 5),
        "requiredAverageLegProbability": round(required_average, 5),
        "independentModelProbability": round(independent_probability, 5) if independent_probability is not None else None,
        "averageLegProbability": round(float(np.mean(probabilities)), 5) if probabilities else None,
        "lowestLegProbability": round(min(probabilities), 5) if probabilities else None,
        "targetMetByIndependentModel": bool(independent_probability is not None and independent_probability >= target_probability),
        "targetProbabilityShortfall": round(max(0.0, target_probability - independent_probability), 5)
        if independent_probability is not None
        else None,
        "sameGamePairs": exposure["sameGamePairs"],
        "maxSameGameLegs": exposure["maxSameGameLegs"],
        "sameTeamPairs": sum(count * (count - 1) // 2 for count in Counter(row["team"] for row in legs).values()),
        "comboLegs": sum(1 for row in legs if row["market"] in COMBO_MARKETS),
        "sgpExposure": exposure,
        "warnings": warnings,
    }


def _proof_context() -> dict[str, Any]:
    return {
        "archiveSelector": dict(ARCHIVE_SELECTOR_PROOF),
        "fanDuelStrictShadow": dict(FANDUEL_STRICT_SHADOW_PROOF),
        "liveFanDuelClaim": (
            "The website card uses FanDuel-live model selection. Archive/cross-source proof is research context only, "
            "and it does not transfer to strict single-book execution."
        ),
    }


def _execution_profile(limits: dict[str, Any]) -> dict[str, Any]:
    required_book = str(limits.get("required_source_book") or "").strip().lower()
    if "fanduel" in required_book:
        return {
            "mode": "FANDUEL_LIVE",
            "label": "FanDuel Live Mode",
            "status": "EXPERIMENTAL",
            "inheritsArchiveProof": False,
            "requiresPlayableSideOdds": bool(limits.get("require_playable_side_odds")),
            "proofBoundary": FANDUEL_STRICT_SHADOW_PROOF["proofBoundary"],
        }
    if limits.get("allow_expanded_fill"):
        return {
            "mode": "EXPANDED_RESEARCH",
            "label": "Expanded Research Mode",
            "status": "RESEARCH",
            "inheritsArchiveProof": False,
            "requiresPlayableSideOdds": bool(limits.get("require_playable_side_odds")),
            "proofBoundary": "Expanded cards can use non-FanDuel rows and must be checked for book availability before betting.",
        }
    return {
        "mode": "ARCHIVE_OR_GENERIC_RESEARCH",
        "label": "Research Preview Mode",
        "status": "RESEARCH",
        "inheritsArchiveProof": False,
        "requiresPlayableSideOdds": bool(limits.get("require_playable_side_odds")),
        "proofBoundary": CLAIM_BOUNDARY,
    }


def score_board(
    logs: pd.DataFrame,
    board: pd.DataFrame,
    slate_date: str | None = None,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    active_limits = {**PORTFOLIO_LIMITS, **(limits or {})}
    board = resolve_player_ids(board, logs)
    if slate_date:
        board = board[board["game_date"] == pd.to_datetime(slate_date)].copy()
    if board.empty:
        raise ValueError("No board rows available for scoring.")
    rows: list[dict[str, Any]] = []
    for board_row in board.sort_values(["game_date", "team_abbr", "player", "market"]).to_dict("records"):
        row = pd.Series(board_row)
        history = logs[logs["game_date"] < row["game_date"]].copy()
        rows.append(_score_row(history, row))
    _select_portfolio(rows, active_limits)
    selected_rows = [row for row in rows if row["model_action"] == "SELECTED"]
    candidate_rows = [row for row in rows if row["model_action"] == "CANDIDATE"]
    target_picks = int(active_limits.get("target_picks") or active_limits["max_picks"])
    parlay_plan = _parlay_plan(selected_rows, target_picks=target_picks)
    execution_profile = _execution_profile(active_limits)
    proof_context = _proof_context()
    summary = {
        "totalBoardRows": len(rows),
        "candidateCount": len(candidate_rows),
        "selectedCount": len(selected_rows),
        "targetPicks": target_picks,
        "selectedByTier": dict(Counter(row["tier"] for row in selected_rows)),
        "boardRowsByTier": dict(Counter(row["tier"] for row in rows)),
        "boardRowsByAction": dict(Counter(row["model_action"] for row in rows)),
        "averageModelProbability": round(float(np.mean([row["model_probability"] for row in selected_rows])), 5)
        if selected_rows
        else None,
        "averageFinalScore": round(float(np.mean([row["final_score"] for row in selected_rows])), 5) if selected_rows else None,
        "priceCoveragePct": round(100.0 * sum(row["fair_probability"] is not None for row in rows) / len(rows), 2),
        "sgpRiskLevel": parlay_plan["sgpExposure"]["riskLevel"],
        "sameGamePairs": parlay_plan["sameGamePairs"],
        "maxSameGameLegs": parlay_plan["maxSameGameLegs"],
        "executionStatus": execution_profile["status"],
        "warningCount": 0,
    }
    warnings: list[str] = []
    if summary["priceCoveragePct"] < 100:
        warnings.append("Some rows are missing both over_odds and under_odds, so those rows are ranked without true price edge.")
    if any("single_side_price" in row["risk_flags"] for row in rows):
        warnings.append("Some sourced rows have only the pick-side book price, so price edge is approximate rather than full no-vig.")
    if selected_rows and any("no_price_edge" in row["risk_flags"] for row in selected_rows):
        warnings.append("At least one selected row lacks price edge. Add current over_odds and under_odds before betting.")
    required_book = str(active_limits.get("required_source_book") or "").strip()
    if required_book and not selected_rows:
        warnings.append(f"No selected rows cleared the {required_book} availability gate.")
    if 0 < len(selected_rows) < target_picks:
        warnings.append(f"Only {len(selected_rows)} rows cleared the current gates for a {target_picks}-pick target.")
    if execution_profile["mode"] == "FANDUEL_LIVE":
        warnings.append(
            "FanDuel-live card is experimental: the 51.85% archive proof does not transfer to strict FanDuel execution."
        )
    if selected_rows and any("expanded_card_fill" in row["risk_flags"] for row in selected_rows):
        warnings.append("Expanded-card rows are included to reach the target count; verify book availability and current odds before using them.")
    if selected_rows and any("forced_six_pick_fill" in row["risk_flags"] for row in selected_rows):
        warnings.append("Forced six-pick fill added lower-confidence playable rows to reach the daily target; treat those legs as coverage picks, not high-confidence edges.")
    if selected_rows and any("same_player_correlation" in row["risk_flags"] for row in selected_rows):
        warnings.append("Expanded card includes multiple props on the same player because the available slate board is concentrated.")
    if selected_rows and any("same_game_concentration" in row["risk_flags"] for row in selected_rows):
        warnings.append("Expanded card is concentrated in one matchup; treat correlated results as higher variance.")
    warnings.extend(parlay_plan["warnings"])
    summary["warningCount"] = len(warnings)
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelName": "WNBA Correlation-Aware Player Prop Model V1",
        "modelVersion": MODEL_VERSION,
        "mode": "PREVIEW",
        "slateDate": str(board["game_date"].dt.date.min()),
        "currentDateEt": today_et(),
        "claimBoundary": CLAIM_BOUNDARY,
        "executionProfile": execution_profile,
        "proofContext": proof_context,
        "parlayPlan": parlay_plan,
        "portfolioConfig": active_limits,
        "summary": summary,
        "warnings": warnings,
        "boardRows": rows,
        "selectedRows": sorted(selected_rows, key=lambda item: item["selected_rank"] or 999),
        "candidateRows": sorted(candidate_rows, key=lambda item: item["final_score"], reverse=True),
    }


def empty_card(
    slate_date: str,
    limits: dict[str, Any] | None = None,
    mode: str = "NO_SLATE",
    warnings: list[str] | None = None,
    source_note: str | None = None,
) -> dict[str, Any]:
    active_limits = {**PORTFOLIO_LIMITS, **(limits or {})}
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelName": "WNBA Correlation-Aware Player Prop Model V1",
        "modelVersion": MODEL_VERSION,
        "mode": mode,
        "slateDate": slate_date,
        "currentDateEt": today_et(),
        "claimBoundary": CLAIM_BOUNDARY,
        "portfolioConfig": active_limits,
        "summary": {
            "totalBoardRows": 0,
            "candidateCount": 0,
            "selectedCount": 0,
            "selectedByTier": {},
            "boardRowsByTier": {},
            "boardRowsByAction": {},
            "averageModelProbability": None,
            "averageFinalScore": None,
            "priceCoveragePct": 0.0,
            "warningCount": len(warnings or []),
        },
        "warnings": warnings or [],
        "boardRows": [],
        "selectedRows": [],
        "candidateRows": [],
        **({"sourceNote": source_note} if source_note else {}),
    }


def _json_ready(value: Any) -> Any:
    if isinstance(value, set):
        return sorted(value)
    if isinstance(value, dict):
        return {key: _json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    return value


def write_card(card: dict[str, Any], out_prefix: str | Path) -> dict[str, str]:
    prefix = Path(out_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = prefix.with_suffix(".json")
    csv_path = prefix.with_suffix(".csv")
    md_path = prefix.with_suffix(".md")
    json_path.write_text(json.dumps(_json_ready(card), indent=2), encoding="utf-8")
    rows = card["boardRows"]
    if rows:
        fieldnames = [
            "model_action",
            "selected_rank",
            "tier",
            "final_score",
            "player",
            "team",
            "team_name",
            "opponent",
            "opponent_name",
            "market",
            "side",
            "line",
            "projected_value",
            "line_gap",
            "model_probability",
            "fair_probability",
            "price_edge",
            "projected_minutes",
            "sample_size",
            "source_pick",
            "source_projection",
            "source_odds",
            "source_book",
            "source_market",
            "source_status",
            "team_resolution_status",
            "source_url",
            "risk_flags",
            "rejection_reason",
        ]
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            for row in rows:
                copy = dict(row)
                copy["risk_flags"] = "|".join(row.get("risk_flags") or [])
                writer.writerow(copy)
    lines = [
        f"# {card['modelName']}",
        "",
        f"Generated: {card['generatedAt']}",
        f"Slate: {card['slateDate']}",
        "",
        "## Selected",
        "",
    ]
    if not card["selectedRows"]:
        lines.append("No selected rows cleared the portfolio gates.")
    for row in card["selectedRows"]:
        edge = "" if row["price_edge"] is None else f", edge {row['price_edge']:+.1%}"
        team_label = row.get("team_name") or row.get("team")
        opponent_label = row.get("opponent_name") or row.get("opponent")
        lines.append(
            f"{row['selected_rank']}. {row['player']} {row['side']} {row['market']} {row['line']} "
            f"({team_label} vs {opponent_label}): p={row['model_probability']:.1%}, "
            f"proj={row['projected_value']:.2f}{edge}, score={row['final_score']:.3f}, "
            f"source={row.get('source_book') or 'Public board'}"
        )
    execution = card.get("executionProfile") or {}
    parlay = card.get("parlayPlan") or {}
    sgp = parlay.get("sgpExposure") or {}
    if execution or parlay:
        lines.extend(["", "## Execution Reality", ""])
    if execution:
        lines.append(
            f"{execution.get('label', 'Execution mode')}: {execution.get('status', 'UNKNOWN')}. "
            f"{execution.get('proofBoundary', CLAIM_BOUNDARY)}"
        )
    if parlay:
        independent = parlay.get("independentModelProbability")
        taxed = sgp.get("estimatedTaxedIndependentProbability")
        independent_text = "incomplete" if independent is None else f"{independent:.1%}"
        taxed_text = "n/a" if taxed is None else f"{taxed:.1%}"
        lines.append(
            f"Selected legs: {parlay.get('selectedLegs')}/{parlay.get('targetLegs')}; "
            f"independent probability: {independent_text}; estimated SGP-taxed probability: {taxed_text}; "
            f"SGP risk: {sgp.get('riskLevel', 'UNKNOWN')}"
        )
    lines.extend(["", "## Warnings", ""])
    lines.extend(card["warnings"] or ["None"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"json": str(json_path), "csv": str(csv_path), "md": str(md_path)}


def _actual_for_line(logs: pd.DataFrame, row: pd.Series) -> float | None:
    supplied = clean_number(row.get("actual"))
    if supplied is not None:
        return supplied
    market = str(row["market"]).upper()
    date = row["game_date"]
    candidates = logs[logs["game_date"] == date]
    player_id = str(row.get("player_id") or "").strip()
    if player_id:
        candidates = candidates[candidates["player_id"].astype(str) == player_id]
    else:
        candidates = candidates[candidates["player_key"] == row["player_key"]]
    if candidates.empty:
        return None
    return clean_number(candidates.iloc[0][market])


def backtest_historical_lines(
    logs: pd.DataFrame,
    lines: pd.DataFrame,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scored: list[dict[str, Any]] = []
    for slate_date in sorted(lines["game_date"].dropna().dt.date.unique()):
        date_text = slate_date.isoformat()
        board = lines[lines["game_date"].dt.date == slate_date].copy()
        if board.empty:
            continue
        try:
            card = score_board(logs, board, date_text, limits)
        except ValueError:
            continue
        actual_lookup = {row["candidate_id"]: row for row in card["boardRows"]}
        for _, line_row in board.iterrows():
            temp = pd.Series(line_row)
            actual = _actual_for_line(logs, temp)
            if actual is None:
                continue
            key_prefix = f"{date_text}:{temp.get('player_id') or temp.get('player_key')}:{str(temp['market']).upper()}:{float(temp['line'])}"
            model_row = actual_lookup.get(key_prefix)
            if model_row is None:
                continue
            correct = (actual > float(temp["line"]) and model_row["side"] == "OVER") or (
                actual < float(temp["line"]) and model_row["side"] == "UNDER"
            )
            scored.append({**model_row, "actual": actual, "correct": bool(correct)})
    selected = [row for row in scored if row["model_action"] == "SELECTED"]
    candidates = [row for row in scored if row["model_action"] in {"SELECTED", "CANDIDATE"}]

    def rollup(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {"samples": 0, "wins": 0, "accuracyPct": None}
        wins = sum(1 for row in rows if row["correct"])
        return {"samples": len(rows), "wins": wins, "accuracyPct": round(100.0 * wins / len(rows), 2)}

    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": {
            "all": rollup(scored),
            "candidates": rollup(candidates),
            "selected": rollup(selected),
            "byMarketSelected": {market: rollup([row for row in selected if row["market"] == market]) for market in MARKETS},
            "byTierSelected": {tier: rollup([row for row in selected if row["tier"] == tier]) for tier in ["S", "A", "B", "C", "D"]},
        },
        "rows": scored,
    }
