from __future__ import annotations

import argparse
import json
import math
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


RAW_DECISION_CAT_KEYS = ["archetype", "minutesBucket", "modelKind", "favoredSide"]
RAW_DECISION_NUM_KEYS = [
    "bucketSamples",
    "bucketModelAccuracy",
    "bucketLateAccuracy",
    "leafCount",
    "leafAccuracy",
    "absLineGap",
    "priceLean",
    "priceStrength",
    "projectionMarketAgreement",
    "overProbability",
    "underProbability",
    "projectionWinProbability",
    "projectionPriceEdge",
    "projectionResidualMean",
    "projectionResidualStdDev",
]

BASE_CAT_COLS = [
    "market",
    "baselineSide",
    "rawSide",
    "strictRawSide",
    "finalSide",
    "rawSource",
    "strictRawSource",
    "finalSource",
    "playerOverrideSide",
    "contextProjectionSide",
    "contextFavoredSide",
    "teamCode",
    "spreadResolved",
    "stepUpRoleFlag",
    "rd_archetype",
    "rd_minutesBucket",
    "rd_modelKind",
    "rd_favoredSide",
    "playerId",
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
    "seasonMinutesAvg",
    "minutesLiftPct",
    "activeCorePts",
    "activeCoreAst",
    "missingCorePts",
    "missingCoreAst",
    "missingCoreShare",
    "expectedMinutes",
    "contextMinutesVolatility",
    "contextStarterRateLast10",
    "benchBigRoleStability",
    "l5MarketDeltaAvg",
    "l5OverRate",
    "l5MinutesAvg",
    "openingTeamSpread",
    "openingTotal",
    "lineupTimingConfidence",
    "completenessScore",
    "contextPriceLean",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replay the best current 115-player base V2 market-selector experiment."
    )
    parser.add_argument("--input", default="exports/ultimate-live-quality-current-details.json")
    parser.add_argument(
        "--context-input",
        default="exports/projection-backtest-allplayers-with-rows-live-team-context.json",
    )
    parser.add_argument(
        "--model-artifact",
        default="exports/projection-115-live-quality-walkforward-playerday-results.json",
    )
    parser.add_argument(
        "--out",
        default="exports/projection-115-base-v2-market-selector-results.json",
    )
    parser.add_argument(
        "--report-out",
        default="exports/projection-115-base-v2-market-selector-results.md",
    )
    parser.add_argument("--min-train-dates", type=int, default=21)
    parser.add_argument("--test-dates", type=int, default=14)
    return parser.parse_args()


def finite_float(value: Any, default: float | None = None) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return default


def raw_decision_value(decision: Any, key: str) -> Any:
    if isinstance(decision, dict):
        return decision.get(key)
    return None


def build_folds(dates: list[str], min_train_dates: int, test_dates: int) -> list[list[str]]:
    folds = []
    for start in range(min_train_dates, len(dates), test_dates):
        fold_dates = dates[start : start + test_dates]
        if fold_dates:
            folds.append(fold_dates)
    return folds


def load_quality_ids(model_artifact_path: Path) -> tuple[dict[str, Any], set[str]]:
    artifact = json.loads(model_artifact_path.read_text(encoding="utf-8"))
    quality_ids = {str(row["playerId"]) for row in artifact["qualityPlayerPool"]}
    return artifact, quality_ids


