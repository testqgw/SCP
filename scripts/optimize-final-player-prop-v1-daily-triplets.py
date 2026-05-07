from __future__ import annotations

import argparse
import csv
import itertools
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-06-portfolio-guard-v1"
RECOMMENDED_RULE = "daily_top6_under_else_top3_triplets_v1"
HIGH_WATER_RULE = "daily_top3_no_pts_pra_else_top3_triplets_v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize Final V1 daily all three-leg combo rules.")
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-v1-daily-triplet-optimizer")
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


def top_n(rows: list[dict[str, Any]], n: int, pred: Callable[[dict[str, Any]], bool]) -> list[dict[str, Any]]:
    return [row for row in rows if pred(row)][:n]


def fallback_selector(
    n: int,
    pred: Callable[[dict[str, Any]], bool],
    fallback_n: int = 3,
) -> Callable[[list[dict[str, Any]]], list[dict[str, Any]]]:
    def select(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        filtered = top_n(rows, n, pred)
        return filtered if len(filtered) >= 3 else rows[:fallback_n]

    return select


def recommended_selector(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    under = top_n(rows, 6, lambda row: row.get("side") == "UNDER")
    return under if len(under) >= 3 else rows[:3]


def high_water_selector(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    no_pts_pra = top_n(rows, 3, lambda row: row.get("market") not in {"PTS", "PRA"})
    return no_pts_pra if len(no_pts_pra) >= 3 else rows[:3]


def all_three_leg_combos(rows: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]:
    return list(itertools.combinations(rows, 3))


def evaluate_rule(
    by_date: dict[str, list[dict[str, Any]]],
    name: str,
    selector: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
) -> dict[str, Any]:
    active_days = 0
    skipped_days = 0
    perfect_days = 0
    combo_wins = 0
    combo_losses = 0
    leg_wins = 0
    leg_losses = 0
    selected_legs = 0

    for rows in by_date.values():
        selected = selector(rows)
        if len(selected) < 3:
            skipped_days += 1
            continue
        combos = all_three_leg_combos(selected)
        if not combos:
            skipped_days += 1
            continue
        active_days += 1
        selected_legs += len(selected)
        leg_wins += sum(1 for row in selected if row["_win"])
        leg_losses += sum(1 for row in selected if not row["_win"])
        day_perfect = all(row["_win"] for row in selected)
        perfect_days += int(day_perfect)
        for combo in combos:
            if all(leg["_win"] for leg in combo):
                combo_wins += 1
            else:
                combo_losses += 1

    combo_count = combo_wins + combo_losses
    leg_count = leg_wins + leg_losses
    return {
        "name": name,
        "activeDays": active_days,
        "skippedDays": skipped_days,
        "selectedLegs": selected_legs,
        "avgSelectedLegsPerActiveDay": round(selected_legs / active_days, 2) if active_days else None,
        "threeLegCombos": combo_count,
        "avgCombosPerActiveDay": round(combo_count / active_days, 2) if active_days else None,
        "dailyAllCombosHitDays": perfect_days,
        "dailyAllCombosHitPct": pct(perfect_days, active_days),
        "comboWins": combo_wins,
        "comboLosses": combo_losses,
        "comboAccuracyPct": pct(combo_wins, combo_count),
        "legWins": leg_wins,
        "legLosses": leg_losses,
        "legAccuracyPct": pct(leg_wins, leg_count),
    }


def build_candidate_rules() -> list[tuple[str, Callable[[list[dict[str, Any]]], list[dict[str, Any]]]]]:
    filters: list[tuple[str, Callable[[dict[str, Any]], bool]]] = [
        ("non_pts", lambda row: row.get("market") != "PTS"),
        ("no_pts_pra", lambda row: row.get("market") not in {"PTS", "PRA"}),
        ("reb_ast_threes", lambda row: row.get("market") in {"REB", "AST", "THREES"}),
        ("singles", lambda row: row.get("market") in {"PTS", "REB", "AST", "THREES"}),
        ("non_combo", lambda row: row.get("market") not in {"PRA", "PA", "PR", "RA"}),
        ("non_pr", lambda row: row.get("market") != "PR"),
        ("under", lambda row: row.get("side") == "UNDER"),
        ("over", lambda row: row.get("side") == "OVER"),
        ("tier_a", lambda row: row.get("tier") == "A"),
        ("score_0_90", lambda row: (row["_finalScore"] or 0) >= 0.90),
        ("score_0_88", lambda row: (row["_finalScore"] or 0) >= 0.88),
        ("score_0_86", lambda row: (row["_finalScore"] or 0) >= 0.86),
    ]

    rules: list[tuple[str, Callable[[list[dict[str, Any]]], list[dict[str, Any]]]]] = [
        ("baseline_all_selected_all_three_leg_combos", lambda rows: rows),
        (RECOMMENDED_RULE, recommended_selector),
        (HIGH_WATER_RULE, high_water_selector),
        ("top3_all_selected_triplets_v1", lambda rows: rows[:3]),
        ("top4_all_selected_triplets_v1", lambda rows: rows[:4]),
        ("top6_all_selected_triplets_v1", lambda rows: rows[:6]),
    ]
    for n in [3, 4, 5, 6]:
        for label, pred in filters:
            name = f"daily_top{n}_{label}_else_top3_triplets_v1"
            if name in {RECOMMENDED_RULE, HIGH_WATER_RULE}:
                continue
            rules.append((name, fallback_selector(n, pred)))
    return rules


def combo_row(
    date: str,
    rule: str,
    combo_index: int,
    leg_a: dict[str, Any],
    leg_b: dict[str, Any],
    leg_c: dict[str, Any],
    selected_count: int,
) -> dict[str, Any]:
    return {
        "date": date,
        "rule": rule,
        "selectedLegsOnDay": selected_count,
        "comboIndex": combo_index,
        "legA_rank": leg_a.get("selectedRank"),
        "legA_player": leg_a.get("playerName"),
        "legA_team": leg_a.get("teamCode"),
        "legA_market": leg_a.get("market"),
        "legA_side": leg_a.get("side"),
        "legA_line": leg_a.get("line"),
        "legA_correct": leg_a["_win"],
        "legB_rank": leg_b.get("selectedRank"),
        "legB_player": leg_b.get("playerName"),
        "legB_team": leg_b.get("teamCode"),
        "legB_market": leg_b.get("market"),
        "legB_side": leg_b.get("side"),
        "legB_line": leg_b.get("line"),
        "legB_correct": leg_b["_win"],
        "legC_rank": leg_c.get("selectedRank"),
        "legC_player": leg_c.get("playerName"),
        "legC_team": leg_c.get("teamCode"),
        "legC_market": leg_c.get("market"),
        "legC_side": leg_c.get("side"),
        "legC_line": leg_c.get("line"),
        "legC_correct": leg_c["_win"],
        "combo_hit": bool(leg_a["_win"] and leg_b["_win"] and leg_c["_win"]),
    }


def build_recommended_combo_rows(by_date: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for date, rows in sorted(by_date.items()):
        selected = recommended_selector(rows)
        for combo_index, (leg_a, leg_b, leg_c) in enumerate(all_three_leg_combos(selected), start=1):
            output.append(combo_row(date, RECOMMENDED_RULE, combo_index, leg_a, leg_b, leg_c, len(selected)))
    return output


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def markdown_report(report: dict[str, Any]) -> str:
    recommended = report["recommendedRule"]
    high_water = report["highWaterRule"]
    baseline = report["baselineAllSelected"]
    lines = [
        "# Final V1 Daily Three-Leg Combo Optimizer",
        "",
        f"Generated: {report['generatedAt']}",
        f"Recommended all-triplet rule: **{recommended['name']}**",
        f"High-water one-triplet rule: **{high_water['name']}**",
        "",
        "## Recommended Rule",
        "",
        "- For each slate, take up to the top 6 `UNDER` legs from the Final V1 selected set.",
        "- If fewer than 3 `UNDER` legs exist, fall back to the top 3 overall Final V1 legs.",
        "- Generate and grade **all three-leg combinations** from that daily set.",
        "",
        "## Baseline Constraint",
        "",
        f"- All original selected legs: {baseline['dailyAllCombosHitDays']}/{baseline['activeDays']} perfect days, {pct_fmt(baseline['dailyAllCombosHitPct'])}.",
        "- If a daily selected set contains one losing leg, at least one three-leg combo loses.",
        "",
        "## Recommended Result",
        "",
        "| Metric | Value |",
        "|---|---:|",
    ]
    for key in [
        "activeDays",
        "skippedDays",
        "selectedLegs",
        "avgSelectedLegsPerActiveDay",
        "threeLegCombos",
        "avgCombosPerActiveDay",
        "dailyAllCombosHitDays",
        "dailyAllCombosHitPct",
        "comboWins",
        "comboLosses",
        "comboAccuracyPct",
        "legAccuracyPct",
    ]:
        value = recommended.get(key)
        rendered = pct_fmt(value) if key.endswith("Pct") else str(value)
        lines.append(f"| {key} | {rendered} |")

    lines.extend(
        [
            "",
            "## High-Water Rule",
            "",
            "| Metric | Value |",
            "|---|---:|",
            f"| dailyAllCombosHitPct | {pct_fmt(high_water['dailyAllCombosHitPct'])} |",
            f"| dailyAllCombosHitDays | {high_water['dailyAllCombosHitDays']}/{high_water['activeDays']} |",
            f"| threeLegCombos | {high_water['threeLegCombos']} |",
            f"| avgCombosPerActiveDay | {high_water['avgCombosPerActiveDay']} |",
            "",
            "## Candidate Rules",
            "",
            "| Rule | Days | Skipped | Legs | Avg Legs | Triplets | Daily All-Triplet Hit | Triplet Accuracy |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for row in report["candidateRules"]:
        lines.append(
            f"| {row['name']} | {row['activeDays']} | {row['skippedDays']} | {row['selectedLegs']} | "
            f"{row['avgSelectedLegsPerActiveDay']} | {row['threeLegCombos']} | {pct_fmt(row['dailyAllCombosHitPct'])} | "
            f"{pct_fmt(row['comboAccuracyPct'])} |"
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
    candidates = [evaluate_rule(by_date, name, selector) for name, selector in build_candidate_rules()]
    candidates.sort(
        key=lambda row: (
            row["dailyAllCombosHitPct"] or 0,
            row["activeDays"],
            row["threeLegCombos"],
            row["selectedLegs"],
        ),
        reverse=True,
    )
    baseline = next(row for row in candidates if row["name"] == "baseline_all_selected_all_three_leg_combos")
    recommended = next(row for row in candidates if row["name"] == RECOMMENDED_RULE)
    high_water = next(row for row in candidates if row["name"] == HIGH_WATER_RULE)

    loss_distribution = Counter(sum(1 for row in rows_for_date if not row["_win"]) for rows_for_date in by_date.values())
    combo_rows = build_recommended_combo_rows(by_date)

    report = {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "inputs": {
            "selectedCsv": str(selected_path.resolve()),
            "selectedRows": len(rows),
            "activeDates": len(by_date),
        },
        "baselineAllSelected": baseline,
        "recommendedRule": recommended,
        "highWaterRule": high_water,
        "candidateRules": candidates,
        "lossDistributionByOriginalDay": dict(sorted(loss_distribution.items())),
        "interpretation": [
            "This improves the daily all-three-leg-combo hit rate by changing the daily selected-leg set, not by selecting only one hand-picked triplet.",
            "The recommended rule grades every three-leg combination from the selected daily set and clears the 80% daily all-triplet target historically.",
            "The high-water top-3 rule has a higher daily hit rate, but it creates only one triplet per active day.",
            "This is a replay-selected card layer and needs locked-forward validation before being treated as proven live.",
        ],
    }

    json_path = out_prefix.with_suffix(".json")
    md_path = out_prefix.with_suffix(".md")
    csv_path = out_prefix.with_name(out_prefix.name + "-daily-triplets").with_suffix(".csv")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(markdown_report(report), encoding="utf-8")
    write_csv(csv_path, combo_rows)

    print(
        json.dumps(
            {
                "baselineDailyAllTripletsHitPct": baseline["dailyAllCombosHitPct"],
                "recommendedRule": recommended["name"],
                "recommendedDailyAllTripletsHitPct": recommended["dailyAllCombosHitPct"],
                "recommendedTripletRecord": f"{recommended['comboWins']}-{recommended['comboLosses']}",
                "recommendedSelectedLegs": recommended["selectedLegs"],
                "recommendedThreeLegCombos": recommended["threeLegCombos"],
                "highWaterRule": high_water["name"],
                "highWaterDailyAllTripletsHitPct": high_water["dailyAllCombosHitPct"],
                "outputs": {"json": str(json_path), "md": str(md_path), "dailyTripletsCsv": str(csv_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
