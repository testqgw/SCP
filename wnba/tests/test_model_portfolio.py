from copy import deepcopy

from wnba_prop_model.model import PORTFOLIO_LIMITS, _select_portfolio, empty_card, score_board, write_card


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


def _write_score_fixture(tmp_path, same_game: bool = False) -> tuple:
    logs_path = tmp_path / "logs.csv"
    board_path = tmp_path / "board.csv"
    game_team = "NY" if same_game else None
    game_opponent = "CON" if same_game else None
    players = [
        ("1001", "Player One", game_team or "NY", game_opponent or "CON", "PTS", 12.5),
        ("1002", "Player Two", game_team or "LV", game_opponent or "LA", "REB", 4.5),
        ("1003", "Player Three", game_team or "SEA", game_opponent or "PHX", "AST", 3.5),
        ("1004", "Player Four", game_team or "MIN", game_opponent or "ATL", "THREES", 1.5),
        ("1005", "Player Five", game_team or "DAL", game_opponent or "CHI", "PRA", 24.5),
        ("1006", "Player Six", game_team or "WAS", game_opponent or "IND", "PA", 17.5),
    ]
    log_rows = [
        "game_date,game_id,player_id,player,team,opponent,minutes,points,rebounds,assists,threes,is_home,starter,position"
    ]
    for game_number in range(1, 13):
        date = f"2026-06-{game_number:02d}"
        for index, (player_id, player, team, opponent, *_rest) in enumerate(players, start=1):
            log_rows.append(
                f"{date},g{game_number}-{index},{player_id},{player},{team},{opponent},"
                "32,22,9,7,3,1,1,G"
            )
    board_rows = [
        "game_date,player,player_id,team,opponent,is_home,market,line,over_odds,under_odds,sportsbook_count,source_book,over_book,under_book,source_projection,source_pick"
    ]
    for player_id, player, team, opponent, market, line in players:
        board_rows.append(
            f"2026-07-03,{player},{player_id},{team},{opponent},1,{market},{line},+140,-165,1,FanDuel,FanDuel,FanDuel,30,OVER"
        )
    logs_path.write_text("\n".join(log_rows) + "\n", encoding="utf-8")
    board_path.write_text("\n".join(board_rows) + "\n", encoding="utf-8")
    from wnba_prop_model.model import load_board, load_logs

    return load_logs(logs_path, include_preseason=True), load_board(board_path)


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
    rejected_player_a_rows = [row for row in rows if row["player"] == "Player A" and row["model_action"] != "SELECTED"]
    assert len(rejected_player_a_rows) == 1
    assert rejected_player_a_rows[0]["rejection_reason"] == "max_per_player"


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


def test_forced_fill_blocks_negative_price_edge_when_fair_probability_exists() -> None:
    bad_price = _row("bad-price", "Bad Price", "bad", "PTS", 0.90)
    bad_price["fair_probability"] = 0.65
    bad_price["price_edge"] = -0.05
    good_price = _row("good-price", "Good Price", "good", "AST", 0.80)
    good_price["fair_probability"] = 0.55
    good_price["price_edge"] = 0.02
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.99,
            "allow_expanded_fill": False,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_score": 0.0,
            "forced_fill_min_probability": 0.0,
            "forced_fill_min_price_edge": 0.0,
        }
    )

    _select_portfolio([bad_price, good_price], limits)

    selected = [row["candidate_id"] for row in [bad_price, good_price] if row["model_action"] == "SELECTED"]
    assert selected == ["good-price"]
    assert bad_price["rejection_reason"] == "below_forced_fill_price_edge"


def test_selected_forced_fill_clears_prior_rejection_reason() -> None:
    row = _row("forced", "Forced", "forced", "PTS", 0.40)
    row["tier"] = "D"
    row["model_probability"] = 0.56
    row["source_pick"] = "OVER"
    row["source_projection"] = 1.0
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.99,
            "allow_source_consensus_leans": True,
            "min_consensus_probability": 0.60,
            "allow_expanded_fill": False,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_probability": 0.52,
        }
    )

    _select_portfolio([row], limits)

    assert row["model_action"] == "SELECTED"
    assert row["rejection_reason"] is None


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
    sturdy_fill = _row("sturdy", "Sturdy Fill", "sturdy", "REB", 0.59)
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


