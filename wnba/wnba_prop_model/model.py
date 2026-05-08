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
    round_or_none,
    season_phase_for_date,
    today_et,
)

MODEL_ID = "wnba-player-prop-model-v1"
MODEL_VERSION = "2026-05-08-espn-logs-correlation-v1"
CLAIM_BOUNDARY = (
    "WNBA V1 uses historical boxscore logs plus supplied prop lines. It is a ranking and calibration model, "
    "not a guarantee. Live betting claims require current lines, player availability, and settled forward audit."
)

PORTFOLIO_LIMITS = {
    "max_picks": 6,
    "min_score": 0.68,
    "max_per_player": 1,
    "max_per_team": 2,
    "max_per_game": 2,
    "max_per_market": 2,
    "max_same_team_counting_overs": 1,
    "max_combo_markets": 2,
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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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
    df["team_abbr"] = df["team_abbr"].astype(str).str.upper()
    df["opponent_abbr"] = df["opponent_abbr"].astype(str).str.upper()
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
    df["market"] = df["market"].astype(str).str.upper()
    df = df[df["market"].isin(MARKETS)].copy()
    df["line"] = pd.to_numeric(df["line"], errors="coerce")
    df = df[df["line"].notna()].copy()
    for column in ["over_odds", "under_odds", "sportsbook_count", "projected_minutes", "game_total", "spread"]:
        if column not in df.columns:
            df[column] = np.nan
        df[column] = pd.to_numeric(df[column], errors="coerce")
    for column in ["player_id", "injury_note", "line_last_updated"]:
        if column not in df.columns:
            df[column] = ""
    if "is_home" not in df.columns:
        df["is_home"] = np.nan
    if "starter_expected" not in df.columns:
        df["starter_expected"] = np.nan
    df["player_id"] = df["player_id"].fillna("").astype(str)
    df["player_key"] = df["player"].map(canonical_name)
    df["team_abbr"] = df["team_abbr"].astype(str).str.upper()
    df["opponent_abbr"] = df["opponent_abbr"].astype(str).str.upper()
    return df.reset_index(drop=True)


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
    df = board.copy()
    resolved: list[str] = []
    for row in df.itertuples():
        current = str(row.player_id or "").strip()
        resolved.append(current or by_team.get((row.player_key, row.team_abbr), "") or name_map.get(row.player_key, ""))
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
    for component_market in [m for m in ("PTS", "REB", "AST") if MARKET_COMPONENTS[component_market][0] in MARKET_COMPONENTS[market]]:
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
    if rest_days is not None and rest_days <= 1:
        flags.append("short_rest_or_b2b")
    spread = clean_number(row.get("spread"))
    if spread is not None and abs(spread) >= 10.5:
        flags.append("blowout_spread")
    if player_logs.empty:
        flags.append("unresolved_player")
    return flags


def _score_row(history: pd.DataFrame, row: pd.Series) -> dict[str, Any]:
    player_logs = _player_history(history, row)
    minutes, minutes_confidence, minute_flags = _expected_minutes(player_logs, row)
    market = str(row["market"]).upper()
    line = float(row["line"])
    projected = _project_market(history, player_logs, row, market, minutes)
    projection = float(projected["projection"])
    sample_size = int(projected["sample_size"])
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
    prob_strength = clamp((model_prob - 0.52) / 0.18, 0.0, 1.0)
    gap_strength = clamp(gap_sigma / 1.15, 0.0, 1.0)
    edge_strength = clamp(((edge or 0.0) - 0.005) / 0.055, 0.0, 1.0) if fair_prob is not None else 0.35
    risk_penalty = 0.025 * len(set(risk_flags))
    if "injury_or_status_note" in risk_flags:
        risk_penalty += 0.07
    if "unresolved_player" in risk_flags:
        risk_penalty += 0.12
    base_score = 0.42 * prob_strength + 0.24 * gap_strength + 0.20 * data_confidence + 0.14 * edge_strength
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
    return {
        "candidate_id": f"{row.get('game_date').date().isoformat()}:{row.get('player_id') or row.get('player_key')}:{market}:{line}",
        "slate_date": row.get("game_date").date().isoformat(),
        "player_id": str(row.get("player_id") or ""),
        "player": row.get("player"),
        "team": row.get("team_abbr"),
        "opponent": row.get("opponent_abbr"),
        "matchup_key": "-".join(sorted([str(row.get("team_abbr")), str(row.get("opponent_abbr"))])),
        "market": market,
        "side": side,
        "line": round(line, 3),
        "over_odds": round_or_none(row.get("over_odds"), 0),
        "under_odds": round_or_none(row.get("under_odds"), 0),
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
        "tier": tier,
        "base_score": round(base_score, 5),
        "final_score": round(final_score, 5),
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


def _select_portfolio(rows: list[dict[str, Any]], limits: dict[str, Any]) -> None:
    candidates = [
        row
        for row in rows
        if row["final_score"] >= limits["min_score"]
        and row["tier"] in {"S", "A", "B"}
        and _passes_price_gate(row)
        and "injury_or_status_note" not in row["risk_flags"]
        and "unresolved_player" not in row["risk_flags"]
    ]
    candidates.sort(key=lambda item: (item["final_score"], item["model_probability"], item["abs_line_gap"]), reverse=True)
    player_counts: Counter[str] = Counter()
    team_counts: Counter[str] = Counter()
    game_counts: Counter[str] = Counter()
    market_counts: Counter[str] = Counter()
    same_team_counting_overs: Counter[tuple[str, str]] = Counter()
    combo_count = 0
    selected = 0
    candidate_ids = {row["candidate_id"] for row in candidates}
    for row in rows:
        if row["candidate_id"] in candidate_ids:
            row["model_action"] = "CANDIDATE"
    for row in candidates:
        rejection = None
        player_key = row["player_id"] or str(row["player"]).lower()
        if selected >= limits["max_picks"]:
            rejection = "portfolio_full"
        elif player_counts[player_key] >= limits["max_per_player"]:
            rejection = "max_per_player"
        elif team_counts[row["team"]] >= limits["max_per_team"]:
            rejection = "max_per_team"
        elif game_counts[row["matchup_key"]] >= limits["max_per_game"]:
            rejection = "max_per_game"
        elif market_counts[row["market"]] >= limits["max_per_market"]:
            rejection = "max_per_market"
        elif row["market"] in COMBO_MARKETS and combo_count >= limits["max_combo_markets"]:
            rejection = "max_combo_markets"
        elif (
            row["side"] == "OVER"
            and row["market"] in COUNTING_OVER_MARKETS
            and same_team_counting_overs[(row["matchup_key"], row["team"])] >= limits["max_same_team_counting_overs"]
        ):
            rejection = "same_team_counting_over_correlation"
        if rejection:
            row["rejection_reason"] = rejection
            continue
        selected += 1
        row["model_action"] = "SELECTED"
        row["selected_rank"] = selected
        player_counts[player_key] += 1
        team_counts[row["team"]] += 1
        game_counts[row["matchup_key"]] += 1
        market_counts[row["market"]] += 1
        if row["market"] in COMBO_MARKETS:
            combo_count += 1
        if row["side"] == "OVER" and row["market"] in COUNTING_OVER_MARKETS:
            same_team_counting_overs[(row["matchup_key"], row["team"])] += 1


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
    summary = {
        "totalBoardRows": len(rows),
        "candidateCount": len(candidate_rows),
        "selectedCount": len(selected_rows),
        "selectedByTier": dict(Counter(row["tier"] for row in selected_rows)),
        "boardRowsByTier": dict(Counter(row["tier"] for row in rows)),
        "boardRowsByAction": dict(Counter(row["model_action"] for row in rows)),
        "averageModelProbability": round(float(np.mean([row["model_probability"] for row in selected_rows])), 5)
        if selected_rows
        else None,
        "averageFinalScore": round(float(np.mean([row["final_score"] for row in selected_rows])), 5) if selected_rows else None,
        "priceCoveragePct": round(100.0 * sum(row["fair_probability"] is not None for row in rows) / len(rows), 2),
        "warningCount": 0,
    }
    warnings: list[str] = []
    if summary["priceCoveragePct"] < 100:
        warnings.append("Some rows are missing both over_odds and under_odds, so those rows are ranked without true price edge.")
    if selected_rows and any("no_price_edge" in row["risk_flags"] for row in selected_rows):
        warnings.append("At least one selected row lacks price edge. Add current over_odds and under_odds before betting.")
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
        "portfolioConfig": active_limits,
        "summary": summary,
        "warnings": warnings,
        "boardRows": rows,
        "selectedRows": sorted(selected_rows, key=lambda item: item["selected_rank"] or 999),
        "candidateRows": sorted(candidate_rows, key=lambda item: item["final_score"], reverse=True),
    }


def write_card(card: dict[str, Any], out_prefix: str | Path) -> dict[str, str]:
    prefix = Path(out_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = prefix.with_suffix(".json")
    csv_path = prefix.with_suffix(".csv")
    md_path = prefix.with_suffix(".md")
    json_path.write_text(json.dumps(card, indent=2), encoding="utf-8")
    rows = card["boardRows"]
    if rows:
        fieldnames = [
            "model_action",
            "selected_rank",
            "tier",
            "final_score",
            "player",
            "team",
            "opponent",
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
            "risk_flags",
            "rejection_reason",
        ]
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
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
        lines.append(
            f"{row['selected_rank']}. {row['player']} {row['side']} {row['market']} {row['line']} "
            f"({row['team']} vs {row['opponent']}): p={row['model_probability']:.1%}, "
            f"proj={row['projected_value']:.2f}{edge}, score={row['final_score']:.3f}"
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
