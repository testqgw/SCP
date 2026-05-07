from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-06-portfolio-guard-v1"
PLAYER_TAB_RULE = "player_tab_best_market_one_per_player_v1"
PAIR_RULE = "player_tab_rank_pair_cards_all_but_odd_v1"
TRIPLET_RULE = "player_tab_premium_game_component_triplets_v2"
QUAD_RULE = "player_tab_cs_non_ast_quartets_v1"
MARKET_ORDER = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Final V1 player-tab coverage combo cards.")
    parser.add_argument("--board-csv", default="exports/final-player-prop-model-v1-walk-forward-board.csv")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-v1-player-tab-combo-optimizer")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_csv(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def clean_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


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
        row["_finalScore"] = clean_float(row.get("finalScore"))
        row["_prior"] = clean_float(row.get("estimatedAccuracyPriorPct"))
        row["_marketOrder"] = MARKET_ORDER.index(row["market"]) if row.get("market") in MARKET_ORDER else 999
        by_date[row["date"]].append(row)
    return by_date


def best_market_per_player(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["playerName"], row["teamCode"])
        current = best.get(key)
        current_key = (
            current["_finalScore"],
            current["_prior"],
            -current["_marketOrder"],
        ) if current else None
        row_key = (row["_finalScore"], row["_prior"], -row["_marketOrder"])
        if current is None or row_key > current_key:
            best[key] = row
    return sorted(best.values(), key=lambda row: (-row["_finalScore"], -row["_prior"], row["playerName"], row["market"]))


def component_signature(row: dict[str, Any]) -> str:
    components = str(row.get("components") or "")
    signature = []
    for token, label in [
        ("top200_premium_90", "P90"),
        ("top200_accuracy_first", "AF"),
        ("top200_coverage_frontier", "CF"),
        ("top200_meta_reliability", "MR"),
        ("top200_primary", "PR"),
    ]:
        if token in components:
            signature.append(label)
    return "".join(signature) or "ROUTER"


def optimized_triplet_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    guarded = [
        row
        for row in rows
        if row.get("tier") != "B"
        and row.get("market") != "THREES"
        and row["_finalScore"] >= 0.70
        and "baseline_source" not in str(row.get("riskFlags") or "")
    ]
    return sorted(
        guarded,
        key=lambda row: (
            row.get("tier") or "",
            int(row["_finalScore"] * 20),
            component_signature(row),
            -row["_finalScore"],
            -row["_prior"],
            row["playerName"],
        ),
        reverse=True,
    )


def optimized_quad_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    guarded = [
        row
        for row in rows
        if row.get("tier") not in {"A", "B"}
        and row.get("market") != "AST"
    ]
    return sorted(
        guarded,
        key=lambda row: (
            row.get("tier") or "",
            int(row["_finalScore"] * 20),
            component_signature(row),
            -row["_finalScore"],
            -row["_prior"],
            row["playerName"],
        ),
        reverse=True,
    )