def test_forced_fill_prefers_clean_projection_over_near_line_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    near_line_fill = _row("near-line", "Near Line Fill", "near-line", "PTS", 0.61)
    clean_fill = _row("clean", "Clean Fill", "clean", "REB", 0.58)
    rows = standard_rows + [near_line_fill, clean_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    near_line_fill["tier"] = "D"
    near_line_fill["model_probability"] = 0.56
    near_line_fill["fair_probability"] = 0.50
    near_line_fill["price_edge"] = -0.01
    near_line_fill["risk_flags"] = ["source_projection_near_line"]
    clean_fill["tier"] = "D"
    clean_fill["model_probability"] = 0.56
    clean_fill["fair_probability"] = 0.50
    clean_fill["price_edge"] = -0.01
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
    assert "Clean Fill" in selected_players
    assert "Near Line Fill" not in selected_players


def test_forced_fill_prefers_clean_projection_over_disagreement_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    disagreement_fill = _row("disagreement", "Disagreement Fill", "disagreement", "PTS", 0.63)
    clean_fill = _row("clean", "Clean Fill", "clean", "REB", 0.58)
    rows = standard_rows + [disagreement_fill, clean_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    disagreement_fill["tier"] = "D"
    disagreement_fill["model_probability"] = 0.56
    disagreement_fill["fair_probability"] = 0.50
    disagreement_fill["price_edge"] = -0.01
    disagreement_fill["risk_flags"] = ["source_projection_disagreement"]
    clean_fill["tier"] = "D"
    clean_fill["model_probability"] = 0.56
    clean_fill["fair_probability"] = 0.50
    clean_fill["price_edge"] = -0.01
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
    assert "Clean Fill" in selected_players
    assert "Disagreement Fill" not in selected_players


def test_forced_fill_prefers_stable_market_over_pts_under_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    points_under_fill = _row("points-under", "Points Under Fill", "points-under", "PTS", 0.61)
    stable_fill = _row("stable", "Stable Fill", "stable", "REB", 0.58)
    rows = standard_rows + [points_under_fill, stable_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    for row in [points_under_fill, stable_fill]:
        row["tier"] = "D"
        row["model_probability"] = 0.56
        row["fair_probability"] = 0.50
        row["price_edge"] = -0.01
    points_under_fill["side"] = "UNDER"
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
    assert "Stable Fill" in selected_players
    assert "Points Under Fill" not in selected_players


def test_forced_fill_prefers_stable_market_over_pra_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    pra_fill = _row("pra", "PRA Fill", "pra", "PRA", 0.62)
    stable_fill = _row("stable", "Stable Fill", "stable", "REB", 0.58)
    rows = standard_rows + [pra_fill, stable_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    for row in [pra_fill, stable_fill]:
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
    assert "Stable Fill" in selected_players
    assert "PRA Fill" not in selected_players


def test_forced_fill_prefers_stable_market_over_threes_over_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    threes_over_fill = _row("threes-over", "Threes Over Fill", "threes-over", "THREES", 0.66)
    stable_fill = _row("stable", "Stable Fill", "stable", "REB", 0.58)
    rows = standard_rows + [threes_over_fill, stable_fill]
    for row in standard_rows:
        row["tier"] = "A"
        row["model_probability"] = 0.68
    for row in [threes_over_fill, stable_fill]:
        row["tier"] = "D"
        row["model_probability"] = 0.56
        row["fair_probability"] = 0.50
        row["price_edge"] = -0.01
    threes_over_fill["side"] = "OVER"
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
    assert "Stable Fill" in selected_players
    assert "Threes Over Fill" not in selected_players


def test_standard_selection_prefers_stable_market_over_pra_under_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    pra_under = _row("pra-under", "PRA Under", "pra-under", "PRA", 0.72)
    stable = _row("stable", "Stable", "stable", "REB", 0.69)
    rows = standard_rows + [pra_under, stable]
    pra_under["tier"] = "B"
    pra_under["side"] = "UNDER"
    stable["tier"] = "B"
    for row in rows:
        row["model_probability"] = 0.64
        row["fair_probability"] = 0.55
        row["price_edge"] = 0.04
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_same_team_counting_overs": 6,
        }
    )

    _select_portfolio(rows, limits)

    selected_players = [row["player"] for row in rows if row["model_action"] == "SELECTED"]
    assert "Stable" in selected_players
    assert "PRA Under" not in selected_players


def test_standard_pra_under_penalty_can_be_disabled() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    pra_under = _row("pra-under", "PRA Under", "pra-under", "PRA", 0.72)
    stable = _row("stable", "Stable", "stable", "REB", 0.69)
    rows = standard_rows + [pra_under, stable]
    pra_under["tier"] = "B"
    pra_under["side"] = "UNDER"
    stable["tier"] = "B"
    for row in rows:
        row["model_probability"] = 0.64
        row["fair_probability"] = 0.55
        row["price_edge"] = 0.04
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_same_team_counting_overs": 6,
            "standard_pra_under_penalty": 0.0,
        }
    )

    _select_portfolio(rows, limits)

    selected_players = [row["player"] for row in rows if row["model_action"] == "SELECTED"]
    assert "PRA Under" in selected_players
    assert "Stable" not in selected_players


