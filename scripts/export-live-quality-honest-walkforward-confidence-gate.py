import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


CAT_COLS = [
    "market",
    "baselineSide",
    "rawSide",
    "strictRawSide",
    "finalSide",
    "rawSource",
    "strictRawSource",
    "finalSource",
    "playerOverrideSide",
]

BASE_NUM_COLS = [
    "projectedValue",
    "line",
    "overPrice",
    "underPrice",
    "projectedMinutes",
    "minutesVolatility",
    "starterRateLast10",
    "lineGap",
    "absLineGap",
]

PRIOR_SPECS = {
    "prior_market_source_side": ["market", "finalSource", "finalSide"],
    "prior_market_final_side": ["market", "finalSide"],
    "prior_market_baseline_side": ["market", "baselineSide"],
    "prior_market_raw_source_side": ["market", "rawSource", "rawSide"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export an honest walk-forward confidence-gated full-model report."
    )
    parser.add_argument(
        "--input",
        default="exports/ultimate-live-quality-current-details.json",
        help="Row-level live-quality details JSON.",
    )
    parser.add_argument(
        "--out-prefix",
        default="exports/live-quality-full-model-honest-walkforward-confidence-gate-70-results",
        help="Output prefix for .md/.json/-rows.csv/-daily.csv/-by-market.csv.",
    )
    parser.add_argument("--min-train-dates", type=int, default=56)
    parser.add_argument("--test-dates", type=int, default=14)
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.7,
        help="Confidence gate. Use 0.7 for the frozen research candidate.",
    )
    return parser.parse_args()


def summarize(df: pd.DataFrame, mask: pd.Series, correct_col: str = "selectedCorrect") -> dict:
    sub = df.loc[mask]
    samples = int(len(sub))
    wins = int(sub[correct_col].sum()) if samples else 0
    losses = samples - wins
    return {
        "samples": samples,
        "wins": wins,
        "losses": losses,
        "accuracyPct": round(100 * wins / samples, 2) if samples else 0,
    }


def fmt_bucket(bucket: dict) -> str:
    return (
        f"{bucket['accuracyPct']:.2f}% "
        f"({bucket['wins']:,}-{bucket['losses']:,}, {bucket['samples']:,} rows)"
    )


def prepare_frame(input_path: Path) -> tuple[pd.DataFrame, list[str], list[str]]:
    rows = json.loads(input_path.read_text(encoding="utf-8"))
    df = pd.DataFrame(rows)
    if "rowKey" not in df.columns:
        df["rowKey"] = np.arange(len(df)).astype(str)

    for col in CAT_COLS:
        if col not in df.columns:
            df[col] = "NA"
        df[col] = df[col].fillna("NA").astype(str)

    num_cols = list(BASE_NUM_COLS)
    for col in num_cols:
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["actualSide"] = df["actualSide"].astype(str)
    df["finalCorrectBool"] = df["finalSide"].astype(str).eq(df["actualSide"]).astype(int)
    df["y"] = (df["actualSide"] == "OVER").astype(int)
    return df, list(CAT_COLS), num_cols


def attach_prior_reliability(df: pd.DataFrame, dates: list[str], num_cols: list[str]) -> list[str]:
    for prefix, cols in PRIOR_SPECS.items():
        n_col = f"{prefix}_n"
        acc_col = f"{prefix}_acc"
        df[n_col] = 0.0
        df[acc_col] = np.nan
        stats: dict[tuple[str, ...], list[int]] = defaultdict(lambda: [0, 0])

        for date in dates:
            idx = df.index[df["gameDateEt"].eq(date)]
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
                stats[key][0] += 1
                stats[key][1] += int(correct)

        num_cols.extend([n_col, acc_col])

    return num_cols


def build_folds(dates: list[str], min_train_dates: int, test_dates: int) -> list[list[str]]:
    folds = []
    for start in range(min_train_dates, len(dates), test_dates):
        fold_dates = dates[start : start + test_dates]
        if fold_dates:
            folds.append(fold_dates)
    return folds


