import pandas as pd

from wnba_prop_model import data_scoresandodds
from wnba_prop_model.data_scoresandodds import _latest_context, parse_props_from_html


HTML = """
<ul class="table-list">
  <li class="border" data-delta="0.76" data-proj="15.26" data-diff="0.76" data-name="brittney sykes" data-state="Pregame">
    <div data-content='<div data-role="chassis" data-event="wnba/11905650" data-market="points" data-filter="Brittney Sykes"></div>'></div>
    <span class="data-moneyline">o14.5</span><small class="data-odds best">-110</small>
    <span class="data-moneyline">u14.5</span><small class="data-odds best">even</small>
  </li>
</ul>
"""


def test_parse_scoresandodds_row() -> None:
    props = parse_props_from_html(HTML, "https://www.scoresandodds.com/wnba/props/points", default_date="2026-05-08")
    assert len(props) == 1
    prop = props[0]
    assert prop.player == "Brittney Sykes"
    assert prop.market == "PTS"
    assert prop.line == 14.5
    assert prop.over_odds == -110
    assert prop.under_odds == 100
    assert prop.source_projection == 15.26
    assert prop.source_event_id == "11905650"


def test_latest_context_blocks_stale_historical_team_match() -> None:
    logs = pd.DataFrame(
        [
            {
                "game_date": "2025-08-01",
                "player_id": "old-1",
                "player": "Stale Player",
                "player_key": "stale player",
                "team_abbr": "IND",
                "opponent_abbr": "WSH",
            }
        ]
    )
    team_matchups = {"IND": "WSH", "WSH": "IND"}
    active_rosters = {"IND": {"active fever player"}, "WSH": {"active mystics player"}}

    player_id, team, opponent, player, status = _latest_context(logs, "Stale Player", team_matchups, active_rosters)

    assert player_id == ""
    assert team == ""
    assert opponent == ""
    assert player == "Stale Player"
    assert status == "not_on_current_roster"


def test_props_to_board_rows_returns_empty_when_target_date_has_no_espn_slate(monkeypatch) -> None:
    monkeypatch.setattr(data_scoresandodds, "_current_team_context", lambda date: ({}, {}))
    prop = data_scoresandodds.ScoresAndOddsProp(
        game_date="2026-05-16",
        player="Old Board Player",
        market="PTS",
        source_market="PTS",
        line=10.5,
        over_odds=-110,
        under_odds=-110,
        over_book="fanduel",
        under_book="fanduel",
        source_projection=None,
        source_url="https://www.scoresandodds.com/wnba/props/points",
        source_event_id="stale",
    )

    assert data_scoresandodds.props_to_board_rows([prop], pd.DataFrame()) == []
