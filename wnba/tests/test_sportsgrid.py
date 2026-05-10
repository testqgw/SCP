from wnba_prop_model.data_sportsgrid import normalize_team, parse_props_from_html
from wnba_prop_model.utils import normalize_market


HTML = """
<h2>LATEST PLAYER PROPS</h2>
<div class="player-card-listitems">
  <span>GSV</span><p>05/08<!-- --> - <!-- -->10:00 PM</p><span>SEA</span>
  <p>PLAYER</p><p>Veronica Burton</p>
  <p>MARKET</p><p>1.5 <!-- -->3 Point FG Made</p>
  <p>PICK</p><p>Over</p>
  <p>RATING</p><svg><path></path></svg>
  <p>PROJECTION</p><p>2.0</p>
  <p>o1.5</p><p>+118</p>
</div>
<h2>LATEST PLAYER PROPS</h2>
"""

NEXT_DATA_HTML = """
<script id="__NEXT_DATA__" type="application/json">{
  "props": {
    "pageProps": {
      "ssr_data": {
        "header_data": {"away_alias": "PHX", "home_alias": "LVA"},
        "game_lines": {"data": {"away_spread_point": "+9.5", "home_spread_point": "-9.5", "away_total_point": "O 167.5"}},
        "props_picks_data": {
          "data": [
            {
              "player": "A'ja Wilson",
              "market_points": "23.5",
              "market": "Points",
              "picks": "Over",
              "bookmaker": "FanDuel",
              "projection": "26.6",
              "date": "05/09",
              "time": "3:30 PM",
              "bet": "-120",
              "over_under_filter": "Over"
            }
          ]
        }
      }
    }
  }
}</script>
"""


def test_normalize_market_aliases() -> None:
    assert normalize_market("Points") == "PTS"
    assert normalize_market("Pts + Reb + Ast") == "PRA"
    assert normalize_market("3 Point FG Made") == "THREES"


def test_parse_sportsgrid_card() -> None:
    props = parse_props_from_html(HTML, "https://example.test/wnba/game/test-may-08-2026")
    assert len(props) == 1
    prop = props[0]
    assert prop.away_abbr == "GS"
    assert prop.home_abbr == "SEA"
    assert prop.player == "Veronica Burton"
    assert prop.market == "THREES"
    assert prop.over_odds == 118
    assert prop.under_odds is None


def test_team_aliases() -> None:
    assert normalize_team("GSV") == "GS"
    assert normalize_team("LVA") == "LV"
    assert normalize_team("LAS") == "LA"
    assert normalize_team("NYL") == "NY"
    assert normalize_team("PDX") == "POR"
    assert normalize_team("Portland Fire") == "POR"
    assert normalize_team("Toronto Tempo") == "TOR"


def test_parse_next_data_fanduel_props() -> None:
    props = parse_props_from_html(NEXT_DATA_HTML, "https://example.test/wnba/game/test", default_date="2026-05-09")
    assert len(props) == 1
    prop = props[0]
    assert prop.source_book == "FanDuel"
    assert prop.away_abbr == "PHX"
    assert prop.home_abbr == "LV"
    assert prop.market == "PTS"
    assert prop.source_pick == "OVER"
    assert prop.over_odds == -120
    assert prop.under_odds is None