def score_walk_forward(
    df: pd.DataFrame,
    dates: list[str],
    folds: list[list[str]],
    cat_cols: list[str],
    num_cols: list[str],
) -> list[dict]:
    df["eligibleWalkForward"] = False
    df["wfFold"] = np.nan
    df["wfProbOver"] = np.nan
    df["wfConfidence"] = np.nan
    df["wfSide"] = ""
    df["selectedCorrect"] = False

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
    fold_summaries = []

    for fold_index, fold_dates in enumerate(folds, 1):
        train_mask = df["gameDateEt"].lt(fold_dates[0])
        test_mask = df["gameDateEt"].isin(fold_dates)
        pipeline.fit(df.loc[train_mask, feature_cols], df.loc[train_mask, "y"])
        proba = pipeline.predict_proba(df.loc[test_mask, feature_cols])[:, 1]

        idx = df.index[test_mask]
        side = np.where(proba >= 0.5, "OVER", "UNDER")
        confidence = np.maximum(proba, 1 - proba)
        correct = side == df.loc[idx, "actualSide"].values

        df.loc[idx, "eligibleWalkForward"] = True
        df.loc[idx, "wfFold"] = fold_index
        df.loc[idx, "wfProbOver"] = proba
        df.loc[idx, "wfConfidence"] = confidence
        df.loc[idx, "wfSide"] = side
        df.loc[idx, "selectedCorrect"] = correct

        fold_summaries.append(
            {
                "fold": fold_index,
                "trainFrom": dates[0],
                "trainTo": dates[dates.index(fold_dates[0]) - 1],
                "testFrom": fold_dates[0],
                "testTo": fold_dates[-1],
                "trainSamples": int(train_mask.sum()),
                "testSamples": int(test_mask.sum()),
                "ungatedAccuracyPct": round(float(correct.mean() * 100), 2),
            }
        )

    return fold_summaries


def build_window_mask(df: pd.DataFrame, base: pd.Series, window: str, last30: set[str], last14: set[str]) -> pd.Series:
    if window == "overall":
        return base
    if window == "last30":
        return base & df["gameDateEt"].isin(last30)
    if window == "last14":
        return base & df["gameDateEt"].isin(last14)
    raise ValueError(window)


def threshold_search(
    df: pd.DataFrame,
    eligible: pd.Series,
    last30: set[str],
    last14: set[str],
) -> list[dict]:
    rows = []
    for threshold in np.round(np.arange(0.5, 0.901, 0.005), 3):
        selected = eligible & (df["wfConfidence"] >= threshold)
        entry = {"threshold": float(threshold), "selectedSamples": int(selected.sum())}
        ok = True
        min_accuracy = 999.0
        for window in ["overall", "last30", "last14"]:
            mask = build_window_mask(df, selected, window, last30, last14)
            bucket = summarize(df, mask)
            entry[window] = bucket
            if bucket["samples"] == 0 or bucket["accuracyPct"] < 70:
                ok = False
            if bucket["samples"]:
                min_accuracy = min(min_accuracy, bucket["accuracyPct"])
        entry["passes70AllWindows"] = ok
        entry["minWindowAccuracyPct"] = round(min_accuracy if min_accuracy != 999.0 else 0, 2)
        rows.append(entry)
    return rows


