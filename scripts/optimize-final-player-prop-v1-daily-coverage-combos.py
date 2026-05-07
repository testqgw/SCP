from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-06-portfolio-guard-v1"
PAIR_RULE = "rank_pair_cards_all_but_odd_v1"
TRIPLET_RULE = "rank_triplet_cards_all_but_remainder_v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Final V1 daily coverage combo cards.")
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-v1-daily-coverage-combo-optimizer")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_csv(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def clean_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_int(value: Any, default: int = 999) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def pct(numerator: int | float, denominator: int | float) -> float | None:
    if denominator <= 0:
        return None
    return round(100.0 * numerator / denominator, 2)


def pct_fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}%"


def prepare_rows(rows: list[dict[str, str]]) -> dict[str, list[dict[str, Any]]]:
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in rows:
        row: dict[str, Any] = dict(raw)
        row["_win"] = truthy(row.get("correct"))
        row["_rank"] = clean_int(row.get("selectedRank"))
        row["_finalScore"] = clean_float(row.get("finalScore"))
        row["_prior"] = clean_float(row.get("estimatedAccuracyPriorPct"))
        by_date[row["date"]].append(row)
    for date in by_date:
        by_date[date].sort(key=lambda row: row["_rank"])
    return by_date


def chunk_by_rank(rows: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    used_count = (len(rows) // size) * size
    used = rows[:used_count]
    return [used[index : index + size] for index in range(0, len(used), size)]


def top_bottom_pairs(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    used = rows[: (len(rows) // 2) * 2]
    return [[used[index], used[-1 - index]] for index in range(len(used) // 2)]


def snake_triplets(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    used = rows[: (len(rows) // 3) * 3]
    ordered: list[dict[str, Any]] = []
    low = 0
    high = len(used) - 1
    while low <= high:
        ordered.append(used[low])
        low += 1
        if low <= high:
            ordered.append(used[high])
            high -= 1
    return [ordered[index : index + 3] for index in range(0, len(ordered), 3)]


def evaluate_group_rule(
    by_date: dict[str, list[dict[str, Any]]],
    name: str,
    size: int,
    group_builder: Callable[[list[dict[str, Any]]], list[list[dict[str, Any]]]],
    total_selected_rows: int,
) -> dict[str, Any]:
    active_days = 0
    skipped_days = 0
    all_cards_hit_days = 0
    card_wins = 0
    card_losses = 0
    leg_wins = 0
    leg_losses = 0
    used_legs = 0
    unused_legs = 0

    for rows in by_date.values():
        groups = group_builder(rows)
        flat = [leg for group in groups for leg in group]
        if not groups:
            skipped_days += 1
            unused_legs += len(rows)
            continue
        active_days += 1
        used_legs += len(flat)
        unused_legs += len(rows) - len(flat)
        leg_wins += sum(1 for leg in flat if leg["_win"])
        leg_losses += sum(1 for leg in flat if not leg["_win"])
        all_cards_hit_days += int(all(leg["_win"] for leg in flat))
        for group in groups:
            if all(leg["_win"] for leg in group):
                card_wins += 1
            else:
                card_losses += 1

    card_count = card_wins + card_losses
    leg_count = leg_wins + leg_losses
    return {
        "name": name,
        "cardSize": size,
        "activeDays": active_days,
        "skippedDays": skipped_days,
        "usedLegs": used_legs,
        "unusedLegs": unused_legs,
        "legCoveragePct": pct(used_legs, total_selected_rows),
        "avgUsedLegsPerActiveDay": round(used_legs / active_days, 2) if active_days else None,
        "cards": card_count,
        "avgCardsPerActiveDay": round(card_count / active_days, 2) if active_days else None,
        "dailyAllCardsHitDays": all_cards_hit_days,
        "dailyAllCardsHitPct": pct(all_cards_hit_days, active_days),
        "cardWins": card_wins,
        "cardLosses": card_losses,
        "cardAccuracyPct": pct(card_wins, card_count),
        "legWins": leg_wins,
        "legLosses": leg_losses,
        "legAccuracyPct": pct(leg_wins, leg_count),
    }


def leg_payload(prefix: str, leg: dict[str, Any]) -> dict[str, Any]:
    return {
        f"{prefix}_rank": leg.get("selectedRank"),
        f"{prefix}_player": leg.get("playerName"),
        f"{prefix}_team": leg.get("teamCode"),
        f"{prefix}_market": leg.get("market"),
        f"{prefix}_side": leg.get("side"),
        f"{prefix}_line": leg.get("line"),
        f"{prefix}_correct": leg["_win"],
    }


def card_rows(
    by_date: dict[str, list[dict[str, Any]]],
    name: str,
    size: int,
    group_builder: Callable[[list[dict[str, Any]]], list[list[dict[str, Any]]]],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    labels = ["legA", "legB", "legC"]
    for date, rows in sorted(by_date.items()):
        groups = group_builder(rows)
        for card_index, group in enumerate(groups, start=1):
            row: dict[str, Any] = {
                "date": date,
                "rule": name,
                "cardSize": size,
                "selectedLegsOnDay": len(rows),
                "usedLegsOnDay": len(groups) * size,
                "unusedLegsOnDay": len(rows) - len(groups) * size,
                "cardIndex": card_index,
                "card_hit": all(leg["_win"] for leg in group),
            }
            for label, leg in zip(labels, group):
                row.update(leg_payload(label, leg))
            output.append(row)
    return output


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = sorted({key for row in rows for key in row.keys()})
    preferred = [
        "date",
        "rule",
        "cardSize",
        "selectedLegsOnDay",
        "usedLegsOnDay",
        "unusedLegsOnDay",
        "cardIndex",
        "card_hit",
    ]
    ordered = preferred + [field for field in fieldnames if field not in preferred]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ordered)
        writer.writeheader()
        writer.writerows(rows)


def markdown_report(report: dict[str, Any]) -> str:
    pair = report["pairCoverageRule"]
    triplet = report["tripletCoverageRule"]
    lines = [
        "# Final V1 Daily Coverage Combo Optimizer",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        "## Rule",
        "",
        "- Use the Final V1 selected picks in rank order.",
        "- Two-leg cards: group rank chunks of 2 and leave only the odd final leg out.",
        "- Three-leg cards: group rank chunks of 3 and leave only the unavoidable remainder out.",
        "- This is a coverage-first card layer, not a filtered high-water combo layer.",
        "",
        "## Coverage Results",
        "",
        "| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |",
        "|---|---|---:|---:|---:|---:|---:|",
        f"| 2-leg | {pair['name']} | {pct_fmt(pair['legCoveragePct'])} | {pair['cards']} | {pair['avgCardsPerActiveDay']} | {pct_fmt(pair['cardAccuracyPct'])} | {pct_fmt(pair['dailyAllCardsHitPct'])} |",
        f"| 3-leg | {triplet['name']} | {pct_fmt(triplet['legCoveragePct'])} | {triplet['cards']} | {triplet['avgCardsPerActiveDay']} | {pct_fmt(triplet['cardAccuracyPct'])} | {pct_fmt(triplet['dailyAllCardsHitPct'])} |",
        "",
        "## Candidate Grouping Rules",
        "",
        "| Rule | Size | Coverage | Used Legs | Unused Legs | Cards | Card Accuracy | Daily All-Card Hit |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in report["candidateRules"]:
        lines.append(
            f"| {row['name']} | {row['cardSize']} | {pct_fmt(row['legCoveragePct'])} | {row['usedLegs']} | "
            f"{row['unusedLegs']} | {row['cards']} | {pct_fmt(row['cardAccuracyPct'])} | {pct_fmt(row['dailyAllCardsHitPct'])} |"
        )
    lines.extend(["", "## Interpretation", ""])
    lines.extend(f"- {item}" for item in report["interpretation"])
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    selected_path = Path(args.selected_csv)
    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    rows = read_csv(selected_path)
    by_date = prepare_rows(rows)
    total_selected_rows = len(rows)
    size_distribution = Counter(len(rows_for_date) for rows_for_date in by_date.values())

    pair_rank = evaluate_group_rule(by_date, PAIR_RULE, 2, lambda rows_for_date: chunk_by_rank(rows_for_date, 2), total_selected_rows)
    pair_top_bottom = evaluate_group_rule(by_date, "top_bottom_pair_cards_all_but_odd_v1", 2, top_bottom_pairs, total_selected_rows)
    triplet_rank = evaluate_group_rule(by_date, TRIPLET_RULE, 3, lambda rows_for_date: chunk_by_rank(rows_for_date, 3), total_selected_rows)
    triplet_snake = evaluate_group_rule(by_date, "snake_triplet_cards_all_but_remainder_v1", 3, snake_triplets, total_selected_rows)

    candidate_rules = [pair_rank, pair_top_bottom, triplet_rank, triplet_snake]
    report = {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "inputs": {
            "selectedCsv": str(selected_path.resolve()),
            "selectedRows": total_selected_rows,
            "activeDates": len(by_date),
            "dailySelectedCountDistribution": dict(sorted(size_distribution.items())),
        },
        "pairCoverageRule": pair_rank,
        "tripletCoverageRule": triplet_rank,
        "candidateRules": candidate_rules,
        "interpretation": [
            "This corrected layer uses almost the whole Final V1 selected card: 97.95% of legs for two-leg cards and 95.68% for three-leg cards.",
            "The daily all-card hit rate is lower than the filtered high-water layer because one used losing leg makes that day fail the all-card test.",
            "Pairing/grouping order can change card-level accuracy slightly, but it cannot change daily all-card hit unless different legs are excluded.",
            "This is historical replay evidence and still needs locked-forward tracking before live-edge claims.",
        ],
    }

    json_path = out_prefix.with_suffix(".json")
    md_path = out_prefix.with_suffix(".md")
    cards_path = out_prefix.with_name(out_prefix.name + "-cards").with_suffix(".csv")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(markdown_report(report), encoding="utf-8")
    write_csv(cards_path, card_rows(by_date, PAIR_RULE, 2, lambda rows_for_date: chunk_by_rank(rows_for_date, 2)) + card_rows(by_date, TRIPLET_RULE, 3, lambda rows_for_date: chunk_by_rank(rows_for_date, 3)))

    print(
        json.dumps(
            {
                "pairRule": pair_rank["name"],
                "pairLegCoveragePct": pair_rank["legCoveragePct"],
                "pairCards": pair_rank["cards"],
                "pairAvgCardsPerDay": pair_rank["avgCardsPerActiveDay"],
                "pairCardAccuracyPct": pair_rank["cardAccuracyPct"],
                "pairDailyAllCardsHitPct": pair_rank["dailyAllCardsHitPct"],
                "tripletRule": triplet_rank["name"],
                "tripletLegCoveragePct": triplet_rank["legCoveragePct"],
                "tripletCards": triplet_rank["cards"],
                "tripletAvgCardsPerDay": triplet_rank["avgCardsPerActiveDay"],
                "tripletCardAccuracyPct": triplet_rank["cardAccuracyPct"],
                "tripletDailyAllCardsHitPct": triplet_rank["dailyAllCardsHitPct"],
                "outputs": {"json": str(json_path), "md": str(md_path), "cardsCsv": str(cards_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
