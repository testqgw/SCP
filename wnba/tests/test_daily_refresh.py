from pathlib import Path

from argparse import Namespace

from scripts.daily_refresh import build_score_limits, load_unavailable_candidate_ids, parse_args


def test_load_unavailable_candidate_ids_filters_by_slate_date(tmp_path: Path) -> None:
    path = tmp_path / "unavailable.csv"
    path.write_text(
        "\n".join(
            [
                "game_date,candidate_id,player,market,line,reason",
                "2026-07-03,2026-07-03:2529458:PR:12.5,Cheyenne Parker-Tyus,PR,12.5,missing on FanDuel",
                "2026-07-02,2026-07-02:2529458:PR:12.5,Cheyenne Parker-Tyus,PR,12.5,old slate",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    blocked = load_unavailable_candidate_ids(path, "2026-07-03")

    assert blocked == {
        "2026-07-03:2529458:PR:12.5",
        "2026-07-03:2529458:PR:*",
        "2026-07-03:2529458.0:PR:12.5",
        "2026-07-03:2529458.0:PR:*",
        "2026-07-03:cheyenne parker tyus:PR:*",
    }


def test_load_unavailable_candidate_ids_blocks_decimal_player_id_alias(tmp_path: Path) -> None:
    path = tmp_path / "unavailable.csv"
    path.write_text(
        "\n".join(
            [
                "game_date,candidate_id,player,market,line,reason",
                "2026-07-06,2026-07-06:5220150:REB:8.5,Dominique Malonga,REB,8.5,missing on FanDuel",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    blocked = load_unavailable_candidate_ids(path, "2026-07-06")

    assert "2026-07-06:5220150.0:REB:*" in blocked
    assert "2026-07-06:5220150.0:REB:8.5" in blocked


def test_fanduel_live_limits_preserve_same_game_correlation() -> None:
    args = Namespace(book="fanduel", max_picks=6, min_score=0.68, unavailable_props="missing.csv")

    limits = build_score_limits(args, "2026-07-03")

    assert limits["max_per_game"] == 6
    assert limits["sgp_tax_penalty_per_same_game_pair"] > 0
    assert limits["exclude_single_side_prices"] is True
    assert limits["exclude_rebound_unders"] is True
    assert limits["market_side_score_adjustments"] == {"THREES:UNDER": 0.55}
    assert limits["required_source_book"] == "FanDuel"
    assert limits["require_direct_source_book"] is True


def test_sportsgrid_fanduel_limits_allow_pick_side_only_prices() -> None:
    args = Namespace(book="fanduel", max_picks=6, min_score=0.68, unavailable_props="missing.csv")

    limits = build_score_limits(args, "2026-07-07", source="sportsgrid-fanduel")

    assert limits["required_source_book"] == "FanDuel"
    assert limits["allow_pick_side_only_prices"] is True
    assert limits["exclude_single_side_prices"] is True


def test_daily_refresh_defaults_to_fanduel_live_mode(monkeypatch) -> None:
    monkeypatch.setattr("sys.argv", ["daily_refresh.py"])

    args = parse_args()

    assert args.book == "fanduel"


def test_workflow_runs_fanduel_live_mode() -> None:
    workflow = Path("../.github/workflows/wnba-daily-card.yml").read_text(encoding="utf-8")

    assert "daily_refresh.py --book fanduel --max-picks 6" in workflow


def test_expanded_limits_still_honor_unavailable_props(tmp_path: Path) -> None:
    path = tmp_path / "unavailable.csv"
    path.write_text(
        "\n".join(
            [
                "game_date,candidate_id,player,market,line,reason",
                "2026-07-03,2026-07-03:2529458:PR:12.5,Cheyenne Parker-Tyus,PR,12.5,missing on FanDuel",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    args = Namespace(book="expanded", max_picks=6, min_score=0.68, unavailable_props=str(path))

    limits = build_score_limits(args, "2026-07-03")

    assert "2026-07-03:2529458:PR:*" in limits["blocked_candidate_ids"]
    assert limits["allow_expanded_fill"] is True
    assert limits["allow_forced_six_pick_fill"] is True
    assert limits["forced_fill_min_probability"] == 0.60
