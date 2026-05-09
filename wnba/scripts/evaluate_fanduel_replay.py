from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wnba_prop_model.model import load_board, load_logs, score_board
from wnba_prop_model.settlement import settle_card

LOGS_PATH = ROOT / "data/raw/wnba_player_game_logs.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay settled FanDuel WNBA prop boards with the current selector.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--board", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--max-picks", type=int, default=6)
    parser.add_argument("--min-score", type=float, default=0.68)
    return parser.parse_args()


def default_board_path(target_date: str) -> Path:
    candidates = [
        ROOT / f"data/current/sportsgrid_board_{target_date}.csv",
        ROOT / f"data/current/sportsgrid_fanduel_board_{target_date}.csv",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError(f"No SportsGrid FanDuel board found for {target_date}.")


def main() -> int:
    args = parse_args()
    board_path = Path(args.board) if args.board else default_board_path(args.date)
    logs = load_logs(LOGS_PATH, include_preseason=True)
    board = load_board(board_path, default_date=args.date)
    card = score_board(
        logs,
        board,
        slate_date=args.date,
        limits={
            "max_picks": args.max_picks,
            "min_score": args.min_score,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_source_consensus_leans": True,
        },
    )
    settlement = settle_card(card, logs)
    selected = [
        {
            "rank": row["selected_rank"],
            "player": row["player"],
            "market": row["market"],
            "side": row["side"],
            "line": row["line"],
            "actual": row["actual"],
            "settlement": row["settlement"],
            "model_probability": row["model_probability"],
            "final_score": row["final_score"],
        }
        for row in settlement["rows"]
    ]
    result = {
        "date": args.date,
        "boardPath": str(board_path),
        "modelVersion": card["modelVersion"],
        "selectedCount": card["summary"]["selectedCount"],
        "candidateCount": card["summary"]["candidateCount"],
        "settlement": settlement["summary"],
        "selected": selected,
    }
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
