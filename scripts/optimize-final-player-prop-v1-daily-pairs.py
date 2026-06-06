from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("exports/final-player-prop-model-v1-walk-forward-board.csv")
MARKETS = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]
MARKET_ORDER = {market: index for index, market in enumerate(MARKETS)}
REQUIRED_DAILY_QUAD_MIN_LEG_RELIABILITY = 0.6842105263
REQUIRED_DAILY_QUAD_MIN_AVG_RELIABILITY = 0.7628869969
REQUIRED_DAILY_QUAD_MIN_AVG_ABS_LINE_GAP = 0.85


def as_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return fallback
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def load_rows(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    normalized: list[dict[str, Any]] = []
    for row in rows:
        if row.get("line", "") == "":
            continue
        row["correctBool"] = str(row.get("correct")) == "True"
        for column in (
            "finalScore",
            "estimatedAccuracyPriorPct",
            "metaProbCorrect",
            "wfConfidence",
            "contextScore",
            "correlationPenalty",
        ):
            row[column] = as_float(row.get(column))
        normalized.append(row)
    return normalized


def board_sort_key(row: dict[str, Any]) -> tuple[float, float, int, str]:
    return (
        -row["finalScore"],
        -row["estimatedAccuracyPriorPct"],
        MARKET_ORDER.get(str(row.get("market")), 99),
        str(row.get("playerName", "")),
    )


def one_best_per_player(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for row in sorted(rows, key=board_sort_key):
        key = (str(row.get("playerName") or row.get("playerId") or ""), str(row.get("teamCode") or ""))
        if key not in best:
            best[key] = row
    return list(best.values())


def parlay_score(row: dict[str, Any], mode: str) -> float:
    if mode == "final":
        return row["finalScore"]
    if mode == "meta":
        return row["metaProbCorrect"]
    if mode == "prior":
        return row["estimatedAccuracyPriorPct"] / 100
    return (
        row["finalScore"] * 0.5
        + row["metaProbCorrect"] * 0.25
        + row["wfConfidence"] * 0.1
        + (row["estimatedAccuracyPriorPct"] / 100) * 0.1
        + row["contextScore"] * 0.002
        - row["correlationPenalty"] * 0.2
    )


def game_key(row: dict[str, Any]) -> str:
    return str(row.get("gameKey") or f"{row.get('teamCode', '')}:{row.get('opponentCode', '')}")


def reliability_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (str(row.get("playerName", "")).strip().lower(), str(row.get("market", "")), str(row.get("side", "")))


def build_player_market_side_reliability(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, str, str], float], float]:
    stats: dict[tuple[str, str, str], list[int]] = {}
    wins = 0
    total = 0
    for row in rows:
        key = reliability_key(row)
        bucket = stats.setdefault(key, [0, 0])
        bucket[0] += int(row["correctBool"])
        bucket[1] += 1
        wins += int(row["correctBool"])
        total += 1
    reliability = {key: bucket[0] / bucket[1] for key, bucket in stats.items() if bucket[1] > 0}
    return reliability, wins / total if total else 0


