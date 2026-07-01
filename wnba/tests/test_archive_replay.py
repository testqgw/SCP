import json
from copy import deepcopy
from pathlib import Path

import pandas as pd

from wnba_prop_model.cli import parse_args
from wnba_prop_model.archive_replay import (
    _ml_sweep_sort_key,
    _sweep_sort_key,
    daily_six_pick_limits,
    default_archive_profiles,
    replay_archived_cards,
    rerank_current_card_with_archive_ml,
    sweep_archive_ml_ranker_limits,
    sweep_archive_profiles,
    walk_forward_archive_ml_limit_profiles,
    walk_forward_archive_profiles,
    walk_forward_archive_ml_ranker,
)
from wnba_prop_model.model import PORTFOLIO_LIMITS


def _row(candidate_id: str, player: str, player_id: str, market: str, side: str, score: float) -> dict:
    return {
        "candidate_id": candidate_id,
        "slate_date": "2026-06-30",
        "model_action": "COVERAGE",
        "selected_rank": None,
        "rejection_reason": None,
        "final_score": score,
        "model_probability": 0.72,
        "abs_line_gap": 3.0,
        "tier": "A",
        "fair_probability": 0.55,
        "price_edge": 0.04,
        "risk_flags": [],
        "side": side,
        "line": 5.5,
        "over_odds": -110,
        "under_odds": -110,
        "source_odds": None,
        "source_book": "test book",
        "source_url": "https://example.test/props",
        "player_id": player_id,
        "player": player,
        "team": "IND",
        "team_name": "Indiana Fever",
        "opponent": "WSH",
        "opponent_name": "Washington Mystics",
        "matchup_key": "IND-WSH",
        "market": market,
    }


def _card(rows: list[dict], limits: dict | None = None) -> dict:
    active_limits = deepcopy(PORTFOLIO_LIMITS)
    active_limits.update(
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
    active_limits.update(limits or {})
    return {
        "generatedAt": "2026-06-30T20:00:00Z",
        "mode": "TEST",
        "slateDate": "2026-06-30",
        "portfolioConfig": active_limits,
        "boardRows": rows,
        "selectedRows": [],
    }


def _logs() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "game_date": pd.Timestamp("2026-06-30"),
                "player_id": str(index),
                "player_key": f"player {index}",
                "team_abbr": "IND",
                "opponent_abbr": "WSH",
                "PTS": 10.0,
                "REB": 4.0,
                "AST": 1.0,
                "THREES": 0.0,
                "PRA": 15.0,
                "PA": 11.0,
                "PR": 14.0,
                "RA": 5.0,
            }
            for index in range(7)
        ]
    )


def _market_learning_logs(dates: list[str]) -> pd.DataFrame:
    rows = []
    for slate_date in dates:
        for index in range(12):
            rows.append(
                {
                    "game_date": pd.Timestamp(slate_date),
                    "player_id": str(index),
                    "player_key": f"player {index}",
                    "team_abbr": "IND",
                    "opponent_abbr": "WSH",
                    "PTS": 10.0,
                    "REB": 2.0,
                    "AST": 3.0,
                    "THREES": 0.0,
                    "PRA": 15.0,
                    "PA": 13.0,
                    "PR": 12.0,
                    "RA": 5.0,
                }
            )
    return pd.DataFrame(rows)


def _market_flip_logs(training_dates: list[str], eval_dates: str | list[str]) -> pd.DataFrame:
    rows = []
    eval_date_set = {eval_dates} if isinstance(eval_dates, str) else set(eval_dates)
    for slate_date in [*training_dates, *sorted(eval_date_set)]:
        is_eval = slate_date in eval_date_set
        for index in range(12):
            rows.append(
                {
                    "game_date": pd.Timestamp(slate_date),
                    "player_id": str(index),
                    "player_key": f"player {index}",
                    "team_abbr": "IND",
                    "opponent_abbr": "WSH",
                    "PTS": 10.0 if is_eval else 15.0,
                    "REB": 2.0 if is_eval else 8.0,
                    "AST": 3.0 if is_eval else 1.0,
                    "THREES": 0.0,
                    "PRA": 15.0,
                    "PA": 13.0,
                    "PR": 12.0,
                    "RA": 5.0,
                }
            )
    return pd.DataFrame(rows)


