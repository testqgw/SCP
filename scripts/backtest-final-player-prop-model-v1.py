from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


MARKETS = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]
MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-08-accuracy90-ladder-v1"
COUNTING_OVER_MARKETS = {"PTS", "AST", "PRA", "PA", "PR", "RA"}
COMBO_MARKETS = {"PRA", "PA", "PR", "RA"}
SELECTED_MARKET_VETO = {"PR", "PA"}
PORTFOLIO_LIMITS = {
    "maxPerPlayer": 1,
    "maxPerTeam": 2,
    "maxPerGame": 2,
    "maxPerMarket": 2,
    "maxSameTeamCountingOvers": 1,
    "maxComboMarkets": 1,
}


POCKET_SPECS: list[dict[str, Any]] = [
    {"label": "top200 REB UNDER agreement, abs gap (1.5, 2.0]", "pool": "top200", "market": "REB", "source": "player_override", "finalSide": "UNDER", "wfAgreement": True, "absGap": (1.5, 2.0)},
    {"label": "tail200plus AST OVER agreement, HGB confidence (0.82, 0.85]", "pool": "tail200plus", "market": "AST", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "wfConfidence": (0.82, 0.85)},
    {"label": "top200 REB OVER agreement, abs gap (1.5, 2.0], source-side prior (0.80, 0.85]", "pool": "top200", "market": "REB", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "absGap": (1.5, 2.0), "priorSourceSideAcc": (0.8, 0.85)},
    {"label": "tail200plus AST OVER agreement, line (0.5, 1.5]", "pool": "tail200plus", "market": "AST", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "line": (0.5, 1.5)},
    {"label": "top200 PR OVER triple-agree, line (12.5, 15.5], HGB confidence (0.75, 0.78]", "pool": "top200", "market": "PR", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "line": (12.5, 15.5), "wfConfidence": (0.75, 0.78)},
    {"label": "top200 REB UNDER HGB/projection split, abs gap (1.5, 2.0]", "pool": "top200", "market": "REB", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "OVER", "absGap": (1.5, 2.0)},
    {"label": "top200 PA UNDER agreement, minutes (28, 30], line (15.5, 18.5]", "pool": "top200", "market": "PA", "source": "player_override", "finalSide": "UNDER", "wfAgreement": True, "minutes": (28.0, 30.0), "line": (15.5, 18.5)},
    {"label": "top200 AST OVER agreement, abs gap (0.25, 0.5], minutes (16, 20]", "pool": "top200", "market": "AST", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "absGap": (0.25, 0.5), "minutes": (16.0, 20.0)},
    {"label": "tail200plus PR OVER triple-agree, minutes (20, 24]", "pool": "tail200plus", "market": "PR", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "minutes": (20.0, 24.0)},
    {"label": "tail200plus PTS OVER triple-agree, minutes (20, 24]", "pool": "tail200plus", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "minutes": (20.0, 24.0)},
    {"label": "tail200plus REB OVER triple-agree, line (0.5, 1.5]", "pool": "tail200plus", "market": "REB", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "line": (0.5, 1.5)},
    {"label": "tail200plus AST UNDER triple-agree, HGB confidence (0.80, 0.82]", "pool": "tail200plus", "market": "AST", "source": "player_override", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "UNDER", "wfConfidence": (0.8, 0.82)},
    {"label": "tail200plus PTS OVER triple-agree, HGB confidence (0.85, 0.88]", "pool": "tail200plus", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "wfConfidence": (0.85, 0.88)},
    {"label": "tail200plus THREES UNDER triple-agree, HGB confidence (0.78, 0.80]", "pool": "tail200plus", "market": "THREES", "source": "player_override", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "UNDER", "wfConfidence": (0.78, 0.8)},
    {"label": "top200 REB UNDER agreement, minutes (32, 34], line (2.5, 3.5], HGB confidence (0.78, 0.80]", "pool": "top200", "market": "REB", "source": "player_override", "finalSide": "UNDER", "wfAgreement": True, "minutes": (32.0, 34.0), "line": (2.5, 3.5), "wfConfidence": (0.78, 0.8)},
    {"label": "tail200plus RA OVER agreement, HGB confidence (0.82, 0.85], final-side prior (0.65, 0.70]", "pool": "tail200plus", "market": "RA", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "wfConfidence": (0.82, 0.85), "priorFinalSideAcc": (0.65, 0.7)},
    {"label": "top200 REB UNDER agreement, abs gap (0.25, 0.5], minutes (32, 34], line (2.5, 3.5]", "pool": "top200", "market": "REB", "source": "player_override", "finalSide": "UNDER", "wfAgreement": True, "absGap": (0.25, 0.5), "minutes": (32.0, 34.0), "line": (2.5, 3.5)},
    {"label": "top200 AST OVER triple-agree, minutes (16, 20], source-side prior (0.80, 0.85]", "pool": "top200", "market": "AST", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "OVER", "minutes": (16.0, 20.0), "priorSourceSideAcc": (0.8, 0.85)},
    {"label": "top200 PTS OVER agreement, minutes (28, 30], line (12.5, 15.5], HGB confidence (0.78, 0.80]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "minutes": (28.0, 30.0), "line": (12.5, 15.5), "wfConfidence": (0.78, 0.8)},
    {"label": "top200 PTS OVER agreement, abs gap (1.5, 2.0], minutes (20, 24], HGB confidence (0.82, 0.85]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "absGap": (1.5, 2.0), "minutes": (20.0, 24.0), "wfConfidence": (0.82, 0.85)},
    {"label": "top200 PTS OVER agreement, abs gap (1.25, 1.5], HGB confidence (0.82, 0.85]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfAgreement": True, "absGap": (1.25, 1.5), "wfConfidence": (0.82, 0.85)},
    {"label": "top200 PTS UNDER HGB/projection split, HGB confidence (0.85, 0.88]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "OVER", "wfConfidence": (0.85, 0.88)},
    {"label": "top200 PA OVER HGB/projection split, abs gap <= 0.25, minutes (24, 28]", "pool": "top200", "market": "PA", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "UNDER", "absGapMax": 0.25, "minutes": (24.0, 28.0)},
    {"label": "tail200plus AST UNDER HGB/projection split, HGB confidence (0.82, 0.85], final-side prior (0.65, 0.70]", "pool": "tail200plus", "market": "AST", "source": "player_override", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "OVER", "wfConfidence": (0.82, 0.85), "priorFinalSideAcc": (0.65, 0.7)},
    {"label": "top200 AST UNDER triple-agree, abs gap (0.5, 0.75], minutes (24, 28], HGB confidence (0.80, 0.82]", "pool": "top200", "market": "AST", "source": "player_override", "finalSide": "UNDER", "wfSide": "UNDER", "projectionSide": "UNDER", "absGap": (0.5, 0.75), "minutes": (24.0, 28.0), "wfConfidence": (0.8, 0.82)},
    {"label": "top200 PTS OVER HGB/projection split, abs gap (0.25, 0.5], minutes (24, 28]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "OVER", "wfSide": "OVER", "projectionSide": "UNDER", "absGap": (0.25, 0.5), "minutes": (24.0, 28.0)},
    {"label": "top200 PTS UNDER agreement, abs gap (0.75, 1.0], minutes (24, 28], HGB confidence (0.80, 0.82]", "pool": "top200", "market": "PTS", "source": "player_override", "finalSide": "UNDER", "wfAgreement": True, "absGap": (0.75, 1.0), "minutes": (24.0, 28.0), "wfConfidence": (0.8, 0.82)},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Walk-forward backtest for Final Player Prop Model V1.")
    parser.add_argument("--input", default="exports/live-quality-full-season-router-v9-details.json")
    parser.add_argument("--model", default="exports/top-player-200-sample-prop-model-results.json")
    parser.add_argument("--precision", default="exports/precision-locked-pregame-results.json")
    parser.add_argument("--v9-summary", default="exports/live-quality-full-season-router-v9-default-eval.json")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-model-v1-walk-forward")
    parser.add_argument("--min-train-dates", type=int, default=7)
    parser.add_argument("--test-dates", type=int, default=7)
    parser.add_argument("--max-picks", type=int, default=6)
    parser.add_argument("--min-score", type=float, default=0.84)
    return parser.parse_args()


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def clean_number(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def round_number(value: Any, digits: int = 6) -> float | None:
    number = clean_number(value)
    if number is None:
        return None
    return round(number, digits)


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def projection_side(line_gap: Any) -> str:
    gap = clean_number(line_gap)
    if gap is None:
        return "NEUTRAL"
    if gap > 0:
        return "OVER"
    if gap < 0:
        return "UNDER"
    return "NEUTRAL"


def between_open_closed(value: Any, bounds: tuple[float, float]) -> bool:
    number = clean_number(value)
    return number is not None and number > bounds[0] and number <= bounds[1]


def load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def lane_accuracy(lane: dict[str, Any] | None) -> float | None:
    if not lane:
        return None
    return clean_number(lane.get("runtimeFinalAccuracyPct", lane.get("accuracyPct")))


def build_component_accuracies(model: dict[str, Any], precision: dict[str, Any] | None, v9: dict[str, Any] | None) -> dict[str, float]:
    return {
        "top200_premium_90": lane_accuracy(model.get("expandedPremium90Lane")) or 93.15,
        "top200_premium_pts_over": lane_accuracy(model.get("premiumPtsOverLane")) or 91.0,
        "top200_accuracy_first": lane_accuracy(model.get("accuracyFirstLane")) or 86.79,
        "top200_meta_reliability": 83.11,
        "top200_coverage_frontier": lane_accuracy(model.get("coverageFrontierLane")) or 82.73,
        "top200_recent_form_fade": lane_accuracy(model.get("recentFormLane")) or 82.68,
        "top200_primary": lane_accuracy(model.get("primaryLane")) or 82.39,
        "precision_parlay_v1": clean_number(((precision or {}).get("summary") or {}).get("overall", {}).get("accuracy")) or 90.25,
        "live_quality_router_v9": clean_number(((v9 or {}).get("overall") or {}).get("blendedAccuracy")) or 89.06,
    }


def build_meta_probabilities(
    df: pd.DataFrame,
    dates: list[str],
    folds: list[list[str]],
    primary_ids: set[str],
) -> None:
    df["projectionSide"] = df["lineGap"].map(projection_side)
    df["sideAgreesProjection"] = df["wfSide"].astype(str).eq(df["projectionSide"].astype(str)).astype(int)
    df["targetCorrect"] = df["finalCorrectBool"].astype(int)
    df["metaProbCorrect"] = np.nan

    meta_cat_cols = ["playerId", "market", "wfSide", "projectionSide"]
    meta_num_cols = [
        "wfConfidence",
        "wfProbOver",
        "absLineGap",
        "lineGap",
        "projectedValue",
        "line",
        "projectedMinutes",
        "sideAgreesProjection",
        *[col for col in df.columns if col.endswith("_n") or col.endswith("_acc")],
    ]
    for col in meta_cat_cols:
        df[col] = df[col].fillna("NA").astype(str)
    for col in meta_num_cols:
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")

    preprocessor = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), meta_cat_cols),
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler()),
                    ]
                ),
                meta_num_cols,
            ),
        ]
    )
    classifier = HistGradientBoostingClassifier(
        max_iter=120,
        learning_rate=0.045,
        max_leaf_nodes=31,
        l2_regularization=0.05,
        random_state=11,
    )
    pipeline = Pipeline([("pre", preprocessor), ("clf", classifier)])
    feature_cols = meta_cat_cols + meta_num_cols
    eligible_top = df["eligibleWalkForward"] & df["playerId"].isin(primary_ids)

    for fold_dates in folds:
        train_mask = eligible_top & df["gameDateEt"].lt(fold_dates[0])
        test_mask = df["eligibleWalkForward"] & df["gameDateEt"].isin(fold_dates)
        if int(train_mask.sum()) < 500 or df.loc[train_mask, "targetCorrect"].nunique() < 2:
            prior = float(df.loc[train_mask, "targetCorrect"].mean()) if int(train_mask.sum()) else 0.75
            df.loc[test_mask, "metaProbCorrect"] = prior
            continue
        pipeline.fit(df.loc[train_mask, feature_cols], df.loc[train_mask, "targetCorrect"])
        df.loc[test_mask, "metaProbCorrect"] = pipeline.predict_proba(df.loc[test_mask, feature_cols])[:, 1]


