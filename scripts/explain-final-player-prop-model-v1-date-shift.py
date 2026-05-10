from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OFFSETS = [1, -1, 3, 7]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Explain Final V1 selected-pick date-shift stability.")
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument("--board-csv", default="exports/final-player-prop-model-v1-walk-forward-board.csv")
    parser.add_argument("--audit-json", default="exports/final-player-prop-model-v1-backtest-audit.json")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-model-v1-date-shift-explain")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_csv_rows(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_json(path: str | Path) -> dict[str, Any] | None:
    target = Path(path)
    if not target.exists():
        return None
    return json.loads(target.read_text(encoding="utf-8"))


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def clean_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def pct(wins: int, samples: int) -> float | None:
    return round(100.0 * wins / samples, 2) if samples else None


def pct_text(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}%"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    samples = len(rows)
    wins = sum(1 for row in rows if row.get("win") is True)
    losses = sum(1 for row in rows if row.get("win") is False)
    pushes = samples - wins - losses
    graded = wins + losses
    return {
        "samples": samples,
        "graded": graded,
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "accuracyPct": pct(wins, graded),
    }


def summarize_selected(rows: list[dict[str, str]]) -> dict[str, Any]:
    samples = len(rows)
    wins = sum(1 for row in rows if truthy(row.get("correct")))
    return {"samples": samples, "wins": wins, "losses": samples - wins, "accuracyPct": pct(wins, samples)}


def bucket_prior(value: Any) -> str:
    number = clean_float(value)
    if number is None:
        return "NA"
    if number >= 94:
        return "94+"
    if number >= 92:
        return "92-94"
    if number >= 90:
        return "90-92"
    if number >= 88:
        return "88-90"
    return "<88"


def bucket_score(value: Any) -> str:
    number = clean_float(value)
    if number is None:
        return "NA"
    if number >= 0.9:
        return "0.90+"
    if number >= 0.85:
        return "0.85-0.90"
    if number >= 0.8:
        return "0.80-0.85"
    if number >= 0.75:
        return "0.75-0.80"
    return "<0.75"


def bucket_line(market: str, value: Any) -> str:
    number = clean_float(value)
    if number is None:
        return "NA"
    if market in {"REB", "AST", "THREES"}:
        if number <= 1.5:
            return "<=1.5"
        if number <= 3.5:
            return "2-3.5"
        if number <= 5.5:
            return "4-5.5"
        if number <= 7.5:
            return "6-7.5"
        return "8+"
    if market in {"PRA", "PA", "PR", "RA"}:
        if number <= 10.5:
            return "<=10.5"
        if number <= 18.5:
            return "11-18.5"
        if number <= 26.5:
            return "19-26.5"
        if number <= 34.5:
            return "27-34.5"
        return "35+"
    if number <= 9.5:
        return "<=9.5"
    if number <= 14.5:
        return "10-14.5"
    if number <= 19.5:
        return "15-19.5"
    if number <= 24.5:
        return "20-24.5"
    return "25+"


def row_bucket(row: dict[str, str], key: str) -> str:
    if key == "priorBucket":
        return bucket_prior(row.get("estimatedAccuracyPriorPct"))
    if key == "scoreBucket":
        return bucket_score(row.get("finalScore"))
    if key == "lineBucket":
        return f"{row.get('market') or 'NA'}:{bucket_line(row.get('market') or '', row.get('line'))}"
    if key == "riskFlags":
        return row.get("riskFlags") or "none"
    if key == "components":
        return row.get("components") or "none"
    return row.get(key) or "NA"


def summarize_by(rows: list[dict[str, Any]], key: str, top_n: int = 12) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        source = row.get("sourceRow") or {}
        groups[row_bucket(source, key)].append(row)
    output = []
    for name, group in groups.items():
        summary = summarize(group)
        output.append({"bucket": name, **summary})
    return sorted(output, key=lambda item: (-item["samples"], item["bucket"]))[:top_n]


def side_wins(side: str, line: float | None, actual: float | None) -> bool | None:
    if line is None or actual is None:
        return None
    if actual == line:
        return None
    if side == "OVER":
        return actual > line
    if side == "UNDER":
        return actual < line
    return None


def selected_rank_date_shift(selected_rows: list[dict[str, str]], offset: int) -> list[dict[str, Any]]:
    dates = sorted({row.get("date", "") for row in selected_rows})
    shifted_date = {date: dates[(index + offset) % len(dates)] for index, date in enumerate(dates)}
    rows_by_rank_date: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in selected_rows:
        rows_by_rank_date[(row.get("selectedRank", ""), row.get("date", ""))].append(row)
    output = []
    for row in selected_rows:
        shifted = rows_by_rank_date.get((row.get("selectedRank", ""), shifted_date.get(row.get("date", ""), "")), [])
        shifted_row = shifted[0] if shifted else None
        if shifted_row is None:
            continue
        output.append(
            {
                "sourceRow": row,
                "shiftedRow": shifted_row,
                "win": truthy(shifted_row.get("correct")),
                "date": row.get("date"),
                "shiftedDate": shifted_row.get("date"),
            }
        )
    return output


