from copy import deepcopy

from wnba_prop_model.model import PORTFOLIO_LIMITS, _select_portfolio


def _row(candidate_id: str, player: str, player_id: str, market: str, score: float) -> dict:
    return {
        "candidate_id": candidate_id,
        "model_action": "COVERAGE",
        "selected_rank": None,
        "rejection_reason": None,
        "final_score": score,
        "model_probability": 0.72,
        "abs_line_gap": 3.0,
        "tier": "A",
        "fair_probability": None,
        "price_edge": None,
        "risk_flags": [],
        "side": "UNDER",
        "over_odds": -110,
        "under_odds": -110,
        "source_odds": None,
        "source_book": "test book",
        "player_id": player_id,
        "player": player,
        "team": "IND",
        "matchup_key": "IND-WSH",
        "market": market,
    }


def test_portfolio_selects_one_pick_per_player() -> None:
    rows = [
        _row("a-pts", "Player A", "a", "PTS", 0.90),
        _row("a-reb", "Player A", "a", "REB", 0.88),
        _row("b-pts", "Player B", "b", "PTS", 0.84),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update({"max_picks": 3, "target_picks": 3, "max_per_player": 1})

    _select_portfolio(rows, limits)

    selected = [row for row in rows if row["model_action"] == "SELECTED"]
    assert [row["player"] for row in selected] == ["Player A", "Player B"]
    assert rows[1]["rejection_reason"] == "max_per_player"