def _market_learning_card(slate_date: str) -> dict:
    rows = []
    for index in range(6):
        row = _row(f"{slate_date}-ast-{index}", f"Player {index}", str(index), "AST", "UNDER", 0.88)
        row["slate_date"] = slate_date
        row["line"] = 1.5
        rows.append(row)
    for index in range(6, 9):
        row = _row(f"{slate_date}-reb-{index}", f"Player {index}", str(index), "REB", "UNDER", 0.70)
        row["slate_date"] = slate_date
        row["line"] = 5.5
        rows.append(row)
    for index in range(9, 12):
        row = _row(f"{slate_date}-pts-{index}", f"Player {index}", str(index), "PTS", "UNDER", 0.70)
        row["slate_date"] = slate_date
        row["line"] = 12.5
        rows.append(row)
    card = _card(rows)
    card["slateDate"] = slate_date
    return card


def _same_player_fill_logs(dates: list[str]) -> pd.DataFrame:
    rows = []
    for slate_date in dates:
        for index in range(4):
            rows.append(
                {
                    "game_date": pd.Timestamp(slate_date),
                    "player_id": str(index),
                    "player_key": f"player {index}",
                    "team_abbr": "IND",
                    "opponent_abbr": "WSH",
                    "PTS": 10.0,
                    "REB": 2.0,
                    "AST": 3.0,
                    "THREES": 0.0,
                    "PRA": 15.0,
                    "PA": 13.0,
                    "PR": 12.0,
                    "RA": 5.0,
                }
            )
    return pd.DataFrame(rows)


def _same_player_fill_card(slate_date: str) -> dict:
    rows = []
    for index in range(4):
        ast = _row(f"{slate_date}-ast-{index}", f"Player {index}", str(index), "AST", "UNDER", 0.88)
        ast["slate_date"] = slate_date
        ast["line"] = 1.5
        rows.append(ast)
    for index in range(4):
        reb = _row(f"{slate_date}-reb-{index}", f"Player {index}", str(index), "REB", "UNDER", 0.70)
        reb["slate_date"] = slate_date
        reb["line"] = 5.5
        rows.append(reb)
    card = _card(rows)
    card["slateDate"] = slate_date
    return card


def test_archive_replay_reselects_with_current_selector_and_settles(tmp_path: Path) -> None:
    archive_dir = tmp_path / "archive" / "2026-06-30"
    archive_dir.mkdir(parents=True)
    standard_rows = [_row(f"standard-{index}", f"Player {index}", str(index), "AST", "UNDER", 0.80) for index in range(5)]
    fragile_fill = _row("fragile", "Player 5", "5", "PTS", "UNDER", 0.61)
    stable_fill = _row("stable", "Player 6", "6", "REB", "UNDER", 0.58)
    fragile_fill["tier"] = "D"
    stable_fill["tier"] = "D"
    fragile_fill["risk_flags"] = ["forced_six_pick_fill", "same_game_concentration"]
    (archive_dir / "current-card.json").write_text(
        json.dumps(_card(standard_rows + [fragile_fill, stable_fill])),
        encoding="utf-8",
    )

    replay = replay_archived_cards(tmp_path / "archive", _logs())

    daily = replay["dailyRows"][0]
    selected_players = [row["player"] for row in replay["selectedRows"]]
    stable_row = next(row for row in replay["selectedRows"] if row["player"] == "Player 6")
    assert daily["selectedCount"] == 6
    assert daily["wins"] == 6
    assert daily["sixPickParlayHit"] is True
    assert "Player 6" in selected_players
    assert "Player 5" not in selected_players
    assert stable_row["risk_flags"] == ["forced_six_pick_fill", "same_game_concentration"]


def test_archive_profile_sweep_ranks_better_six_pick_profile_first(tmp_path: Path) -> None:
    archive_dir = tmp_path / "archive" / "2026-06-30"
    archive_dir.mkdir(parents=True)
    standard_rows = [_row(f"standard-{index}", f"Player {index}", str(index), "AST", "UNDER", 0.80) for index in range(5)]
    loose_forced_loss = _row("loose-loss", "Player 5", "5", "REB", "UNDER", 0.61)
    strict_forced_win = _row("strict-win", "Player 6", "6", "REB", "UNDER", 0.58)
    for row in [loose_forced_loss, strict_forced_win]:
        row["tier"] = "D"
    loose_forced_loss["model_probability"] = 0.52
    strict_forced_win["model_probability"] = 0.56
    (archive_dir / "current-card.json").write_text(
        json.dumps(_card(standard_rows + [loose_forced_loss, strict_forced_win])),
        encoding="utf-8",
    )
    logs = _logs()
    logs.loc[logs["player_id"] == "5", "REB"] = 10.0
    profiles = [
        {"name": "loose", "limits": {"forced_fill_min_probability": 0.50}},
        {"name": "strict", "limits": {"forced_fill_min_probability": 0.55}},
    ]

    sweep = sweep_archive_profiles(tmp_path / "archive", logs, profiles=profiles)

    assert [row["profileName"] for row in sweep["profiles"]] == ["strict", "loose"]
    assert sweep["profiles"][0]["summary"]["sixPickParlayAccuracyPct"] == 100.0
    assert sweep["profiles"][1]["summary"]["sixPickParlayAccuracyPct"] == 0.0


