import json
from copy import deepcopy
from pathlib import Path

import pandas as pd

from wnba_prop_model.cli import parse_args
from wnba_prop_model.archive_replay import (
    _sweep_sort_key,
    daily_six_pick_limits,
    default_archive_profiles,
    replay_archived_cards,
    sweep_archive_profiles,
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
    assert args.out == "output/archive-replay.json"