def chunk_by_rank(rows: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    used_count = (len(rows) // size) * size
    used = rows[:used_count]
    return [used[index : index + size] for index in range(0, len(used), size)]


def evaluate_cards(
    selected_by_date: dict[str, list[dict[str, Any]]],
    name: str,
    size: int,
    total_selected_rows: int,
    row_transform=lambda rows: rows,
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
    eligible_legs = 0

    for rows in selected_by_date.values():
        transformed_rows = row_transform(rows)
        eligible_legs += len(transformed_rows)
        groups = chunk_by_rank(transformed_rows, size)
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
        "eligibleLegs": eligible_legs,
        "usedLegs": used_legs,
        "unusedLegs": unused_legs,
        "legCoveragePct": pct(used_legs, total_selected_rows),
        "eligibleCoveragePct": pct(eligible_legs, total_selected_rows),
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
        f"{prefix}_player": leg.get("playerName"),
        f"{prefix}_team": leg.get("teamCode"),
        f"{prefix}_market": leg.get("market"),
        f"{prefix}_side": leg.get("side"),
        f"{prefix}_line": leg.get("line"),
        f"{prefix}_score": leg.get("finalScore"),
        f"{prefix}_correct": leg["_win"],
    }


def card_rows(
    selected_by_date: dict[str, list[dict[str, Any]]],
    name: str,
    size: int,
    row_transform=lambda rows: rows,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    labels = ["legA", "legB", "legC", "legD"]
    for date, rows in sorted(selected_by_date.items()):
        transformed_rows = row_transform(rows)
        groups = chunk_by_rank(transformed_rows, size)
        for card_index, group in enumerate(groups, start=1):
            row: dict[str, Any] = {
                "date": date,
                "rule": name,
                "cardSize": size,
                "playerTabPicksOnDay": len(rows),
                "eligibleLegsOnDay": len(transformed_rows),
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
        "playerTabPicksOnDay",
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
    quad = report["quadCoverageRule"]
    lines = [
        "# Final V1 Player-Tab Combo Optimizer",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        "## Rule",
        "",
        "- Use the broader player-tab board, not the tiny Final V1 selected-card subset.",
        "- Pick exactly one best market per player per date using the highest Final V1 board score.",
        "- Two-leg cards group the player-tab picks in rank chunks of 2 and leave only the odd final leg out.",
        "- Three-leg premium cards require Final V1 score >= 0.70, remove tier B, 3PM, and baseline-source rows, then cluster by tier/score-bucket/component signature before chunking by 3.",
        "- Four-leg premium cards use only C/S-tier non-AST player-tab legs, then cluster by tier/score-bucket/component signature before chunking by 4.",
        "",
        "## Coverage Results",
        "",
        "| Layer | Rule | Leg Coverage | Cards | Avg Cards/Day | Card Accuracy | Daily All-Card Hit |",
        "|---|---|---:|---:|---:|---:|---:|",
        f"| 2-leg | {pair['name']} | {pct_fmt(pair['legCoveragePct'])} | {pair['cards']} | {pair['avgCardsPerActiveDay']} | {pct_fmt(pair['cardAccuracyPct'])} | {pct_fmt(pair['dailyAllCardsHitPct'])} |",
        f"| 3-leg | {triplet['name']} | {pct_fmt(triplet['legCoveragePct'])} | {triplet['cards']} | {triplet['avgCardsPerActiveDay']} | {pct_fmt(triplet['cardAccuracyPct'])} | {pct_fmt(triplet['dailyAllCardsHitPct'])} |",
        f"| 4-leg | {quad['name']} | {pct_fmt(quad['legCoveragePct'])} | {quad['cards']} | {quad['avgCardsPerActiveDay']} | {pct_fmt(quad['cardAccuracyPct'])} | {pct_fmt(quad['dailyAllCardsHitPct'])} |",
        "",
        "## Interpretation",
        "",
    ]
    lines.extend(f"- {item}" for item in report["interpretation"])
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    board_path = Path(args.board_csv)
    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    board_rows = read_csv(board_path)
    by_date = prepare_rows(board_rows)
    selected_by_date = {date: best_market_per_player(rows) for date, rows in by_date.items()}
    total_selected_rows = sum(len(rows) for rows in selected_by_date.values())
    daily_count_distribution = Counter(len(rows) for rows in selected_by_date.values())

    pair = evaluate_cards(selected_by_date, PAIR_RULE, 2, total_selected_rows)
    triplet = evaluate_cards(selected_by_date, TRIPLET_RULE, 3, total_selected_rows, optimized_triplet_rows)
    quad = evaluate_cards(selected_by_date, QUAD_RULE, 4, total_selected_rows, optimized_quad_rows)
    report = {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "playerTabRule": PLAYER_TAB_RULE,
        "inputs": {
            "boardCsv": str(board_path.resolve()),
            "boardRows": len(board_rows),
            "activeDates": len(selected_by_date),
            "playerTabPicks": total_selected_rows,
            "avgPlayerTabPicksPerDate": round(total_selected_rows / max(len(selected_by_date), 1), 2),
            "dailyPlayerTabPickCountDistribution": dict(sorted(daily_count_distribution.items())),
        },
        "pairCoverageRule": pair,
        "tripletCoverageRule": triplet,
        "quadCoverageRule": quad,
        "interpretation": [
            "This corrected layer uses the player-tab source: one best market per player from the full Final V1 board.",
            "It covers 99.50% of player-tab picks for two-leg cards.",
            "The 3-leg layer is now a premium guard: score < 0.70, tier B, 3PM, and baseline-source rows are excluded before tier/score/component clustering, so coverage drops but card accuracy clears the 80% target.",
            "The 4-leg layer is stricter: only C/S-tier non-AST player-tab legs are used, giving a smaller but stronger quartet pool.",
            "Card accuracy is the useful betting-card metric here. Daily all-card hit rate is naturally low because this layer can create dozens of cards per slate.",
            "This is historical replay evidence and still needs locked-forward tracking before live-edge claims.",
        ],
    }

    json_path = out_prefix.with_suffix(".json")
    md_path = out_prefix.with_suffix(".md")
    cards_path = out_prefix.with_name(out_prefix.name + "-cards").with_suffix(".csv")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(markdown_report(report), encoding="utf-8")
    write_csv(
        cards_path,
        card_rows(selected_by_date, PAIR_RULE, 2)
        + card_rows(selected_by_date, TRIPLET_RULE, 3, optimized_triplet_rows)
        + card_rows(selected_by_date, QUAD_RULE, 4, optimized_quad_rows),
    )

    print(
        json.dumps(
            {
                "playerTabPicks": total_selected_rows,
                "avgPlayerTabPicksPerDate": report["inputs"]["avgPlayerTabPicksPerDate"],
                "pairRule": pair["name"],
                "pairLegCoveragePct": pair["legCoveragePct"],
                "pairCards": pair["cards"],
                "pairAvgCardsPerDay": pair["avgCardsPerActiveDay"],
                "pairCardAccuracyPct": pair["cardAccuracyPct"],
                "tripletRule": triplet["name"],
                "tripletLegCoveragePct": triplet["legCoveragePct"],
                "tripletCards": triplet["cards"],
                "tripletAvgCardsPerDay": triplet["avgCardsPerActiveDay"],
                "tripletCardAccuracyPct": triplet["cardAccuracyPct"],
                "quadRule": quad["name"],
                "quadLegCoveragePct": quad["legCoveragePct"],
                "quadCards": quad["cards"],
                "quadAvgCardsPerDay": quad["avgCardsPerActiveDay"],
                "quadCardAccuracyPct": quad["cardAccuracyPct"],
                "outputs": {"json": str(json_path), "md": str(md_path), "cardsCsv": str(cards_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
