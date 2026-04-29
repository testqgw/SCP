from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import date
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score the current slate with the 200+ sample HGB prop model.")
    parser.add_argument("--historical-input", default="exports/ultimate-live-quality-current-details.json")
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
            rows.append(
                {
                    "rowKey": f"current:{row.get('playerId')}:{market}",
                    "gameDateEt": board["dateEt"],
                    "playerId": row.get("playerId"),
                    "playerName": row.get("playerName"),
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
                    "starterRateLast10": np.nan,
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
        raise RuntimeError("No current rows could be scored from the board payload.")

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
    score = score[~score["removed"].eq(True)].copy()

    rows = []
    for row in score.itertuples():
        rows.append(
            {
                "dateEt": board["dateEt"],
                "playerId": row.playerId,
                "playerName": row.playerName,
                "market": row.market,
                "wfProbOver": clean_float(row.wfProbOver),
                "wfConfidence": clean_float(row.wfConfidence),
                "wfSide": row.wfSide,
                "runtimeFinalSide": row.finalSide,
                "line": clean_float(row.line, 2),
                "projectedValue": clean_float(row.projectedValue, 2),
                "absLineGap": clean_float(row.absLineGap, 2),
                "sportsbookCount": None if pd.isna(row.sportsbookCount) else int(row.sportsbookCount),
            }
        )

    output = {
        "generatedAt": date.today().isoformat(),
        "dateEt": board["dateEt"],
        "source": args.board_json or args.board_url,
        "rows": rows,
    }
    Path(args.out).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": args.out, "dateEt": board["dateEt"], "rows": len(rows)}, indent=2))


if __name__ == "__main__":
    main()