def test_standard_selection_prefers_stable_minutes_when_scores_are_close() -> None:
    standard_rows = [_row(f"standard-{index}", f"Standard {index}", f"s{index}", "AST", 0.80) for index in range(5)]
    volatile = _row("volatile", "Volatile", "volatile", "REB", 0.72)
    stable = _row("stable", "Stable", "stable", "REB", 0.69)
    rows = standard_rows + [volatile, stable]
    volatile["tier"] = "B"
    volatile["risk_flags"] = ["volatile_minutes"]
    stable["tier"] = "B"
    for row in rows:
        row["model_probability"] = 0.64
        row["fair_probability"] = 0.55
        row["price_edge"] = 0.04
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_same_team_counting_overs": 6,
        }
    )

    _select_portfolio(rows, limits)

    selected_players = [row["player"] for row in rows if row["model_action"] == "SELECTED"]
    assert "Stable" in selected_players
    assert "Volatile" not in selected_players


def test_portfolio_replaces_blocked_unavailable_candidate() -> None:
    rows = [
        _row("blocked", "Blocked Player", "blocked", "PTS", 0.99),
        _row("a", "Player A", "a", "PTS", 0.95),
        _row("b", "Player B", "b", "RA", 0.94),
        _row("c", "Player C", "c", "AST", 0.93),
        _row("d", "Player D", "d", "THREES", 0.92),
        _row("e", "Player E", "e", "PRA", 0.91),
        _row("replacement", "Replacement Player", "replacement", "PA", 0.90),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "max_per_team": 7,
            "max_per_game": 7,
            "max_per_market": 7,
            "max_combo_markets": 7,
            "max_same_team_counting_overs": 7,
            "blocked_candidate_ids": {"blocked"},
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert "blocked" not in selected
    assert "replacement" in selected
    assert len(selected) == 6
    assert rows[0]["rejection_reason"] == "unavailable_live_prop"


def test_portfolio_blocks_unavailable_player_market_wildcard() -> None:
    rows = [
        _row("2026-07-03:2529458:PR:13.5", "Cheyenne Parker-Tyus", "2529458", "PR", 0.95),
        _row("replacement", "Replacement Player", "replacement", "PTS", 0.80),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "max_per_team": 2,
            "max_per_game": 2,
            "blocked_candidate_ids": {"2026-07-03:2529458:PR:*"},
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert selected == ["replacement"]
    assert rows[0]["rejection_reason"] == "unavailable_live_prop"


def test_portfolio_blocks_unavailable_player_market_wildcard_with_decimal_player_id() -> None:
    rows = [
        _row("2026-07-06:5220150.0:REB:8.5", "Dominique Malonga", "5220150.0", "REB", 0.95),
        _row("replacement", "Replacement Player", "replacement", "PTS", 0.80),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "max_per_team": 2,
            "max_per_game": 2,
            "blocked_candidate_ids": {"2026-07-06:5220150:REB:*"},
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert selected == ["replacement"]
    assert rows[0]["rejection_reason"] == "unavailable_live_prop"


def test_portfolio_blocks_unavailable_player_market_wildcard_by_name_when_row_has_player_id() -> None:
    rows = [
        _row("2026-07-07:5220150:REB:8.5", "Dominique Malonga", "5220150", "REB", 0.95),
        _row("replacement", "Replacement Player", "replacement", "PTS", 0.80),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "max_per_team": 2,
            "max_per_game": 2,
            "blocked_candidate_ids": {"2026-07-07:dominique malonga:REB:*"},
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert selected == ["replacement"]
    assert rows[0]["rejection_reason"] == "unavailable_live_prop"


def test_portfolio_replaces_single_side_price_when_excluded() -> None:
    rows = [
        _row("thin", "Thin Price Player", "thin", "PTS", 0.99),
        _row("a", "Player A", "a", "PTS", 0.95),
        _row("b", "Player B", "b", "RA", 0.94),
        _row("c", "Player C", "c", "AST", 0.93),
        _row("d", "Player D", "d", "THREES", 0.92),
        _row("e", "Player E", "e", "PRA", 0.91),
        _row("replacement", "Replacement Player", "replacement", "PA", 0.90),
    ]
    rows[0]["risk_flags"] = ["single_side_price", "thin_market_count"]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "max_per_team": 7,
            "max_per_game": 7,
            "max_per_market": 7,
            "max_combo_markets": 7,
            "max_same_team_counting_overs": 7,
            "exclude_single_side_prices": True,
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert "thin" not in selected
    assert "replacement" in selected
    assert len(selected) == 6
    assert rows[0]["rejection_reason"] == "single_side_price_excluded"


def test_portfolio_allows_pick_side_only_fanduel_price_when_enabled() -> None:
    row = _row("sportsgrid-fd", "SportsGrid FanDuel", "fd", "PTS", 0.90)
    row["source_book"] = "FanDuel"
    row["source_pick"] = "UNDER"
    row["source_odds"] = -112
    row["under_odds"] = None
    row["risk_flags"] = ["single_side_price", "thin_market_count"]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "exclude_single_side_prices": True,
            "allow_pick_side_only_prices": True,
        }
    )

    _select_portfolio([row], limits)

    assert row["model_action"] == "SELECTED"
    assert row["rejection_reason"] is None


def test_source_consensus_blocks_negative_price_edge_when_floor_is_set() -> None:
    bad_price = _row("bad-consensus", "Bad Consensus", "bad-consensus", "THREES", 0.50)
    bad_price["tier"] = "D"
    bad_price["model_probability"] = 0.62
    bad_price["source_book"] = "FanDuel"
    bad_price["source_pick"] = "UNDER"
    bad_price["source_projection"] = 1.5
    bad_price["fair_probability"] = 0.67
    bad_price["price_edge"] = -0.05
    good_price = _row("good-consensus", "Good Consensus", "good-consensus", "PA", 0.42)
    good_price["tier"] = "D"
    good_price["model_probability"] = 0.61
    good_price["source_book"] = "FanDuel"
    good_price["source_pick"] = "UNDER"
    good_price["source_projection"] = 14.0
    good_price["fair_probability"] = 0.55
    good_price["price_edge"] = 0.06
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.99,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_source_consensus_leans": True,
            "min_consensus_score": 0.25,
            "min_consensus_probability": 0.60,
            "min_consensus_price_edge": 0.0,
        }
    )

    _select_portfolio([bad_price, good_price], limits)

    selected = [row["candidate_id"] for row in [bad_price, good_price] if row["model_action"] == "SELECTED"]
    assert selected == ["good-consensus"]
    assert bad_price["rejection_reason"] == "below_consensus_price_edge"


