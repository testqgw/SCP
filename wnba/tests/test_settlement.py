import pandas as pd

from wnba_prop_model.settlement import settle_card, write_settlement
from wnba_prop_model.utils import canonical_name


def test_settlement_marks_missing_player_from_final_team_boxscore_as_no_action() -> None:
    card = {
        "generatedAt": "2026-05-15T01:57:00Z",
        "slateDate": "2026-05-15",
        "selectedRows": [
            {
                "slate_date": "2026-05-15",
                "selected_rank": 1,
                "player": "Missing Player",
                "player_id": "missing-1",
                "team": "WSH",
                "opponent": "IND",
                "market": "PTS",
                "side": "UNDER",
                "line": 9.5,
                "model_probability": 0.7,
                "final_score": 0.8,
                "source_book": "test",
                "source_url": "",
            }
        ],
    }
    logs = pd.DataFrame(
        [
            {
                "game_date": pd.Timestamp("2026-05-15"),
                "player": "Actual Player",
                "player_id": "actual-1",
                "player_key": canonical_name("Actual Player"),
                "team_abbr": "WSH",
                "opponent_abbr": "IND",
                "PTS": 12,
            }
        ]
    )

    result = settle_card(card, logs)

    assert result["rows"][0]["settlement"] == "NO_ACTION"
    assert result["summary"]["noActionPicks"] == 1
    assert result["summary"]["pendingPicks"] == 0


def test_write_settlement_uses_lf_csv_line_endings(tmp_path) -> None:
    result = {
        "generatedAt": "2026-07-03T12:00:00Z",
        "slateDate": "2026-07-03",
        "cardGeneratedAt": "2026-07-03T11:00:00Z",
        "summary": {
            "settledPicks": 0,
            "trackedPicks": 1,
            "noActionPicks": 0,
            "accuracyPct": None,
        },
        "rows": [
            {
                "slate_date": "2026-07-03",
                "selected_rank": 1,
                "player": "Test Player",
                "team": "NY",
                "team_name": "New York Liberty",
                "opponent": "MIN",
                "opponent_name": "Minnesota Lynx",
                "market": "PTS",
                "side": "UNDER",
                "line": 14.5,
                "actual": None,
                "settlement": "PENDING",
                "model_probability": 0.62,
                "final_score": 0.41,
                "source_book": "fanduel",
                "source_url": "https://example.test/props",
            }
        ],
    }

    paths = write_settlement(result, tmp_path / "settlement")

    assert b"\r\n" not in (tmp_path / "settlement.csv").read_bytes()
    assert paths["csv"].endswith("settlement.csv")
