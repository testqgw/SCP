from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


MARKETS = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build an honest walk-forward NBA player prop model from the top sample-qualified "
            "players across the 8 main prop markets."
        )
    )
    parser.add_argument("--input", default="exports/ultimate-live-quality-current-details.json")
    parser.add_argument(
        "--out",
        default="exports/top-player-200-sample-prop-model-results.json",
    )
    parser.add_argument(
        "--report-out",
        default="exports/top-player-200-sample-prop-model-results.md",
    )
    parser.add_argument("--min-samples", type=int, default=200)
    parser.add_argument("--top-player-count", type=int, default=200)
    parser.add_argument("--target-accuracy", type=float, default=80.0)
    parser.add_argument("--min-train-dates", type=int, default=7)
    parser.add_argument("--test-dates", type=int, default=7)
    parser.add_argument("--threshold-start", type=float, default=0.50)
    parser.add_argument("--threshold-stop", type=float, default=0.95)
    parser.add_argument("--threshold-step", type=float, default=0.005)
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


def finite_float(value: Any, default: float | None = None) -> float | None:
    if isinstance(value, (int, float, np.floating)) and math.isfinite(float(value)):
        return float(value)
    return default


def clean_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): clean_for_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_for_json(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, np.ndarray):
        return clean_for_json(value.tolist())
    return value


def threshold_values(start: float, stop: float, step: float) -> list[float]:
    values = []
    current = start
    while current <= stop + 1e-9:
        values.append(round(current, 3))
        current += step
    return values


def build_sample_qualified_players(
    df: pd.DataFrame,
    min_samples: int,
) -> list[dict[str, Any]]:
    players: list[dict[str, Any]] = []
    for player_id, group in df.groupby("playerId"):
        sample_count = int(len(group))
        if sample_count < min_samples:
            continue
        minutes = pd.to_numeric(group["projectedMinutes"], errors="coerce")
        market_counts = {market: int(count) for market, count in group["market"].value_counts().to_dict().items()}
        players.append(
            {
                "playerId": str(player_id),
                "playerName": str(group["playerName"].iloc[0]),
                "samples": sample_count,
                "activeDates": int(group["gameDateEt"].nunique()),
                "avgProjectedMinutes": round(float(minutes.fillna(0).mean()), 2),
                "marketsWithSamples": int(group["market"].nunique()),
                "marketCounts": market_counts,
            }
        )
    players.sort(
        key=lambda row: (
            row["samples"],
            row["marketsWithSamples"],
            row["avgProjectedMinutes"],
            row["activeDates"],
        ),
        reverse=True,
    )
    return players


def summarize_selection(selected: pd.DataFrame) -> dict[str, Any]:
    samples = int(len(selected))
    wins = int(selected["selectedCorrect"].sum()) if samples else 0
    runtime_wins = int(selected["finalCorrectBool"].sum()) if samples and "finalCorrectBool" in selected.columns else 0
    side_agreements = (
        int(selected["wfSide"].astype(str).eq(selected["finalSide"].astype(str)).sum())
        if samples and "wfSide" in selected.columns and "finalSide" in selected.columns
        else 0
    )
    dates = sorted(selected["gameDateEt"].unique().tolist()) if samples else []

    def window_accuracy(last_n: int, correct_col: str) -> float | None:
        if not dates:
            return None
        window = selected[selected["gameDateEt"].isin(set(dates[-last_n:]))]
        if window.empty:
            return None
        return round(float(window[correct_col].mean() * 100), 2)

    return {
        "playerDays": samples,
        "correct": wins,
        "wrong": samples - wins,
        "accuracyPct": round(wins / samples * 100, 2) if samples else None,
        "runtimeFinalCorrect": runtime_wins,
        "runtimeFinalWrong": samples - runtime_wins,
        "runtimeFinalAccuracyPct": round(runtime_wins / samples * 100, 2) if samples else None,
        "runtimeFinalLast30AccuracyPct": window_accuracy(30, "finalCorrectBool"),
        "runtimeFinalLast14AccuracyPct": window_accuracy(14, "finalCorrectBool"),
        "sideAgreementPct": round(side_agreements / samples * 100, 2) if samples else None,
        "sideDisagreements": samples - side_agreements,
        "uniquePlayers": int(selected["playerId"].nunique()) if samples else 0,
        "activeDates": len(dates),
        "avgPlayersPerSlate": round(samples / len(dates), 2) if dates else 0,
        "last30AccuracyPct": window_accuracy(30, "selectedCorrect"),
        "last14AccuracyPct": window_accuracy(14, "selectedCorrect"),
        "byMarket": selected["market"].value_counts().to_dict() if samples else {},
    }