def index_board_by_player_market(board_rows: list[dict[str, str]]) -> dict[tuple[str, str], list[dict[str, str]]]:
    grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in board_rows:
        grouped[(row.get("playerName", ""), row.get("market", ""))].append(row)
    for key in grouped:
        grouped[key].sort(key=lambda row: (row.get("date", ""), row.get("gameKey", ""), row.get("line", "")))
    return grouped


def same_player_market_shift(
    selected_rows: list[dict[str, str]],
    board_by_player_market: dict[tuple[str, str], list[dict[str, str]]],
    offset: int,
    prefer_same_line_bucket: bool = False,
) -> list[dict[str, Any]]:
    output = []
    for row in selected_rows:
        bucket = (row.get("playerName", ""), row.get("market", ""))
        candidates = board_by_player_market.get(bucket, [])
        current_indexes = [
            index
            for index, candidate in enumerate(candidates)
            if candidate.get("date") == row.get("date") and candidate.get("gameKey") == row.get("gameKey")
        ]
        if not current_indexes:
            continue
        current_index = current_indexes[0]
        target_index = current_index + offset
        if target_index < 0 or target_index >= len(candidates):
            continue
        shifted_row = candidates[target_index]
        source_line = clean_float(row.get("line"))
        shifted_actual = clean_float(shifted_row.get("actualValue"))
        win = side_wins(row.get("side", ""), source_line, shifted_actual)
        line_bucket_match = bucket_line(row.get("market", ""), row.get("line")) == bucket_line(shifted_row.get("market", ""), shifted_row.get("line"))
        if prefer_same_line_bucket and not line_bucket_match:
            same_bucket_indexes = [
                index
                for index, candidate in enumerate(candidates)
                if index != current_index
                and ((index > current_index and offset > 0) or (index < current_index and offset < 0))
                and bucket_line(row.get("market", ""), row.get("line")) == bucket_line(candidate.get("market", ""), candidate.get("line"))
            ]
            if same_bucket_indexes:
                target_index = same_bucket_indexes[0] if offset > 0 else same_bucket_indexes[-1]
                shifted_row = candidates[target_index]
                shifted_actual = clean_float(shifted_row.get("actualValue"))
                win = side_wins(row.get("side", ""), source_line, shifted_actual)
                line_bucket_match = True
        output.append(
            {
                "sourceRow": row,
                "shiftedRow": shifted_row,
                "win": win,
                "date": row.get("date"),
                "shiftedDate": shifted_row.get("date"),
                "sameSide": row.get("side") == shifted_row.get("side"),
                "sameLineBucket": line_bucket_match,
                "sameExactLine": clean_float(row.get("line")) == clean_float(shifted_row.get("line")),
                "actualValue": shifted_actual,
            }
        )
    return output


def availability(rows: list[dict[str, Any]], total: int) -> dict[str, Any]:
    same_side = sum(1 for row in rows if row.get("sameSide"))
    same_bucket = sum(1 for row in rows if row.get("sameLineBucket"))
    same_line = sum(1 for row in rows if row.get("sameExactLine"))
    return {
        "matched": len(rows),
        "coveragePct": pct(len(rows), total),
        "sameSidePct": pct(same_side, len(rows)),
        "sameLineBucketPct": pct(same_bucket, len(rows)),
        "sameExactLinePct": pct(same_line, len(rows)),
    }


def top_shifted_winners(rows: list[dict[str, Any]], key: str, top_n: int = 10) -> list[dict[str, Any]]:
    winners = [row for row in rows if row.get("win") is True]
    counts = Counter(row_bucket(row.get("sourceRow") or {}, key) for row in winners)
    total = len(winners)
    return [
        {"bucket": bucket, "wins": count, "sharePct": pct(count, total)}
        for bucket, count in counts.most_common(top_n)
    ]


def markdown_table(rows: list[dict[str, Any]], cols: list[str]) -> list[str]:
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for row in rows:
        values = []
        for col in cols:
            value = row.get(col)
            if isinstance(value, float):
                value = f"{value:.2f}"
            values.append(str(value if value is not None else "-"))
        lines.append("| " + " | ".join(values) + " |")
    return lines


def build_shift_report(name: str, rows: list[dict[str, Any]], total_selected: int) -> dict[str, Any]:
    return {
        "name": name,
        "summary": summarize(rows),
        "availability": availability(rows, total_selected),
        "byMarket": summarize_by(rows, "market"),
        "bySide": summarize_by(rows, "side"),
        "byTier": summarize_by(rows, "tier"),
        "byPriorBucket": summarize_by(rows, "priorBucket"),
        "byLineBucket": summarize_by(rows, "lineBucket"),
        "byRiskFlags": summarize_by(rows, "riskFlags"),
        "topWinningPlayers": top_shifted_winners(rows, "playerName"),
        "topWinningMarkets": top_shifted_winners(rows, "market"),
    }


