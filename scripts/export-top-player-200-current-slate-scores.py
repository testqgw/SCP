from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
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
META_EXPANDED_LANE = {
    "label": "top200_meta_reliability_expanded",
    "accuracyPct": 83.11,
    "playerDays": 4215,
    "last30AccuracyPct": 84.44,
    "last14AccuracyPct": 81.97,
    "activeDates": 128,
    "avgPlayersPerSlate": 32.93,
    "metaThreshold": 0.825,
    "minWfConfidence": 0.75,
    "rule": "top200 meta reliability gate: one highest metaProbCorrect market per player, metaProbCorrect >= 0.825 and wfConfidence >= 0.750",
}
MARKET_SIGNAL_KEYS = {
    "PTS": "ptsSignal",
    "REB": "rebSignal",
    "AST": "astSignal",
    "THREES": "threesSignal",
    "PRA": "praSignal",
    "PA": "paSignal",
    "PR": "prSignal",
    "RA": "raSignal",
}


def record_pct(record: dict[str, Any] | None) -> float | None:
    if not isinstance(record, dict):
        return None
    try:
        wins = float(record.get("wins") or 0)
        losses = float(record.get("losses") or 0)
    except (TypeError, ValueError):
        return None
    total = wins + losses
    if total <= 0:
        return None
    return round(wins / total, 4)


def metric_value(record: dict[str, Any] | None, market: str) -> float | None:
    if not isinstance(record, dict):
        return None
    try:
        value = float(record.get(market))
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def net_pra_for_side(matchup: dict[str, Any], prefix: str) -> float | None:
    scored = metric_value(matchup.get(f"{prefix}Last10For"), "PRA")
    allowed = metric_value(matchup.get(f"{prefix}Last10Allowed"), "PRA")
    if scored is None or allowed is None:
        return None
    return round(scored - allowed, 4)


def infer_stake_level(date_et: str) -> str:
    try:
        month = int(date_et.split("-")[1])
        day = int(date_et.split("-")[2])
    except (IndexError, ValueError):
        return "UNKNOWN"
    if (month == 4 and day >= 15) or month in {5, 6}:
        return "PLAYOFF_HIGH_LEVERAGE"
    if month == 4 and day >= 1:
        return "REGULAR_SEASON_LATE"
    return "REGULAR_SEASON"