def test_portfolio_replaces_rebound_unders_when_excluded() -> None:
    rows = [
        _row("reb-under", "Rebound Under Player", "reb-under", "REB", 0.99),
        _row("a", "Player A", "a", "PTS", 0.95),
        _row("b", "Player B", "b", "RA", 0.94),
        _row("c", "Player C", "c", "AST", 0.93),
        _row("d", "Player D", "d", "THREES", 0.92),
        _row("e", "Player E", "e", "PRA", 0.91),
        _row("replacement", "Replacement Player", "replacement", "PA", 0.90),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "max_per_team": 7,
            "max_per_game": 7,
            "max_per_market": 7,
            "max_combo_markets": 7,
            "max_same_team_counting_overs": 7,
            "exclude_rebound_unders": True,
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert "reb-under" not in selected
    assert "replacement" in selected
    assert len(selected) == 6
    assert rows[0]["rejection_reason"] == "rebound_under_excluded"


def test_fanduel_gate_accepts_scoresandodds_row_when_pick_side_book_is_fanduel() -> None:
    fanduel_side = _row("fd-side", "FanDuel Side", "fd", "PTS", 0.90)
    fanduel_side["source_book"] = "ScoresAndOdds Best Odds"
    fanduel_side["side"] = "OVER"
    fanduel_side["over_book"] = "FanDuel"
    fanduel_side["under_book"] = "DraftKings"
    other_book_side = _row("other-side", "Other Side", "other", "PTS", 0.89)
    other_book_side["source_book"] = "ScoresAndOdds Best Odds"
    other_book_side["side"] = "OVER"
    other_book_side["over_book"] = "DraftKings"
    other_book_side["under_book"] = "FanDuel"
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
        }
    )

    _select_portfolio([fanduel_side, other_book_side], limits)

    assert fanduel_side["model_action"] == "SELECTED"
    assert other_book_side["model_action"] == "COVERAGE"
    assert other_book_side["rejection_reason"] == "not_fanduel_sourced"


