from __future__ import annotations

import json
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Any

import pandas as pd

from .model import CLAIM_BOUNDARY, MODEL_ID, MODEL_VERSION, PORTFOLIO_LIMITS, _select_portfolio, _try_select_row, utc_now
from .settlement import _actual_for_row, _has_final_team_boxscore, _settlement_status, settle_card

SELECTION_ONLY_FLAGS = {
    "expanded_card_fill",
    "forced_six_pick_fill",
    "same_game_concentration",
    "same_player_correlation",
}

ML_FLAG_FEATURES = [
    "volatile_minutes",
    "combo_market_correlation",
    "single_side_price",
    "thin_market_count",
    "blowout_spread",
    "source_projection_near_line",
    "source_projection_disagreement",
    "short_rest_or_b2b",
    "low_player_sample",
    "thin_player_history",
]
ML_NUMERIC_FEATURES = [
    "final_score",
    "model_probability",
    "abs_line_gap",
    "line",
    "projected_value",
    "line_gap",
    "price_edge",
    "fair_probability",
    "projected_minutes",
    "sample_size",
]
ML_CATEGORICAL_FEATURES = ["market", "side", "tier", "source_book", "team", "opponent"]


def daily_six_pick_limits(max_picks: int = 6, min_score: float = 0.68) -> dict[str, Any]:
    return {
        "max_picks": max_picks,
        "target_picks": max_picks,
        "min_score": min_score,
        "require_playable_side_odds": True,
        "allow_expanded_fill": True,
        "expanded_min_score": 0.58,
        "expanded_min_probability": 0.62,
        "expanded_min_price_edge": 0.04,
        "allow_forced_six_pick_fill": True,
        "forced_fill_min_score": 0.0,
        "forced_fill_min_probability": 0.50,
        "max_per_player": 1,
        "max_per_team": 6,
        "max_per_game": 6,
        "max_per_market": 4,
        "max_combo_markets": 4,
    }


def default_archive_profiles(max_picks: int = 6, min_score: float = 0.68) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    for forced_probability in [0.50, 0.54]:
        for expanded_probability in [0.62, 0.64]:
            for max_combo_markets in [3, 4]:
                for pra_under_penalty in [0.0, 0.04]:
                    for volatile_penalty in [0.0, 0.04]:
                        limits = daily_six_pick_limits(max_picks=max_picks, min_score=min_score)
                        limits.update(
                            {
                                "forced_fill_min_probability": forced_probability,
                                "expanded_min_probability": expanded_probability,
                                "max_combo_markets": max_combo_markets,
                                "standard_pra_under_penalty": pra_under_penalty,
                                "standard_volatile_penalty": volatile_penalty,
                            }
                        )
                        profiles.append(
                            {
                                "name": (
                                    f"forced_p{forced_probability:.2f}_"
                                    f"expanded_p{expanded_probability:.2f}_"
                                    f"combo{max_combo_markets}_"
                                    f"pra{pra_under_penalty:.2f}_vol{volatile_penalty:.2f}"
                                ),
                                "limits": limits,
                            }
                        )
    return profiles


def default_archive_ml_limit_profiles(max_picks: int = 6, min_score: float = 0.68) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    for max_per_market in [2, 3, 4, 5, 6]:
        for max_combo_markets in [1, 2, 3, 4]:
            profiles.append(
                {
                    "name": f"market{max_per_market}_combo{max_combo_markets}",
                    "limits": {
                        "max_picks": max_picks,
                        "target_picks": max_picks,
                        "min_score": min_score,
                        "max_per_market": max_per_market,
                        "max_combo_markets": max_combo_markets,
                    },
                }
            )
    return profiles


def _reset_replay_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reset_rows = deepcopy(rows)
    for row in reset_rows:
        row["model_action"] = "COVERAGE"
        row["selected_rank"] = None
        row["rejection_reason"] = None
        row["risk_flags"] = sorted(set(row.get("risk_flags") or []) - SELECTION_ONLY_FLAGS)
    return reset_rows