def test_walk_forward_archive_profiles_choose_profile_from_prior_cards(tmp_path: Path) -> None:
    profiles = [
        {"name": "loose", "limits": {"forced_fill_min_probability": 0.50}},
        {"name": "strict", "limits": {"forced_fill_min_probability": 0.55}},
    ]
    for slate_date in ["2026-06-29", "2026-06-30"]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        standard_rows = [
            _row(f"{slate_date}-standard-{index}", f"Player {index}", str(index), "AST", "UNDER", 0.80)
            for index in range(5)
        ]
        loose_forced_loss = _row(f"{slate_date}-loose-loss", "Player 5", "5", "REB", "UNDER", 0.61)
        strict_forced_win = _row(f"{slate_date}-strict-win", "Player 6", "6", "REB", "UNDER", 0.58)
        for row in [loose_forced_loss, strict_forced_win]:
            row["tier"] = "D"
        loose_forced_loss["model_probability"] = 0.52
        strict_forced_win["model_probability"] = 0.56
        card = _card(standard_rows + [loose_forced_loss, strict_forced_win])
        card["slateDate"] = slate_date
        (archive_dir / "current-card.json").write_text(json.dumps(card), encoding="utf-8")
    logs = _logs()
    logs.loc[logs["player_id"] == "5", "REB"] = 10.0

    walk_forward = walk_forward_archive_profiles(
        tmp_path / "archive",
        logs,
        profiles=profiles,
        min_training_cards=1,
    )

    assert walk_forward["summary"]["cardsEvaluated"] == 1
    assert walk_forward["summary"]["sixPickParlayAccuracyPct"] == 100.0
    assert walk_forward["dailyRows"][0]["selectedProfileName"] == "strict"
    assert walk_forward["dailyRows"][0]["sixPickParlayHit"] is True
    assert {row["selectedProfileName"] for row in walk_forward["selectedRows"]} == {"strict"}


def test_walk_forward_archive_ml_ranker_learns_from_prior_candidate_rows(tmp_path: Path) -> None:
    for slate_date in ["2026-06-29", "2026-06-30"]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_market_learning_card(slate_date)),
            encoding="utf-8",
        )

    walk_forward = walk_forward_archive_ml_ranker(
        tmp_path / "archive",
        _market_learning_logs(["2026-06-29", "2026-06-30"]),
        min_training_cards=1,
        min_training_rows=12,
    )

    assert walk_forward["summary"]["cardsEvaluated"] == 1
    assert walk_forward["summary"]["sixPickParlayAccuracyPct"] == 100.0
    assert {row["market"] for row in walk_forward["selectedRows"]} == {"PTS", "REB"}
    assert all(row["learnedHitProbability"] > 0.5 for row in walk_forward["selectedRows"])


def test_rerank_current_card_with_archive_ml_uses_prior_archive_rows(tmp_path: Path) -> None:
    for slate_date in ["2026-06-28", "2026-06-29"]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_market_learning_card(slate_date)),
            encoding="utf-8",
        )
    current = _market_learning_card("2026-06-30")

    reranked = rerank_current_card_with_archive_ml(
        current,
        tmp_path / "archive",
        _market_learning_logs(["2026-06-28", "2026-06-29", "2026-06-30"]),
        min_training_cards=1,
        min_training_rows=12,
    )

    assert reranked["mode"] == "TEST_ARCHIVE_ML_RERANK"
    assert reranked["summary"]["selectedCount"] == 6
    assert {row["market"] for row in reranked["selectedRows"]} == {"PTS", "REB"}
    assert reranked["archiveMlProfile"]["profileName"].endswith("sameplayerfill")
    assert all("learnedHitProbability" in row for row in reranked["selectedRows"])