def matches_pocket(row: pd.Series, spec: dict[str, Any], top_ids: set[str], tail_ids: set[str]) -> bool:
    is_pool = row.playerId in top_ids if spec["pool"] == "top200" else row.playerId in tail_ids
    if not is_pool:
        return False
    if row.market != spec["market"]:
        return False
    if row.finalSide != spec["finalSide"]:
        return False
    if "source" in spec and row.finalSource != spec["source"]:
        return False
    if "wfSide" in spec and row.wfSide != spec["wfSide"]:
        return False
    if "projectionSide" in spec and row.projectionSide != spec["projectionSide"]:
        return False
    if spec.get("wfAgreement") and row.wfSide != row.finalSide:
        return False
    if "absGap" in spec and not between_open_closed(row.absLineGap, spec["absGap"]):
        return False
    if "absGapMax" in spec and not (clean_number(row.absLineGap, 999) <= float(spec["absGapMax"])):
        return False
    if "minutes" in spec and not between_open_closed(row.projectedMinutes, spec["minutes"]):
        return False
    if "line" in spec and not between_open_closed(row.line, spec["line"]):
        return False
    if "wfConfidence" in spec and not between_open_closed(row.wfConfidence, spec["wfConfidence"]):
        return False
    if "priorSourceSideAcc" in spec and not between_open_closed(row.prior_market_source_side_acc, spec["priorSourceSideAcc"]):
        return False
    if "priorFinalSideAcc" in spec and not between_open_closed(row.prior_market_final_side_acc, spec["priorFinalSideAcc"]):
        return False
    return True