def _replay_card(card: dict[str, Any], logs: pd.DataFrame, limits: dict[str, Any] | None = None) -> dict[str, Any]:
    rows = _reset_replay_rows(card.get("boardRows") or [])
    portfolio_config = {**(card.get("portfolioConfig") or {}), **(limits or {})}
    _select_portfolio(rows, portfolio_config)
    selected_rows = sorted(
        [row for row in rows if row["model_action"] == "SELECTED"],
        key=lambda item: item.get("selected_rank") or 999,
    )
    replayed_card = {
        **card,
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "mode": "ARCHIVE_SELECTOR_REPLAY",
        "portfolioConfig": portfolio_config,
        "boardRows": rows,
        "selectedRows": selected_rows,
    }
    settlement = settle_card(replayed_card, logs)
    return {"card": replayed_card, "settlement": settlement}


def _card_paths(archive_root: str | Path, current_card: str | Path | None = None) -> list[Path]:
    root = Path(archive_root)
    paths = sorted(root.glob("*/current-card.json"))
    if current_card is not None:
        current_path = Path(current_card)
        if current_path.exists():
            paths.append(current_path)
    return paths


def _archive_summary(
    daily_rows: list[dict[str, Any]],
    selected_rows: list[dict[str, Any]],
    target_picks: int,
    *,
    cards_key: str = "cardsReplayed",
    cards_value: int | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settled_rows = [row for row in selected_rows if row["settlement"] in {"WIN", "LOSS"}]
    wins = sum(row["settlement"] == "WIN" for row in settled_rows)
    six_pick_settled = [row for row in daily_rows if row["sixPickSettled"]]
    six_pick_wins = sum(row["sixPickParlayHit"] for row in six_pick_settled)
    summary = {
        cards_key: len(daily_rows) if cards_value is None else cards_value,
        "targetPicks": target_picks,
        "sixPickCoveredDates": sum(row["sixPickCovered"] for row in daily_rows),
        "sixPickSettledDates": len(six_pick_settled),
        "sixPickParlayWins": six_pick_wins,
        "sixPickParlayAccuracyPct": round(100.0 * six_pick_wins / len(six_pick_settled), 2)
        if six_pick_settled
        else None,
        "settledLegs": len(settled_rows),
        "legWins": wins,
        "legAccuracyPct": round(100.0 * wins / len(settled_rows), 2) if settled_rows else None,
    }
    if extra:
        summary.update(extra)
    return summary


def _replay_card_paths(
    card_paths: list[Path],
    logs: pd.DataFrame,
    *,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    daily_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    target_picks = int((limits or {}).get("target_picks") or (limits or {}).get("max_picks") or 6)
    for card_path in card_paths:
        card = json.loads(card_path.read_text(encoding="utf-8"))
        if not card.get("boardRows"):
            continue
        replay = _replay_card(card, logs, limits)
        settlement = replay["settlement"]
        summary = settlement["summary"]
        selected_count = len(replay["card"]["selectedRows"])
        settled_full_card = selected_count >= target_picks and summary["settledPicks"] == selected_count
        parlay_hit = bool(settled_full_card and summary["wins"] == selected_count)
        slate_date = str(card.get("slateDate") or card_path.parent.name)
        daily_rows.append(
            {
                "slateDate": slate_date,
                "cardPath": str(card_path),
                "selectedCount": selected_count,
                "settledPicks": summary["settledPicks"],
                "wins": summary["wins"],
                "losses": summary["losses"],
                "pushes": summary["pushes"],
                "pendingPicks": summary["pendingPicks"],
                "noActionPicks": summary["noActionPicks"],
                "legAccuracyPct": summary["accuracyPct"],
                "sixPickCovered": selected_count >= target_picks,
                "sixPickSettled": settled_full_card,
                "sixPickParlayHit": parlay_hit,
            }
        )
        replayed_by_rank = {
            row.get("selected_rank"): row
            for row in replay["card"]["selectedRows"]
            if row.get("selected_rank") is not None
        }
        for row in settlement["rows"]:
            replayed_row = replayed_by_rank.get(row.get("selected_rank"), {})
            selected_rows.append(
                {
                    **row,
                    "risk_flags": list(replayed_row.get("risk_flags") or []),
                    "tier": replayed_row.get("tier"),
                    "cardPath": str(card_path),
                    "sixPickParlayHit": parlay_hit,
                }
            )

    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": _archive_summary(daily_rows, selected_rows, target_picks),
        "dailyRows": daily_rows,
        "selectedRows": selected_rows,
    }


def replay_archived_cards(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    current_card: str | Path | None = None,
    limits: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _replay_card_paths(_card_paths(archive_root, current_card), logs, limits=limits)


def _sweep_sort_key(profile_result: dict[str, Any]) -> tuple[float, float, float, float, float]:
    summary = profile_result["summary"]
    cards_replayed = max(1, int(summary["cardsReplayed"]))
    coverage_rate = float(summary["sixPickCoveredDates"]) / cards_replayed
    settled_rate = float(summary["sixPickSettledDates"]) / cards_replayed
    return (
        coverage_rate,
        float(summary["sixPickParlayAccuracyPct"] or 0.0),
        float(summary["sixPickSettledDates"]),
        float(summary["legAccuracyPct"] or 0.0),
        settled_rate,
    )


def _sweep_archive_profile_paths(
    card_paths: list[Path],
    logs: pd.DataFrame,
    *,
    profiles: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profile_results: list[dict[str, Any]] = []
    for index, profile in enumerate(profiles or default_archive_profiles()):
        name = str(profile.get("name") or f"profile_{index + 1}")
        limits = dict(profile.get("limits") or {})
        report = _replay_card_paths(card_paths, logs, limits=limits)
        profile_results.append(
            {
                "profileName": name,
                "limits": limits,
                "summary": report["summary"],
            }
        )
    profile_results.sort(key=_sweep_sort_key, reverse=True)
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "profileCount": len(profile_results),
        "profiles": profile_results,
    }


def sweep_archive_profiles(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    profiles: list[dict[str, Any]] | None = None,
    current_card: str | Path | None = None,
) -> dict[str, Any]:
    return _sweep_archive_profile_paths(
        _card_paths(archive_root, current_card),
        logs,
        profiles=profiles,
    )


def walk_forward_archive_profiles(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    profiles: list[dict[str, Any]] | None = None,
    current_card: str | Path | None = None,
    min_training_cards: int = 1,
) -> dict[str, Any]:
    card_paths = _card_paths(archive_root, current_card)
    profile_grid = profiles or default_archive_profiles()
    daily_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    target_limits = dict((profile_grid[0].get("limits") if profile_grid else {}) or {})
    target_picks = int(target_limits.get("target_picks") or target_limits.get("max_picks") or 6)
    profile_cache: list[dict[str, Any]] = []
    for profile_index, profile in enumerate(profile_grid):
        limits = dict(profile.get("limits") or {})
        profile_cache.append(
            {
                "profileIndex": profile_index,
                "profileName": str(profile.get("name") or f"profile_{profile_index + 1}"),
                "limits": limits,
                "targetPicks": int(limits.get("target_picks") or limits.get("max_picks") or 6),
                "reports": [_replay_card_paths([card_path], logs, limits=limits) for card_path in card_paths],
            }
        )

    for index in range(max(0, min_training_cards), len(card_paths)):
        if index < min_training_cards:
            continue
        profile_results: list[dict[str, Any]] = []
        for profile in profile_cache:
            training_reports = profile["reports"][:index]
            training_daily = [row for report in training_reports for row in report["dailyRows"]]
            training_selected = [row for report in training_reports for row in report["selectedRows"]]
            profile_results.append(
                {
                    "profileIndex": profile["profileIndex"],
                    "profileName": profile["profileName"],
                    "limits": profile["limits"],
                    "summary": _archive_summary(training_daily, training_selected, profile["targetPicks"]),
                }
            )
        profile_results.sort(key=_sweep_sort_key, reverse=True)
        if not profile_results:
            continue
        selected_profile = profile_results[0]
        profile_name = str(selected_profile["profileName"])
        report = profile_cache[selected_profile["profileIndex"]]["reports"][index]
        for row in report["dailyRows"]:
            daily_rows.append(
                {
                    **row,
                    "trainingCards": index,
                    "selectedProfileName": profile_name,
                    "trainingSummary": selected_profile["summary"],
                }
            )
        for row in report["selectedRows"]:
            selected_rows.append({**row, "selectedProfileName": profile_name})

    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": _archive_summary(
            daily_rows,
            selected_rows,
            target_picks,
            cards_key="cardsEvaluated",
            extra={"minTrainingCards": min_training_cards},
        ),
        "dailyRows": daily_rows,
        "selectedRows": selected_rows,
    }


