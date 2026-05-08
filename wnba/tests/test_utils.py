from wnba_prop_model.utils import american_to_prob, no_vig_probability, parse_made_attempted, parse_minutes


def test_parse_minutes_decimal_and_clock() -> None:
    assert parse_minutes("24") == 24
    assert round(parse_minutes("12:30"), 2) == 12.5


def test_parse_made_attempted() -> None:
    assert parse_made_attempted("3-8") == (3, 8)


def test_no_vig_probability() -> None:
    assert round(american_to_prob("-110"), 4) == 0.5238
    assert round(no_vig_probability("-110", "-110", "OVER"), 4) == 0.5