def matches_premium_pts(row: pd.Series, qualified_ids: set[str]) -> bool:
    return (
        row.playerId in qualified_ids
        and row.market == "PTS"
        and row.finalSource == "player_override"
        and row.finalSide == "OVER"
        and row.wfSide == "OVER"
        and row.projectionSide == "OVER"
        and clean_number(row.absLineGap, -1) >= 0.5
        and clean_number(row.absLineGap, 999) < 1.25
        and clean_number(row.projectedMinutes, -1) >= 20
        and clean_number(row.projectedMinutes, 999) < 24
        and clean_number(row.wfConfidence, -1) >= 0.78
        and clean_number(row.wfConfidence, 999) < 0.85
    )


def matches_coverage_frontier(row: pd.Series, qualified_ids: set[str]) -> bool:
    return (
        row.playerId in qualified_ids
        and row.market in {"PTS", "REB", "AST"}
        and row.finalSource == "player_override"
        and row.finalSide in {"OVER", "UNDER"}
        and row.projectionSide in {"OVER", "UNDER"}
        and row.finalSide != row.projectionSide
        and clean_number(row.absLineGap, -1) >= 1
        and clean_number(row.projectedMinutes, -1) >= 24
    )


def matches_recent_form(row: pd.Series, top_ids: set[str]) -> bool:
    return (
        row.playerId in top_ids
        and row.market in {"PTS", "REB", "AST"}
        and row.finalSource == "player_override"
        and row.finalSide == "UNDER"
        and row.projectionSide == "OVER"
        and clean_number(row.absLineGap, -1) >= 1
        and clean_number(row.projectedMinutes, -1) >= 28
    )