def _settle_replay_candidate(row: dict[str, Any], logs: pd.DataFrame) -> tuple[float | None, str]:
    actual = _actual_for_row(logs, row)
    settlement = _settlement_status(row, actual)
    if settlement == "PENDING" and _has_final_team_boxscore(logs, row):
        settlement = "NO_ACTION"
    return actual, settlement


def _candidate_card_for_ml(
    card_path: Path,
    logs: pd.DataFrame,
    limits: dict[str, Any] | None,
) -> dict[str, Any] | None:
    card = json.loads(card_path.read_text(encoding="utf-8"))
    if not card.get("boardRows"):
        return None
    replay = _replay_card(card, logs, limits)
    candidate_rows: list[dict[str, Any]] = []
    for row in replay["card"]["boardRows"]:
        if row["model_action"] not in {"SELECTED", "CANDIDATE"}:
            continue
        candidate = deepcopy(row)
        actual, settlement = _settle_replay_candidate(candidate, logs)
        candidate["actual"] = actual
        candidate["settlement"] = settlement
        if settlement in {"WIN", "LOSS"}:
            candidate["hit_label"] = 1 if settlement == "WIN" else 0
        candidate_rows.append(candidate)
    return {
        "cardPath": str(card_path),
        "slateDate": str(card.get("slateDate") or card_path.parent.name),
        "portfolioConfig": replay["card"].get("portfolioConfig") or {},
        "candidateRows": candidate_rows,
    }