def markdown_report(report: dict[str, Any]) -> str:
    actual = report["actualSelected"]
    lines = [
        "# Final V1 Date-Shift Explainer",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        "## Actual Selected Result",
        "",
        f"- Accuracy: {pct_text(actual['accuracyPct'])}",
        f"- Record: {actual['wins']}-{actual['losses']}",
        f"- Picks: {actual['samples']}",
        "",
        "## Shift Summary",
        "",
        "| Test | Accuracy | Record | Coverage | Same side | Same line bucket |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for shift in report["shifts"]:
        summary = shift["summary"]
        availability_info = shift["availability"]
        lines.append(
            "| "
            + " | ".join(
                [
                    shift["name"],
                    pct_text(summary["accuracyPct"]),
                    f"{summary['wins']}-{summary['losses']}",
                    pct_text(availability_info.get("coveragePct")),
                    pct_text(availability_info.get("sameSidePct")),
                    pct_text(availability_info.get("sameLineBucketPct")),
                ]
            )
            + " |"
        )
    lines.extend(["", "## Strongest Same-Player Same-Market Shift", ""])
    strongest = report["strongestSamePlayerMarketShift"]
    lines.extend(
        [
            f"- Test: {strongest['name']}",
            f"- Accuracy: {pct_text(strongest['summary']['accuracyPct'])}",
            f"- Coverage: {pct_text(strongest['availability']['coveragePct'])}",
            f"- Same line bucket: {pct_text(strongest['availability']['sameLineBucketPct'])}",
            "",
            "### By Market",
            "",
        ]
    )
    lines.extend(markdown_table(strongest["byMarket"], ["bucket", "samples", "wins", "losses", "accuracyPct"]))
    lines.extend(["", "### By Prior Bucket", ""])
    lines.extend(markdown_table(strongest["byPriorBucket"], ["bucket", "samples", "wins", "losses", "accuracyPct"]))
    lines.extend(["", "### Top Shifted Winning Players", ""])
    lines.extend(markdown_table(strongest["topWinningPlayers"], ["bucket", "wins", "sharePct"]))
    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- Selected-rank date shifts preserve the selected slice and are stability diagnostics, not strict leakage tests.",
            "- Same-player same-market shifts regrade the original side/line against nearby actual stat outcomes for the same player and market.",
            "- High same-player same-market shifted accuracy points toward stable player/market pockets; low availability or suspicious exact-row matches would be more concerning.",
            "- This report explains the selected-rank date-shift diagnostic; it does not replace third-party as-of replay, odds/CLV/ROI grading, or live locked-forward proof.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    selected_rows = read_csv_rows(args.selected_csv)
    board_rows = read_csv_rows(args.board_csv)
    audit = load_json(args.audit_json)
    board_by_player_market = index_board_by_player_market(board_rows)

    rank_date_shifts = [
        build_shift_report(f"selected-rank date shift {offset:+d}", selected_rank_date_shift(selected_rows, offset), len(selected_rows))
        for offset in OFFSETS
    ]
    same_player_shifts = [
        build_shift_report(
            f"same-player same-market shift {offset:+d}",
            same_player_market_shift(selected_rows, board_by_player_market, offset),
            len(selected_rows),
        )
        for offset in OFFSETS
    ]
    same_player_line_bucket_shifts = [
        build_shift_report(
            f"same-player same-market line-bucket shift {offset:+d}",
            same_player_market_shift(selected_rows, board_by_player_market, offset, prefer_same_line_bucket=True),
            len(selected_rows),
        )
        for offset in OFFSETS
    ]
    all_same_player = same_player_shifts + same_player_line_bucket_shifts
    strongest_same_player = max(
        all_same_player,
        key=lambda item: item["summary"]["accuracyPct"] or 0,
    )

    report = {
        "generatedAt": utc_now(),
        "source": {
            "selectedCsv": str(Path(args.selected_csv).resolve()),
            "boardCsv": str(Path(args.board_csv).resolve()),
            "auditJson": str(Path(args.audit_json).resolve()) if Path(args.audit_json).exists() else None,
        },
        "actualSelected": summarize_selected(selected_rows),
        "auditDateShiftWarning": next(
            (item for item in (audit or {}).get("checks", []) if item.get("name") == "DATE_SHIFT_DIAGNOSTIC"),
            None,
        ),
        "shifts": rank_date_shifts + same_player_shifts + same_player_line_bucket_shifts,
        "strongestSamePlayerMarketShift": strongest_same_player,
        "claimBoundary": {
            "explains": "Breaks down whether selected-only date-shift controls remain stable because of a weak rank/date diagnostic or same-player/same-market persistence.",
            "doesNotProve": "No-leakage, third-party as-of replay, odds/CLV/ROI, or live forward profitability.",
        },
    }

    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = Path(f"{out_prefix}.json")
    md_path = Path(f"{out_prefix}.md")
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(markdown_report(report) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "actualSelectedAccuracyPct": report["actualSelected"]["accuracyPct"],
                "strongestSamePlayerMarketShift": {
                    "name": strongest_same_player["name"],
                    "accuracyPct": strongest_same_player["summary"]["accuracyPct"],
                    "coveragePct": strongest_same_player["availability"]["coveragePct"],
                    "sameLineBucketPct": strongest_same_player["availability"]["sameLineBucketPct"],
                },
                "outputs": {"json": str(json_path), "md": str(md_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