def load_frame(input_path: Path, context_input_path: Path) -> pd.DataFrame:
    df = pd.DataFrame(json.loads(input_path.read_text(encoding="utf-8")))
    for key in RAW_DECISION_CAT_KEYS:
        df[f"rd_{key}"] = (
            df["rawDecision"].apply(lambda decision: raw_decision_value(decision, key)).fillna("NA").astype(str)
        )
    for key in RAW_DECISION_NUM_KEYS:
        df[f"rd_{key}"] = pd.to_numeric(
            df["rawDecision"].apply(lambda decision: raw_decision_value(decision, key)),
            errors="coerce",
        )
    df["projectionWinScore"] = df["rd_projectionWinProbability"].fillna(0.5)

    context = pd.DataFrame(json.loads(context_input_path.read_text(encoding="utf-8"))["playerMarketRows"])
    context_cols = [
        "playerId",
        "gameDateEt",
        "market",
        "projectionSide",
        "priceLean",
        "favoredSide",
        "seasonMinutesAvg",
        "minutesLiftPct",
        "activeCorePts",
        "activeCoreAst",
        "missingCorePts",
        "missingCoreAst",
        "missingCoreShare",
        "stepUpRoleFlag",
        "expectedMinutes",
        "minutesVolatility",
        "starterRateLast10",
        "benchBigRoleStability",
        "l5MarketDeltaAvg",
        "l5OverRate",
        "l5MinutesAvg",
        "openingTeamSpread",
        "openingTotal",
        "lineupTimingConfidence",
        "completenessScore",
        "spreadResolved",
        "teamCode",
    ]
    context = context[[col for col in context_cols if col in context.columns]].rename(
        columns={
            "projectionSide": "contextProjectionSide",
            "priceLean": "contextPriceLean",
            "favoredSide": "contextFavoredSide",
            "minutesVolatility": "contextMinutesVolatility",
            "starterRateLast10": "contextStarterRateLast10",
        }
    )
    df = df.merge(context, on=["playerId", "gameDateEt", "market"], how="left")

    for col in BASE_CAT_COLS:
        if col not in df.columns:
            df[col] = "NA"
        df[col] = df[col].fillna("NA").astype(str)

    num_cols = [*BASE_NUM_COLS, *[f"rd_{key}" for key in RAW_DECISION_NUM_KEYS]]
    for col in num_cols:
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["actualSide"] = df["actualSide"].astype(str)
    df["currentFinalCorrect"] = df["finalSide"].astype(str).eq(df["actualSide"].astype(str))
    df["rawCorrectSide"] = df["rawSide"].astype(str).eq(df["actualSide"].astype(str))
    df["projectionCorrectSide"] = df["contextProjectionSide"].astype(str).eq(df["actualSide"].astype(str))
    df["yOver"] = df["actualSide"].eq("OVER").astype(int)
    return df


def attach_rolling_reliability(df: pd.DataFrame, dates: list[str], num_cols: list[str]) -> list[str]:
    specs = [
        ("final_src_mkt", ["finalSource", "market"], "currentFinalCorrect"),
        ("player_mkt_final", ["playerId", "market", "finalSide"], "currentFinalCorrect"),
        ("player_mkt", ["playerId", "market"], "currentFinalCorrect"),
        ("team_mkt", ["teamCode", "market"], "currentFinalCorrect"),
        ("raw_src_mkt", ["rawSource", "market"], "rawCorrectSide"),
        ("proj_side_mkt", ["contextProjectionSide", "market"], "projectionCorrectSide"),
        ("mkt_over", ["market"], "yOver"),
        ("player_mkt_over", ["playerId", "market"], "yOver"),
    ]
    for prefix, cols, target_col in specs:
        n_col = f"roll_{prefix}_n"
        acc_col = f"roll_{prefix}_acc"
        df[n_col] = 0.0
        df[acc_col] = np.nan
        stats: dict[tuple[str, ...], list[int]] = defaultdict(lambda: [0, 0])

        for slate_date in dates:
            idx = df.index[df["gameDateEt"].eq(slate_date)]
            keys = list(map(tuple, df.loc[idx, cols].astype(str).values.tolist()))
            samples = []
            accuracies = []
            for key in keys:
                n, wins = stats[key]
                samples.append(float(n))
                accuracies.append((wins + 10) / (n + 20) if n else np.nan)
            df.loc[idx, n_col] = samples
            df.loc[idx, acc_col] = accuracies

            for key, correct in zip(keys, df.loc[idx, target_col].astype(int).tolist()):
                stats[key][0] += 1
                stats[key][1] += int(correct)

        num_cols.extend([n_col, acc_col])

    return list(dict.fromkeys(num_cols))