def _ml_feature_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    feature_rows: list[dict[str, Any]] = []
    for row in rows:
        flags = set(row.get("risk_flags") or [])
        features: dict[str, Any] = {}
        for column in ML_NUMERIC_FEATURES:
            features[column] = row.get(column)
        for column in ML_CATEGORICAL_FEATURES:
            features[column] = str(row.get(column) or "")
        for flag in ML_FLAG_FEATURES:
            features[f"flag_{flag}"] = 1 if flag in flags else 0
        feature_rows.append(features)
    frame = pd.DataFrame(feature_rows)
    for column in ML_NUMERIC_FEATURES + [f"flag_{flag}" for flag in ML_FLAG_FEATURES]:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
            if frame[column].isna().all():
                frame[column] = 0.0
    return frame


def _build_archive_ml_ranker(training_row_count: int = 0) -> Any:
    try:
        from sklearn.compose import ColumnTransformer
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.impute import SimpleImputer
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder, StandardScaler
    except ImportError as error:  # pragma: no cover - exercised only in missing optional dependency environments
        raise RuntimeError("scikit-learn is required for archive ML ranker diagnostics.") from error

    numeric_features = ML_NUMERIC_FEATURES + [f"flag_{flag}" for flag in ML_FLAG_FEATURES]
    min_samples_leaf = max(2, min(12, training_row_count // 6 if training_row_count else 12))
    preprocessing = ColumnTransformer(
        [
            (
                "num",
                Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]),
                numeric_features,
            ),
            ("cat", OneHotEncoder(handle_unknown="ignore"), ML_CATEGORICAL_FEATURES),
        ]
    )
    return Pipeline(
        [
            ("pre", preprocessing),
            (
                "clf",
                RandomForestClassifier(
                    n_estimators=200,
                    max_depth=3,
                    min_samples_leaf=min_samples_leaf,
                    random_state=7,
                    class_weight="balanced_subsample",
                ),
            ),
        ]
    )


