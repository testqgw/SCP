from wnba_prop_model.data_scoresandodds import parse_props_from_html


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