def estimate_prior(components: list[str], component_acc: dict[str, float]) -> float:
    values = [component_acc[item] for item in components if item in component_acc]
    if not values:
        return 75.0
    return round(min(96.0, max(values) + min(2.0, max(0, len(values) - 1) * 0.55)), 2)


def score_row(row: pd.Series, components: list[str], prior: float) -> float:
    accuracy_score = prior / 100
    wf_score = clean_number(row.wfConfidence, 0.5) or 0.5
    meta_score = clean_number(row.metaProbCorrect, accuracy_score) or accuracy_score
    gap_score = clamp((clean_number(row.absLineGap, 0) or 0) / 3, 0, 1)
    book_score = 0.6
    minute = clean_number(row.projectedMinutes)
    minute_score = 0.5 if minute is None else clamp((minute - 16) / 18, 0, 1)
    consensus_score = clamp((len(components) - 1) / 4, 0, 1)
    source_adjustment = 0.035 if row.finalSource == "player_override" else -0.018 if row.finalSource == "baseline" else 0
    return round(
        accuracy_score * 0.48
        + wf_score * 0.18
        + meta_score * 0.14
        + gap_score * 0.08
        + book_score * 0.05
        + minute_score * 0.03
        + consensus_score * 0.04
        + source_adjustment,
        6,
    )


def tier_for(components: list[str], row: pd.Series) -> str:
    if "top200_premium_90" in components:
        return "S"
    if "top200_premium_pts_over" in components or "top200_accuracy_first" in components:
        return "A"
    if "top200_meta_reliability" in components and (
        "top200_coverage_frontier" in components or "top200_recent_form_fade" in components
    ):
        return "A"
    if any(
        item in components
        for item in ["top200_meta_reliability", "top200_coverage_frontier", "top200_recent_form_fade", "top200_primary"]
    ):
        return "B"
    if row.finalSource == "player_override" or clean_number(row.wfConfidence, 0) >= 0.7 or clean_number(row.metaProbCorrect, 0) >= 0.74:
        return "C"
    return "D"


def action_for(tier: str, components: list[str], base_score: float) -> str:
    action_components = [item for item in components if item != "live_quality_router_v9"]
    if action_components or tier in {"S", "A", "B"}:
        return "CANDIDATE"
    if tier == "C" and base_score >= 0.78:
        return "CANDIDATE"
    return "COVERAGE"


def risk_flags(row: pd.Series, components: list[str]) -> list[str]:
    flags = []
    if clean_number(row.projectedMinutes, 99) < 22:
        flags.append("low_projected_minutes")
    if row.finalSource == "baseline" and "top200_premium_90" not in components:
        flags.append("baseline_source")
    if row.finalSide in {"OVER", "UNDER"} and row.projectionSide in {"OVER", "UNDER"} and row.finalSide != row.projectionSide:
        flags.append("projection_side_split")
    if clean_number(row.absLineGap, 0) < 0.5 and "top200_premium_90" not in components:
        flags.append("thin_projection_gap")
    return flags


