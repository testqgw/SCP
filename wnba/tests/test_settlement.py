import pandas as pd

from wnba_prop_model.settlement import settle_card
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