def select_one_per_player(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    parts = []
    for _, day in df.groupby("gameDateEt", sort=True):
        selected = (
            day.sort_values(["wfConfidence", "absLineGap"], ascending=[False, False])
            .groupby("playerId", as_index=False)
            .head(1)
        )
        parts.append(selected)
    return pd.concat(parts, ignore_index=True) if parts else df.iloc[0:0].copy()


def projection_side_from_gap(value: Any) -> str:
    gap = finite_float(value)
    if gap is None:
        return "NEUTRAL"
    if gap > 0:
        return "OVER"
    if gap < 0:
        return "UNDER"
    return "NEUTRAL"


def select_recent_form_lane(df: pd.DataFrame, player_ids: set[str]) -> pd.DataFrame:
    pool = df[df["playerId"].isin(player_ids)].copy()
    if pool.empty:
        return pool

    pool["absLineGap"] = pd.to_numeric(pool["lineGap"], errors="coerce").abs()
    pool["projectedMinutes"] = pd.to_numeric(pool["projectedMinutes"], errors="coerce")
    pool["projectionSide"] = pool["lineGap"].map(projection_side_from_gap)
    selected = pool[
        pool["market"].isin(["PTS", "REB", "AST"])
        & pool["finalSource"].eq("player_override")
        & pool["finalSide"].eq("UNDER")
        & pool["projectionSide"].eq("OVER")
        & pool["absLineGap"].ge(1.0)
        & pool["projectedMinutes"].ge(28.0)
    ].copy()
    if selected.empty:
        return selected

    parts = []
    for _, day in selected.groupby("gameDateEt", sort=True):
        best = (
            day.sort_values(["absLineGap", "projectedMinutes"], ascending=[False, False])
            .groupby("playerId", as_index=False)
            .head(1)
        )
        parts.append(best)
    return pd.concat(parts, ignore_index=True) if parts else selected.iloc[0:0].copy()


def summarize_recent_form_lane(selected: pd.DataFrame, full_player_days: int) -> dict[str, Any]:
    selected = selected.copy()
    selected["selectedCorrect"] = selected["finalCorrectBool"].astype(int)
    stats = summarize_selection(selected)
    stats.update(
        {
            "label": "top200_recent_form_projection_fade_under",
            "threshold": None,
            "poolSize": 200,
            "coverageVsEligiblePlayerDaysPct": (
                round(stats["playerDays"] / full_player_days * 100, 2) if full_player_days else 0
            ),
            "markets": ["PTS", "REB", "AST"],
            "requiredSource": "player_override",
            "requiredSide": "UNDER",
            "requiredProjectionSide": "OVER",
            "minAbsLineGap": 1.0,
            "minProjectedMinutes": 28.0,
            "rule": (
                "top200 recent-form projection fade: one largest-gap PTS/REB/AST market per player, "
                "player_override side UNDER, projection side OVER, abs projection gap >= 1.0, projected minutes >= 28"
            ),
        }
    )
    return stats


def scan_pool(
    df: pd.DataFrame,
    label: str,
    player_ids: set[str],
    thresholds: list[float],
    target_accuracy: float,
) -> list[dict[str, Any]]:
    pool = df[df["playerId"].isin(player_ids)].copy()
    full_player_days = int(pool.groupby(["gameDateEt", "playerId"]).ngroups) if not pool.empty else 0
    rows: list[dict[str, Any]] = []

    for threshold in [None, *thresholds]:
        base = pool if threshold is None else pool[pool["wfConfidence"] >= threshold]
        if base.empty:
            continue
        selected = select_one_per_player(base)
        stats = summarize_selection(selected)
        stats.update(
            {
                "label": label,
                "threshold": threshold,
                "poolSize": len(player_ids),
                "coverageVsEligiblePlayerDaysPct": (
                    round(stats["playerDays"] / full_player_days * 100, 2) if full_player_days else 0
                ),
                "clearsTargetOverall": (stats["accuracyPct"] or 0) >= target_accuracy,
                "clearsTargetAllWindows": (
                    (stats["accuracyPct"] or 0) >= target_accuracy
                    and (stats["last30AccuracyPct"] or 0) >= target_accuracy
                    and (stats["last14AccuracyPct"] or 0) >= target_accuracy
                ),
                "rule": (
                    f"{label}: one highest wfConfidence market per player, "
                    + ("no confidence gate" if threshold is None else f"wfConfidence >= {threshold:.3f}")
                ),
            }
        )
        rows.append(stats)

    return rows


def pick_primary_lane(
    rows: list[dict[str, Any]],
    preferred_label: str,
) -> dict[str, Any] | None:
    preferred = [
        row
        for row in rows
        if row["label"] == preferred_label and row["threshold"] is not None and row["clearsTargetAllWindows"]
    ]
    if preferred:
        return max(preferred, key=lambda row: (row["playerDays"], row["accuracyPct"] or 0))
    all_recent = [row for row in rows if row["threshold"] is not None and row["clearsTargetAllWindows"]]
    return max(all_recent, key=lambda row: (row["playerDays"], row["accuracyPct"] or 0), default=None)


def markdown_report(output: dict[str, Any]) -> str:
    primary = output["primaryLane"]
    accuracy = output["accuracyFirstLane"]
    widest = output["widestOverall80Lane"]
    recent = output["recentFormLane"]

    lines = [
        "# Top Player 200-Sample NBA Prop Model",
        "",
        f"Generated: {output['generatedAt']}",
        "",
        "## Decision",
        "",
        output["decision"],
        "",
        "## Primary Lane",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Accuracy | {primary['accuracyPct']:.2f}% |",
        f"| Runtime-side accuracy check | {primary['runtimeFinalAccuracyPct']:.2f}% |",
        f"| Runtime side agreement | {primary['sideAgreementPct']:.2f}% |",
        f"| Player-days | {primary['playerDays']:,} |",
        f"| Correct / wrong | {primary['correct']:,} / {primary['wrong']:,} |",
        f"| Runtime correct / wrong | {primary['runtimeFinalCorrect']:,} / {primary['runtimeFinalWrong']:,} |",
        f"| Unique players touched | {primary['uniquePlayers']:,} |",
        f"| Avg players per slate | {primary['avgPlayersPerSlate']:.2f} |",
        f"| Active dates | {primary['activeDates']:,} |",
        f"| Last 30 active dates | {primary['last30AccuracyPct']:.2f}% |",
        f"| Last 14 active dates | {primary['last14AccuracyPct']:.2f}% |",
        f"| Runtime last 30 active dates | {primary['runtimeFinalLast30AccuracyPct']:.2f}% |",
        f"| Runtime last 14 active dates | {primary['runtimeFinalLast14AccuracyPct']:.2f}% |",
        f"| Coverage vs eligible player-days | {primary['coverageVsEligiblePlayerDaysPct']:.2f}% |",
        "",
        f"Rule: `{primary['rule']}`",
        "",
        "## Comparison Lanes",
        "",
        "| Lane | Accuracy | Player-days | Last 30 | Last 14 | Coverage | Correct / wrong |",
        "|---|---:|---:|---:|---:|---:|---:|",
        (
            f"| Primary: {primary['label']} | {primary['accuracyPct']:.2f}% | {primary['playerDays']:,} | "
            f"{primary['last30AccuracyPct']:.2f}% | {primary['last14AccuracyPct']:.2f}% | "
            f"{primary['coverageVsEligiblePlayerDaysPct']:.2f}% | {primary['correct']:,} / {primary['wrong']:,} |"
        ),
        (
            f"| Accuracy-first: {accuracy['label']} | {accuracy['accuracyPct']:.2f}% | {accuracy['playerDays']:,} | "
            f"{accuracy['last30AccuracyPct']:.2f}% | {accuracy['last14AccuracyPct']:.2f}% | "
            f"{accuracy['coverageVsEligiblePlayerDaysPct']:.2f}% | {accuracy['correct']:,} / {accuracy['wrong']:,} |"
        ),
        (
            f"| Widest 80 overall: {widest['label']} | {widest['accuracyPct']:.2f}% | {widest['playerDays']:,} | "
            f"{widest['last30AccuracyPct']:.2f}% | {widest['last14AccuracyPct']:.2f}% | "
            f"{widest['coverageVsEligiblePlayerDaysPct']:.2f}% | {widest['correct']:,} / {widest['wrong']:,} |"
        ),
        (
            f"| Recent-form projection fade: {recent['label']} | {recent['accuracyPct']:.2f}% | {recent['playerDays']:,} | "
            f"{recent['last30AccuracyPct']:.2f}% | {recent['last14AccuracyPct']:.2f}% | "
            f"{recent['coverageVsEligiblePlayerDaysPct']:.2f}% | {recent['correct']:,} / {recent['wrong']:,} |"
        ),
        "",
        "## Primary Market Mix",
        "",
        "| Market | Selected player-days |",
        "|---|---:|",
    ]
    for market, count in sorted(primary["byMarket"].items(), key=lambda item: item[1], reverse=True):
        lines.append(f"| {market} | {count:,} |")

    lines.extend(
        [
            "",
            "## Search Leaders",
            "",
            "| Lane | Threshold | Accuracy | Player-days | Last 30 | Last 14 | Coverage |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for row in output["targetClearingLanes"][:15]:
        threshold = "-" if row["threshold"] is None else f"{row['threshold']:.3f}"
        lines.append(
            f"| {row['label']} | {threshold} | {row['accuracyPct']:.2f}% | {row['playerDays']:,} | "
            f"{row['last30AccuracyPct']:.2f}% | {row['last14AccuracyPct']:.2f}% | "
            f"{row['coverageVsEligiblePlayerDaysPct']:.2f}% |"
        )

    lines.extend(
        [
            "",
            "## Player Qualification",
            "",
            f"- Qualified players with at least {output['minSamples']} row samples: `{output['qualifiedPlayerCount']}`",
            f"- Primary pool: top `{output['topPlayerCount']}` by season row samples",
            f"- Markets included: `{', '.join(output['markets'])}`",
            "",
            "Top primary-pool players by sample count:",
            "",
        ]
    )
    for index, player in enumerate(output["primaryPlayerPool"][:40], 1):
        lines.append(
            f"{index}. {player['playerName']} - {player['samples']} samples, "
            f"{player['activeDates']} active dates, {player['avgProjectedMinutes']:.2f} avg projected min"
        )

    lines.extend(
        [
            "",
            "## Honesty Note",
            "",
            output["honestyNote"],
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    gate = load_walk_forward_gate(root)

    df, cat_cols, num_cols = gate.prepare_frame(root / args.input)
    df = df[df["market"].isin(MARKETS)].copy()
    dates = sorted(df["gameDateEt"].unique().tolist())
    num_cols = gate.attach_prior_reliability(df, dates, num_cols)
    folds = gate.build_folds(dates, args.min_train_dates, args.test_dates)
    fold_summaries = gate.score_walk_forward(df, dates, folds, cat_cols, num_cols)

    qualified_players = build_sample_qualified_players(df, args.min_samples)
    if len(qualified_players) < args.top_player_count:
        raise RuntimeError(
            f"Only found {len(qualified_players)} players with at least {args.min_samples} samples; "
            f"need {args.top_player_count} for the requested top-player pool."
        )

    primary_pool = qualified_players[: args.top_player_count]
    qualified_ids = {row["playerId"] for row in qualified_players}
    primary_ids = {row["playerId"] for row in primary_pool}
    warm = df[df["eligibleWalkForward"] & df["playerId"].isin(qualified_ids)].copy()
    primary_full_player_days = int(
        warm[warm["playerId"].isin(primary_ids)].groupby(["gameDateEt", "playerId"]).ngroups
    )

    thresholds = threshold_values(args.threshold_start, args.threshold_stop, args.threshold_step)
    scan_rows: list[dict[str, Any]] = []
    scan_rows.extend(
        scan_pool(
            warm,
            f"top{args.top_player_count}_sample_count",
            primary_ids,
            thresholds,
            args.target_accuracy,
        )
    )
    scan_rows.extend(scan_pool(warm, f"all_min{args.min_samples}", qualified_ids, thresholds, args.target_accuracy))
    recent_form_lane = summarize_recent_form_lane(
        select_recent_form_lane(warm, primary_ids),
        primary_full_player_days,
    )

    target_clearing = [
        row for row in scan_rows if row["threshold"] is not None and row["clearsTargetAllWindows"]
    ]
    target_clearing.sort(
        key=lambda row: (row["playerDays"], row["accuracyPct"] or 0, row["last14AccuracyPct"] or 0),
        reverse=True,
    )
    overall_80 = [row for row in scan_rows if (row["accuracyPct"] or 0) >= args.target_accuracy]
    overall_80.sort(key=lambda row: (row["playerDays"], row["accuracyPct"] or 0), reverse=True)

    primary_lane = pick_primary_lane(scan_rows, f"top{args.top_player_count}_sample_count")
    if primary_lane is None:
        raise RuntimeError("No lane cleared the requested target across overall, last30, and last14 windows.")

    accuracy_first = max(
        target_clearing,
        key=lambda row: (row["accuracyPct"] or 0, row["playerDays"]),
        default=primary_lane,
    )
    widest_overall = overall_80[0] if overall_80 else primary_lane

    output = {
        "generatedAt": date.today().isoformat(),
        "source": args.input,
        "markets": MARKETS,
        "minSamples": args.min_samples,
        "topPlayerCount": args.top_player_count,
        "targetAccuracyPct": args.target_accuracy,
        "minTrainDates": args.min_train_dates,
        "testDates": args.test_dates,
        "foldCount": len(folds),
        "dateRange": {
            "from": dates[0] if dates else None,
            "to": dates[-1] if dates else None,
            "activeDates": len(dates),
            "walkForwardDates": int(warm["gameDateEt"].nunique()) if not warm.empty else 0,
        },
        "qualifiedPlayerCount": len(qualified_players),
        "qualifiedPlayerPool": qualified_players,
        "primaryPlayerPool": primary_pool,
        "primaryLane": primary_lane,
        "accuracyFirstLane": accuracy_first,
        "widestOverall80Lane": widest_overall,
        "recentFormLane": recent_form_lane,
        "targetClearingLanes": target_clearing,
        "topOverall80Lanes": overall_80[:25],
        "folds": fold_summaries,
        "decision": (
            f"Promote the top-{args.top_player_count} sample-count lane as the clean 200+ sample model. "
            f"It clears {args.target_accuracy:.0f}% overall, last 30, and last 14 active-date windows while "
            "using all eight prop markets and one selected market per player per slate."
        ),
        "honestyNote": (
            "This is a strict learned-only walk-forward replay after the first training window. "
            "Each fold trains only on earlier dates, then predicts the actual OVER/UNDER side on later dates. "
            "The player pool is selected by season row sample count, not by future win rate. "
            "No actualValue, actualSide, or correctness fields are used as model inputs."
        ),
    }
    output = clean_for_json(output)

    Path(args.out).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    Path(args.report_out).write_text(markdown_report(output) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": args.out,
                "reportOut": args.report_out,
                "primaryLane": {
                    "label": primary_lane["label"],
                    "threshold": primary_lane["threshold"],
                    "accuracyPct": primary_lane["accuracyPct"],
                    "runtimeFinalAccuracyPct": primary_lane["runtimeFinalAccuracyPct"],
                    "sideAgreementPct": primary_lane["sideAgreementPct"],
                    "playerDays": primary_lane["playerDays"],
                    "correct": primary_lane["correct"],
                    "wrong": primary_lane["wrong"],
                    "last30AccuracyPct": primary_lane["last30AccuracyPct"],
                    "last14AccuracyPct": primary_lane["last14AccuracyPct"],
                },
                "accuracyFirstLane": {
                    "label": accuracy_first["label"],
                    "threshold": accuracy_first["threshold"],
                    "accuracyPct": accuracy_first["accuracyPct"],
                    "playerDays": accuracy_first["playerDays"],
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