def matchup_context(board: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    matchup_key = row.get("matchupKey")
    matchups = {
        item.get("matchupKey"): item
        for item in board.get("teamMatchups", [])
        if isinstance(item, dict) and item.get("matchupKey")
    }
    matchup = matchups.get(matchup_key) or {}
    team = row.get("teamCode")
    away = matchup.get("awayTeam")
    home = matchup.get("homeTeam")
    prefix = "away" if team == away else "home" if team == home else None
    opp_prefix = "home" if prefix == "away" else "away" if prefix == "home" else None
    if prefix is None or opp_prefix is None:
        return {
            "stakeLevel": infer_stake_level(str(board.get("dateEt") or "")),
            "teamRecentWinPct": None,
            "opponentRecentWinPct": None,
            "teamSeasonWinPct": None,
            "opponentSeasonWinPct": None,
            "teamRecentNetPRA": None,
            "opponentRecentNetPRA": None,
        }
    return {
        "stakeLevel": infer_stake_level(str(board.get("dateEt") or "")),
        "teamRecentWinPct": record_pct(matchup.get(f"{prefix}Last10Record")),
        "opponentRecentWinPct": record_pct(matchup.get(f"{opp_prefix}Last10Record")),
        "teamSeasonWinPct": record_pct(matchup.get(f"{prefix}SeasonRecord")),
        "opponentSeasonWinPct": record_pct(matchup.get(f"{opp_prefix}SeasonRecord")),
        "teamRecentNetPRA": net_pra_for_side(matchup, prefix),
        "opponentRecentNetPRA": net_pra_for_side(matchup, opp_prefix),
    }


def synergy_context(context: dict[str, Any], market: str) -> dict[str, Any]:
    synergies = context.get("teammateSynergies")
    if not isinstance(synergies, list):
        return {"activeSynergyCount": 0, "marketSynergyBoost": 0.0, "marketSynergyDrag": 0.0}
    active = [
        item
        for item in synergies
        if isinstance(item, dict)
        and item.get("targetMarket") == market
        and item.get("activeToday") is True
    ]
    boost = 0.0
    drag = 0.0
    for item in active:
        try:
            delta = abs(float(item.get("delta") or 0))
        except (TypeError, ValueError):
            delta = 0.0
        if item.get("direction") == "BOOST":
            boost += delta
        elif item.get("direction") == "DRAG":
            drag += delta
    return {
        "activeSynergyCount": len(active),
        "marketSynergyBoost": round(boost, 4),
        "marketSynergyDrag": round(drag, 4),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score the current slate with the 200+ sample HGB prop model.")
    parser.add_argument("--historical-input", default="exports/projection-backtest-allplayers-with-rows-live.json")
    parser.add_argument("--board-url", default="https://ultops.com/api/snapshot/board?refresh=1")
    parser.add_argument("--board-json", default=None, help="Optional local API response JSON instead of --board-url.")
    parser.add_argument("--out", default="exports/top-player-200-sample-current-slate-scores.json")
    return parser.parse_args()


def load_walk_forward_gate(root: Path) -> Any:
    path = root / "scripts/export-live-quality-honest-walkforward-confidence-gate.py"
    spec = importlib.util.spec_from_file_location("live_quality_wf_gate", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["live_quality_wf_gate"] = module
    spec.loader.exec_module(module)
    return module


def load_board(args: argparse.Namespace) -> dict[str, Any]:
    if args.board_json:
        payload = json.loads(Path(args.board_json).read_text(encoding="utf-8"))
    else:
        with urllib.request.urlopen(args.board_url, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    if payload.get("ok") is True and isinstance(payload.get("result"), dict):
        return payload["result"]
    if "rows" in payload:
        return payload
    raise RuntimeError("Board payload did not look like SnapshotBoardViewData.")


def is_removed(row: dict[str, Any]) -> bool:
    context = row.get("playerContext") or {}
    status = context.get("availabilityStatus")
    percent = context.get("availabilityPercentPlay")
    if status in {"OUT", "DOUBTFUL"}:
        return True
    return (100 if percent is None else percent) <= 0


def current_rows_from_board(board: dict[str, Any]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for row in board.get("rows", []):
        context = row.get("playerContext") or {}
        game_context = matchup_context(board, row)
        runtime_by_market = row.get("marketRuntime") or {}
        projected = row.get("projectedTonight") or {}
        model_lines = row.get("modelLines") or {}
        removed = is_removed(row)

        for market in MARKETS:
            signal = row.get(MARKET_SIGNAL_KEYS[market])
            runtime = runtime_by_market.get(market) or {}
            if not signal:
                continue

            live_line = signal.get("marketLine")
            books = signal.get("sportsbookCount")
            projection = projected.get(market)
            if live_line is None or projection is None or books is None or books < 3:
                continue

            final_side = runtime.get("finalSide") or signal.get("side") or "NEUTRAL"
            if final_side not in {"OVER", "UNDER"}:
                continue

            source = runtime.get("source") or "baseline"
            baseline_side = runtime.get("baselineSide") or (model_lines.get(market) or {}).get("modelSide") or "NEUTRAL"
            line_gap = float(projection) - float(live_line)
            market_synergy = synergy_context(context, market)
            rows.append(
                {
                    "rowKey": f"current:{row.get('playerId')}:{market}",
                    "gameDateEt": board["dateEt"],
                    "playerId": row.get("playerId"),
                    "playerName": row.get("playerName"),
                    "teamCode": row.get("teamCode"),
                    "opponentCode": row.get("opponentCode"),
                    "matchupKey": row.get("matchupKey"),
                    "gameTimeEt": row.get("gameTimeEt"),
                    "market": market,
                    "baselineSide": baseline_side,
                    "rawSide": signal.get("side") or final_side,
                    "strictRawSide": final_side,
                    "finalSide": final_side,
                    "rawSource": source,
                    "strictRawSource": source,
                    "finalSource": source,
                    "playerOverrideSide": final_side if source == "player_override" else "NA",
                    "projectedValue": projection,
                    "line": live_line,
                    "overPrice": np.nan,
                    "underPrice": np.nan,
                    "projectedMinutes": context.get("projectedMinutes"),
                    "minutesVolatility": context.get("minutesVolatility"),
                    "starterRateLast10": context.get("starterRateLast10"),
                    "lineupStatus": context.get("lineupStatus"),
                    "lineupStarter": context.get("lineupStarter"),
                    "availabilityStatus": context.get("availabilityStatus"),
                    "availabilityPercentPlay": context.get("availabilityPercentPlay"),
                    "rotationRank": context.get("rotationRank"),
                    "minutesTrend": context.get("minutesTrend"),
                    "projectedMinutesFloor": context.get("projectedMinutesFloor"),
                    "projectedMinutesCeiling": context.get("projectedMinutesCeiling"),
                    "dataCompletenessScore": (row.get("dataCompleteness") or {}).get("score"),
                    **game_context,
                    **market_synergy,
                    "lineGap": line_gap,
                    "absLineGap": abs(line_gap),
                    "actualSide": "NA",
                    "finalCorrectBool": np.nan,
                    "y": 0,
                    "sportsbookCount": books,
                    "removed": removed,
                }
            )
    return pd.DataFrame(rows)


def clean_float(value: Any, digits: int = 6) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return round(number, digits)


def attach_prior_reliability_for_live_score(gate: Any, df: pd.DataFrame, dates: list[str], num_cols: list[str]) -> list[str]:
    """Attach walk-forward prior features while ignoring unresolved current-slate outcomes."""

    for prefix, cols in gate.PRIOR_SPECS.items():
        n_col = f"{prefix}_n"
        acc_col = f"{prefix}_acc"
        df[n_col] = 0.0
        df[acc_col] = np.nan
        stats: dict[tuple[str, ...], list[int]] = defaultdict(lambda: [0, 0])

        for game_date in dates:
            idx = df.index[df["gameDateEt"].eq(game_date)]
            keys = list(map(tuple, df.loc[idx, cols].astype(str).values.tolist()))
            ns = []
            accs = []
            for key in keys:
                n, wins = stats[key]
                ns.append(float(n))
                accs.append((wins / n) if n else np.nan)
            df.loc[idx, n_col] = ns
            df.loc[idx, acc_col] = accs

            for key, correct in zip(keys, df.loc[idx, "finalCorrectBool"].tolist()):
                if pd.isna(correct):
                    continue
                stats[key][0] += 1
                stats[key][1] += int(correct)

        num_cols.extend([n_col, acc_col])

    return num_cols


def build_top_player_ids(df: pd.DataFrame, min_samples: int = 200, top_count: int = 200) -> set[str]:
    players: list[tuple[str, int, int, float, int]] = []
    for player_id, group in df.groupby("playerId"):
        sample_count = int(len(group))
        if sample_count < min_samples:
            continue
        minutes = pd.to_numeric(group["projectedMinutes"], errors="coerce")
        players.append(
            (
                str(player_id),
                sample_count,
                int(group["market"].nunique()),
                float(minutes.fillna(0).mean()),
                int(group["gameDateEt"].nunique()),
            )
        )
    players.sort(key=lambda row: (row[1], row[2], row[3], row[4]), reverse=True)
    return {player_id for player_id, *_ in players[:top_count]}


def attach_meta_features(df: pd.DataFrame) -> None:
    line_gap = pd.to_numeric(df["lineGap"], errors="coerce")
    df["projectionSide"] = np.where(line_gap > 0, "OVER", np.where(line_gap < 0, "UNDER", "NEUTRAL"))
    df["sideAgreesProjection"] = df["wfSide"].astype(str).eq(df["projectionSide"].astype(str)).astype(int)


def add_meta_reliability_scores(
    gate: Any,
    historical: pd.DataFrame,
    current: pd.DataFrame,
    cat_cols: list[str],
    num_cols: list[str],
) -> pd.DataFrame:
    meta_historical = historical.copy()
    historical_dates = sorted(meta_historical["gameDateEt"].unique().tolist())
    gate.score_walk_forward(meta_historical, historical_dates, gate.build_folds(historical_dates, 7, 7), cat_cols, num_cols)
    meta_historical = meta_historical[meta_historical["eligibleWalkForward"]].copy()
    top_player_ids = build_top_player_ids(meta_historical)
    meta_historical = meta_historical[meta_historical["playerId"].isin(top_player_ids)].copy()
    meta_historical["targetCorrect"] = meta_historical["finalCorrectBool"].astype(int)
    attach_meta_features(meta_historical)

    current = current.copy()
    attach_meta_features(current)

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
        *[col for col in meta_historical.columns if col.endswith("_n") or col.endswith("_acc")],
    ]

    for col in meta_cat_cols:
        if col not in current.columns:
            current[col] = "NA"
        meta_historical[col] = meta_historical[col].fillna("NA").astype(str)
        current[col] = current[col].fillna("NA").astype(str)
    for col in meta_num_cols:
        if col not in meta_historical.columns:
            meta_historical[col] = np.nan
        if col not in current.columns:
            current[col] = np.nan
        meta_historical[col] = pd.to_numeric(meta_historical[col], errors="coerce")
        current[col] = pd.to_numeric(current[col], errors="coerce")

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
    pipeline.fit(meta_historical[feature_cols], meta_historical["targetCorrect"])
    current["metaProbCorrect"] = pipeline.predict_proba(current[feature_cols])[:, 1]
    return current


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    gate = load_walk_forward_gate(root)

    historical, cat_cols, num_cols = gate.prepare_frame(root / args.historical_input)
    historical = historical[historical["market"].isin(MARKETS)].copy()
    historical_last_date = max(historical["gameDateEt"].unique().tolist())

    board = load_board(args)
    current = current_rows_from_board(board)
    if current.empty:
        generated_at_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        output = {
            "generatedAt": generated_at_utc,
            "generatedAtUtc": generated_at_utc,
            "dateEt": board.get("dateEt"),
            "firstGameTimeEt": None,
            "scheduledGameTimesEt": [],
            "source": args.board_json or args.board_url,
            "metaExpandedLane": META_EXPANDED_LANE,
            "warnings": ["No current rows could be scored from the board payload."],
            "rows": [],
        }
        Path(args.out).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"out": args.out, "dateEt": board.get("dateEt"), "rows": 0, "warnings": output["warnings"]}, indent=2))
        return

    for col in cat_cols:
        if col not in current.columns:
            current[col] = "NA"
        current[col] = current[col].fillna("NA").astype(str)
    for col in num_cols:
        if col not in current.columns:
            current[col] = np.nan
        current[col] = pd.to_numeric(current[col], errors="coerce")

    combined = pd.concat([historical, current], ignore_index=True, sort=False)
    dates = sorted(combined["gameDateEt"].unique().tolist())
    num_cols = attach_prior_reliability_for_live_score(gate, combined, dates, num_cols)

    train = combined[combined["gameDateEt"].le(historical_last_date)].copy()
    score = combined[combined["gameDateEt"].eq(board["dateEt"])].copy()

    preprocessor = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cat_cols),
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler()),
                    ]
                ),
                num_cols,
            ),
        ]
    )
    classifier = HistGradientBoostingClassifier(
        max_iter=120,
        learning_rate=0.045,
        max_leaf_nodes=31,
        l2_regularization=0.03,
        random_state=7,
    )
    pipeline = Pipeline([("pre", preprocessor), ("clf", classifier)])
    feature_cols = cat_cols + num_cols
    pipeline.fit(train[feature_cols], train["y"])

    proba = pipeline.predict_proba(score[feature_cols])[:, 1]
    score["wfProbOver"] = proba
    score["wfConfidence"] = np.maximum(proba, 1 - proba)
    score["wfSide"] = np.where(proba >= 0.5, "OVER", "UNDER")
    score = add_meta_reliability_scores(gate, train, score, cat_cols, num_cols)
    score = score[~score["removed"].eq(True)].copy()

    rows = []
    for row in score.itertuples():
        rows.append(
            {
                "dateEt": board["dateEt"],
                "playerId": row.playerId,
                "playerName": row.playerName,
                "teamCode": getattr(row, "teamCode", None),
                "opponentCode": getattr(row, "opponentCode", None),
                "matchupKey": getattr(row, "matchupKey", None),
                "gameTimeEt": getattr(row, "gameTimeEt", None),
                "market": row.market,
                "wfProbOver": clean_float(row.wfProbOver),
                "wfConfidence": clean_float(row.wfConfidence),
                "wfSide": row.wfSide,
                "metaProbCorrect": clean_float(row.metaProbCorrect),
                "runtimeFinalSide": row.finalSide,
                "runtimeFinalSource": row.finalSource,
                "projectionSide": row.projectionSide,
                "line": clean_float(row.line, 2),
                "projectedValue": clean_float(row.projectedValue, 2),
                "lineGap": clean_float(row.lineGap, 2),
                "absLineGap": clean_float(row.absLineGap, 2),
                "projectedMinutes": clean_float(row.projectedMinutes, 2),
                "minutesVolatility": clean_float(getattr(row, "minutesVolatility", None), 2),
                "starterRateLast10": clean_float(getattr(row, "starterRateLast10", None), 4),
                "lineupStatus": getattr(row, "lineupStatus", None),
                "lineupStarter": getattr(row, "lineupStarter", None),
                "availabilityStatus": getattr(row, "availabilityStatus", None),
                "availabilityPercentPlay": clean_float(getattr(row, "availabilityPercentPlay", None), 2),
                "rotationRank": clean_float(getattr(row, "rotationRank", None), 0),
                "minutesTrend": clean_float(getattr(row, "minutesTrend", None), 2),
                "projectedMinutesFloor": clean_float(getattr(row, "projectedMinutesFloor", None), 2),
                "projectedMinutesCeiling": clean_float(getattr(row, "projectedMinutesCeiling", None), 2),
                "dataCompletenessScore": clean_float(getattr(row, "dataCompletenessScore", None), 2),
                "stakeLevel": getattr(row, "stakeLevel", None),
                "teamRecentWinPct": clean_float(getattr(row, "teamRecentWinPct", None), 4),
                "opponentRecentWinPct": clean_float(getattr(row, "opponentRecentWinPct", None), 4),
                "teamSeasonWinPct": clean_float(getattr(row, "teamSeasonWinPct", None), 4),
                "opponentSeasonWinPct": clean_float(getattr(row, "opponentSeasonWinPct", None), 4),
                "teamRecentNetPRA": clean_float(getattr(row, "teamRecentNetPRA", None), 4),
                "opponentRecentNetPRA": clean_float(getattr(row, "opponentRecentNetPRA", None), 4),
                "marketSynergyBoost": clean_float(getattr(row, "marketSynergyBoost", None), 4),
                "marketSynergyDrag": clean_float(getattr(row, "marketSynergyDrag", None), 4),
                "activeSynergyCount": clean_float(getattr(row, "activeSynergyCount", None), 0),
                "priorMarketSourceSideAcc": clean_float(row.prior_market_source_side_acc),
                "priorMarketFinalSideAcc": clean_float(row.prior_market_final_side_acc),
                "sportsbookCount": None if pd.isna(row.sportsbookCount) else int(row.sportsbookCount),
            }
        )

    game_times = sorted(
        {
            str(item)
            for item in score.get("gameTimeEt", pd.Series(dtype=str)).dropna().tolist()
            if str(item).strip()
        }
    )
    generated_at_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    output = {
        "generatedAt": generated_at_utc,
        "generatedAtUtc": generated_at_utc,
        "dateEt": board["dateEt"],
        "firstGameTimeEt": game_times[0] if game_times else None,
        "scheduledGameTimesEt": game_times,
        "source": args.board_json or args.board_url,
        "metaExpandedLane": META_EXPANDED_LANE,
        "rows": rows,
    }
    Path(args.out).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": args.out, "dateEt": board["dateEt"], "rows": len(rows)}, indent=2))


if __name__ == "__main__":
    main()