def _predict_win_probabilities(ranker: Any, rows: list[dict[str, Any]]) -> list[float]:
    probabilities = ranker.predict_proba(_ml_feature_frame(rows))
    classes = list(ranker.named_steps["clf"].classes_)
    if 1 not in classes:
        return [0.0 for _ in rows]
    win_index = classes.index(1)
    return [float(value) for value in probabilities[:, win_index]]


def _select_ml_ranked_rows(
    candidate_rows: list[dict[str, Any]],
    win_probabilities: list[float],
    limits: dict[str, Any],
) -> list[dict[str, Any]]:
    rows = deepcopy(candidate_rows)
    active_limits = {**PORTFOLIO_LIMITS, **limits}
    target = min(int(active_limits.get("target_picks") or active_limits["max_picks"]), int(active_limits["max_picks"]))
    for rank, (row, probability) in enumerate(zip(rows, win_probabilities), start=1):
        row["model_action"] = "CANDIDATE"
        row["selected_rank"] = None
        row["rejection_reason"] = None
        row["ml_candidate_rank"] = rank
        row["learnedHitProbability"] = round(probability, 5)
    rows.sort(
        key=lambda row: (
            float(row.get("learnedHitProbability") or 0.0),
            float(row.get("final_score") or 0.0),
            float(row.get("model_probability") or 0.0),
        ),
        reverse=True,
    )
    player_counts: Counter[str] = Counter()
    team_counts: Counter[str] = Counter()
    game_counts: Counter[str] = Counter()
    market_counts: Counter[str] = Counter()
    same_team_counting_overs: Counter[tuple[str, str]] = Counter()
    combo_count = 0
    selected = 0
    for relax_correlation_limits in [False, True]:
        for row in rows:
            if selected >= target:
                break
            if row["model_action"] == "SELECTED":
                continue
            picked, combo_count = _try_select_row(
                row,
                active_limits,
                selected,
                player_counts,
                team_counts,
                game_counts,
                market_counts,
                same_team_counting_overs,
                combo_count,
                relax_correlation_limits=relax_correlation_limits,
            )
            if picked:
                selected += 1
        if selected >= target:
            break
    return sorted(
        [row for row in rows if row["model_action"] == "SELECTED"],
        key=lambda row: row.get("selected_rank") or 999,
    )


def _selected_ml_rows_for_report(
    selected_rows: list[dict[str, Any]],
    card_path: str,
    parlay_hit: bool,
) -> list[dict[str, Any]]:
    report_rows: list[dict[str, Any]] = []
    for row in selected_rows:
        report_rows.append(
            {
                "slate_date": row.get("slate_date"),
                "selected_rank": row.get("selected_rank"),
                "player": row.get("player"),
                "team": row.get("team"),
                "team_name": row.get("team_name"),
                "opponent": row.get("opponent"),
                "opponent_name": row.get("opponent_name"),
                "market": row.get("market"),
                "side": row.get("side"),
                "line": row.get("line"),
                "actual": row.get("actual"),
                "settlement": row.get("settlement"),
                "model_probability": row.get("model_probability"),
                "final_score": row.get("final_score"),
                "learnedHitProbability": row.get("learnedHitProbability"),
                "source_book": row.get("source_book"),
                "source_url": row.get("source_url"),
                "risk_flags": list(row.get("risk_flags") or []),
                "tier": row.get("tier"),
                "cardPath": card_path,
                "sixPickParlayHit": parlay_hit,
            }
        )
    return report_rows