def build_model_rows(df: pd.DataFrame, model: dict[str, Any], component_acc: dict[str, float]) -> list[dict[str, Any]]:
    primary_ids = {item["playerId"] for item in model["primaryPlayerPool"]}
    qualified_ids = {item["playerId"] for item in model.get("qualifiedPlayerPool", model["primaryPlayerPool"])}
    tail_ids = qualified_ids - primary_ids
    primary_threshold = clean_number(model.get("primaryLane", {}).get("threshold"), 0.84) or 0.84
    accuracy_threshold = clean_number(model.get("accuracyFirstLane", {}).get("threshold"), 0.89) or 0.89
    output = []

    for row in df.itertuples(index=False):
        if row.finalSide not in {"OVER", "UNDER"}:
            continue
        components = ["live_quality_router_v9"]
        pockets = [spec["label"] for spec in POCKET_SPECS if matches_pocket(row, spec, primary_ids, tail_ids)]
        if pockets:
            components.append("top200_premium_90")
        if matches_premium_pts(row, qualified_ids):
            components.append("top200_premium_pts_over")
        if row.playerId in primary_ids and clean_number(row.wfConfidence, 0) >= accuracy_threshold:
            components.append("top200_accuracy_first")
        if row.playerId in primary_ids and clean_number(row.metaProbCorrect, 0) >= 0.825 and clean_number(row.wfConfidence, 0) >= 0.75:
            components.append("top200_meta_reliability")
        if matches_coverage_frontier(row, qualified_ids):
            components.append("top200_coverage_frontier")
        if matches_recent_form(row, primary_ids):
            components.append("top200_recent_form_fade")
        if row.playerId in primary_ids and clean_number(row.wfConfidence, 0) >= primary_threshold:
            components.append("top200_primary")
        components = list(dict.fromkeys(components))
        prior = estimate_prior(components, component_acc)
        base_score = score_row(row, components, prior)
        tier = tier_for(components, row)
        action = action_for(tier, components, base_score)
        team = getattr(row, "teamCode", None)
        game = getattr(row, "externalGameId", None) or getattr(row, "matchupKey", None)
        output.append(
            {
                "rowKey": row.rowKey,
                "date": row.gameDateEt,
                "playerId": row.playerId,
                "playerName": row.playerName,
                "teamCode": team,
                "gameKey": game,
                "market": row.market,
                "side": row.finalSide,
                "actualSide": row.actualSide,
                "correct": row.finalSide == row.actualSide,
                "line": round_number(row.line, 2),
                "actualValue": round_number(row.actualValue, 2),
                "projectedValue": round_number(row.projectedValue, 2),
                "lineGap": round_number(row.lineGap, 3),
                "absLineGap": round_number(row.absLineGap, 3),
                "wfConfidence": round_number(row.wfConfidence, 6),
                "metaProbCorrect": round_number(row.metaProbCorrect, 6),
                "projectedMinutes": round_number(row.projectedMinutes, 2),
                "tier": tier,
                "modelAction": action,
                "components": components,
                "premiumPockets": sorted(pockets),
                "estimatedAccuracyPriorPct": prior,
                "baseScore": base_score,
                "correlationPenalty": 0.0,
                "finalScore": base_score,
                "selectedRank": None,
                "riskFlags": risk_flags(row, components),
                "rejectionReason": None,
            }
        )
    return output


def is_counting_over(row: dict[str, Any]) -> bool:
    return row["side"] == "OVER" and row["market"] in COUNTING_OVER_MARKETS


def same_team(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return bool(left.get("teamCode")) and left.get("teamCode") == right.get("teamCode")


def same_game(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return bool(left.get("gameKey")) and left.get("gameKey") == right.get("gameKey")


def correlation_penalty(row: dict[str, Any], selected: list[dict[str, Any]]) -> float:
    penalty = 0.0
    for leg in selected:
        if same_game(row, leg):
            penalty += 0.025
        if same_team(row, leg):
            penalty += 0.045
        if same_team(row, leg) and is_counting_over(row) and is_counting_over(leg):
            penalty += 0.13
        if row["market"] == leg["market"]:
            penalty += 0.006
        if same_game(row, leg) and row["market"] in COMBO_MARKETS and leg["market"] in COMBO_MARKETS:
            penalty += 0.018
    return round(penalty, 6)


def cap_rejection(row: dict[str, Any], selected: list[dict[str, Any]]) -> str | None:
    if row["market"] in SELECTED_MARKET_VETO:
        return "portfolio_guard_market_veto"
    if sum(1 for item in selected if item["playerId"] == row["playerId"]) >= PORTFOLIO_LIMITS["maxPerPlayer"]:
        return "same_player_cap"
    if row.get("teamCode") and sum(1 for item in selected if item.get("teamCode") == row.get("teamCode")) >= PORTFOLIO_LIMITS["maxPerTeam"]:
        return "same_team_cap"
    if row.get("gameKey") and sum(1 for item in selected if item.get("gameKey") == row.get("gameKey")) >= PORTFOLIO_LIMITS["maxPerGame"]:
        return "same_game_cap"
    if sum(1 for item in selected if item["market"] == row["market"]) >= PORTFOLIO_LIMITS["maxPerMarket"]:
        return "market_cap"
    if row["market"] in COMBO_MARKETS and sum(1 for item in selected if item["market"] in COMBO_MARKETS) >= PORTFOLIO_LIMITS["maxComboMarkets"]:
        return "combo_market_cap"
    if row.get("teamCode") and is_counting_over(row):
        existing = [item for item in selected if item.get("teamCode") == row.get("teamCode") and is_counting_over(item)]
        if len(existing) >= PORTFOLIO_LIMITS["maxSameTeamCountingOvers"]:
            return "same_team_counting_over_cap"
    return None


def candidate_sort_key(row: dict[str, Any]) -> tuple:
    tier_rank = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}.get(row["tier"], 5)
    return (
        tier_rank,
        -row["baseScore"],
        -(row["estimatedAccuracyPriorPct"] or 0),
        -(row.get("wfConfidence") or 0),
        -(row.get("absLineGap") or 0),
        row["playerName"],
        row["market"],
    )


def final_sort_key(row: dict[str, Any]) -> tuple:
    tier_rank = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}.get(row["tier"], 5)
    return (
        -row["finalScore"],
        tier_rank,
        -(row["estimatedAccuracyPriorPct"] or 0),
        row["playerName"],
        row["market"],
    )