def test_rerank_current_card_with_archive_ml_auto_fills_when_profile_selects_short(tmp_path: Path) -> None:
    for slate_date in ["2026-06-28", "2026-06-29"]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_market_learning_card(slate_date)),
            encoding="utf-8",
        )
    current = _market_learning_card("2026-06-30")
    strict_profile = [
        {
            "name": "strict_market_cap",
            "limits": {
                "max_picks": 6,
                "target_picks": 6,
                "max_per_player": 0,
                "max_per_market": 1,
                "max_combo_markets": 1,
                "allow_forced_six_pick_fill": False,
            },
        }
    ]

    reranked = rerank_current_card_with_archive_ml(
        current,
        tmp_path / "archive",
        _market_learning_logs(["2026-06-28", "2026-06-29", "2026-06-30"]),
        profiles=strict_profile,
        min_training_cards=1,
        min_training_rows=12,
    )

    assert reranked["summary"]["selectedCount"] == 6
    assert reranked["archiveMlProfile"]["profileName"] == "strict_market_cap_auto_sameplayerfill"
    assert any("same_player_coverage_fill" in row.get("risk_flags", []) for row in reranked["selectedRows"])


def test_walk_forward_archive_ml_ranker_can_fill_same_player_coverage(tmp_path: Path) -> None:
    for slate_date in ["2026-06-29", "2026-06-30"]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_same_player_fill_card(slate_date)),
            encoding="utf-8",
        )
    logs = _same_player_fill_logs(["2026-06-29", "2026-06-30"])

    no_fill = walk_forward_archive_ml_ranker(
        tmp_path / "archive",
        logs,
        min_training_cards=1,
        min_training_rows=8,
    )
    with_fill = walk_forward_archive_ml_ranker(
        tmp_path / "archive",
        logs,
        limits={**daily_six_pick_limits(), "allow_same_player_coverage_fill": True},
        min_training_cards=1,
        min_training_rows=8,
    )

    assert no_fill["summary"]["sixPickCoveredDates"] == 0
    assert with_fill["summary"]["sixPickCoveredDates"] == 1
    assert with_fill["dailyRows"][0]["selectedCount"] == 6
    assert any("same_player_coverage_fill" in row["risk_flags"] for row in with_fill["selectedRows"])
    assert any("same_player_correlation" in row["risk_flags"] for row in with_fill["selectedRows"])


def test_sweep_archive_ml_ranker_limits_ranks_constraint_profiles_from_cached_predictions(tmp_path: Path) -> None:
    training_dates = ["2026-06-28", "2026-06-29"]
    eval_date = "2026-06-30"
    for slate_date in [*training_dates, eval_date]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_market_learning_card(slate_date)),
            encoding="utf-8",
        )
    profiles = [
        {"name": "loose_market6", "limits": {"max_per_market": 6}},
        {"name": "cap_market3", "limits": {"max_per_market": 3}},
    ]

    sweep = sweep_archive_ml_ranker_limits(
        tmp_path / "archive",
        _market_flip_logs(training_dates, eval_date),
        profiles=profiles,
        min_training_cards=2,
        min_training_rows=24,
    )

    assert [profile["profileName"] for profile in sweep["profiles"]] == ["cap_market3", "loose_market6"]
    assert sweep["profiles"][0]["summary"]["legAccuracyPct"] > sweep["profiles"][1]["summary"]["legAccuracyPct"]
    assert sweep["profiles"][0]["summary"]["cardsEvaluated"] == 1
    assert sweep["profiles"][0]["summary"]["predictionCardsBuilt"] == 1


def test_walk_forward_archive_ml_limit_profiles_choose_profile_from_prior_prediction_cards(tmp_path: Path) -> None:
    training_dates = ["2026-06-27", "2026-06-28"]
    eval_dates = ["2026-06-29", "2026-06-30"]
    for slate_date in [*training_dates, *eval_dates]:
        archive_dir = tmp_path / "archive" / slate_date
        archive_dir.mkdir(parents=True)
        (archive_dir / "current-card.json").write_text(
            json.dumps(_market_learning_card(slate_date)),
            encoding="utf-8",
        )
    profiles = [
        {"name": "loose_market6", "limits": {"max_per_market": 6}},
        {"name": "cap_market3", "limits": {"max_per_market": 3}},
    ]

    walk_forward = walk_forward_archive_ml_limit_profiles(
        tmp_path / "archive",
        _market_flip_logs(training_dates, eval_dates),
        profiles=profiles,
        min_training_cards=2,
        min_training_rows=24,
        min_profile_training_cards=1,
    )

    assert walk_forward["summary"]["cardsEvaluated"] == 1
    assert walk_forward["dailyRows"][0]["selectedProfileName"] == "cap_market3"
    assert walk_forward["dailyRows"][0]["profileTrainingCards"] == 1
    assert {row["selectedProfileName"] for row in walk_forward["selectedRows"]} == {"cap_market3"}