def _build_ml_prediction_cards(
    card_data: list[dict[str, Any]],
    *,
    min_training_cards: int,
    min_training_rows: int,
) -> tuple[list[dict[str, Any]], int]:
    prediction_cards: list[dict[str, Any]] = []
    skipped_cards = 0
    for index, data in enumerate(card_data):
        if index < min_training_cards:
            skipped_cards += 1
            continue
        training_rows = [
            row
            for prior_data in card_data[:index]
            for row in prior_data["candidateRows"]
            if row.get("hit_label") in {0, 1}
        ]
        labels = [int(row["hit_label"]) for row in training_rows]
        if len(training_rows) < min_training_rows or len(set(labels)) < 2:
            skipped_cards += 1
            continue
        candidate_rows = deepcopy(data["candidateRows"])
        if not candidate_rows:
            skipped_cards += 1
            continue
        ranker = _build_archive_ml_ranker(len(training_rows))
        ranker.fit(_ml_feature_frame(training_rows), labels)
        probabilities = _predict_win_probabilities(ranker, candidate_rows)
        for rank, (row, probability) in enumerate(zip(candidate_rows, probabilities), start=1):
            row["ml_candidate_rank"] = rank
            row["learnedHitProbability"] = round(probability, 5)
        prediction_cards.append(
            {
                "cardPath": data["cardPath"],
                "slateDate": data["slateDate"],
                "portfolioConfig": data["portfolioConfig"],
                "candidateRows": candidate_rows,
                "trainingCards": index,
                "trainingRows": len(training_rows),
            }
        )
    return prediction_cards, skipped_cards


def _ml_report_from_prediction_cards(
    prediction_cards: list[dict[str, Any]],
    *,
    limits: dict[str, Any] | None = None,
    target_picks: int = 6,
    summary_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    daily_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    for data in prediction_cards:
        selection_limits = {**(data.get("portfolioConfig") or {}), **(limits or {})}
        candidate_rows = data["candidateRows"]
        probabilities = [float(row.get("learnedHitProbability") or 0.0) for row in candidate_rows]
        selected = _select_ml_ranked_rows(candidate_rows, probabilities, selection_limits)
        selected_count = len(selected)
        wins = sum(row.get("settlement") == "WIN" for row in selected)
        losses = sum(row.get("settlement") == "LOSS" for row in selected)
        pushes = sum(row.get("settlement") == "PUSH" for row in selected)
        no_action = sum(row.get("settlement") == "NO_ACTION" for row in selected)
        pending = sum(row.get("settlement") == "PENDING" for row in selected)
        settled = wins + losses
        settled_full_card = selected_count >= target_picks and settled == selected_count
        parlay_hit = bool(settled_full_card and wins == selected_count)
        daily_rows.append(
            {
                "slateDate": data["slateDate"],
                "cardPath": data["cardPath"],
                "selectedCount": selected_count,
                "settledPicks": settled,
                "wins": wins,
                "losses": losses,
                "pushes": pushes,
                "pendingPicks": pending,
                "noActionPicks": no_action,
                "legAccuracyPct": round(100.0 * wins / settled, 2) if settled else None,
                "sixPickCovered": selected_count >= target_picks,
                "sixPickSettled": settled_full_card,
                "sixPickParlayHit": parlay_hit,
                "trainingCards": data["trainingCards"],
                "trainingRows": data["trainingRows"],
                "rankerModel": "random_forest_candidate_ranker",
            }
        )
        selected_rows.extend(_selected_ml_rows_for_report(selected, data["cardPath"], parlay_hit))

    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": _archive_summary(
            daily_rows,
            selected_rows,
            target_picks,
            cards_key="cardsEvaluated",
            extra=summary_extra,
        ),
        "dailyRows": daily_rows,
        "selectedRows": selected_rows,
    }