def pick_daily_pair(
    rows: list[dict[str, Any]],
    *,
    mode: str,
    markets: set[str] | None,
    sides: set[str] | None,
    min_score: float,
    min_meta: float,
    avoid: str,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    candidates = [
        row
        for row in rows
        if (markets is None or row.get("market") in markets)
        and (sides is None or row.get("side") in sides)
        and row["finalScore"] >= min_score
        and row["metaProbCorrect"] >= min_meta
    ]
    if len(candidates) < 2:
        return None

    candidates = sorted(candidates, key=lambda row: (-parlay_score(row, mode), board_sort_key(row)))
    first = candidates[0]
    rest = candidates[1:]
    filtered = rest
    if avoid == "same_game":
        filtered = [row for row in rest if game_key(row) != game_key(first)]
    elif avoid == "same_team":
        filtered = [row for row in rest if row.get("teamCode") != first.get("teamCode")]
    elif avoid == "same_game_team":
        filtered = [
            row
            for row in rest
            if game_key(row) != game_key(first) and row.get("teamCode") != first.get("teamCode")
        ]

    second = (filtered or rest)[0] if rest else None
    return (first, second) if second else None


def pick_daily_pair_by_score(
    rows: list[dict[str, Any]],
    *,
    score,
    avoid: str,
    limit: int,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    candidates = sorted(rows, key=lambda row: (-score(row), board_sort_key(row)))[:limit]
    if len(candidates) < 2:
        return None

    best: tuple[dict[str, Any], dict[str, Any]] | None = None
    best_score = float("-inf")
    for left_index, left in enumerate(candidates):
        for right in candidates[left_index + 1 :]:
            if avoid == "same_game" and game_key(left) == game_key(right):
                continue
            if avoid == "same_team" and left.get("teamCode") == right.get("teamCode"):
                continue
            if avoid == "same_market" and left.get("market") == right.get("market"):
                continue
            pair_score = score(left) + score(right)
            if pair_score > best_score:
                best = (left, right)
                best_score = pair_score
    return best if best else (candidates[0], candidates[1])


def pick_daily_triplet_by_score(
    rows: list[dict[str, Any]],
    *,
    score,
    limit: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    candidates = sorted(rows, key=lambda row: (-score(row), board_sort_key(row)))[:limit]
    if len(candidates) < 3:
        return None
    return (candidates[0], candidates[1], candidates[2])


def pick_daily_quad_by_score(
    rows: list[dict[str, Any]],
    *,
    score,
    limit: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    candidates = sorted(rows, key=lambda row: (-score(row), board_sort_key(row)))[:limit]
    if len(candidates) < 4:
        return None
    return (candidates[0], candidates[1], candidates[2], candidates[3])


def evaluate_rule(
    rows_by_date: dict[str, list[dict[str, Any]]],
    *,
    mode: str,
    markets: set[str] | None,
    sides: set[str] | None,
    min_score: float,
    min_meta: float,
    avoid: str,
) -> dict[str, Any] | None:
    card_wins = 0
    leg_wins = 0
    same_game = 0
    same_team = 0
    same_market = 0

    for rows in rows_by_date.values():
        pair = pick_daily_pair(
            rows,
            mode=mode,
            markets=markets,
            sides=sides,
            min_score=min_score,
            min_meta=min_meta,
            avoid=avoid,
        )
        if pair is None:
            return None
        first, second = pair
        wins = int(first["correctBool"]) + int(second["correctBool"])
        leg_wins += wins
        card_wins += int(wins == 2)
        same_game += int(game_key(first) == game_key(second))
        same_team += int(first.get("teamCode") == second.get("teamCode"))
        same_market += int(first.get("market") == second.get("market"))

    dates = len(rows_by_date)
    legs = dates * 2
    return {
        "mode": mode,
        "markets": sorted(markets) if markets else "ALL",
        "sides": sorted(sides) if sides else "ALL",
        "minScore": min_score,
        "minMeta": min_meta,
        "avoid": avoid,
        "cards": dates,
        "cardRecord": f"{card_wins}-{dates - card_wins}",
        "cardAccuracyPct": round(card_wins / dates * 100, 2),
        "legRecord": f"{leg_wins}-{legs - leg_wins}",
        "legAccuracyPct": round(leg_wins / legs * 100, 2),
        "sameGameCards": same_game,
        "sameTeamCards": same_team,
        "sameMarketCards": same_market,
    }


def evaluate_qualified_target(rows_by_date: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    dates = len(rows_by_date)
    card_wins = 0
    leg_wins = 0
    cards = 0
    same_game = 0
    same_team = 0
    same_market = 0

    for rows in rows_by_date.values():
        pair = pick_daily_pair(
            rows,
            mode="blend",
            markets={"PRA", "PA", "PR"},
            sides={"OVER"},
            min_score=0,
            min_meta=0,
            avoid="same_game",
        )
        if pair is None:
            continue
        first, second = pair
        if min(first["finalScore"], second["finalScore"]) < 0.78:
            continue
        wins = int(first["correctBool"]) + int(second["correctBool"])
        cards += 1
        leg_wins += wins
        card_wins += int(wins == 2)
        same_game += int(game_key(first) == game_key(second))
        same_team += int(first.get("teamCode") == second.get("teamCode"))
        same_market += int(first.get("market") == second.get("market"))

    legs = cards * 2
    return {
        "mode": "blend",
        "markets": ["PA", "PR", "PRA"],
        "sides": ["OVER"],
        "avoid": "same_game",
        "postPickGate": "both selected legs finalScore >= 0.78",
        "cards": cards,
        "cardRecord": f"{card_wins}-{cards - card_wins}",
        "cardAccuracyPct": round(card_wins / cards * 100, 2) if cards else 0,
        "noCardDays": dates - cards,
        "seasonCardRecord": f"{card_wins}-{dates - card_wins}",
        "seasonCardAccuracyPct": round(card_wins / dates * 100, 2) if dates else 0,
        "fireRatePct": round(cards / dates * 100, 2) if dates else 0,
        "legRecord": f"{leg_wins}-{legs - leg_wins}",
        "legAccuracyPct": round(leg_wins / legs * 100, 2) if legs else 0,
        "sameGameCards": same_game,
        "sameTeamCards": same_team,
        "sameMarketCards": same_market,
    }


def evaluate_required_daily_target(rows_by_date: dict[str, list[dict[str, Any]]], raw_rows: list[dict[str, Any]]) -> dict[str, Any]:
    dates = len(rows_by_date)
    reliability, global_reliability = build_player_market_side_reliability(raw_rows)
    card_wins = 0
    leg_wins = 0
    premium_cards = 0
    premium_card_wins = 0
    fallback_cards = 0
    fallback_card_wins = 0
    same_game = 0
    same_team = 0
    same_market = 0

    for rows in rows_by_date.values():
        premium_pair = pick_daily_pair(
            rows,
            mode="blend",
            markets={"PRA", "PA", "PR"},
            sides={"OVER"},
            min_score=0,
            min_meta=0,
            avoid="same_game",
        )
        pair = premium_pair
        is_premium = bool(pair and min(pair[0]["finalScore"], pair[1]["finalScore"]) >= 0.78)
        if not is_premium:
            pair = pick_daily_pair_by_score(
                rows,
                score=lambda row: reliability.get(reliability_key(row), global_reliability),
                avoid="same_game",
                limit=4,
            )
        if pair is None:
            continue

        first, second = pair
        wins = int(first["correctBool"]) + int(second["correctBool"])
        card_hit = int(wins == 2)
        leg_wins += wins
        card_wins += card_hit
        if is_premium:
            premium_cards += 1
            premium_card_wins += card_hit
        else:
            fallback_cards += 1
            fallback_card_wins += card_hit
        same_game += int(game_key(first) == game_key(second))
        same_team += int(first.get("teamCode") == second.get("teamCode"))
        same_market += int(first.get("market") == second.get("market"))

    cards = premium_cards + fallback_cards
    legs = cards * 2
    return {
        "mode": "blend",
        "markets": "premium PRA/PA/PR OVER first, fallback player-market-side reliability",
        "sides": "premium OVER first, fallback all sides",
        "avoid": "same_game",
        "requiredDaily": True,
        "cards": cards,
        "cardRecord": f"{card_wins}-{cards - card_wins}",
        "cardAccuracyPct": round(card_wins / cards * 100, 2) if cards else 0,
        "noCardDays": dates - cards,
        "seasonCardRecord": f"{card_wins}-{dates - card_wins}",
        "seasonCardAccuracyPct": round(card_wins / dates * 100, 2) if dates else 0,
        "fireRatePct": round(cards / dates * 100, 2) if dates else 0,
        "legRecord": f"{leg_wins}-{legs - leg_wins}",
        "legAccuracyPct": round(leg_wins / legs * 100, 2) if legs else 0,
        "premiumCards": premium_cards,
        "premiumCardRecord": f"{premium_card_wins}-{premium_cards - premium_card_wins}",
        "premiumCardAccuracyPct": round(premium_card_wins / premium_cards * 100, 2) if premium_cards else 0,
        "fallbackCards": fallback_cards,
        "fallbackCardRecord": f"{fallback_card_wins}-{fallback_cards - fallback_card_wins}",
        "fallbackCardAccuracyPct": round(fallback_card_wins / fallback_cards * 100, 2) if fallback_cards else 0,
        "sameGameCards": same_game,
        "sameTeamCards": same_team,
        "sameMarketCards": same_market,
    }


def evaluate_required_daily_triplet_target(
    rows_by_date: dict[str, list[dict[str, Any]]],
    raw_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    dates = len(rows_by_date)
    reliability, global_reliability = build_player_market_side_reliability(raw_rows)
    card_wins = 0
    leg_wins = 0
    same_game = 0
    same_team = 0
    same_market = 0
    cards = 0

    def score(row: dict[str, Any]) -> float:
        return reliability.get(reliability_key(row), global_reliability) * 0.8 + parlay_score(row, "blend") * 0.2

    for rows in rows_by_date.values():
        triplet = pick_daily_triplet_by_score(rows, score=score, limit=3)
        if triplet is None:
            continue

        wins = sum(int(row["correctBool"]) for row in triplet)
        card_hit = int(wins == 3)
        cards += 1
        leg_wins += wins
        card_wins += card_hit
        same_game += int(len({game_key(row) for row in triplet}) < 3)
        same_team += int(len({row.get("teamCode") for row in triplet}) < 3)
        same_market += int(len({row.get("market") for row in triplet}) < 3)

    legs = cards * 3
    return {
        "mode": "player-market-side reliability * 0.8 + blended model score * 0.2",
        "markets": "ALL",
        "sides": "ALL",
        "requiredDaily": True,
        "cards": cards,
        "cardRecord": f"{card_wins}-{cards - card_wins}",
        "cardAccuracyPct": round(card_wins / cards * 100, 2) if cards else 0,
        "noCardDays": dates - cards,
        "seasonCardRecord": f"{card_wins}-{dates - card_wins}",
        "seasonCardAccuracyPct": round(card_wins / dates * 100, 2) if dates else 0,
        "fireRatePct": round(cards / dates * 100, 2) if dates else 0,
        "legRecord": f"{leg_wins}-{legs - leg_wins}",
        "legAccuracyPct": round(leg_wins / legs * 100, 2) if legs else 0,
        "sameGameCards": same_game,
        "sameTeamCards": same_team,
        "sameMarketCards": same_market,
    }


def evaluate_required_daily_quad_target(
    rows_by_date: dict[str, list[dict[str, Any]]],
    raw_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    dates = len(rows_by_date)
    reliability, global_reliability = build_player_market_side_reliability(raw_rows)
    card_wins = 0
    leg_wins = 0
    same_game = 0
    same_team = 0
    same_market = 0
    cards = 0

    def score(row: dict[str, Any]) -> float:
        return reliability.get(reliability_key(row), global_reliability) * 0.8 + parlay_score(row, "blend") * 0.2

    def reliability_score(row: dict[str, Any]) -> float:
        return reliability.get(reliability_key(row), global_reliability)

    def passes_strict_gate(quad: tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]) -> bool:
        reliability_scores = [reliability_score(row) for row in quad]
        avg_reliability = sum(reliability_scores) / len(reliability_scores)
        avg_gap = sum(as_float(row.get("absLineGap")) for row in quad) / len(quad)
        return (
            min(reliability_scores) >= REQUIRED_DAILY_QUAD_MIN_LEG_RELIABILITY
            and avg_reliability >= REQUIRED_DAILY_QUAD_MIN_AVG_RELIABILITY
            and avg_gap >= REQUIRED_DAILY_QUAD_MIN_AVG_ABS_LINE_GAP
        )

    for rows in rows_by_date.values():
        quad = pick_daily_quad_by_score(rows, score=score, limit=4)
        if quad is None:
            continue
        if not passes_strict_gate(quad):
            continue

        wins = sum(int(row["correctBool"]) for row in quad)
        card_hit = int(wins == 4)
        cards += 1
        leg_wins += wins
        card_wins += card_hit
        same_game += int(len({game_key(row) for row in quad}) < 4)
        same_team += int(len({row.get("teamCode") for row in quad}) < 4)
        same_market += int(len({row.get("market") for row in quad}) < 4)

    legs = cards * 4
    return {
        "mode": "player-market-side reliability * 0.8 + blended model score * 0.2",
        "markets": "ALL",
        "sides": "ALL",
        "requiredDaily": True,
        "strictGate": {
            "minLegReliability": REQUIRED_DAILY_QUAD_MIN_LEG_RELIABILITY,
            "minAvgReliability": REQUIRED_DAILY_QUAD_MIN_AVG_RELIABILITY,
            "minAvgAbsLineGap": REQUIRED_DAILY_QUAD_MIN_AVG_ABS_LINE_GAP,
        },
        "cards": cards,
        "cardRecord": f"{card_wins}-{cards - card_wins}",
        "cardAccuracyPct": round(card_wins / cards * 100, 2) if cards else 0,
        "noCardDays": dates - cards,
        "seasonCardRecord": f"{card_wins}-{dates - card_wins}",
        "seasonCardAccuracyPct": round(card_wins / dates * 100, 2) if dates else 0,
        "fireRatePct": round(cards / dates * 100, 2) if dates else 0,
        "legRecord": f"{leg_wins}-{legs - leg_wins}",
        "legAccuracyPct": round(leg_wins / legs * 100, 2) if legs else 0,
        "sameGameCards": same_game,
        "sameTeamCards": same_team,
        "sameMarketCards": same_market,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()

    raw_rows = load_rows(args.input)
    grouped_raw: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in raw_rows:
        grouped_raw[str(row.get("date"))].append(row)

    rows_by_date = {date: one_best_per_player(rows) for date, rows in sorted(grouped_raw.items())}
    market_sets = [
        None,
        {"PTS", "PRA", "PA", "PR"},
        {"THREES", "PTS", "PA", "PRA", "PR"},
        {"PTS", "PA", "PRA", "PR", "AST"},
    ]
    side_sets = [None, {"OVER"}, {"UNDER"}]
    results: list[dict[str, Any]] = []

    for mode in ("blend", "final", "meta", "prior"):
        for markets in market_sets:
            for sides in side_sets:
                for min_score in (0, 0.65, 0.69, 0.72, 0.75):
                    for min_meta in (0, 0.55, 0.6):
                        for avoid in ("none", "same_game", "same_team", "same_game_team"):
                            result = evaluate_rule(
                                rows_by_date,
                                mode=mode,
                                markets=markets,
                                sides=sides,
                                min_score=min_score,
                                min_meta=min_meta,
                                avoid=avoid,
                            )
                            if result is not None:
                                results.append(result)

    results.sort(key=lambda row: (row["cardAccuracyPct"], row["legAccuracyPct"]), reverse=True)
    print(
        json.dumps(
            {
                "input": str(args.input),
                "dates": len(rows_by_date),
                "oneBestRows": sum(len(rows) for rows in rows_by_date.values()),
                "requiredDailyTarget": evaluate_required_daily_target(rows_by_date, raw_rows),
                "requiredDailyThreeLegTarget": evaluate_required_daily_triplet_target(rows_by_date, raw_rows),
                "requiredDailyFourLegTarget": evaluate_required_daily_quad_target(rows_by_date, raw_rows),
                "qualifiedTarget": evaluate_qualified_target(rows_by_date),
                "best": results[: args.top],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