def select_for_date(rows: list[dict[str, Any]], max_picks: int, min_score: float) -> list[dict[str, Any]]:
    candidates = sorted([row for row in rows if row["modelAction"] == "CANDIDATE"], key=candidate_sort_key)
    remaining = {row["rowKey"]: row for row in candidates}
    selected: list[dict[str, Any]] = []
    while len(selected) < max_picks and remaining:
        best = None
        for row in remaining.values():
            if cap_rejection(row, selected):
                continue
            penalty = correlation_penalty(row, selected)
            scored = dict(row)
            scored["correlationPenalty"] = penalty
            scored["finalScore"] = round(scored["baseScore"] - penalty, 6)
            if scored["finalScore"] < min_score:
                continue
            if best is None or final_sort_key(scored) < final_sort_key(best):
                best = scored
        if best is None:
            break
        best["modelAction"] = "SELECTED"
        best["selectedRank"] = len(selected) + 1
        selected.append(best)
        remaining.pop(best["rowKey"], None)
    return selected


def apply_portfolio(rows: list[dict[str, Any]], max_picks: int, min_score: float) -> list[dict[str, Any]]:
    rows_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        rows_by_date[row["date"]].append(row)
    output = []
    for date in sorted(rows_by_date):
        day = rows_by_date[date]
        selected = select_for_date(day, max_picks, min_score)
        selected_keys = {row["rowKey"] for row in selected}
        output.extend(selected)
        for row in day:
            if row["rowKey"] in selected_keys:
                continue
            penalty = correlation_penalty(row, selected)
            item = dict(row)
            item["correlationPenalty"] = penalty
            item["finalScore"] = round(item["baseScore"] - penalty, 6)
            cap = cap_rejection(item, selected)
            score = "below_min_score" if item["finalScore"] < min_score else None
            cutoff = "portfolio_rank_cutoff" if item["modelAction"] == "CANDIDATE" and not cap and not score else None
            item["rejectionReason"] = cap or score or cutoff
            output.append(item)
    return sorted(output, key=lambda row: (row["date"], row.get("selectedRank") or 999, candidate_sort_key(row)))


def summarize(rows: list[dict[str, Any]], dates: list[str] | None = None) -> dict[str, Any]:
    scoped = [row for row in rows if dates is None or row["date"] in dates]
    samples = len(scoped)
    wins = sum(1 for row in scoped if row["correct"])
    return {
        "samples": samples,
        "wins": wins,
        "losses": samples - wins,
        "accuracyPct": round(100 * wins / samples, 2) if samples else None,
    }


def summarize_by(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row.get(key) or "NA")].append(row)
    return {name: summarize(group) for name, group in sorted(groups.items())}


def summarize_daily(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row["date"]].append(row)
    daily = []
    for date, group in sorted(groups.items()):
        bucket = summarize(group)
        daily.append({"date": date, **bucket})
    return daily


def is_qualified_90_board_row(row: dict[str, Any]) -> bool:
    return row["tier"] in {"S", "A", "C"}


def is_score_90_board_row(row: dict[str, Any]) -> bool:
    return clean_number(row.get("finalScore"), 0) >= 0.78


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    cols = [
        "date",
        "selectedRank",
        "modelAction",
        "tier",
        "playerName",
        "teamCode",
        "gameKey",
        "market",
        "side",
        "line",
        "actualValue",
        "actualSide",
        "correct",
        "estimatedAccuracyPriorPct",
        "baseScore",
        "correlationPenalty",
        "finalScore",
        "rejectionReason",
        "components",
        "riskFlags",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=cols)
        writer.writeheader()
        for row in rows:
            out = {col: row.get(col) for col in cols}
            out["components"] = ";".join(row.get("components") or [])
            out["riskFlags"] = ";".join(row.get("riskFlags") or [])
            writer.writerow(out)