def test_archive_sweep_rank_prioritizes_parlay_accuracy_after_coverage() -> None:
    higher_accuracy = {
        "summary": {
            "cardsReplayed": 10,
            "sixPickCoveredDates": 10,
            "sixPickSettledDates": 8,
            "sixPickParlayAccuracyPct": 25.0,
            "legAccuracyPct": 64.0,
        }
    }
    larger_sample = {
        "summary": {
            "cardsReplayed": 10,
            "sixPickCoveredDates": 10,
            "sixPickSettledDates": 9,
            "sixPickParlayAccuracyPct": 20.0,
            "legAccuracyPct": 66.0,
        }
    }

    assert _sweep_sort_key(higher_accuracy) > _sweep_sort_key(larger_sample)


def test_archive_sweep_rank_prioritizes_sample_count_after_parlay_accuracy() -> None:
    larger_sample = {
        "summary": {
            "cardsReplayed": 10,
            "sixPickCoveredDates": 10,
            "sixPickSettledDates": 9,
            "sixPickParlayAccuracyPct": 20.0,
            "legAccuracyPct": 64.0,
        }
    }
    higher_leg_accuracy = {
        "summary": {
            "cardsReplayed": 10,
            "sixPickCoveredDates": 10,
            "sixPickSettledDates": 8,
            "sixPickParlayAccuracyPct": 20.0,
            "legAccuracyPct": 66.0,
        }
    }

    assert _sweep_sort_key(larger_sample) > _sweep_sort_key(higher_leg_accuracy)


def test_ml_sweep_rank_prefers_same_player_fill_when_metrics_tie() -> None:
    no_fill = {
        "limits": {"max_per_market": 3},
        "summary": {
            "cardsEvaluated": 2,
            "sixPickCoveredDates": 2,
            "sixPickSettledDates": 2,
            "sixPickParlayAccuracyPct": 50.0,
            "legAccuracyPct": 66.0,
        },
    }
    same_player_fill = {
        "limits": {"max_per_market": 3, "allow_same_player_coverage_fill": True},
        "summary": {
            "cardsEvaluated": 2,
            "sixPickCoveredDates": 2,
            "sixPickSettledDates": 2,
            "sixPickParlayAccuracyPct": 50.0,
            "legAccuracyPct": 66.0,
        },
    }

    assert _ml_sweep_sort_key(same_player_fill) > _ml_sweep_sort_key(no_fill)


def test_daily_six_pick_limits_match_expanded_site_forced_fill() -> None:
    limits = daily_six_pick_limits(max_picks=6, min_score=0.68)

    assert limits["max_picks"] == 6
    assert limits["target_picks"] == 6
    assert limits["min_score"] == 0.68
    assert limits["require_playable_side_odds"] is True
    assert limits["allow_expanded_fill"] is True
    assert limits["allow_forced_six_pick_fill"] is True
    assert limits["forced_fill_min_probability"] == 0.50


def test_default_archive_profiles_include_selector_penalty_variants() -> None:
    profiles = default_archive_profiles(max_picks=6, min_score=0.68)
    penalty_pairs = {
        (profile["limits"].get("standard_pra_under_penalty"), profile["limits"].get("standard_volatile_penalty"))
        for profile in profiles
    }

    assert (0.0, 0.0) in penalty_pairs
    assert (0.04, 0.04) in penalty_pairs


def test_cli_parses_archive_replay_daily_six_pick(monkeypatch) -> None:
    monkeypatch.setattr(
        "sys.argv",
        [
            "wnba_prop_model",
            "archive-replay",
            "--archive-root",
            "archive",
            "--include-current",
            "--daily-six-pick",
            "--sweep-out",
            "output/archive-sweep.json",
            "--walk-forward-out",
            "output/archive-walk-forward.json",
            "--ml-ranker-out",
            "output/archive-ml-ranker.json",
            "--ml-min-training-cards",
            "5",
            "--ml-min-training-rows",
            "80",
            "--ml-sweep-out",
            "output/archive-ml-sweep.json",
            "--ml-limit-walk-forward-out",
            "output/archive-ml-limit-walk-forward.json",
            "--out",
            "output/archive-replay.json",
        ],
    )

    args = parse_args()

    assert args.command == "archive-replay"
    assert args.archive_root == "archive"
    assert args.include_current is True
    assert args.daily_six_pick is True
    assert args.sweep_out == "output/archive-sweep.json"
    assert args.walk_forward_out == "output/archive-walk-forward.json"
    assert args.ml_ranker_out == "output/archive-ml-ranker.json"
    assert args.ml_min_training_cards == 5
    assert args.ml_min_training_rows == 80
    assert args.ml_sweep_out == "output/archive-ml-sweep.json"
    assert args.ml_limit_walk_forward_out == "output/archive-ml-limit-walk-forward.json"
    assert args.out == "output/archive-replay.json"
