from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wnba_prop_model.model import PORTFOLIO_LIMITS, load_board, load_logs, score_board
from wnba_prop_model.settlement import settle_card

LOGS_PATH = ROOT / "data/raw/wnba_player_game_logs.csv"


def _side_odds(row: dict[str, Any]) -> float | None:
    return row.get("over_odds") if row.get("side") == "OVER" else row.get("under_odds")


def raw_pool_ceiling(rows: list[dict[str, Any]]) -> dict[str, Any]:
    settled = [
        row
        for row in rows
        if "fanduel" in str(row.get("source_book") or "").lower()
        and (row.get("side_odds") is not None or row.get("source_odds") is not None)
        and row.get("settlement") in {"WIN", "LOSS"}
    ]
    wins = [row for row in settled if row.get("settlement") == "WIN"]
    winning_players = {str(row.get("player") or "") for row in wins}
    return {
        "rawFanDuelSettledRows": len(settled),
        "rawFanDuelWinningRows": len(wins),
        "rawFanDuelWinningPlayers": len(winning_players),
        "rawCanHitSix": len(wins) >= 6,
        "rawCanHitSixUniquePlayers": len(winning_players) >= 6,
    }


def summarize_replay(daily_rows: list[dict[str, Any]]) -> dict[str, Any]:
    settled = [row for row in daily_rows if row.get("sixPickSettled")]
    parlay_wins = sum(1 for row in settled if row.get("sixPickParlayHit"))
    settled_legs = sum(int(row.get("settledLegs") or 0) for row in settled)
    leg_wins = sum(int(row.get("legWins") or 0) for row in settled)
    return {
        "datesEvaluated": len(daily_rows),
        "sixPickSettledDates": len(settled),
        "sixPickParlayWins": parlay_wins,
        "sixPickParlayAccuracyPct": round(100.0 * parlay_wins / len(settled), 2) if settled else None,
        "settledLegs": settled_legs,
        "legWins": leg_wins,
        "legAccuracyPct": round(100.0 * leg_wins / settled_legs, 2) if settled_legs else None,
        "rawImpossibleSixPickDates": sum(1 for row in settled if not row.get("rawCanHitSix")),
        "rawImpossibleSixUniquePlayerDates": sum(1 for row in settled if not row.get("rawCanHitSixUniquePlayers")),
    }


def _board_paths() -> list[tuple[str, Path]]:
    by_date: dict[str, Path] = {}
    for pattern in [
        "expanded_board_2026-*.csv",
        "fanduel_playable_board_2026-*.csv",
        "sportsgrid_fanduel_board_2026-*.csv",
        "sportsgrid_board_2026-*.csv",
        "scoresandodds_board_2026-*.csv",
    ]:
        for path in sorted((ROOT / "data/current").glob(pattern)):
            by_date.setdefault(path.stem.split("_")[-1], path)
    return sorted(by_date.items())


def _limits() -> dict[str, Any]:
    return {
        **PORTFOLIO_LIMITS,
        "max_picks": 6,
        "target_picks": 6,
        "min_score": 0.68,
        "required_source_book": "FanDuel",
        "require_playable_side_odds": True,
        "allow_source_consensus_leans": True,
        "allow_forced_six_pick_fill": True,
        "forced_fill_min_probability": 0.52,
        "max_per_game": 6,
        "sgp_tax_penalty_per_same_game_pair": 0.035,
        "exclude_single_side_prices": True,
        "exclude_rebound_unders": True,
        "market_side_score_adjustments": {"THREES:UNDER": 0.55},
    }


def run_replay_ceiling(date_to: str | None = None) -> dict[str, Any]:
    logs = load_logs(LOGS_PATH, include_preseason=True)
    limits = _limits()
    daily_rows: list[dict[str, Any]] = []
    for slate_date, board_path in _board_paths():
        if date_to and slate_date > date_to:
            continue
        try:
            card = score_board(logs, load_board(board_path, default_date=slate_date), slate_date=slate_date, limits=limits)
        except Exception as error:
            daily_rows.append({"slateDate": slate_date, "boardPath": str(board_path), "error": str(error)})
            continue

        settlement = settle_card(card, logs)
        selected_settled = [row for row in settlement["rows"] if row["settlement"] in {"WIN", "LOSS"}]
        raw_rows = []
        all_rows = []
        for index, row in enumerate(card["boardRows"], start=1):
            copy = dict(row)
            copy["selected_rank"] = index
            copy["side_odds"] = _side_odds(row)
            all_rows.append(copy)
        raw_settlement = settle_card({"generatedAt": card["generatedAt"], "slateDate": slate_date, "selectedRows": all_rows}, logs)
        for source, settled in zip(all_rows, raw_settlement["rows"]):
            raw_rows.append({**source, "settlement": settled["settlement"], "actual": settled["actual"]})
        ceiling = raw_pool_ceiling(raw_rows)
        leg_wins = sum(1 for row in selected_settled if row["settlement"] == "WIN")
        daily_rows.append(
            {
                "slateDate": slate_date,
                "boardPath": str(board_path.relative_to(ROOT)),
                "selectedCount": card["summary"]["selectedCount"],
                "settledLegs": len(selected_settled),
                "legWins": leg_wins,
                "sixPickSettled": len(selected_settled) == 6,
                "sixPickParlayHit": len(selected_settled) == 6 and leg_wins == 6,
                **ceiling,
            }
        )
    return {"summary": summarize_replay(daily_rows), "dailyRows": daily_rows}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit strict FanDuel replay results against raw-pool six-pick ceilings.")
    parser.add_argument("--date-to", default=None)
    parser.add_argument("--out", default="output/wnba-fanduel-replay-ceiling.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = run_replay_ceiling(date_to=args.date_to)
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
