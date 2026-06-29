from __future__ import annotations

from argparse import Namespace
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import daily_refresh


def test_refresh_logs_reuses_existing_cache_when_espn_fetch_fails(tmp_path, monkeypatch):
    logs_path = tmp_path / "wnba_player_game_logs.csv"
    logs_path.write_text("player,game_date\nCached Player,2026-06-28\n", encoding="utf-8")

    def fail_fetch(*args, **kwargs):
        raise RuntimeError("network down")

    def fail_write(*args, **kwargs):
        raise AssertionError("cached fallback should not rewrite logs")

    monkeypatch.setattr(daily_refresh, "LOGS_PATH", logs_path)
    monkeypatch.setattr(daily_refresh, "fetch_player_game_logs", fail_fetch)
    monkeypatch.setattr(daily_refresh, "write_logs_csv", fail_write)

    warnings = daily_refresh.refresh_logs(Namespace(skip_fetch=False, seasons=[2026], fetch_sleep=0))

    assert warnings == [
        "ESPN log refresh failed; reused existing logs at wnba_player_game_logs.csv: network down"
    ]
    assert logs_path.read_text(encoding="utf-8").startswith("player,game_date")


def test_refresh_logs_raises_when_espn_fetch_fails_without_cache(tmp_path, monkeypatch):
    logs_path = tmp_path / "missing_logs.csv"

    def fail_fetch(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(daily_refresh, "LOGS_PATH", logs_path)
    monkeypatch.setattr(daily_refresh, "fetch_player_game_logs", fail_fetch)

    with pytest.raises(RuntimeError, match="network down"):
        daily_refresh.refresh_logs(Namespace(skip_fetch=False, seasons=[2026], fetch_sleep=0))


def test_main_records_refresh_warnings_in_summary(tmp_path, monkeypatch):
    summary_path = tmp_path / "current-refresh-summary.json"
    board_path = daily_refresh.ROOT / "data/current/test_board.csv"
    card = {"summary": {"selectedCount": 0, "totalBoardRows": 0}}
    settlement = {"summary": {"settledPicks": 0}}

    monkeypatch.setattr(
        daily_refresh,
        "parse_args",
        lambda: Namespace(date="2026-06-29", skip_fetch=False, seasons=[2026], fetch_sleep=0),
    )
    monkeypatch.setattr(daily_refresh, "REFRESH_SUMMARY_PATH", summary_path)
    monkeypatch.setattr(daily_refresh, "archive_existing_card", lambda target_date: None)
    monkeypatch.setattr(daily_refresh, "refresh_logs", lambda args: ["cached logs reused"])
    monkeypatch.setattr(daily_refresh, "settle_existing_card", lambda archived_slate: None)
    monkeypatch.setattr(daily_refresh, "generate_current_card", lambda target_date, args: (card, "expanded", board_path))
    monkeypatch.setattr(daily_refresh, "write_card", lambda card, prefix: {"json": str(tmp_path / "card.json")})
    monkeypatch.setattr(daily_refresh, "load_logs", lambda path, include_preseason=False: object())
    monkeypatch.setattr(daily_refresh, "settle_card", lambda card, logs: settlement)
    monkeypatch.setattr(
        daily_refresh,
        "write_settlement",
        lambda result, prefix: {"json": str(tmp_path / "settlement.json")},
    )

    assert daily_refresh.main() == 0

    assert '"refreshWarnings": [\n    "cached logs reused"\n  ]' in summary_path.read_text(encoding="utf-8")