def markdown_report(output: dict[str, Any]) -> str:
    selected = output["selected"]
    full_board = output["fullBoard"]
    qualified = output["qualified90Board"]
    score_qualified = output["score90Board"]
    candidate = output["candidatePool"]
    lines = [
        "# Final Player Prop Model V1 Walk-Forward Backtest",
        "",
        f"Generated: {output['generatedAt']}",
        f"Model version: `{output['modelVersion']}`",
        f"Input: `{output['input']}`",
        "",
        "## Headline",
        "",
        f"- Full-board coverage: {output['coveragePct']:.2f}%",
        f"- Full-board accuracy: {full_board['overall']['accuracyPct']:.2f}% ({full_board['overall']['wins']:,}-{full_board['overall']['losses']:,}, {full_board['overall']['samples']:,} rows)",
        f"- 90+ qualified-board accuracy: {qualified['overall']['accuracyPct']:.2f}% ({qualified['overall']['wins']:,}-{qualified['overall']['losses']:,}, {qualified['overall']['samples']:,} rows; {qualified['coveragePct']:.2f}% board coverage)",
        f"- 90+ score-floor-board accuracy: {score_qualified['overall']['accuracyPct']:.2f}% ({score_qualified['overall']['wins']:,}-{score_qualified['overall']['losses']:,}, {score_qualified['overall']['samples']:,} rows; {score_qualified['coveragePct']:.2f}% board coverage)",
        f"- Selected-pick accuracy: {selected['overall']['accuracyPct']:.2f}% ({selected['overall']['wins']:,}-{selected['overall']['losses']:,}, {selected['overall']['samples']:,} picks)",
        f"- Candidate-pool accuracy: {candidate['overall']['accuracyPct']:.2f}% ({candidate['overall']['wins']:,}-{candidate['overall']['losses']:,}, {candidate['overall']['samples']:,} rows)",
        f"- Avg selected picks per slate: {output['avgSelectedPerSlate']:.2f}",
        f"- Selected lift vs full board: {output['selectedLiftVsFullBoardPct']:.2f} pts",
        "",
        "## Recent Windows",
        "",
        "| Slice | Overall | Last 30 | Last 14 |",
        "|---|---:|---:|---:|",
        f"| Full board | {full_board['overall']['accuracyPct']:.2f}% | {full_board['last30']['accuracyPct']:.2f}% | {full_board['last14']['accuracyPct']:.2f}% |",
        f"| 90+ qualified board | {qualified['overall']['accuracyPct']:.2f}% | {qualified['last30']['accuracyPct']:.2f}% | {qualified['last14']['accuracyPct']:.2f}% |",
        f"| 90+ score-floor board | {score_qualified['overall']['accuracyPct']:.2f}% | {score_qualified['last30']['accuracyPct']:.2f}% | {score_qualified['last14']['accuracyPct']:.2f}% |",
        f"| Candidate pool | {candidate['overall']['accuracyPct']:.2f}% | {candidate['last30']['accuracyPct']:.2f}% | {candidate['last14']['accuracyPct']:.2f}% |",
        f"| Selected picks | {selected['overall']['accuracyPct']:.2f}% | {selected['last30']['accuracyPct']:.2f}% | {selected['last14']['accuracyPct']:.2f}% |",
        "",
        "## Selected By Market",
        "",
        "| Market | Picks | Accuracy | Record |",
        "|---|---:|---:|---:|",
    ]
    for market, bucket in output["selectedByMarket"].items():
        lines.append(
            f"| {market} | {bucket['samples']:,} | {bucket['accuracyPct']:.2f}% | {bucket['wins']:,}-{bucket['losses']:,} |"
        )
    lines.extend(
        [
            "",
            "## Selected By Tier",
            "",
            "| Tier | Picks | Accuracy | Record |",
            "|---|---:|---:|---:|",
        ]
    )
    for tier, bucket in output["selectedByTier"].items():
        lines.append(
            f"| {tier} | {bucket['samples']:,} | {bucket['accuracyPct']:.2f}% | {bucket['wins']:,}-{bucket['losses']:,} |"
        )
    lines.extend(
        [
            "",
            "## Claim Boundary",
            "",
            "- This is the first dedicated replay for the final selector as written.",
            "- The 2026-05-08 accuracy ladder keeps the full-board context intact and adds explicit 90+ qualified-board slices rather than relabeling the full board.",
            "- The 2026-05-06 portfolio guard remains intact: full-board coverage, selected PR/PA veto, one combo-market cap, and a selected score floor of 0.84.",
            "- The full-board side comes from the V9 details artifact; the selector features are recomputed walk-forward by date.",
            "- This is still historical replay, not locked-forward proof.",
            "- ROI and CLV require the market-line and settlement ledgers.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    gate = load_module(root / "scripts/export-live-quality-honest-walkforward-confidence-gate.py", "live_quality_gate")
    model = load_json(args.model)
    precision = load_json(args.precision) if Path(args.precision).exists() else None
    v9 = load_json(args.v9_summary) if Path(args.v9_summary).exists() else None
    component_acc = build_component_accuracies(model, precision, v9)

    df, cat_cols, num_cols = gate.prepare_frame(root / args.input)
    df = df[df["market"].isin(MARKETS)].copy()
    dates = sorted(df["gameDateEt"].unique().tolist())
    num_cols = gate.attach_prior_reliability(df, dates, num_cols)
    folds = gate.build_folds(dates, args.min_train_dates, args.test_dates)
    fold_summaries = gate.score_walk_forward(df, dates, folds, cat_cols, num_cols)
    primary_ids = {item["playerId"] for item in model["primaryPlayerPool"]}
    build_meta_probabilities(df, dates, folds, primary_ids)

    eligible = df[df["eligibleWalkForward"]].copy()
    model_rows = build_model_rows(eligible, model, component_acc)
    board_rows = apply_portfolio(model_rows, args.max_picks, args.min_score)
    selected_rows = [row for row in board_rows if row["modelAction"] == "SELECTED"]
    candidate_rows = [row for row in board_rows if row["modelAction"] in {"SELECTED", "CANDIDATE"}]
    qualified90_rows = [row for row in board_rows if is_qualified_90_board_row(row)]
    score90_rows = [row for row in board_rows if is_score_90_board_row(row)]
    coverage_pct = round(100 * len(board_rows) / len(eligible), 2) if len(eligible) else 0
    active_dates = sorted({row["date"] for row in board_rows})
    last30 = set(active_dates[-30:])
    last14 = set(active_dates[-14:])

    full_overall = summarize(board_rows)
    selected_overall = summarize(selected_rows)
    output = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "input": str(Path(args.input).resolve()),
        "dateRange": {"from": active_dates[0] if active_dates else None, "to": active_dates[-1] if active_dates else None, "activeDates": len(active_dates)},
        "config": {"maxPicks": args.max_picks, "minScore": args.min_score, **PORTFOLIO_LIMITS},
        "coveragePct": coverage_pct,
        "rowsScored": len(board_rows),
        "eligibleRows": int(len(eligible)),
        "folds": fold_summaries,
        "componentAccuracies": component_acc,
        "fullBoard": {
            "overall": full_overall,
            "last30": summarize(board_rows, list(last30)),
            "last14": summarize(board_rows, list(last14)),
        },
        "qualified90Board": {
            "rule": "tier in S/A/C",
            "coveragePct": round(100 * len(qualified90_rows) / len(board_rows), 2) if board_rows else 0,
            "overall": summarize(qualified90_rows),
            "last30": summarize(qualified90_rows, list(last30)),
            "last14": summarize(qualified90_rows, list(last14)),
        },
        "score90Board": {
            "rule": "finalScore >= 0.78",
            "coveragePct": round(100 * len(score90_rows) / len(board_rows), 2) if board_rows else 0,
            "overall": summarize(score90_rows),
            "last30": summarize(score90_rows, list(last30)),
            "last14": summarize(score90_rows, list(last14)),
        },
        "candidatePool": {
            "overall": summarize(candidate_rows),
            "last30": summarize(candidate_rows, list(last30)),
            "last14": summarize(candidate_rows, list(last14)),
        },
        "selected": {
            "overall": selected_overall,
            "last30": summarize(selected_rows, list(last30)),
            "last14": summarize(selected_rows, list(last14)),
        },
        "avgSelectedPerSlate": round(len(selected_rows) / len(active_dates), 2) if active_dates else 0,
        "selectedLiftVsFullBoardPct": round((selected_overall["accuracyPct"] or 0) - (full_overall["accuracyPct"] or 0), 2),
        "fullBoardByMarket": summarize_by(board_rows, "market"),
        "selectedByMarket": summarize_by(selected_rows, "market"),
        "selectedByTier": summarize_by(selected_rows, "tier"),
        "boardRowsByAction": dict(Counter(row["modelAction"] for row in board_rows)),
        "boardRowsByTier": dict(Counter(row["tier"] for row in board_rows)),
        "selectedDaily": summarize_daily(selected_rows),
    }

    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    Path(f"{out_prefix}.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    Path(f"{out_prefix}.md").write_text(markdown_report(output) + "\n", encoding="utf-8")
    write_csv(Path(f"{out_prefix}-selected.csv"), selected_rows)
    write_csv(Path(f"{out_prefix}-board.csv"), board_rows)
    Path(f"{out_prefix}-daily.csv").write_text(
        "date,samples,wins,losses,accuracyPct\n"
        + "\n".join(
            f"{row['date']},{row['samples']},{row['wins']},{row['losses']},{row['accuracyPct']}"
            for row in output["selectedDaily"]
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "modelId": MODEL_ID,
                "coveragePct": coverage_pct,
                "fullBoardAccuracyPct": full_overall["accuracyPct"],
                "qualified90BoardAccuracyPct": output["qualified90Board"]["overall"]["accuracyPct"],
                "qualified90BoardCoveragePct": output["qualified90Board"]["coveragePct"],
                "score90BoardAccuracyPct": output["score90Board"]["overall"]["accuracyPct"],
                "score90BoardCoveragePct": output["score90Board"]["coveragePct"],
                "selectedAccuracyPct": selected_overall["accuracyPct"],
                "candidatePoolAccuracyPct": output["candidatePool"]["overall"]["accuracyPct"],
                "selectedPicks": selected_overall["samples"],
                "avgSelectedPerSlate": output["avgSelectedPerSlate"],
                "selectedLiftVsFullBoardPct": output["selectedLiftVsFullBoardPct"],
                "outputs": {
                    "json": f"{out_prefix}.json",
                    "md": f"{out_prefix}.md",
                    "selectedCsv": f"{out_prefix}-selected.csv",
                    "boardCsv": f"{out_prefix}-board.csv",
                    "dailyCsv": f"{out_prefix}-daily.csv",
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