def build_outputs(
    df: pd.DataFrame,
    args: argparse.Namespace,
    dates: list[str],
    folds: list[list[str]],
    fold_summaries: list[dict],
    cat_cols: list[str],
    num_cols: list[str],
) -> dict:
    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    last30 = set(dates[-30:])
    last14 = set(dates[-14:])
    all_true = pd.Series(True, index=df.index)
    eligible = df["eligibleWalkForward"]
    selected = eligible & (df["wfConfidence"] >= args.threshold)

    df["currentFinalCorrect"] = df["finalSide"].astype(str).eq(df["actualSide"].astype(str))
    df["wfUngatedCorrect"] = df["wfSide"].astype(str).eq(df["actualSide"].astype(str)) & eligible

    baseline = {}
    for window in ["overall", "last30", "last14"]:
        all_mask = build_window_mask(df, all_true, window, last30, last14)
        current_samples = int(all_mask.sum())
        current_wins = int(df.loc[all_mask, "currentFinalCorrect"].sum())
        eligible_mask = build_window_mask(df, eligible, window, last30, last14)
        wf_samples = int(eligible_mask.sum())
        wf_wins = int(df.loc[eligible_mask, "wfUngatedCorrect"].sum())
        baseline[window] = {
            "currentFullBoard": {
                "samples": current_samples,
                "wins": current_wins,
                "losses": current_samples - current_wins,
                "accuracyPct": round(100 * current_wins / current_samples, 2),
            },
            "walkForwardUngated": {
                "samples": wf_samples,
                "wins": wf_wins,
                "losses": wf_samples - wf_wins,
                "accuracyPct": round(100 * wf_wins / wf_samples, 2) if wf_samples else 0,
            },
        }

    threshold_rows = threshold_search(df, eligible, last30, last14)
    passing = [row for row in threshold_rows if row["passes70AllWindows"]]
    coverage_max_threshold = (
        max(passing, key=lambda row: (row["selectedSamples"], row["minWindowAccuracyPct"]))["threshold"]
        if passing
        else None
    )

    summary = {
        "label": "hgb_walkforward_confidence_gate_70",
        "input": str(args.input),
        "generatedAt": "2026-04-24",
        "chosenThreshold": args.threshold,
        "coverageMaxPassingThreshold": coverage_max_threshold,
        "protocol": {
            "seasonDateRange": {"from": dates[0], "to": dates[-1], "activeDates": len(dates)},
            "minTrainDates": args.min_train_dates,
            "testFoldDates": args.test_dates,
            "folds": len(folds),
            "firstPredictionDate": folds[0][0] if folds else None,
            "target": "actualSide",
            "sideChosenBy": "walk-forward HistGradientBoosting probability; OVER if P(OVER) >= 0.5 else UNDER",
            "selectionRule": f"wfConfidence >= {args.threshold:.3f}",
            "honestyConstraint": (
                "Each fold is trained only on rows from earlier gameDateEt values. "
                "Rolling reliability features are computed only from completed dates before the tested date. "
                "Actual/outcome/correct columns are excluded from model inputs."
            ),
            "caveat": (
                "The threshold was discovered in replay research and should be frozen before any future forward proof. "
                "Accuracy is coverage-limited; it is not the full-board all-row accuracy."
            ),
        },
        "features": {"categorical": cat_cols, "numeric": num_cols},
        "selected": {},
        "baseline": baseline,
        "thresholdSearchTopByCoverage": sorted(
            passing, key=lambda row: row["selectedSamples"], reverse=True
        )[:12],
        "folds": fold_summaries,
    }

    for window in ["overall", "last30", "last14"]:
        mask = build_window_mask(df, selected, window, last30, last14)
        bucket = summarize(df, mask)
        denominator = int(build_window_mask(df, all_true, window, last30, last14).sum())
        eligible_denominator = int(build_window_mask(df, eligible, window, last30, last14).sum())
        bucket["coveragePctVsAllRows"] = round(100 * bucket["samples"] / denominator, 2) if denominator else 0
        bucket["coveragePctVsEligibleWalkForwardRows"] = (
            round(100 * bucket["samples"] / eligible_denominator, 2) if eligible_denominator else 0
        )
        bucket["neededWinsFor70Pct"] = max(0, math.ceil(0.70 * bucket["samples"]) - bucket["wins"])
        summary["selected"][window] = bucket

    daily_rows = []
    for date in dates:
        day_all = df["gameDateEt"].eq(date)
        day_selected = selected & day_all
        samples = int(day_selected.sum())
        wins = int(df.loc[day_selected, "selectedCorrect"].sum()) if samples else 0
        all_samples = int(day_all.sum())
        daily_rows.append(
            {
                "date": date,
                "selectedSamples": samples,
                "wins": wins,
                "losses": samples - wins,
                "accuracyPct": round(100 * wins / samples, 2) if samples else None,
                "allRows": all_samples,
                "coveragePct": round(100 * samples / all_samples, 2) if all_samples else 0,
            }
        )

    by_market = []
    for market in sorted(df["market"].dropna().astype(str).unique()):
        market_mask = df["market"].eq(market)
        selected_market = selected & market_mask
        samples = int(selected_market.sum())
        wins = int(df.loc[selected_market, "selectedCorrect"].sum()) if samples else 0
        all_samples = int(market_mask.sum())
        by_market.append(
            {
                "market": market,
                "selectedSamples": samples,
                "wins": wins,
                "losses": samples - wins,
                "accuracyPct": round(100 * wins / samples, 2) if samples else None,
                "allRows": all_samples,
                "coveragePct": round(100 * samples / all_samples, 2) if all_samples else 0,
            }
        )

    row_cols = [
        "rowKey",
        "gameDateEt",
        "playerName",
        "market",
        "line",
        "projectedValue",
        "actualValue",
        "actualSide",
        "baselineSide",
        "rawSide",
        "strictRawSide",
        "finalSide",
        "finalSource",
        "rawSource",
        "playerOverrideSide",
        "wfSide",
        "wfProbOver",
        "wfConfidence",
        "selectedCorrect",
        "wfFold",
        "prior_market_source_side_n",
        "prior_market_source_side_acc",
    ]
    rows_out = df.loc[selected, [col for col in row_cols if col in df.columns]].copy()
    rows_out["wfProbOver"] = rows_out["wfProbOver"].round(6)
    rows_out["wfConfidence"] = rows_out["wfConfidence"].round(6)
    if "prior_market_source_side_acc" in rows_out.columns:
        rows_out["prior_market_source_side_acc"] = rows_out["prior_market_source_side_acc"].round(6)

    rows_out.to_csv(f"{out_prefix}-rows.csv", index=False)
    pd.DataFrame(daily_rows).to_csv(f"{out_prefix}-daily.csv", index=False)
    pd.DataFrame(by_market).to_csv(f"{out_prefix}-by-market.csv", index=False)
    Path(f"{out_prefix}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_markdown(out_prefix, summary, by_market)
    return summary


def write_markdown(out_prefix: Path, summary: dict, by_market: list[dict]) -> None:
    lines = [
        "# Full Model Honest Walk-Forward Confidence Gate Results",
        "",
        "Generated: 2026-04-24",
        f"Input: `{summary['input']}`",
        "",
        "## Bottom Line",
        "",
        (
            "The full-board all-row model is still below 70%, but a strict walk-forward "
            "confidence-gated lane clears 70% overall, last 30 active dates, and last 14 active dates."
        ),
        "",
        "| Window | Selected accuracy | Coverage vs all rows | Needed wins for 70% |",
        "|---|---:|---:|---:|",
    ]

    for window, label in [
        ("overall", "Overall"),
        ("last30", "Last 30 active dates"),
        ("last14", "Last 14 active dates"),
    ]:
        bucket = summary["selected"][window]
        lines.append(
            f"| {label} | {fmt_bucket(bucket)} | "
            f"{bucket['coveragePctVsAllRows']:.2f}% | {bucket['neededWinsFor70Pct']} |"
        )

    lines.extend(
        [
            "",
            "## Rule",
            "",
            (
                f"- Warmup: first {summary['protocol']['minTrainDates']} active dates are training-only; "
                f"first prediction date is {summary['protocol']['firstPredictionDate']}."
            ),
            (
                f"- Fold schedule: expanding walk-forward training, "
                f"{summary['protocol']['testFoldDates']}-active-date test folds."
            ),
            "- Model: HistGradientBoosting side predictor trained only on earlier dates.",
            "- Pick side: `OVER` when `P(OVER) >= 0.5`, otherwise `UNDER`.",
            f"- Selection gate: keep only rows with `wfConfidence >= {summary['chosenThreshold']:.3f}`.",
            "- Rolling reliability features use only completed dates before the tested date.",
        ]
    )
    if summary.get("coverageMaxPassingThreshold") is not None:
        lines.append(
            "- The widest replay threshold that still passed all three 70% checks was "
            f"`{summary['coverageMaxPassingThreshold']:.3f}`; this report uses the cleaner "
            f"`{summary['chosenThreshold']:.3f}` gate for more recent-window margin."
        )

    lines.extend(
        [
            "",
            "## Contrast",
            "",
            "| Window | Current full-board final side | Walk-forward model ungated | Confidence-gated lane |",
            "|---|---:|---:|---:|",
        ]
    )
    for window, label in [
        ("overall", "Overall"),
        ("last30", "Last 30 active dates"),
        ("last14", "Last 14 active dates"),
    ]:
        lines.append(
            f"| {label} | {fmt_bucket(summary['baseline'][window]['currentFullBoard'])} | "
            f"{fmt_bucket(summary['baseline'][window]['walkForwardUngated'])} | "
            f"{fmt_bucket(summary['selected'][window])} |"
        )

    lines.extend(
        [
            "",
            "## Important Caveat",
            "",
            (
                "This is honest as a replay protocol because each fold only trains on earlier dates, "
                "but it is still a coverage-limited lane. The threshold was found during replay research, "
                "so the exact rule should be frozen and forward-tested before treating it as proven live edge."
            ),
            "",
            "## Files",
            "",
            f"- `{out_prefix.name}.json`",
            f"- `{out_prefix.name}-rows.csv`",
            f"- `{out_prefix.name}-daily.csv`",
            f"- `{out_prefix.name}-by-market.csv`",
            "",
            "## By Market",
            "",
            "| Market | Accuracy | Coverage |",
            "|---|---:|---:|",
        ]
    )
    for bucket in by_market:
        accuracy = (
            "-"
            if pd.isna(bucket["accuracyPct"])
            else (
                f"{bucket['accuracyPct']:.2f}% "
                f"({bucket['wins']:,}-{bucket['losses']:,}, {bucket['selectedSamples']:,})"
            )
        )
        lines.append(f"| {bucket['market']} | {accuracy} | {bucket['coveragePct']:.2f}% |")

    Path(f"{out_prefix}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    df, cat_cols, num_cols = prepare_frame(input_path)
    dates = sorted(df["gameDateEt"].astype(str).unique())
    num_cols = attach_prior_reliability(df, dates, num_cols)
    folds = build_folds(dates, args.min_train_dates, args.test_dates)
    fold_summaries = score_walk_forward(df, dates, folds, cat_cols, num_cols)
    summary = build_outputs(df, args, dates, folds, fold_summaries, cat_cols, num_cols)
    print(
        json.dumps(
            {
                "chosenThreshold": summary["chosenThreshold"],
                "selected": summary["selected"],
                "outPrefix": args.out_prefix,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
