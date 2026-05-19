from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-18-soft-context-rerank-v5"
DEFAULT_FALLBACK_ODDS = -110.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Join Final Player Prop Model V1 selected picks to third-party lines and grade odds/ROI/CLV coverage."
    )
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument(
        "--line-csv",
        default="exports/historical-lines/all-players-all-markets-live.csv",
        help="Third-party line file. Supports the local ScoresAndOdds wide schema or a normalized one-row-per-side schema.",
    )
    parser.add_argument("--out-prefix", default="exports/final-player-prop-model-v1-market-proof")
    parser.add_argument(
        "--line-tolerance",
        type=float,
        default=0.0,
        help="Strict proof uses exact line matches by default. Increase only for diagnostics.",
    )
    parser.add_argument("--stake-units", type=float, default=1.0)
    parser.add_argument(
        "--fallback-odds",
        type=float,
        default=DEFAULT_FALLBACK_ODDS,
        help="Assumed American odds for rows with no valid external odds. Used only in the full-coverage diagnostic layer.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: str | Path) -> str | None:
    target = Path(path)
    if not target.exists():
        return None
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: str | Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with Path(path).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def normalize_name(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace(".", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def clean_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def clean_str(row: dict[str, Any], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def boolish(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y", "win"}


def round_or_none(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def pct(numerator: int | float, denominator: int | float) -> float | None:
    if denominator <= 0:
        return None
    return round(100.0 * numerator / denominator, 2)


def pct_fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}%"


def money_fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}"


def bucket_month(date: str | None) -> str:
    text = (date or "").strip()
    return text[:7] if len(text) >= 7 else "UNKNOWN"


def bucket_line(value: float | None) -> str:
    if value is None:
        return "UNKNOWN"
    if value < 5:
        return "<5"
    if value < 10:
        return "5-9.5"
    if value < 15:
        return "10-14.5"
    if value < 20:
        return "15-19.5"
    if value < 25:
        return "20-24.5"
    if value < 30:
        return "25-29.5"
    return "30+"


def bucket_prior(value: float | None) -> str:
    if value is None:
        return "UNKNOWN"
    if value < 88:
        return "<88"
    if value < 90:
        return "88-90"
    if value < 92:
        return "90-92"
    if value < 94:
        return "92-94"
    return "94+"


def bucket_score(value: float | None) -> str:
    if value is None:
        return "UNKNOWN"
    if value < 0.75:
        return "<0.75"
    if value < 0.80:
        return "0.75-0.80"
    if value < 0.85:
        return "0.80-0.85"
    if value < 0.90:
        return "0.85-0.90"
    return "0.90+"


def bucket_price(value: float | None) -> str:
    if not valid_american_odds(value):
        return "UNKNOWN"
    assert value is not None
    if value <= -200:
        return "<=-200"
    if value <= -150:
        return "-199 to -150"
    if value <= -120:
        return "-149 to -120"
    if value < 0:
        return "-119 to -100"
    if value < 150:
        return "+100 to +149"
    if value < 200:
        return "+150 to +199"
    return ">=+200"


def valid_american_odds(value: float | None) -> bool:
    return value is not None and (value <= -100 or value >= 100)


def implied_probability(odds: float | None) -> float | None:
    if not valid_american_odds(odds):
        return None
    assert odds is not None
    if odds < 0:
        return abs(odds) / (abs(odds) + 100.0)
    return 100.0 / (odds + 100.0)


def profit_at_odds(result: str, odds: float | None, stake: float) -> float | None:
    if not valid_american_odds(odds):
        return None
    assert odds is not None
    if result == "LOSS":
        return -stake
    if result in {"PUSH", "VOID"}:
        return 0.0
    if result != "WIN":
        return None
    return stake * (odds / 100.0) if odds > 0 else stake * (100.0 / abs(odds))


def result_for_side(side: str, line: float | None, actual: float | None) -> str:
    if line is None or actual is None:
        return "VOID"
    normalized_side = side.upper()
    if actual == line:
        return "PUSH"
    if normalized_side == "OVER":
        return "WIN" if actual > line else "LOSS"
    if normalized_side == "UNDER":
        return "WIN" if actual < line else "LOSS"
    return "VOID"


def side_aware_line_value(side: str, lock_line: float | None, close_line: float | None) -> float | None:
    if lock_line is None or close_line is None:
        return None
    if side.upper() == "OVER":
        return close_line - lock_line
    if side.upper() == "UNDER":
        return lock_line - close_line
    return None


def line_gap(model_line: float | None, external_line: float | None) -> float | None:
    if model_line is None or external_line is None:
        return None
    return external_line - model_line


def abs_line_gap(model_line: float | None, external_line: float | None) -> float | None:
    gap = line_gap(model_line, external_line)
    return abs(gap) if gap is not None else None


def line_matches(model_line: float | None, external_line: float | None, tolerance: float) -> bool:
    if model_line is None or external_line is None:
        return False
    return abs(model_line - external_line) <= max(0.0, tolerance) + 1e-9


def quote_key(date: str, player: str, market: str) -> tuple[str, str, str]:
    return (date, normalize_name(player), market.upper().strip())


def is_normalized_schema(row: dict[str, str]) -> bool:
    keys = set(row.keys())
    return {"side", "odds"}.issubset(keys) or {"betSide", "bookOdds"}.issubset(keys)


def maybe_col(row: dict[str, str], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def iter_quotes(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    quotes: list[dict[str, Any]] = []
    for source_index, row in enumerate(rows):
        date = maybe_col(row, "gameDateEt", "date", "slate_date", "slateDate", "eventDateEt")
        player = maybe_col(row, "playerName", "player", "participant", "description")
        market = maybe_col(row, "market", "marketKey", "propType").upper()
        if not date or not player or not market:
            continue

        if is_normalized_schema(row):
            side = maybe_col(row, "side", "betSide", "name").upper()
            if side not in {"OVER", "UNDER"}:
                continue
            line = clean_float(maybe_col(row, "line", "bookLine", "point", "handicap"))
            odds = clean_float(maybe_col(row, "odds", "bookOdds", "price", "americanOdds"))
            book = maybe_col(row, "book", "sportsbook", "bookmaker", "vendor")
            close_line = clean_float(maybe_col(row, "closeLine", "closingLine", "close_line", "closing_line"))
            close_odds = clean_float(maybe_col(row, "closeOdds", "closingOdds", "close_odds", "closing_odds"))
            quotes.append(
                {
                    "sourceIndex": source_index,
                    "date": date,
                    "playerName": player,
                    "market": market,
                    "side": side,
                    "line": line,
                    "odds": odds,
                    "book": book,
                    "source": maybe_col(row, "source", "provider") or "third-party",
                    "sourceUrl": maybe_col(row, "sourceUrl", "url"),
                    "snapshotAtUtc": maybe_col(row, "snapshotAtUtc", "lineTimestampUtc", "line_timestamp_utc", "timestamp"),
                    "commenceTimeUtc": maybe_col(row, "commenceTimeUtc", "gameTimeUtc", "game_time_utc"),
                    "closeLine": close_line,
                    "closeOdds": close_odds,
                    "closeTimestampUtc": maybe_col(row, "closeTimestampUtc", "closingTimestampUtc", "close_timestamp_utc"),
                    "raw": row,
                }
            )
            continue

        for side in ("OVER", "UNDER"):
            side_prefix = "over" if side == "OVER" else "under"
            line = clean_float(maybe_col(row, f"{side_prefix}Line", f"{side_prefix}_line", "line"))
            odds = clean_float(maybe_col(row, f"{side_prefix}Price", f"{side_prefix}Odds", f"{side_prefix}_odds"))
            book = maybe_col(row, f"sportsbook{side.title()}", f"{side_prefix}Book", f"{side_prefix}_book", "sportsbook", "book")
            quotes.append(
                {
                    "sourceIndex": source_index,
                    "date": date,
                    "playerName": player,
                    "market": market,
                    "side": side,
                    "line": line,
                    "odds": odds,
                    "book": book,
                    "source": maybe_col(row, "source", "provider") or "third-party",
                    "sourceUrl": maybe_col(row, "sourceUrl", "url"),
                    "snapshotAtUtc": maybe_col(row, "snapshotAtUtc", "lineTimestampUtc", "line_timestamp_utc", "timestamp"),
                    "commenceTimeUtc": maybe_col(row, "commenceTimeUtc", "gameTimeUtc", "game_time_utc"),
                    "closeLine": clean_float(maybe_col(row, f"{side_prefix}CloseLine", "closeLine", "closingLine")),
                    "closeOdds": clean_float(maybe_col(row, f"{side_prefix}CloseOdds", "closeOdds", "closingOdds")),
                    "closeTimestampUtc": maybe_col(row, f"{side_prefix}CloseTimestampUtc", "closeTimestampUtc", "closingTimestampUtc"),
                    "raw": row,
                }
            )
    return quotes


def build_quote_index(quotes: list[dict[str, Any]]) -> dict[tuple[str, str, str], list[dict[str, Any]]]:
    index: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for quote in quotes:
        index[quote_key(quote["date"], quote["playerName"], quote["market"])].append(quote)
    return index


def choose_quote(
    pick: dict[str, str],
    candidates: list[dict[str, Any]],
    line_tolerance: float,
) -> tuple[dict[str, Any] | None, str, dict[str, Any]]:
    side = pick.get("side", "").upper()
    model_line = clean_float(pick.get("line"))
    same_side = [quote for quote in candidates if quote.get("side") == side]
    exact = [quote for quote in same_side if line_matches(model_line, quote.get("line"), line_tolerance)]
    valid_exact = [quote for quote in exact if valid_american_odds(quote.get("odds"))]

    evidence = {
        "candidateCount": len(candidates),
        "sameSideCount": len(same_side),
        "lineMatchCount": len(exact),
        "validOddsLineMatchCount": len(valid_exact),
    }

    if valid_exact:
        return sorted(valid_exact, key=lambda quote: quote["sourceIndex"])[0], "MATCHED_EXACT_LINE_VALID_ODDS", evidence
    if exact:
        return sorted(exact, key=lambda quote: quote["sourceIndex"])[0], "MATCHED_EXACT_LINE_INVALID_ODDS", evidence
    if same_side:
        nearest = sorted(
            same_side,
            key=lambda quote: abs((quote.get("line") or float("inf")) - (model_line or -float("inf"))),
        )[0]
        return nearest, "NO_EXACT_LINE_MATCH", evidence
    if candidates:
        return sorted(candidates, key=lambda quote: quote["sourceIndex"])[0], "NO_SAME_SIDE_LINE", evidence
    return None, "NO_PLAYER_MARKET_LINE", evidence


def nearest_valid_same_side_quote(
    pick: dict[str, str],
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    side = pick.get("side", "").upper()
    model_line = clean_float(pick.get("line"))
    same_side = [
        quote
        for quote in candidates
        if quote.get("side") == side and valid_american_odds(quote.get("odds")) and quote.get("line") is not None
    ]
    if not same_side:
        return None
    return sorted(
        same_side,
        key=lambda quote: (abs((quote.get("line") or 0.0) - (model_line or 0.0)), quote["sourceIndex"]),
    )[0]


def summarize_by(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row.get(field) or "UNKNOWN")].append(row)
    output: list[dict[str, Any]] = []
    for bucket, bucket_rows in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        matched = [row for row in bucket_rows if row.get("strictProofMatch")]
        wins = sum(1 for row in matched if row.get("resultAtExternalLine") == "WIN")
        pushes = sum(1 for row in matched if row.get("resultAtExternalLine") == "PUSH")
        losses = sum(1 for row in matched if row.get("resultAtExternalLine") == "LOSS")
        profit_values = [row.get("profitUnits") for row in matched if isinstance(row.get("profitUnits"), (int, float))]
        stake = sum(row.get("stakeUnits") or 0 for row in matched if isinstance(row.get("profitUnits"), (int, float)))
        profit = sum(profit_values)
        output.append(
            {
                "bucket": bucket,
                "samples": len(bucket_rows),
                "strictMatches": len(matched),
                "coveragePct": pct(len(matched), len(bucket_rows)),
                "wins": wins,
                "losses": losses,
                "pushes": pushes,
                "accuracyPct": pct(wins, wins + losses),
                "profitUnits": round_or_none(profit, 4),
                "roiPct": pct(profit, stake) if stake else None,
            }
        )
    return output


def internal_accuracy(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    wins = sum(1 for row in rows if row.get("modelCorrect"))
    return pct(wins, len(rows))


def external_accuracy(rows: list[dict[str, Any]]) -> float | None:
    graded = [row for row in rows if row.get("resultAtExternalLine") in {"WIN", "LOSS"}]
    if not graded:
        return None
    wins = sum(1 for row in graded if row.get("resultAtExternalLine") == "WIN")
    return pct(wins, len(graded))


def roi_for_rows(rows: list[dict[str, Any]]) -> float | None:
    profit_values = [row.get("profitUnits") for row in rows if isinstance(row.get("profitUnits"), (int, float))]
    stake = sum(row.get("stakeUnits") or 0 for row in rows if isinstance(row.get("profitUnits"), (int, float)))
    if not profit_values or stake <= 0:
        return None
    return pct(sum(profit_values), stake)


def coverage_roi_for_rows(rows: list[dict[str, Any]]) -> float | None:
    profit_values = [row.get("coverageProfitUnits") for row in rows if isinstance(row.get("coverageProfitUnits"), (int, float))]
    stake = sum(row.get("coverageStakeUnits") or 0 for row in rows if isinstance(row.get("coverageProfitUnits"), (int, float)))
    if not profit_values or stake <= 0:
        return None
    return pct(sum(profit_values), stake)


def coverage_accuracy(rows: list[dict[str, Any]]) -> float | None:
    graded = [row for row in rows if row.get("resultAtCoverageLine") in {"WIN", "LOSS"}]
    if not graded:
        return None
    wins = sum(1 for row in graded if row.get("resultAtCoverageLine") == "WIN")
    return pct(wins, len(graded))


def avg_numeric(rows: list[dict[str, Any]], field: str) -> float | None:
    values = [row.get(field) for row in rows if isinstance(row.get(field), (int, float))]
    if not values:
        return None
    return round_or_none(sum(values) / len(values), 4)


def summarize_match_bias(rows: list[dict[str, Any]], field: str, limit: int | None = None) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row.get(field) or "UNKNOWN")].append(row)
    output: list[dict[str, Any]] = []
    for bucket, bucket_rows in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        matched = [row for row in bucket_rows if row.get("strictProofMatch")]
        unmatched = [row for row in bucket_rows if not row.get("strictProofMatch")]
        matched_internal = internal_accuracy(matched)
        unmatched_internal = internal_accuracy(unmatched)
        output.append(
            {
                "bucket": bucket,
                "samples": len(bucket_rows),
                "strictMatches": len(matched),
                "unmatched": len(unmatched),
                "matchCoveragePct": pct(len(matched), len(bucket_rows)),
                "matchedInternalAccuracyPct": matched_internal,
                "unmatchedInternalAccuracyPct": unmatched_internal,
                "matchedVsUnmatchedInternalGapPct": round_or_none(
                    matched_internal - unmatched_internal, 2
                )
                if matched_internal is not None and unmatched_internal is not None
                else None,
                "matchedExternalAccuracyPct": external_accuracy(matched),
                "matchedRoiPct": roi_for_rows(matched),
                "avgMatchedOdds": avg_numeric(matched, "externalOdds"),
            }
        )
    return output[:limit] if limit else output


def summarize_coverage_by(rows: list[dict[str, Any]], field: str, limit: int | None = None) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row.get(field) or "UNKNOWN")].append(row)
    output: list[dict[str, Any]] = []
    for bucket, bucket_rows in sorted(groups.items(), key=lambda item: (-len(item[1]), item[0])):
        graded = [row for row in bucket_rows if row.get("resultAtCoverageLine") in {"WIN", "LOSS", "PUSH"}]
        wins = sum(1 for row in graded if row.get("resultAtCoverageLine") == "WIN")
        losses = sum(1 for row in graded if row.get("resultAtCoverageLine") == "LOSS")
        pushes = sum(1 for row in graded if row.get("resultAtCoverageLine") == "PUSH")
        profit_values = [row.get("coverageProfitUnits") for row in graded if isinstance(row.get("coverageProfitUnits"), (int, float))]
        stake = sum(row.get("coverageStakeUnits") or 0 for row in graded if isinstance(row.get("coverageProfitUnits"), (int, float)))
        gap_values = [row.get("coverageAbsLineGap") for row in graded if isinstance(row.get("coverageAbsLineGap"), (int, float))]
        output.append(
            {
                "bucket": bucket,
                "samples": len(bucket_rows),
                "graded": len(graded),
                "sharePct": pct(len(bucket_rows), len(rows)),
                "wins": wins,
                "losses": losses,
                "pushes": pushes,
                "accuracyPct": pct(wins, wins + losses),
                "profitUnits": round_or_none(sum(profit_values), 4),
                "roiPct": pct(sum(profit_values), stake) if stake else None,
                "avgAbsLineGap": round_or_none(sum(gap_values) / len(gap_values), 4) if gap_values else None,
            }
        )
    return output[:limit] if limit else output


def status_from_metrics(metrics: dict[str, Any]) -> str:
    if metrics["totalSelectedPicks"] <= 0 or metrics["externalLineRows"] <= 0:
        return "PENDING"
    if metrics["strictLineMatchCoveragePct"] < 80:
        return "WARN"
    if metrics["asOfTimestampCoveragePct"] < 95:
        return "WARN"
    if metrics["closingLineCoveragePct"] < 80:
        return "WARN"
    return "PASS"


def markdown_report(report: dict[str, Any]) -> str:
    metrics = report["metrics"]
    total = metrics.get("totalSelectedPicks", 0)
    lines = [
        "# Final V1 Market Proof / ROI / CLV Audit",
        "",
        f"Generated: {report['generatedAt']}",
        f"Overall status: **{report['overallStatus']}**",
        "",
        "## Inputs",
        "",
        f"- Selected picks: `{report['inputs']['selectedCsv']}`",
        f"- External line file: `{report['inputs']['lineCsv']}`",
        f"- Selected SHA256: `{report['inputs']['selectedSha256']}`",
        f"- Line SHA256: `{report['inputs']['lineSha256']}`",
        "",
        "## Main Metrics",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Total selected picks | {metrics.get('totalSelectedPicks', 0)} |",
        f"| External line rows | {metrics.get('externalLineRows', 0)} |",
        f"| Strict exact-line matches with valid odds | {metrics.get('strictValidOddsMatches', 0)} |",
        f"| Strict match coverage | {pct_fmt(metrics.get('strictLineMatchCoveragePct'))} |",
        f"| Accuracy at external line | {pct_fmt(metrics.get('accuracyAtExternalLinePct'))} |",
        f"| Profit units at 1u flat stake | {money_fmt(metrics.get('profitUnits'))} |",
        f"| ROI at odds | {pct_fmt(metrics.get('roiPct'))} |",
        f"| Avg American odds | {money_fmt(metrics.get('avgAmericanOdds'))} |",
        f"| As-of timestamp coverage | {pct_fmt(metrics.get('asOfTimestampCoveragePct'))} |",
        f"| Closing line coverage | {pct_fmt(metrics.get('closingLineCoveragePct'))} |",
        f"| Avg side-aware line CLV | {money_fmt(metrics.get('avgLineClv'))} |",
        "",
        "## Match Status",
        "",
        "| Status | Count | Share |",
        "|---|---:|---:|",
    ]
    for status, count in report.get("matchStatusCounts", {}).items():
        lines.append(f"| {status} | {count} | {pct_fmt(pct(count, total))} |")

    lines.extend(["", "## By Market", "", "| Market | Picks | Strict Matches | Coverage | Accuracy | Profit | ROI |", "|---|---:|---:|---:|---:|---:|---:|"])
    for row in report.get("byMarket", []):
        lines.append(
            f"| {row['bucket']} | {row['samples']} | {row['strictMatches']} | {pct_fmt(row['coveragePct'])} | "
            f"{pct_fmt(row['accuracyPct'])} | {money_fmt(row['profitUnits'])} | {pct_fmt(row['roiPct'])} |"
        )

    def append_bias_table(title: str, rows: list[dict[str, Any]], max_rows: int = 12) -> None:
        lines.extend(
            [
                "",
                f"### {title}",
                "",
                "| Bucket | Picks | Strict Matches | Coverage | Matched Internal Acc | Unmatched Internal Acc | Gap | Matched External Acc | ROI | Avg Odds |",
                "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
            ]
        )
        for row in rows[:max_rows]:
            lines.append(
                f"| {row['bucket']} | {row['samples']} | {row['strictMatches']} | {pct_fmt(row['matchCoveragePct'])} | "
                f"{pct_fmt(row['matchedInternalAccuracyPct'])} | {pct_fmt(row['unmatchedInternalAccuracyPct'])} | "
                f"{pct_fmt(row['matchedVsUnmatchedInternalGapPct'])} | {pct_fmt(row['matchedExternalAccuracyPct'])} | "
                f"{pct_fmt(row['matchedRoiPct'])} | {money_fmt(row['avgMatchedOdds'])} |"
            )

    match_bias = report.get("matchBias", {})
    if match_bias:
        lines.extend(
            [
                "",
                "## Matched vs Unmatched Bias Diagnostics",
                "",
                "Internal accuracy compares the model's historical result labels for exact-line matched picks against the selected picks that did not exact-match the external line file.",
            ]
        )
        append_bias_table("By Side", match_bias.get("bySide", []))
        append_bias_table("By Tier", match_bias.get("byTier", []))
        append_bias_table("By Month", match_bias.get("byMonth", []))
        append_bias_table("By Line Bucket", match_bias.get("byLineBucket", []))
        append_bias_table("By Prior Bucket", match_bias.get("byPriorBucket", []))
        append_bias_table("By Final Score Bucket", match_bias.get("byFinalScoreBucket", []))
        append_bias_table("By Team", match_bias.get("byTeam", []), max_rows=20)
        append_bias_table("Top Player Buckets", match_bias.get("byPlayer", []), max_rows=20)
        append_bias_table("By Book", match_bias.get("byBook", []), max_rows=20)
        append_bias_table("By Price Bucket", match_bias.get("byPriceBucket", []))

    if report.get("fullCoverage"):
        full = report["fullCoverage"]
        lines.extend(
            [
                "",
                "## Full Coverage Diagnostic Layer",
                "",
                "This section grades every selected pick using a tiered ladder. Only `EXACT_EXTERNAL_LINE_VALID_ODDS` is exact external market proof.",
                "",
                "| Metric | Value |",
                "|---|---:|",
                f"| Full coverage rows | {full['metrics']['fullCoverageRows']} |",
                f"| Full coverage | {pct_fmt(full['metrics']['fullCoveragePct'])} |",
                f"| Full coverage accuracy | {pct_fmt(full['metrics']['fullCoverageAccuracyPct'])} |",
                f"| Full coverage profit | {money_fmt(full['metrics']['fullCoverageProfitUnits'])} |",
                f"| Full coverage ROI | {pct_fmt(full['metrics']['fullCoverageRoiPct'])} |",
                f"| External priced coverage | {pct_fmt(full['metrics']['externalPricedCoveragePct'])} |",
                f"| Assumed/internal fallback rows | {full['metrics']['assumedFallbackRows']} |",
                f"| Avg nearest external abs line gap | {money_fmt(full['metrics']['avgNearestAbsLineGap'])} |",
                f"| Max nearest external abs line gap | {money_fmt(full['metrics']['maxNearestAbsLineGap'])} |",
                "",
                "### By Coverage Tier",
                "",
                "| Tier | Rows | Share | Accuracy | Profit | ROI | Avg Abs Line Gap |",
                "|---|---:|---:|---:|---:|---:|---:|",
            ]
        )
        for row in full.get("byTier", []):
            lines.append(
                f"| {row['bucket']} | {row['samples']} | {pct_fmt(row['sharePct'])} | {pct_fmt(row['accuracyPct'])} | "
                f"{money_fmt(row['profitUnits'])} | {pct_fmt(row['roiPct'])} | {money_fmt(row['avgAbsLineGap'])} |"
            )

        lines.extend(["", "### Full Coverage By Market", "", "| Market | Rows | Accuracy | Profit | ROI | Avg Abs Line Gap |", "|---|---:|---:|---:|---:|---:|"])
        for row in full.get("byMarket", []):
            lines.append(
                f"| {row['bucket']} | {row['samples']} | {pct_fmt(row['accuracyPct'])} | {money_fmt(row['profitUnits'])} | "
                f"{pct_fmt(row['roiPct'])} | {money_fmt(row['avgAbsLineGap'])} |"
            )

    lines.extend(["", "## Interpretation", ""])
    lines.extend(f"- {item}" for item in report["interpretation"])
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    selected_path = Path(args.selected_csv)
    line_path = Path(args.line_csv)
    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    if not selected_path.exists() or not line_path.exists():
        report = {
            "generatedAt": utc_now(),
            "modelId": MODEL_ID,
            "modelVersion": MODEL_VERSION,
            "overallStatus": "PENDING",
            "inputs": {
                "selectedCsv": str(selected_path.resolve()),
                "lineCsv": str(line_path.resolve()),
                "selectedExists": selected_path.exists(),
                "lineExists": line_path.exists(),
            },
            "metrics": {
                "totalSelectedPicks": 0,
                "externalLineRows": 0,
            },
            "interpretation": [
                "Market proof cannot run until both the selected-pick CSV and a third-party line CSV exist.",
            ],
        }
        out_prefix.with_suffix(".json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        out_prefix.with_suffix(".md").write_text(markdown_report(report), encoding="utf-8")
        print(json.dumps({"overallStatus": "PENDING", "reason": "missing input file"}, indent=2))
        return

    selected = read_csv(selected_path)
    external_rows = read_csv(line_path)
    quotes = iter_quotes(external_rows)
    index = build_quote_index(quotes)

    proof_rows: list[dict[str, Any]] = []
    for pick in selected:
        key = quote_key(pick.get("date", ""), pick.get("playerName", ""), pick.get("market", ""))
        candidates = index.get(key, [])
        quote, match_status, evidence = choose_quote(pick, candidates, args.line_tolerance)
        nearest_quote = nearest_valid_same_side_quote(pick, candidates)
        model_line = clean_float(pick.get("line"))
        actual = clean_float(pick.get("actualValue"))
        side = (pick.get("side") or "").upper()
        estimated_prior = clean_float(pick.get("estimatedAccuracyPriorPct"))
        final_score = clean_float(pick.get("finalScore"))

        strict_match = match_status == "MATCHED_EXACT_LINE_VALID_ODDS"
        external_line = quote.get("line") if quote else None
        external_odds = quote.get("odds") if quote else None
        result = result_for_side(side, external_line, actual) if strict_match else ""
        profit = profit_at_odds(result, external_odds, args.stake_units) if strict_match else None
        close_line = quote.get("closeLine") if quote else None
        close_odds = quote.get("closeOdds") if quote else None
        line_clv = side_aware_line_value(side, external_line, close_line) if strict_match else None
        odds_clv = None
        if strict_match:
            lock_implied = implied_probability(external_odds)
            close_implied = implied_probability(close_odds)
            if lock_implied is not None and close_implied is not None:
                odds_clv = close_implied - lock_implied

        if strict_match:
            coverage_tier = "EXACT_EXTERNAL_LINE_VALID_ODDS"
            coverage_quote = quote
            coverage_line = external_line
            coverage_odds = external_odds
            coverage_book = quote.get("book") if quote else ""
            coverage_source = quote.get("source") if quote else ""
            coverage_source_url = quote.get("sourceUrl") if quote else ""
        elif nearest_quote is not None:
            coverage_tier = "NEAREST_EXTERNAL_LINE_VALID_ODDS"
            coverage_quote = nearest_quote
            coverage_line = nearest_quote.get("line")
            coverage_odds = nearest_quote.get("odds")
            coverage_book = nearest_quote.get("book") or ""
            coverage_source = nearest_quote.get("source") or ""
            coverage_source_url = nearest_quote.get("sourceUrl") or ""
        else:
            coverage_tier = "INTERNAL_MODEL_LINE_ASSUMED_ODDS"
            coverage_quote = None
            coverage_line = model_line
            coverage_odds = args.fallback_odds if valid_american_odds(args.fallback_odds) else DEFAULT_FALLBACK_ODDS
            coverage_book = "assumed"
            coverage_source = "internal-model-line-assumed-odds"
            coverage_source_url = ""

        result_at_coverage_line = result_for_side(side, coverage_line, actual)
        coverage_profit = profit_at_odds(result_at_coverage_line, coverage_odds, args.stake_units)
        coverage_gap = line_gap(model_line, coverage_line)
        coverage_abs_gap = abs_line_gap(model_line, coverage_line)
        coverage_side_aware_gap = side_aware_line_value(side, model_line, coverage_line)

        proof_rows.append(
            {
                "date": pick.get("date", ""),
                "selectedRank": pick.get("selectedRank", ""),
                "playerName": pick.get("playerName", ""),
                "teamCode": pick.get("teamCode", ""),
                "gameKey": pick.get("gameKey", ""),
                "market": pick.get("market", ""),
                "side": side,
                "tier": pick.get("tier", "") or "UNKNOWN",
                "month": bucket_month(pick.get("date", "")),
                "modelLine": model_line,
                "lineBucket": bucket_line(model_line),
                "actualValue": actual,
                "modelCorrect": boolish(pick.get("correct")),
                "estimatedAccuracyPriorPct": estimated_prior,
                "priorBucket": bucket_prior(estimated_prior),
                "finalScore": final_score,
                "finalScoreBucket": bucket_score(final_score),
                "matchStatus": match_status,
                "strictProofMatch": strict_match,
                "candidateCount": evidence["candidateCount"],
                "sameSideCount": evidence["sameSideCount"],
                "lineMatchCount": evidence["lineMatchCount"],
                "externalLine": external_line,
                "externalOdds": external_odds,
                "priceBucket": bucket_price(external_odds),
                "externalBook": quote.get("book") if quote else "",
                "externalSource": quote.get("source") if quote else "",
                "externalSourceUrl": quote.get("sourceUrl") if quote else "",
                "lineTimestampUtc": quote.get("snapshotAtUtc") if quote else "",
                "gameTimeUtc": quote.get("commenceTimeUtc") if quote else "",
                "closeLine": close_line,
                "closeOdds": close_odds,
                "closeTimestampUtc": quote.get("closeTimestampUtc") if quote else "",
                "resultAtExternalLine": result,
                "stakeUnits": args.stake_units if strict_match and profit is not None else "",
                "profitUnits": round_or_none(profit, 6),
                "lineClv": round_or_none(line_clv, 4),
                "oddsClv": round_or_none(odds_clv, 6),
                "coverageTier": coverage_tier,
                "coverageLine": coverage_line,
                "coverageOdds": coverage_odds,
                "coverageBook": coverage_book,
                "coverageSource": coverage_source,
                "coverageSourceUrl": coverage_source_url,
                "coverageIsExternal": coverage_quote is not None,
                "coverageIsExactExternal": strict_match,
                "coverageLineGap": round_or_none(coverage_gap, 4),
                "coverageAbsLineGap": round_or_none(coverage_abs_gap, 4),
                "coverageSideAwareLineGap": round_or_none(coverage_side_aware_gap, 4),
                "resultAtCoverageLine": result_at_coverage_line,
                "coverageStakeUnits": args.stake_units if coverage_profit is not None else "",
                "coverageProfitUnits": round_or_none(coverage_profit, 6),
            }
        )

    strict_rows = [row for row in proof_rows if row["strictProofMatch"]]
    graded_rows = [row for row in strict_rows if row["resultAtExternalLine"] in {"WIN", "LOSS", "PUSH"}]
    win_loss_rows = [row for row in graded_rows if row["resultAtExternalLine"] in {"WIN", "LOSS"}]
    wins = sum(1 for row in win_loss_rows if row["resultAtExternalLine"] == "WIN")
    profit_values = [row["profitUnits"] for row in graded_rows if isinstance(row.get("profitUnits"), (int, float))]
    stake = sum(row["stakeUnits"] for row in graded_rows if isinstance(row.get("profitUnits"), (int, float)))
    odds_values = [row["externalOdds"] for row in strict_rows if valid_american_odds(row.get("externalOdds"))]
    timestamp_rows = [row for row in strict_rows if row.get("lineTimestampUtc")]
    close_rows = [row for row in strict_rows if row.get("closeLine") is not None and row.get("closeOdds") is not None]
    clv_values = [row["lineClv"] for row in close_rows if isinstance(row.get("lineClv"), (int, float))]
    coverage_rows = [row for row in proof_rows if row.get("resultAtCoverageLine") in {"WIN", "LOSS", "PUSH"}]
    coverage_win_loss_rows = [row for row in coverage_rows if row.get("resultAtCoverageLine") in {"WIN", "LOSS"}]
    coverage_wins = sum(1 for row in coverage_win_loss_rows if row.get("resultAtCoverageLine") == "WIN")
    coverage_profit_values = [
        row["coverageProfitUnits"] for row in coverage_rows if isinstance(row.get("coverageProfitUnits"), (int, float))
    ]
    coverage_stake = sum(
        row["coverageStakeUnits"] for row in coverage_rows if isinstance(row.get("coverageProfitUnits"), (int, float))
    )
    external_priced_rows = [row for row in proof_rows if row.get("coverageTier") in {"EXACT_EXTERNAL_LINE_VALID_ODDS", "NEAREST_EXTERNAL_LINE_VALID_ODDS"}]
    nearest_rows = [row for row in proof_rows if row.get("coverageTier") == "NEAREST_EXTERNAL_LINE_VALID_ODDS"]
    fallback_rows = [row for row in proof_rows if row.get("coverageTier") == "INTERNAL_MODEL_LINE_ASSUMED_ODDS"]
    nearest_abs_gaps = [row.get("coverageAbsLineGap") for row in nearest_rows if isinstance(row.get("coverageAbsLineGap"), (int, float))]

    metrics = {
        "totalSelectedPicks": len(selected),
        "externalLineRows": len(external_rows),
        "externalQuotes": len(quotes),
        "strictValidOddsMatches": len(strict_rows),
        "strictLineMatchCoveragePct": pct(len(strict_rows), len(selected)) or 0.0,
        "gradedAtExternalLine": len(win_loss_rows),
        "winsAtExternalLine": wins,
        "lossesAtExternalLine": len(win_loss_rows) - wins,
        "pushesAtExternalLine": sum(1 for row in graded_rows if row["resultAtExternalLine"] == "PUSH"),
        "accuracyAtExternalLinePct": pct(wins, len(win_loss_rows)),
        "profitUnits": round_or_none(sum(profit_values), 4),
        "stakeUnits": round_or_none(stake, 4),
        "roiPct": pct(sum(profit_values), stake) if stake else None,
        "avgAmericanOdds": round_or_none(sum(odds_values) / len(odds_values), 2) if odds_values else None,
        "asOfTimestampCoveragePct": pct(len(timestamp_rows), len(strict_rows)) or 0.0,
        "closingLineCoveragePct": pct(len(close_rows), len(strict_rows)) or 0.0,
        "avgLineClv": round_or_none(sum(clv_values) / len(clv_values), 4) if clv_values else None,
        "lineTolerance": args.line_tolerance,
        "fallbackOdds": args.fallback_odds if valid_american_odds(args.fallback_odds) else DEFAULT_FALLBACK_ODDS,
    }
    full_coverage = {
        "metrics": {
            "fullCoverageRows": len(coverage_rows),
            "fullCoveragePct": pct(len(coverage_rows), len(selected)) or 0.0,
            "fullCoverageWins": coverage_wins,
            "fullCoverageLosses": len(coverage_win_loss_rows) - coverage_wins,
            "fullCoveragePushes": sum(1 for row in coverage_rows if row.get("resultAtCoverageLine") == "PUSH"),
            "fullCoverageAccuracyPct": pct(coverage_wins, len(coverage_win_loss_rows)),
            "fullCoverageProfitUnits": round_or_none(sum(coverage_profit_values), 4),
            "fullCoverageStakeUnits": round_or_none(coverage_stake, 4),
            "fullCoverageRoiPct": pct(sum(coverage_profit_values), coverage_stake) if coverage_stake else None,
            "externalPricedRows": len(external_priced_rows),
            "externalPricedCoveragePct": pct(len(external_priced_rows), len(selected)) or 0.0,
            "exactExternalRows": len(strict_rows),
            "nearestExternalRows": len(nearest_rows),
            "assumedFallbackRows": len(fallback_rows),
            "avgNearestAbsLineGap": round_or_none(sum(nearest_abs_gaps) / len(nearest_abs_gaps), 4)
            if nearest_abs_gaps
            else None,
            "maxNearestAbsLineGap": round_or_none(max(nearest_abs_gaps), 4) if nearest_abs_gaps else None,
            "fallbackOdds": args.fallback_odds if valid_american_odds(args.fallback_odds) else DEFAULT_FALLBACK_ODDS,
        },
        "byTier": summarize_coverage_by(proof_rows, "coverageTier"),
        "byMarket": summarize_coverage_by(proof_rows, "market"),
        "bySide": summarize_coverage_by(proof_rows, "side"),
    }
    match_counts = dict(Counter(row["matchStatus"] for row in proof_rows))
    report = {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "overallStatus": status_from_metrics(metrics),
        "inputs": {
            "selectedCsv": str(selected_path.resolve()),
            "lineCsv": str(line_path.resolve()),
            "selectedSha256": sha256_file(selected_path),
            "lineSha256": sha256_file(line_path),
        },
        "metrics": metrics,
        "matchStatusCounts": match_counts,
        "byMarket": summarize_by(proof_rows, "market"),
        "bySource": summarize_by(proof_rows, "externalSource"),
        "byBook": summarize_by([row for row in proof_rows if row.get("externalBook")], "externalBook")[:20],
        "fullCoverage": full_coverage,
        "matchBias": {
            "byMarket": summarize_match_bias(proof_rows, "market"),
            "bySide": summarize_match_bias(proof_rows, "side"),
            "byTier": summarize_match_bias(proof_rows, "tier"),
            "byMonth": summarize_match_bias(proof_rows, "month"),
            "byLineBucket": summarize_match_bias(proof_rows, "lineBucket"),
            "byPriorBucket": summarize_match_bias(proof_rows, "priorBucket"),
            "byFinalScoreBucket": summarize_match_bias(proof_rows, "finalScoreBucket"),
            "byPlayer": summarize_match_bias(proof_rows, "playerName", limit=30),
            "byTeam": summarize_match_bias(proof_rows, "teamCode"),
            "byBook": summarize_match_bias([row for row in proof_rows if row.get("externalBook")], "externalBook", limit=30),
            "byPriceBucket": summarize_match_bias(
                [row for row in proof_rows if row.get("priceBucket") != "UNKNOWN"],
                "priceBucket",
            ),
        },
        "interpretation": [
            "Strict proof requires an exact player/date/market/side/line match with valid American odds.",
            "ROI is graded only on strict exact-line matches, using the external line and external odds.",
            "The full-coverage diagnostic layer grades all selected picks using exact external lines first, nearest same-side external lines second, and internal model-line assumed odds only when no valid external line exists.",
            "Full-coverage diagnostic ROI is useful for coverage inspection, but it is not a replacement for exact-line as-of market proof.",
            "Matched-vs-unmatched diagnostics compare internal historical accuracy between the exact-line matched subset and the selected picks that did not exact-match the external line file.",
            "CLV remains pending unless the external file includes closeLine/closeOdds or equivalent closing fields.",
            "As-of safety remains pending unless the external file includes lineTimestampUtc/snapshotAtUtc and gameTimeUtc/commenceTimeUtc.",
            "This is market-proof grading, not live forward proof and not an independent as-of feature replay.",
        ],
    }

    json_path = out_prefix.with_suffix(".json")
    md_path = out_prefix.with_suffix(".md")
    csv_path = out_prefix.with_suffix(".csv")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(markdown_report(report), encoding="utf-8")
    write_csv(
        csv_path,
        proof_rows,
        [
            "date",
            "selectedRank",
            "playerName",
            "teamCode",
            "gameKey",
            "market",
            "side",
            "tier",
            "month",
            "modelLine",
            "lineBucket",
            "actualValue",
            "modelCorrect",
            "estimatedAccuracyPriorPct",
            "priorBucket",
            "finalScore",
            "finalScoreBucket",
            "matchStatus",
            "strictProofMatch",
            "candidateCount",
            "sameSideCount",
            "lineMatchCount",
            "externalLine",
            "externalOdds",
            "priceBucket",
            "externalBook",
            "externalSource",
            "externalSourceUrl",
            "lineTimestampUtc",
            "gameTimeUtc",
            "closeLine",
            "closeOdds",
            "closeTimestampUtc",
            "resultAtExternalLine",
            "stakeUnits",
            "profitUnits",
            "lineClv",
            "oddsClv",
            "coverageTier",
            "coverageLine",
            "coverageOdds",
            "coverageBook",
            "coverageSource",
            "coverageSourceUrl",
            "coverageIsExternal",
            "coverageIsExactExternal",
            "coverageLineGap",
            "coverageAbsLineGap",
            "coverageSideAwareLineGap",
            "resultAtCoverageLine",
            "coverageStakeUnits",
            "coverageProfitUnits",
        ],
    )

    print(
        json.dumps(
            {
                "overallStatus": report["overallStatus"],
                "strictLineMatchCoveragePct": metrics["strictLineMatchCoveragePct"],
                "accuracyAtExternalLinePct": metrics["accuracyAtExternalLinePct"],
                "profitUnits": metrics["profitUnits"],
                "roiPct": metrics["roiPct"],
                "fullCoveragePct": full_coverage["metrics"]["fullCoveragePct"],
                "fullCoverageAccuracyPct": full_coverage["metrics"]["fullCoverageAccuracyPct"],
                "fullCoverageRoiPct": full_coverage["metrics"]["fullCoverageRoiPct"],
                "externalPricedCoveragePct": full_coverage["metrics"]["externalPricedCoveragePct"],
                "asOfTimestampCoveragePct": metrics["asOfTimestampCoveragePct"],
                "closingLineCoveragePct": metrics["closingLineCoveragePct"],
                "outputs": {"json": str(json_path), "md": str(md_path), "csv": str(csv_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
