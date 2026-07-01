from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pandas as pd

from .model import CLAIM_BOUNDARY, MODEL_ID, MODEL_VERSION, _select_portfolio, utc_now
from .settlement import settle_card

SELECTION_ONLY_FLAGS = {
    "expanded_card_fill",
    "forced_six_pick_fill",
    "same_game_concentration",
    "same_player_correlation",
}


def daily_six_pick_limits(max_picks: int = 6, min_score: float = 0.68) -> dict[str, Any]:
    return {
        "max_picks": max_picks,
        "target_picks": max_picks,
        "min_score": min_score,
        "require_playable_side_odds": True,
        "allow_expanded_fill": True,
        "expanded_min_score": 0.58,
        "expanded_min_probability": 0.62,
        "expanded_min_price_edge": 0.04,
        "allow_forced_six_pick_fill": True,
        "forced_fill_min_score": 0.0,
        "forced_fill_min_probability": 0.50,
        "max_per_player": 1,
        "max_per_team": 6,
        "max_per_game": 6,
        "max_per_market": 4,
        "max_combo_markets": 4,
    }


def _reset_replay_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reset_rows = deepcopy(rows)
    for row in reset_rows:
        row["model_action"] = "COVERAGE"
        row["selected_rank"] = None
        row["rejection_reason"] = None
        row["risk_flags"] = sorted(set(row.get("risk_flags") or []) - SELECTION_ONLY_FLAGS)
    return reset_rows


def _replay_card(card: dict[str, Any], logs: pd.DataFrame, limits: dict[str, Any] | None = None) -> dict[str, Any]:
    rows = _reset_replay_rows(card.get("boardRows") or [])
    portfolio_config = {**(card.get("portfolioConfig") or {}), **(limits or {})}
    _select_portfolio(rows, portfolio_config)
    selected_rows = sorted(
        [row for row in rows if row["model_action"] == "SELECTED"],
        key=lambda item: item.get("selected_rank") or 999,
    )
    replayed_card = {
        **card,
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "mode": "ARCHIVE_SELECTOR_REPLAY",
        "portfolioConfig": portfolio_config,
        "boardRows": rows,
        "selectedRows": selected_rows,
    }
    settlement = settle_card(replayed_card, logs)
    return {"card": replayed_card, "settlement": settlement}


def _card_paths(archive_root: str | Path, current_card: str | Path | None = None) -> list[Path]:
    root = Path(archive_root)
    paths = sorted(root.glob("*/current-card.json"))
    if current_card is not None:
        current_path = Path(current_card)
        if current_path.exists():
            paths.append(current_path)
    return paths


def replay_archived_cards(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    current_card: str | Path | None = None,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    daily_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    target_picks = int((limits or {}).get("target_picks") or (limits or {}).get("max_picks") or 6)
    for card_path in _card_paths(archive_root, current_card):
        card = json.loads(card_path.read_text(encoding="utf-8"))
        if not card.get("boardRows"):
            continue
        replay = _replay_card(card, logs, limits)
        settlement = replay["settlement"]
        summary = settlement["summary"]
        selected_count = len(replay["card"]["selectedRows"])
        settled_full_card = selected_count >= target_picks and summary["settledPicks"] == selected_count
        parlay_hit = bool(settled_full_card and summary["wins"] == selected_count)
        slate_date = str(card.get("slateDate") or card_path.parent.name)
        daily_rows.append(
            {
                "slateDate": slate_date,
                "cardPath": str(card_path),
                "selectedCount": selected_count,
                "settledPicks": summary["settledPicks"],
                "wins": summary["wins"],
                "losses": summary["losses"],
                "pushes": summary["pushes"],
                "pendingPicks": summary["pendingPicks"],
                "noActionPicks": summary["noActionPicks"],
                "legAccuracyPct": summary["accuracyPct"],
                "sixPickCovered": selected_count >= target_picks,
                "sixPickSettled": settled_full_card,
                "sixPickParlayHit": parlay_hit,
            }
        )
        replayed_by_rank = {
            row.get("selected_rank"): row
            for row in replay["card"]["selectedRows"]
            if row.get("selected_rank") is not None
        }
        for row in settlement["rows"]:
            replayed_row = replayed_by_rank.get(row.get("selected_rank"), {})
            selected_rows.append(
                {
                    **row,
                    "risk_flags": list(replayed_row.get("risk_flags") or []),
                    "tier": replayed_row.get("tier"),
                    "cardPath": str(card_path),
                    "sixPickParlayHit": parlay_hit,
                }
            )

    settled_rows = [row for row in selected_rows if row["settlement"] in {"WIN", "LOSS"}]
    wins = sum(row["settlement"] == "WIN" for row in settled_rows)
    six_pick_settled = [row for row in daily_rows if row["sixPickSettled"]]
    six_pick_wins = sum(row["sixPickParlayHit"] for row in six_pick_settled)
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": {
            "cardsReplayed": len(daily_rows),
            "targetPicks": target_picks,
            "sixPickCoveredDates": sum(row["sixPickCovered"] for row in daily_rows),
            "sixPickSettledDates": len(six_pick_settled),
            "sixPickParlayWins": six_pick_wins,
            "sixPickParlayAccuracyPct": round(100.0 * six_pick_wins / len(six_pick_settled), 2)
            if six_pick_settled
            else None,
            "settledLegs": len(settled_rows),
            "legWins": wins,
            "legAccuracyPct": round(100.0 * wins / len(settled_rows), 2) if settled_rows else None,
        },
        "dailyRows": daily_rows,
        "selectedRows": selected_rows,
    }


def write_replay_report(report: dict[str, Any], out: str | Path) -> Path:
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path
