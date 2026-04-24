#!/usr/bin/env python3
"""Train the Precision Picks v5 upstream HGB blend artifact.

The artifact carries two things:

1. Honest walk-forward scores for the historical replay window.
2. Full-history HGB models for live dates after the training window.

The TypeScript runtime reads the artifact directly; this script is only a
regeneration utility and is not required by the Vercel build.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HISTORY = REPO_ROOT / "exports" / "precision-upstream-reranker-history-v1.json"
DEFAULT_OUT = REPO_ROOT / "exports" / "precision-upstream-hgb-reranker-runtime-model-v1.json"

TARGET_COUNT = 6
MARKET_CAPS = {
    "PTS": 2,
    "REB": 2,
    "AST": 1,
    "PRA": 2,
    "PA": 1,
    "PR": 2,
    "RA": 2,
}

NUMERIC_FIELDS = [
    "poolCount",
    "strictPoolCount",
    "finalPoolCount",
    "scoringCorePool",
    "comboPool",
    "overrideEngaged",
    "playerOverrideEngaged",
    "rawQualified",
    "strictAgreement",
    "finalAgreement",
    "projectionAgreement",
    "favoredAgreement",
    "bucketSamples",
    "bucketModelAccuracy",
    "bucketLateAccuracy",
    "leafCount",
    "leafAccuracy",
    "projectionWinProbability",
    "projectionPriceEdge",
    "priceStrength",
    "projectionMarketAgreement",
    "rejectionCount",
    "holdoutAccuracy",
    "projectionBaselineAccuracy",
    "finalBaselineAccuracy",
    "modelAccuracy",
    "samples",
    "edgeVsProjection",
    "edgeVsFinal",
    "projectedValue",
    "lineGap",
    "absLineGap",
    "expectedMinutes",
    "minutesVolatility",
    "starterRateLast10",
    "priceLean",
    "weightedCurrentLineOverRate",
    "emaCurrentLineDelta",
    "emaCurrentLineOverRate",
    "l5CurrentLineOverRate",
    "baseScoreGap",
    "baseScoreRecency",
    "baseScoreBalanced",
]

CATEGORY_FIELDS = [
    "market",
    "rawSource",
    "strictRawSource",
    "finalSource",
    "archetype",
    "modelKind",
]

RANK_SMALL_FIELDS = [
    "baseScoreGap",
    "baseScoreRecency",
    "baseScoreBalanced",
    "holdoutAccuracy",
    "modelAccuracy",
    "samples",
    "edgeVsProjection",
    "edgeVsFinal",
    "absLineGap",
    "projectionWinProbability",
    "projectionPriceEdge",
    "priceStrength",
    "bucketModelAccuracy",
    "bucketLateAccuracy",
    "leafAccuracy",
]

MODEL_SPECS = [
    {
        "name": "hgb_long_all_rank",
        "weight": 0.2,
        "numericFields": NUMERIC_FIELDS,
        "rankFields": NUMERIC_FIELDS,
        "params": {
            "max_iter": 90,
            "learning_rate": 0.03,
            "max_leaf_nodes": 15,
            "l2_regularization": 0.5,
            "random_state": 42,
        },
    },
    {
        "name": "hgb_med_no_rank",
        "weight": 0.7,
        "numericFields": NUMERIC_FIELDS,
        "rankFields": [],
        "params": {
            "max_iter": 60,
            "learning_rate": 0.04,
            "max_leaf_nodes": 15,
            "l2_regularization": 0.5,
            "random_state": 42,
        },
    },
    {
        "name": "hgb_med_small_rank",
        "weight": 0.1,
        "numericFields": NUMERIC_FIELDS,
        "rankFields": RANK_SMALL_FIELDS,
        "params": {
            "max_iter": 60,
            "learning_rate": 0.04,
            "max_leaf_nodes": 15,
            "l2_regularization": 0.5,
            "random_state": 42,
        },
    },
]


def finite_number(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return default


def score_key(row: dict[str, Any]) -> str:
    return "|".join(
        [
            str(row.get("date", "")),
            str(row.get("playerId", "")),
            str(row.get("market", "")),
            str(row.get("side", "")),
        ]
    )


def build_rank_values(rows: list[dict[str, Any]], fields: list[str]) -> dict[tuple[int, str], float]:
    ranks: dict[tuple[int, str], float] = {}
    denominator = max(len(rows) - 1, 1)
    for field in fields:
        ordered = sorted(
            (
                finite_number(row.get(field), -1e18),
                row["_idx"],
            )
            for row in rows
        )
        for rank, (_value, row_idx) in enumerate(ordered):
            ranks[(row_idx, field)] = rank / denominator
    return ranks


def build_historical_rank_values(
    dates: list[str],
    by_date: dict[str, list[dict[str, Any]]],
    fields: list[str],
) -> dict[tuple[int, str], float]:
    ranks: dict[tuple[int, str], float] = {}
    for date in dates:
        ranks.update(build_rank_values(by_date[date], fields))
    return ranks


def build_encoder(
    training_rows: list[dict[str, Any]],
    numeric_fields: list[str],
    rank_fields: list[str],
):
    categories: dict[str, list[str]] = {}
    for field in CATEGORY_FIELDS:
        categories[field] = sorted(
            {
                str(row.get(field))
                for row in training_rows
                if row.get(field) not in (None, "")
            }
        )

    feature_count = (
        len(numeric_fields)
        + len(rank_fields)
        + sum(len(values) for values in categories.values())
    )

    def encode(rows: list[dict[str, Any]], rank_values: dict[tuple[int, str], float]) -> np.ndarray:
        matrix = np.zeros((len(rows), feature_count), dtype=np.float32)
        for row_index, row in enumerate(rows):
            column = 0
            for field in numeric_fields:
                matrix[row_index, column] = finite_number(row.get(field))
                column += 1
            for field in rank_fields:
                matrix[row_index, column] = rank_values.get((row["_idx"], field), 0.0)
                column += 1
            for field in CATEGORY_FIELDS:
                value = str(row.get(field)) if row.get(field) not in (None, "") else None
                for category in categories[field]:
                    matrix[row_index, column] = 1.0 if value == category else 0.0
                    column += 1
        return matrix

    return encode, categories


def train_model(
    spec: dict[str, Any],
    training_rows: list[dict[str, Any]],
    training_rank_values: dict[tuple[int, str], float],
):
    encode, categories = build_encoder(
        training_rows,
        spec["numericFields"],
        spec["rankFields"],
    )
    x_train = encode(training_rows, training_rank_values)
    y_train = np.array([1 if row["correct"] else 0 for row in training_rows], dtype=np.int8)
    model = HistGradientBoostingClassifier(**spec["params"])
    model.fit(x_train, y_train)
    return model, encode, categories


def predict_scores(
    spec: dict[str, Any],
    training_rows: list[dict[str, Any]],
    training_rank_values: dict[tuple[int, str], float],
    scoring_rows: list[dict[str, Any]],
) -> list[float]:
    if len({row["date"] for row in training_rows}) < 7 or len({row["correct"] for row in training_rows}) < 2:
        return [finite_number(row.get("baseScoreGap")) for row in scoring_rows]
    encode, _categories = build_encoder(
        training_rows,
        spec["numericFields"],
        spec["rankFields"],
    )
    x_train = encode(training_rows, training_rank_values)
    y_train = np.array([1 if row["correct"] else 0 for row in training_rows], dtype=np.int8)
    model = HistGradientBoostingClassifier(**spec["params"])
    model.fit(x_train, y_train)
    scoring_rank_values = build_rank_values(scoring_rows, spec["rankFields"])
    return [float(value) for value in model.predict_proba(encode(scoring_rows, scoring_rank_values))[:, 1]]


def select_daily_rows(rows: list[dict[str, Any]], scores: dict[int, float]) -> list[dict[str, Any]]:
    ordered = sorted(
        rows,
        key=lambda row: (
            -scores[row["_idx"]],
            -finite_number(row.get("holdoutAccuracy"), -1e18),
            -finite_number(row.get("absLineGap")),
            str(row.get("playerName", "")),
        ),
    )
    selected: list[dict[str, Any]] = []
    selected_players: set[str] = set()
    market_counts: dict[str, int] = defaultdict(int)
    for row in ordered:
        if len(selected) >= TARGET_COUNT:
            break
        player_id = str(row.get("playerId", ""))
        market = str(row.get("market", ""))
        if player_id in selected_players:
            continue
        if market_counts[market] >= MARKET_CAPS.get(market, 0):
            continue
        selected.append(row)
        selected_players.add(player_id)
        market_counts[market] += 1
    return selected


def summarize(dates: list[str], by_date: dict[str, list[dict[str, Any]]], scores: dict[int, float]) -> dict[str, Any]:
    daily = []
    selected_count = 0
    for date in dates:
        selected = select_daily_rows(by_date[date], scores)
        selected_count += len(selected)
        daily.append(
            {
                "date": date,
                "picks": len(selected),
                "correct": sum(1 for row in selected if row["correct"]),
            }
        )

    def summarize_window(window: list[dict[str, Any]]) -> dict[str, Any]:
        picks = sum(row["picks"] for row in window)
        correct = sum(row["correct"] for row in window)
        return {
            "picks": picks,
            "correct": correct,
            "accuracy": round((correct / picks) * 100, 2) if picks else 0,
        }

    return {
        "overall": summarize_window(daily),
        "last30": summarize_window(daily[-30:]),
        "last14": summarize_window(daily[-14:]),
        "picksPerDay": round(selected_count / max(len(dates), 1), 2),
        "daysBelowSix": sum(1 for row in daily if row["picks"] < TARGET_COUNT),
    }


def export_tree_model(model: HistGradientBoostingClassifier, spec: dict[str, Any], categories: dict[str, list[str]]) -> dict[str, Any]:
    baseline = float(np.ravel(model._baseline_prediction)[0])
    trees = []
    for iteration in model._predictors:
        predictor = iteration[0]
        tree_nodes = []
        for node in predictor.nodes:
            tree_nodes.append(
                {
                    "value": round(float(node["value"]), 12),
                    "featureIndex": int(node["feature_idx"]),
                    "threshold": round(float(node["num_threshold"]), 12),
                    "left": int(node["left"]),
                    "right": int(node["right"]),
                    "missingGoToLeft": bool(node["missing_go_to_left"]),
                    "isLeaf": bool(node["is_leaf"]),
                }
            )
        trees.append(tree_nodes)

    return {
        "name": spec["name"],
        "weight": spec["weight"],
        "numericFields": spec["numericFields"],
        "rankFields": spec["rankFields"],
        "categoricalFields": CATEGORY_FIELDS,
        "categories": categories,
        "baseline": round(baseline, 12),
        "trees": trees,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", type=Path, default=DEFAULT_HISTORY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    payload = json.loads(args.history.read_text(encoding="utf-8-sig"))
    rows = [dict(row, _idx=index) for index, row in enumerate(payload["rows"])]
    dates = sorted({row["date"] for row in rows})
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_date[row["date"]].append(row)

    historical_rank_values = build_historical_rank_values(dates, by_date, NUMERIC_FIELDS)
    walk_forward_variant_scores: dict[str, dict[int, float]] = {
        spec["name"]: {} for spec in MODEL_SPECS
    }
    for date_index, date in enumerate(dates):
        training_rows = [row for prior_date in dates[:date_index] for row in by_date[prior_date]]
        scoring_rows = by_date[date]
        training_row_ids = {row["_idx"] for row in training_rows}
        training_rank_values = {
            key: value for key, value in historical_rank_values.items() if key[0] in training_row_ids
        }
        for spec in MODEL_SPECS:
            scores = predict_scores(spec, training_rows, training_rank_values, scoring_rows)
            for row, score in zip(scoring_rows, scores):
                walk_forward_variant_scores[spec["name"]][row["_idx"]] = score

    walk_forward_scores: dict[int, float] = {}
    for row in rows:
        score = 0.0
        for spec in MODEL_SPECS:
            score += spec["weight"] * walk_forward_variant_scores[spec["name"]][row["_idx"]]
        walk_forward_scores[row["_idx"]] = score

    summary = summarize(dates, by_date, walk_forward_scores)

    runtime_models = []
    for spec in MODEL_SPECS:
        model, _encode, categories = train_model(spec, rows, historical_rank_values)
        runtime_models.append(export_tree_model(model, spec, categories))

    output = {
        "version": "precision-upstream-hgb-reranker-runtime-model-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "trainedThroughDate": dates[-1],
        "historyRowCount": len(rows),
        "summary": summary,
        "selectionRule": {
            "targetCount": TARGET_COUNT,
            "marketCaps": MARKET_CAPS,
            "onePickPerPlayer": True,
        },
        "blend": [
            {
                "name": spec["name"],
                "weight": spec["weight"],
                "params": spec["params"],
                "rankFields": spec["rankFields"],
            }
            for spec in MODEL_SPECS
        ],
        "walkForwardScores": {
            score_key(row): round(walk_forward_scores[row["_idx"]], 8) for row in rows
        },
        "models": runtime_models,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
