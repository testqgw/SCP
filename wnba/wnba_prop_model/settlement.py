from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import pandas as pd

from .model import CLAIM_BOUNDARY, MODEL_ID, MODEL_VERSION, utc_now
from .utils import canonical_name, clean_number


def _clean_player_id(value: Any) -> str:
    text = str(value or "").strip()
    return text[:-2] if text.endswith(".0") else text


def _actual_for_row(logs: pd.DataFrame, row: dict[str, Any]) -> float | None:
    slate_date = pd.to_datetime(row.get("slate_date"), errors="coerce")
    if pd.isna(slate_date):
        return None
    candidates = logs[logs["game_date"].dt.date == slate_date.date()]
    player_id = _clean_player_id(row.get("player_id"))
    if player_id:
        candidates = candidates[candidates["player_id"].map(_clean_player_id) == player_id]
    else:
        candidates = candidates[candidates["player_key"] == canonical_name(row.get("player"))]
    if candidates.empty:
        return None
    market = str(row.get("market") or "").upper()
    if market not in candidates.columns:
        return None
    return clean_number(candidates.iloc[0][market])


def _settlement_status(row: dict[str, Any], actual: float | None) -> str:
    if actual is None:
        return "PENDING"
    line = float(row["line"])
    if actual == line:
        return "PUSH"
    side = str(row["side"]).upper()
    if (side == "OVER" and actual > line) or (side == "UNDER" and actual < line):
        return "WIN"
    return "LOSS"


def _rollup(rows: list[dict[str, Any]]) -> dict[str, Any]:
    wins = sum(row["settlement"] == "WIN" for row in rows)
    losses = sum(row["settlement"] == "LOSS" for row in rows)
    pushes = sum(row["settlement"] == "PUSH" for row in rows)
    pending = sum(row["settlement"] == "PENDING" for row in rows)
    settled = wins + losses
    return {
        "trackedPicks": len(rows),
        "settledPicks": settled,
        "pendingPicks": pending,
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "accuracyPct": round(100.0 * wins / settled, 2) if settled else None,
    }


def settle_card(card: dict[str, Any], logs: pd.DataFrame) -> dict[str, Any]:
    settled_rows: list[dict[str, Any]] = []
    for row in card.get("selectedRows") or []:
        actual = _actual_for_row(logs, row)
        settlement = _settlement_status(row, actual)
        settled_rows.append(
            {
                "slate_date": row.get("slate_date"),
                "selected_rank": row.get("selected_rank"),
                "player": row.get("player"),
                "team": row.get("team"),
                "team_name": row.get("team_name"),
                "opponent": row.get("opponent"),
                "opponent_name": row.get("opponent_name"),
                "market": row.get("market"),
                "side": row.get("side"),
                "line": row.get("line"),
                "actual": actual,
                "settlement": settlement,
                "model_probability": row.get("model_probability"),
                "final_score": row.get("final_score"),
                "source_book": row.get("source_book"),
                "source_url": row.get("source_url"),
            }
        )
    summary = _rollup(settled_rows)
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "cardGeneratedAt": card.get("generatedAt"),
        "slateDate": card.get("slateDate"),
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": summary,
        "rows": settled_rows,
    }


def write_settlement(result: dict[str, Any], out_prefix: str | Path) -> dict[str, str]:
    prefix = Path(out_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = prefix.with_suffix(".json")
    csv_path = prefix.with_suffix(".csv")
    md_path = prefix.with_suffix(".md")
    json_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    rows = result["rows"]
    if rows:
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    summary = result["summary"]
    lines = [
        "# WNBA Prop Settlement",
        "",
        f"Generated: {result['generatedAt']}",
        f"Slate: {result.get('slateDate')}",
        f"Settled: {summary['settledPicks']} / {summary['trackedPicks']}",
        f"Accuracy: {summary['accuracyPct'] if summary['accuracyPct'] is not None else 'pending'}",
        "",
        "## Rows",
        "",
    ]
    for row in rows:
        actual = "pending" if row["actual"] is None else row["actual"]
        lines.append(
            f"- {row['settlement']}: {row['player']} {row['side']} {row['market']} {row['line']} "
            f"(actual {actual})"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"json": str(json_path), "csv": str(csv_path), "md": str(md_path)}
