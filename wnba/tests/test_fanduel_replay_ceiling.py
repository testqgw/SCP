from scripts.fanduel_replay_ceiling import raw_pool_ceiling, summarize_replay


def test_raw_pool_ceiling_counts_winning_fanduel_rows() -> None:
    rows = [
        {"source_book": "fanduel", "side_odds": -110, "settlement": "WIN", "player": "A"},
        {"source_book": "FanDuel", "side_odds": -120, "settlement": "LOSS", "player": "B"},
        {"source_book": "draftkings", "side_odds": -110, "settlement": "WIN", "player": "C"},
        {"source_book": "fanduel", "side_odds": None, "settlement": "WIN", "player": "D"},
    ]

    ceiling = raw_pool_ceiling(rows)

    assert ceiling["rawFanDuelSettledRows"] == 2
    assert ceiling["rawFanDuelWinningRows"] == 1
    assert ceiling["rawCanHitSix"] is False


def test_summarize_replay_reports_impossible_six_pick_dates() -> None:
    daily = [
        {"sixPickSettled": True, "sixPickParlayHit": True, "rawCanHitSix": True, "settledLegs": 6, "legWins": 6},
        {"sixPickSettled": True, "sixPickParlayHit": False, "rawCanHitSix": False, "settledLegs": 6, "legWins": 2},
    ]

    summary = summarize_replay(daily)

    assert summary["sixPickSettledDates"] == 2
    assert summary["sixPickParlayWins"] == 1
    assert summary["sixPickParlayAccuracyPct"] == 50.0
    assert summary["rawImpossibleSixPickDates"] == 1
    assert summary["legAccuracyPct"] == 66.67
