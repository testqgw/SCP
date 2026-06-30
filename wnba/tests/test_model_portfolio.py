from copy import deepcopy

from wnba_prop_model.model import PORTFOLIO_LIMITS, _select_portfolio, empty_card


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


def test_forced_fill_reaches_six_from_playable_current_rows_when_enabled() -> None:
    rows = [_row(str(index), f"Player {index}", str(index), "PTS", 0.32) for index in range(6)]
    for row in rows:
        row["tier"] = "D"
        row["model_probability"] = 0.54
        row["price_edge"] = -0.02
        row["fair_probability"] = 0.50
        row["side"] = "UNDER"
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_probability": 0.52,
            "forced_fill_min_score": 0.0,
        }
    )

    _select_portfolio(rows, limits)

    selected = [row for row in rows if row["model_action"] == "SELECTED"]
    assert len(selected) == 6
    assert all("forced_six_pick_fill" in row["risk_flags"] for row in selected)


def test_forced_fill_blocks_unresolved_or_unknown_context_rows() -> None:
    rows = [_row(str(index), f"Player {index}", str(index), "PTS", 0.50) for index in range(6)]
    for row in rows:
        row["tier"] = "D"
        row["model_probability"] = 0.58
        row["side"] = "UNDER"
        row["risk_flags"] = ["unknown_team_context"]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_probability": 0.52,
        }
    )

    _select_portfolio(rows, limits)

    assert [row for row in rows if row["model_action"] == "SELECTED"] == []


def test_forced_fill_prefers_sturdier_market_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    volatile_fill = _row("volatile", "Volatile Fill", "volatile", "THREES", 0.61)
    sturdy_fill = _row("sturdy", "Sturdy Fill", "sturdy", "PTS", 0.59)
    rows = standard_rows + [volatile_fill, sturdy_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    for row in [volatile_fill, sturdy_fill]:
        row["tier"] = "D"
        row["model_probability"] = 0.56
        row["fair_probability"] = 0.50
        row["price_edge"] = -0.01
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_same_team_counting_overs": 6,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_probability": 0.52,
        }
    )

    _select_portfolio(rows, limits)

    selected_players = [row["player"] for row in rows if row["model_action"] == "SELECTED"]
    assert "Sturdy Fill" in selected_players
    assert "Volatile Fill" not in selected_players


def test_empty_card_is_safe_for_no_slate_output() -> None:
    card = empty_card("2026-05-16", mode="NO_SLATE", warnings=["No ESPN WNBA games found."])

    assert card["slateDate"] == "2026-05-16"
    assert card["mode"] == "NO_SLATE"
    assert card["summary"]["selectedCount"] == 0
    assert card["summary"]["priceCoveragePct"] == 0.0
    assert card["boardRows"] == []
    assert card["selectedRows"] == []
    assert card["warnings"] == ["No ESPN WNBA games found."]