def test_score_board_preserves_pick_side_book_for_fanduel_gate(tmp_path) -> None:
    logs_path = tmp_path / "logs.csv"
    board_path = tmp_path / "board.csv"
    logs_path.write_text(
        "\n".join(
            ["game_date,game_id,player_id,player,team,opponent,minutes,points,rebounds,assists,threes,is_home,starter,position"]
            + [
                f"2026-06-{day:02d},g{day},1001,Test Player,NY,CON,31,20,4,3,2,1,1,G"
                for day in range(1, 13)
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    board_path.write_text(
        "\n".join(
            [
                "game_date,player,player_id,team,opponent,is_home,market,line,over_odds,under_odds,sportsbook_count,source_book,over_book,under_book",
                "2026-07-03,Test Player,1001,NY,CON,1,PTS,12.5,-110,-110,1,ScoresAndOdds Best Odds,FanDuel,DraftKings",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    from wnba_prop_model.model import load_board, load_logs

    card = score_board(
        load_logs(logs_path, include_preseason=True),
        load_board(board_path),
        slate_date="2026-07-03",
        limits={
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_forced_six_pick_fill": True,
            "forced_fill_min_probability": 0.0,
        },
    )

    assert card["selectedRows"][0]["player"] == "Test Player"
    assert card["selectedRows"][0]["source_book"] == "FanDuel"
    assert card["selectedRows"][0]["over_book"] == "FanDuel"


def test_market_side_score_adjustment_can_promote_replay_learned_bucket() -> None:
    rows = [
        _row("pts", "Points Player", "pts", "PTS", 0.90),
        _row("threes-under", "Shooter", "shooter", "THREES", 0.40),
    ]
    limits = deepcopy(PORTFOLIO_LIMITS)
    limits.update(
        {
            "max_picks": 1,
            "target_picks": 1,
            "min_score": 0.0,
            "market_side_score_adjustments": {"THREES:UNDER": 0.55},
        }
    )

    _select_portfolio(rows, limits)

    selected = [row["candidate_id"] for row in rows if row["model_action"] == "SELECTED"]
    assert selected == ["threes-under"]
    assert rows[1]["selection_score_adjustment"] == 0.55


def test_empty_card_is_safe_for_no_slate_output() -> None:
    card = empty_card("2026-05-16", mode="NO_SLATE", warnings=["No ESPN WNBA games found."])

    assert card["slateDate"] == "2026-05-16"
    assert card["mode"] == "NO_SLATE"
    assert card["summary"]["selectedCount"] == 0
    assert card["summary"]["priceCoveragePct"] == 0.0
    assert card["boardRows"] == []
    assert card["selectedRows"] == []
    assert card["warnings"] == ["No ESPN WNBA games found."]


def test_fanduel_live_card_is_labeled_experimental_and_separate_from_archive_proof(tmp_path) -> None:
    logs, board = _write_score_fixture(tmp_path)

    card = score_board(
        logs,
        board,
        slate_date="2026-07-03",
        limits={
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_source_consensus_leans": True,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_combo_markets": 6,
            "max_same_team_counting_overs": 6,
        },
    )

    assert card["executionProfile"]["mode"] == "FANDUEL_LIVE"
    assert card["executionProfile"]["status"] == "EXPERIMENTAL"
    assert card["executionProfile"]["inheritsArchiveProof"] is False
    assert card["proofContext"]["archiveSelector"]["sixPickParlayAccuracyPct"] == 51.85
    assert card["proofContext"]["fanDuelStrictShadow"]["sixPickParlayAccuracyPct"] == 60.0
    assert any("FanDuel-live card is experimental" in warning for warning in card["warnings"])


def test_score_board_reports_sgp_exposure_for_same_game_cards(tmp_path) -> None:
    logs, board = _write_score_fixture(tmp_path, same_game=True)

    card = score_board(
        logs,
        board,
        slate_date="2026-07-03",
        limits={
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_source_consensus_leans": True,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_combo_markets": 6,
            "max_same_team_counting_overs": 6,
        },
    )

    assert card["parlayPlan"]["isComplete"] is True
    assert card["parlayPlan"]["sgpExposure"]["maxSameGameLegs"] == 6
    assert card["parlayPlan"]["sgpExposure"]["sameGamePairs"] == 15
    assert card["parlayPlan"]["sgpExposure"]["requiresSameGameParlayPricing"] is True
    assert card["parlayPlan"]["sgpExposure"]["riskLevel"] == "HIGH"
    assert card["parlayPlan"]["sgpExposure"]["estimatedSgpTaxMultiplier"] < 1.0
    assert (
        card["parlayPlan"]["sgpExposure"]["estimatedTaxedIndependentProbability"]
        < card["parlayPlan"]["independentModelProbability"]
    )
    assert card["summary"]["sgpRiskLevel"] == "HIGH"


def test_write_card_uses_lf_csv_line_endings(tmp_path) -> None:
    logs, board = _write_score_fixture(tmp_path)
    card = score_board(
        logs,
        board,
        slate_date="2026-07-03",
        limits={
            "max_picks": 6,
            "target_picks": 6,
            "min_score": 0.0,
            "required_source_book": "FanDuel",
            "require_playable_side_odds": True,
            "allow_source_consensus_leans": True,
            "max_per_team": 6,
            "max_per_game": 6,
            "max_per_market": 6,
            "max_combo_markets": 6,
            "max_same_team_counting_overs": 6,
        },
    )

    paths = write_card(card, tmp_path / "card")

    assert b"\r\n" not in (tmp_path / "card.csv").read_bytes()
    assert paths["csv"].endswith("card.csv")


def test_write_card_serializes_blocked_candidate_ids(tmp_path) -> None:
    card = empty_card("2026-07-03", limits={"blocked_candidate_ids": {"blocked-id"}})

    paths = write_card(card, tmp_path / "card")

    assert paths["json"].endswith("card.json")