def summarize_selection(selected: pd.DataFrame, correct_col: str) -> dict[str, Any]:
    samples = int(len(selected))
    wins = int(selected[correct_col].sum()) if samples else 0
    dates = sorted(selected["gameDateEt"].unique().tolist()) if samples else []

    def window_accuracy(last_n: int) -> float | None:
        if not dates:
            return None
        window = selected[selected["gameDateEt"].isin(set(dates[-last_n:]))]
        if window.empty:
            return None
        return round(float(window[correct_col].sum()) / len(window) * 100, 2)

    return {
        "playerDays": samples,
        "correct": wins,
        "wrong": samples - wins,
        "accuracyPct": round(wins / samples * 100, 2) if samples else None,
        "uniquePlayers": int(selected["playerId"].nunique()) if samples else 0,
        "activeDates": len(dates),
        "avgPlayersPerSlate": round(samples / len(dates), 2) if dates else 0,
        "last30AccuracyPct": window_accuracy(30),
        "last14AccuracyPct": window_accuracy(14),
        "byMarket": selected["market"].value_counts().to_dict() if samples else {},
    }


def select_one_per_player(df: pd.DataFrame, score_col: str, correct_col: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    if df.empty:
        return df.copy(), summarize_selection(df, correct_col)

    parts = []
    for _, day in df.groupby("gameDateEt", sort=True):
        selected = (
            day.sort_values([score_col, "absLineGap"], ascending=[False, False])
            .groupby("playerId", as_index=False)
            .head(1)
        )
        parts.append(selected)
    selected_all = pd.concat(parts, ignore_index=True)
    return selected_all, summarize_selection(selected_all, correct_col)


def evaluate_current_final_market_ranker(
    df: pd.DataFrame,
    dates: list[str],
    folds: list[list[str]],
    quality_ids: set[str],
    min_train_dates: int,
    cat_cols: list[str],
    num_cols: list[str],
) -> dict[str, Any]:
    work = df.copy()
    work["eligibleWalkForward"] = False
    work["baseV2Score"] = np.nan

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
        max_iter=160,
        learning_rate=0.035,
        max_leaf_nodes=31,
        l2_regularization=0.08,
        random_state=17,
    )
    pipeline = Pipeline([("pre", preprocessor), ("clf", classifier)])
    feature_cols = [*cat_cols, *num_cols]
    fold_summaries: list[dict[str, Any]] = []

    for fold_index, fold_dates in enumerate(folds, 1):
        train_mask = work["gameDateEt"].lt(fold_dates[0])
        test_mask = work["gameDateEt"].isin(fold_dates)
        pipeline.fit(work.loc[train_mask, feature_cols], work.loc[train_mask, "currentFinalCorrect"].astype(int))
        proba = pipeline.predict_proba(work.loc[test_mask, feature_cols])[:, 1]
        idx = work.index[test_mask]
        work.loc[idx, "eligibleWalkForward"] = True
        work.loc[idx, "baseV2Score"] = proba

        fold_summaries.append(
            {
                "fold": fold_index,
                "testFrom": fold_dates[0],
                "testTo": fold_dates[-1],
                "trainRows": int(train_mask.sum()),
                "testRows": int(test_mask.sum()),
                "ungroupedCurrentFinalAccuracyPct": round(
                    float(work.loc[test_mask, "currentFinalCorrect"].mean() * 100),
                    2,
                ),
            }
        )

    cutoff = dates[min_train_dates] if len(dates) > min_train_dates else None
    quality = work[work["playerId"].isin(quality_ids)].copy()
    warm = quality[quality["gameDateEt"].ge(cutoff) & quality["eligibleWalkForward"]].copy() if cutoff else quality
    warm_selected, warm_stats = select_one_per_player(warm, "baseV2Score", "currentFinalCorrect")

    cold = quality[quality["gameDateEt"].lt(cutoff)].copy() if cutoff else quality.iloc[0:0].copy()
    cold["baseV2Score"] = cold["projectionWinScore"]
    cold_selected, _ = select_one_per_player(cold, "baseV2Score", "currentFinalCorrect")

    selected = pd.concat([cold_selected, warm_selected], ignore_index=True)
    stats = summarize_selection(selected, "currentFinalCorrect")
    stats["pool"] = "top115_quality"
    stats["label"] = "base_v2_current_final_market_ranker"
    stats["rule"] = (
        "cold current-final by projectionWinScore, then honest walk-forward HGB market ranker "
        "trained to predict whether the current-final side is correct"
    )
    stats["coldStartCutoffDate"] = cutoff
    stats["coldStartPlayerDays"] = int(len(cold_selected))
    stats["walkForwardPlayerDays"] = int(len(warm_selected))
    stats["warmAccuracyPct"] = warm_stats["accuracyPct"]
    stats["warmCorrect"] = warm_stats["correct"]
    stats["warmWrong"] = warm_stats["wrong"]
    stats["folds"] = fold_summaries
    return stats