def walk_forward_archive_ml_ranker(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    current_card: str | Path | None = None,
    limits: dict[str, Any] | None = None,
    min_training_cards: int = 5,
    min_training_rows: int = 80,
) -> dict[str, Any]:
    replay_limits = limits or daily_six_pick_limits()
    card_data = [
        data
        for path in _card_paths(archive_root, current_card)
        if (data := _candidate_card_for_ml(path, logs, replay_limits)) is not None
    ]
    target_picks = int(replay_limits.get("target_picks") or replay_limits.get("max_picks") or 6)
    prediction_cards, skipped_cards = _build_ml_prediction_cards(
        card_data,
        min_training_cards=min_training_cards,
        min_training_rows=min_training_rows,
    )
    return _ml_report_from_prediction_cards(
        prediction_cards,
        target_picks=target_picks,
        summary_extra={
            "cardsSkipped": skipped_cards,
            "minTrainingCards": min_training_cards,
            "minTrainingRows": min_training_rows,
            "predictionCardsBuilt": len(prediction_cards),
            "rankerModel": "random_forest_candidate_ranker",
        },
    )


def _ml_sweep_sort_key(profile_result: dict[str, Any]) -> tuple[float, float, float, float, float]:
    summary = profile_result["summary"]
    cards_evaluated = max(1, int(summary["cardsEvaluated"]))
    coverage_rate = float(summary["sixPickCoveredDates"]) / cards_evaluated
    settled_rate = float(summary["sixPickSettledDates"]) / cards_evaluated
    return (
        coverage_rate,
        float(summary["sixPickParlayAccuracyPct"] or 0.0),
        float(summary["sixPickSettledDates"]),
        float(summary["legAccuracyPct"] or 0.0),
        settled_rate,
    )


def sweep_archive_ml_ranker_limits(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    profiles: list[dict[str, Any]] | None = None,
    current_card: str | Path | None = None,
    limits: dict[str, Any] | None = None,
    min_training_cards: int = 5,
    min_training_rows: int = 80,
) -> dict[str, Any]:
    replay_limits = limits or daily_six_pick_limits()
    card_data = [
        data
        for path in _card_paths(archive_root, current_card)
        if (data := _candidate_card_for_ml(path, logs, replay_limits)) is not None
    ]
    target_picks = int(replay_limits.get("target_picks") or replay_limits.get("max_picks") or 6)
    prediction_cards, skipped_cards = _build_ml_prediction_cards(
        card_data,
        min_training_cards=min_training_cards,
        min_training_rows=min_training_rows,
    )
    profile_results: list[dict[str, Any]] = []
    for index, profile in enumerate(profiles or default_archive_ml_limit_profiles(max_picks=target_picks)):
        name = str(profile.get("name") or f"profile_{index + 1}")
        profile_limits = dict(profile.get("limits") or {})
        report = _ml_report_from_prediction_cards(
            prediction_cards,
            limits=profile_limits,
            target_picks=target_picks,
            summary_extra={
                "cardsSkipped": skipped_cards,
                "minTrainingCards": min_training_cards,
                "minTrainingRows": min_training_rows,
                "predictionCardsBuilt": len(prediction_cards),
                "rankerModel": "random_forest_candidate_ranker",
            },
        )
        profile_results.append(
            {
                "profileName": name,
                "limits": profile_limits,
                "summary": report["summary"],
            }
        )
    profile_results.sort(key=_ml_sweep_sort_key, reverse=True)
    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "profileCount": len(profile_results),
        "predictionCardsBuilt": len(prediction_cards),
        "cardsSkipped": skipped_cards,
        "profiles": profile_results,
    }


def walk_forward_archive_ml_limit_profiles(
    archive_root: str | Path,
    logs: pd.DataFrame,
    *,
    profiles: list[dict[str, Any]] | None = None,
    current_card: str | Path | None = None,
    limits: dict[str, Any] | None = None,
    min_training_cards: int = 5,
    min_training_rows: int = 80,
    min_profile_training_cards: int = 1,
) -> dict[str, Any]:
    replay_limits = limits or daily_six_pick_limits()
    card_data = [
        data
        for path in _card_paths(archive_root, current_card)
        if (data := _candidate_card_for_ml(path, logs, replay_limits)) is not None
    ]
    target_picks = int(replay_limits.get("target_picks") or replay_limits.get("max_picks") or 6)
    prediction_cards, skipped_cards = _build_ml_prediction_cards(
        card_data,
        min_training_cards=min_training_cards,
        min_training_rows=min_training_rows,
    )
    profile_grid = profiles or default_archive_ml_limit_profiles(max_picks=target_picks)
    daily_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    profile_skipped_cards = 0

    for index in range(len(prediction_cards)):
        if index < min_profile_training_cards:
            profile_skipped_cards += 1
            continue
        profile_results: list[dict[str, Any]] = []
        for profile_index, profile in enumerate(profile_grid):
            profile_limits = dict(profile.get("limits") or {})
            report = _ml_report_from_prediction_cards(
                prediction_cards[:index],
                limits=profile_limits,
                target_picks=target_picks,
                summary_extra={
                    "cardsSkipped": skipped_cards,
                    "minTrainingCards": min_training_cards,
                    "minTrainingRows": min_training_rows,
                    "predictionCardsBuilt": len(prediction_cards),
                    "rankerModel": "random_forest_candidate_ranker",
                },
            )
            profile_results.append(
                {
                    "profileIndex": profile_index,
                    "profileName": str(profile.get("name") or f"profile_{profile_index + 1}"),
                    "limits": profile_limits,
                    "summary": report["summary"],
                }
            )
        profile_results.sort(key=_ml_sweep_sort_key, reverse=True)
        if not profile_results:
            profile_skipped_cards += 1
            continue
        selected_profile = profile_results[0]
        selected_profile_name = str(selected_profile["profileName"])
        current_report = _ml_report_from_prediction_cards(
            [prediction_cards[index]],
            limits=dict(selected_profile.get("limits") or {}),
            target_picks=target_picks,
            summary_extra={
                "cardsSkipped": skipped_cards,
                "minTrainingCards": min_training_cards,
                "minTrainingRows": min_training_rows,
                "predictionCardsBuilt": len(prediction_cards),
                "rankerModel": "random_forest_candidate_ranker",
            },
        )
        for row in current_report["dailyRows"]:
            daily_rows.append(
                {
                    **row,
                    "selectedProfileName": selected_profile_name,
                    "profileTrainingCards": index,
                    "profileTrainingSummary": selected_profile["summary"],
                }
            )
        for row in current_report["selectedRows"]:
            selected_rows.append({**row, "selectedProfileName": selected_profile_name})

    return {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "claimBoundary": CLAIM_BOUNDARY,
        "summary": _archive_summary(
            daily_rows,
            selected_rows,
            target_picks,
            cards_key="cardsEvaluated",
            extra={
                "cardsSkipped": skipped_cards + profile_skipped_cards,
                "predictionCardsBuilt": len(prediction_cards),
                "minTrainingCards": min_training_cards,
                "minTrainingRows": min_training_rows,
                "minProfileTrainingCards": min_profile_training_cards,
                "rankerModel": "random_forest_candidate_ranker",
            },
        ),
        "dailyRows": daily_rows,
        "selectedRows": selected_rows,
    }


def write_replay_report(report: dict[str, Any], out: str | Path) -> Path:
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path