def evaluate_any_market_current_final_oracle(
    df: pd.DataFrame,
    dates: list[str],
    quality_ids: set[str],
    min_train_dates: int,
) -> dict[str, Any]:
    cutoff = dates[min_train_dates] if len(dates) > min_train_dates else None
    warm = df[df["playerId"].isin(quality_ids)].copy()
    if cutoff:
        warm = warm[warm["gameDateEt"].ge(cutoff)]
    grouped = warm.groupby(["gameDateEt", "playerId"])["currentFinalCorrect"].max()
    samples = int(len(grouped))
    wins = int(grouped.sum()) if samples else 0
    return {
        "label": "any_market_current_final_oracle",
        "description": (
            "Upper bound if a selector could always choose the correct market while keeping the current-final side."
        ),
        "playerDays": samples,
        "correct": wins,
        "wrong": samples - wins,
        "accuracyPct": round(wins / samples * 100, 2) if samples else None,
    }


def markdown_report(output: dict[str, Any]) -> str:
    base = output["existingBase115"]
    router = output.get("existingNoExclusionSourceRouter")
    v2 = output["baseV2MarketSelector"]
    oracle = output["anyMarketCurrentFinalOracle"]

    lines = [
        "# Projection 115 Base V2 Market Selector",
        "",
        f"Generated: {output['generatedAt']}",
        "",
        "## Readout",
        "",
        "| Model | Accuracy | Player-days | Correct / wrong | Warm accuracy | Last 30 | Last 14 |",
        "|---|---:|---:|---:|---:|---:|---:|",
        (
            f"| Existing base 115 | {base['accuracyPct']:.2f}% | {base['playerDays']:,} | "
            f"{base['correct']:,} / {base['wrong']:,} | - | {base['last30AccuracyPct']:.2f}% | "
            f"{base['last14AccuracyPct']:.2f}% |"
        ),
    ]
    if router:
        lines.append(
            f"| Existing source router | {router['accuracyPct']:.2f}% | {router['playerDays']:,} | "
            f"{router['correct']:,} / {router['wrong']:,} | {router.get('warmAccuracyPct', 0):.2f}% | "
            f"{router['last30AccuracyPct']:.2f}% | {router['last14AccuracyPct']:.2f}% |"
        )
    lines.extend(
        [
            (
                f"| Base V2 market selector | {v2['accuracyPct']:.2f}% | {v2['playerDays']:,} | "
                f"{v2['correct']:,} / {v2['wrong']:,} | {v2['warmAccuracyPct']:.2f}% | "
                f"{v2['last30AccuracyPct']:.2f}% | {v2['last14AccuracyPct']:.2f}% |"
            ),
            (
                f"| Current-final market oracle | {oracle['accuracyPct']:.2f}% | {oracle['playerDays']:,} | "
                f"{oracle['correct']:,} / {oracle['wrong']:,} | - | - | - |"
            ),
            "",
            "## Conclusion",
            "",
            output["conclusion"],
            "",
            "## Base V2 Rule",
            "",
            f"`{v2['rule']}`",
            "",
            "The first 21 active dates stay cold-start and use the current-final side ranked by projectionWinScore. "
            "Every later fold is trained only on earlier dates.",
            "",
            "## Base V2 Market Mix",
            "",
            "| Market | Selected player-days |",
            "|---|---:|",
        ]
    )
    for market, count in sorted(v2["byMarket"].items(), key=lambda item: item[1], reverse=True):
        lines.append(f"| {market} | {count:,} |")
    lines.extend(
        [
            "",
            "## Why This Was The Next Move",
            "",
            (
                "The warm current-final market oracle is still far above the learned selector, so the blocker is "
                "not simply side vocabulary. The base model needs a better market-choice signal before a true "
                "full-coverage 90% claim is honest."
            ),
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    artifact, quality_ids = load_quality_ids(root / args.model_artifact)
    df = load_frame(root / args.input, root / args.context_input)
    dates = sorted(df["gameDateEt"].unique().tolist())
    folds = build_folds(dates, args.min_train_dates, args.test_dates)
    num_cols = attach_rolling_reliability(
        df,
        dates,
        [*BASE_NUM_COLS, *[f"rd_{key}" for key in RAW_DECISION_NUM_KEYS]],
    )

    base_v2 = evaluate_current_final_market_ranker(
        df=df,
        dates=dates,
        folds=folds,
        quality_ids=quality_ids,
        min_train_dates=args.min_train_dates,
        cat_cols=BASE_CAT_COLS,
        num_cols=num_cols,
    )
    oracle = evaluate_any_market_current_final_oracle(df, dates, quality_ids, args.min_train_dates)

    clears_90 = (base_v2["accuracyPct"] or 0) >= 90.0
    output = {
        "generatedAt": date.today().isoformat(),
        "source": args.input,
        "contextSource": args.context_input,
        "modelArtifact": args.model_artifact,
        "playerPoolSize": artifact["playerPoolSize"],
        "minTrainDates": args.min_train_dates,
        "testDates": args.test_dates,
        "coldStartCutoffDate": dates[args.min_train_dates] if len(dates) > args.min_train_dates else None,
        "existingBase115": artifact["best115"],
        "existingNoExclusionSourceRouter": artifact.get("noExclusionSourceRouter"),
        "baseV2MarketSelector": base_v2,
        "anyMarketCurrentFinalOracle": oracle,
        "clears90BaseTarget": clears_90,
        "conclusion": (
            "Base V2 improves the full 115-player replay, but it is not a 90% base model yet. "
            "Do not promote this as a 90% model; treat it as the strongest honest base-direction move found so far."
            if not clears_90
            else "Base V2 clears the 90% full-coverage target under this replay protocol."
        ),
        "honestyNote": (
            "Features are limited to row/model/context fields available in the source snapshots plus rolling "
            "reliability computed only from earlier dates. actualValue, actualSide, correctness flags, and "
            "actualMinutes are not used as model inputs."
        ),
    }

    Path(args.out).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    Path(args.report_out).write_text(markdown_report(output) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": args.out,
                "reportOut": args.report_out,
                "baseV2MarketSelector": {
                    "accuracyPct": base_v2["accuracyPct"],
                    "playerDays": base_v2["playerDays"],
                    "correct": base_v2["correct"],
                    "wrong": base_v2["wrong"],
                    "warmAccuracyPct": base_v2["warmAccuracyPct"],
                    "last30AccuracyPct": base_v2["last30AccuracyPct"],
                    "last14AccuracyPct": base_v2["last14AccuracyPct"],
                },
                "clears90BaseTarget": clears_90,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
