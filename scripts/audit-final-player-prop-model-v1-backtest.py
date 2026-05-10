from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-10-role-floor-context-v2"
EXPECTED_CONFIG = {
    "maxPicks": 6,
    "minScore": 0.75,
    "maxPerPlayer": 1,
    "maxPerTeam": 2,
    "maxPerGame": 2,
    "maxPerMarket": 2,
    "maxSameTeamCountingOvers": 1,
    "maxComboMarkets": 1,
}
NEGATIVE_TEST_SEED = 20260504


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit the Final Player Prop Model V1 historical backtest.")
    parser.add_argument("--summary", default="exports/final-player-prop-model-v1-walk-forward.json")
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument("--board-csv", default="exports/final-player-prop-model-v1-walk-forward-board.csv")
    parser.add_argument("--daily-csv", default="exports/final-player-prop-model-v1-walk-forward-daily.csv")
    parser.add_argument("--backtest-script", default="scripts/backtest-final-player-prop-model-v1.py")
    parser.add_argument("--current-exporter", default="scripts/export-final-player-prop-model-v1.ts")
    parser.add_argument("--date-shift-explain-json", default="exports/final-player-prop-model-v1-date-shift-explain.json")
    parser.add_argument("--out-prefix", default="exports/final-player-prop-model-v1-backtest-audit")
    parser.add_argument("--sample-trials", type=int, default=1000)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: str | Path) -> str | None:
    target = Path(path)
    if not target.exists():
        return None
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_optional_json(path: str | Path) -> dict[str, Any] | None:
    target = Path(path)
    if not target.exists():
        return None
    return json.loads(target.read_text(encoding="utf-8"))


def read_csv_rows(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def clean_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def pct(wins: int, samples: int) -> float | None:
    if samples <= 0:
        return None
    return round(100.0 * wins / samples, 2)


def pct_value(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}%"


def summarize_correct(rows: list[dict[str, str]]) -> dict[str, Any]:
    samples = len(rows)
    wins = sum(1 for row in rows if truthy(row.get("correct")))
    return {"samples": samples, "wins": wins, "losses": samples - wins, "accuracyPct": pct(wins, samples)}


def check(status: str, name: str, detail: str, evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "name": name,
        "detail": detail,
        "evidence": evidence or {},
    }


def status_rollup(checks: list[dict[str, Any]]) -> dict[str, int]:
    return dict(Counter(item["status"] for item in checks))


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * q))))
    return round(ordered[index], 2)


def random_board_baseline(board_rows: list[dict[str, str]], sample_size: int, trials: int) -> dict[str, Any]:
    rng = random.Random(NEGATIVE_TEST_SEED)
    labels = [truthy(row.get("correct")) for row in board_rows]
    if not labels or sample_size <= 0:
        return {"trials": 0, "meanAccuracyPct": None, "p95AccuracyPct": None}
    trial_count = max(1, trials)
    accuracies: list[float] = []
    for _ in range(trial_count):
        wins = sum(1 for value in rng.choices(labels, k=sample_size) if value)
        accuracies.append(100.0 * wins / sample_size)
    return {
        "trials": trial_count,
        "meanAccuracyPct": round(sum(accuracies) / len(accuracies), 2),
        "p95AccuracyPct": quantile(accuracies, 0.95),
        "p99AccuracyPct": quantile(accuracies, 0.99),
    }


def bucket_name(row: dict[str, str], bucket_keys: str | tuple[str, ...]) -> str:
    if isinstance(bucket_keys, str):
        return row.get(bucket_keys, "")
    return "|".join(row.get(key, "") for key in bucket_keys)


def display_bucket(bucket_keys: str | tuple[str, ...]) -> str:
    if isinstance(bucket_keys, str):
        return bucket_keys
    return "+".join(bucket_keys)


def shuffled_by_bucket_baseline(
    selected_rows: list[dict[str, str]],
    board_rows: list[dict[str, str]],
    bucket_key: str | tuple[str, ...],
    trials: int,
) -> dict[str, Any]:
    rng = random.Random(NEGATIVE_TEST_SEED + len(display_bucket(bucket_key)))
    by_bucket: dict[str, list[bool]] = defaultdict(list)
    all_labels: list[bool] = []
    for row in board_rows:
        label = truthy(row.get("correct"))
        by_bucket[bucket_name(row, bucket_key)].append(label)
        all_labels.append(label)
    accuracies: list[float] = []
    trial_count = max(1, trials)
    for _ in range(trial_count):
        wins = 0
        for row in selected_rows:
            labels = by_bucket.get(bucket_name(row, bucket_key), []) or all_labels
            if rng.choice(labels):
                wins += 1
        accuracies.append(100.0 * wins / len(selected_rows))
    return {
        "bucket": display_bucket(bucket_key),
        "trials": trial_count,
        "meanAccuracyPct": round(sum(accuracies) / len(accuracies), 2),
        "p95AccuracyPct": quantile(accuracies, 0.95),
        "p99AccuracyPct": quantile(accuracies, 0.99),
    }


def shuffled_player_ids_preserve_date_market(
    selected_rows: list[dict[str, str]],
    board_rows: list[dict[str, str]],
    trials: int,
) -> dict[str, Any]:
    rng = random.Random(NEGATIVE_TEST_SEED + 101)
    by_date_market: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    all_by_market: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in board_rows:
        by_date_market[(row.get("date", ""), row.get("market", ""))].append(row)
        all_by_market[row.get("market", "")].append(row)
    accuracies: list[float] = []
    trial_count = max(1, trials)
    for _ in range(trial_count):
        wins = 0
        for row in selected_rows:
            candidates = by_date_market.get((row.get("date", ""), row.get("market", "")), []) or all_by_market.get(row.get("market", ""), [])
            if candidates and truthy(rng.choice(candidates).get("correct")):
                wins += 1
        accuracies.append(100.0 * wins / len(selected_rows))
    return {
        "bucket": "date+market random player",
        "trials": trial_count,
        "meanAccuracyPct": round(sum(accuracies) / len(accuracies), 2),
        "p95AccuracyPct": quantile(accuracies, 0.95),
        "p99AccuracyPct": quantile(accuracies, 0.99),
    }


def shifted_selected_labels(selected_rows: list[dict[str, str]], offset: int = 1) -> dict[str, Any]:
    ordered = sorted(selected_rows, key=lambda row: (row.get("selectedRank") or "999", row.get("date") or ""))
    dates = sorted({row.get("date", "") for row in ordered})
    rows_by_rank_date: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in ordered:
        rows_by_rank_date[(row.get("selectedRank", ""), row.get("date", ""))].append(row)
    shifted_date = {date: dates[(index + offset) % len(dates)] for index, date in enumerate(dates)}
    wins = 0
    samples = 0
    for row in ordered:
        shifted_bucket = rows_by_rank_date.get((row.get("selectedRank", ""), shifted_date.get(row.get("date", ""), "")), [])
        shifted_row = shifted_bucket[0] if shifted_bucket else None
        if shifted_row is None:
            continue
        samples += 1
        wins += int(truthy(shifted_row.get("correct")))
    return {"offsetDates": offset, "samples": samples, "wins": wins, "losses": samples - wins, "accuracyPct": pct(wins, samples)}


def explain_date_shift_warning(explain_report: dict[str, Any] | None, selected_acc: float) -> dict[str, Any]:
    if not explain_report:
        return {
            "available": False,
            "explained": False,
            "reason": "No date-shift explainer artifact found.",
        }

    strongest = explain_report.get("strongestSamePlayerMarketShift") or {}
    summary = strongest.get("summary") or {}
    availability = strongest.get("availability") or {}
    shifted_acc = clean_float(summary.get("accuracyPct"))
    coverage = clean_float(availability.get("coveragePct"))
    same_line_bucket = clean_float(availability.get("sameLineBucketPct"))
    collapse_margin = round(selected_acc - shifted_acc, 2) if shifted_acc is not None else None
    explained = (
        shifted_acc is not None
        and coverage is not None
        and coverage >= 75
        and collapse_margin is not None
        and collapse_margin >= 25
        and shifted_acc <= 70
    )
    return {
        "available": True,
        "explained": explained,
        "test": strongest.get("name"),
        "samePlayerMarketAccuracyPct": shifted_acc,
        "coveragePct": coverage,
        "sameLineBucketPct": same_line_bucket,
        "collapseMarginPct": collapse_margin,
        "thresholds": {
            "minCoveragePct": 75,
            "minCollapseMarginPct": 25,
            "maxSamePlayerMarketAccuracyPct": 70,
        },
        "reason": (
            "Selected-rank date-shift stability is explained by a stronger same-player/same-market nearby-game control."
            if explained
            else "Selected-rank date-shift stability is not explained by the same-player/same-market nearby-game control."
        ),
    }


def rolling_windows(daily_rows: list[dict[str, str]], window: int) -> dict[str, Any] | None:
    rows = [
        {
            "date": row["date"],
            "samples": int(float(row["samples"])),
            "wins": int(float(row["wins"])),
            "losses": int(float(row["losses"])),
        }
        for row in daily_rows
    ]
    if len(rows) < window:
        return None
    worst: dict[str, Any] | None = None
    for start in range(0, len(rows) - window + 1):
        chunk = rows[start : start + window]
        samples = sum(row["samples"] for row in chunk)
        wins = sum(row["wins"] for row in chunk)
        item = {
            "from": chunk[0]["date"],
            "to": chunk[-1]["date"],
            "samples": samples,
            "wins": wins,
            "losses": samples - wins,
            "accuracyPct": pct(wins, samples),
        }
        if worst is None or (item["accuracyPct"] or 0) < (worst["accuracyPct"] or 0):
            worst = item
    return worst


def concentration(rows: list[dict[str, str]], key: str, top_n: int = 8) -> dict[str, Any]:
    counts = Counter(row.get(key) or "NA" for row in rows)
    samples = len(rows)
    top = counts.most_common(top_n)
    return {
        "unique": len(counts),
        "maxSharePct": round(100.0 * top[0][1] / samples, 2) if samples and top else 0,
        "top": [{"key": name, "count": count, "sharePct": round(100.0 * count / samples, 2)} for name, count in top],
    }


def audit_folds(summary: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = []
    folds = summary.get("folds") or []
    previous_to: str | None = None
    for fold in folds:
        train_to = fold.get("trainTo")
        test_from = fold.get("testFrom")
        test_to = fold.get("testTo")
        if train_to is None or test_from is None or train_to >= test_from:
            issues.append(f"fold {fold.get('fold')} has trainTo >= testFrom")
        if test_from is None or test_to is None or test_from > test_to:
            issues.append(f"fold {fold.get('fold')} has invalid test window")
        if previous_to is not None and test_from is not None and test_from <= previous_to:
            issues.append(f"fold {fold.get('fold')} overlaps prior test window")
        previous_to = test_to or previous_to
        if int(fold.get("trainSamples") or 0) <= 0 or int(fold.get("testSamples") or 0) <= 0:
            issues.append(f"fold {fold.get('fold')} has empty train/test samples")
    return {"foldCount": len(folds), "issues": issues}


def markdown_report(report: dict[str, Any]) -> str:
    result = report["result"]
    selected = report["finalResults"]["selected"]
    full_board = report["finalResults"]["fullBoard"]
    candidate = report["finalResults"]["candidatePool"]
    lines = [
        "# Final Player Prop Model V1 Backtest Audit",
        "",
        f"Generated: {report['generatedAt']}",
        f"Model: `{report['modelId']}`",
        f"Version: `{report['modelVersion']}`",
        "",
        "## Audit Result",
        "",
        f"- Overall status: **{result['overallStatus']}**",
        f"- PASS: {result['counts'].get('PASS', 0)}",
        f"- WARN: {result['counts'].get('WARN', 0)}",
        f"- PENDING: {result['counts'].get('PENDING', 0)}",
        f"- FAIL: {result['counts'].get('FAIL', 0)}",
        "",
        "## Final Results",
        "",
        f"- Full-board accuracy: {pct_value(full_board['accuracyPct'])} ({full_board['wins']:,}-{full_board['losses']:,}, {full_board['samples']:,} rows)",
        f"- Candidate-pool accuracy: {pct_value(candidate['accuracyPct'])} ({candidate['wins']:,}-{candidate['losses']:,}, {candidate['samples']:,} rows)",
        f"- Selected-pick accuracy: {pct_value(selected['accuracyPct'])} ({selected['wins']:,}-{selected['losses']:,}, {selected['samples']:,} picks)",
        f"- Full-board coverage: {report['finalResults']['coveragePct']:.2f}%",
        f"- Avg selected picks/slate: {report['finalResults']['avgSelectedPerSlate']:.2f}",
        f"- Selected lift vs full board: {report['finalResults']['selectedLiftVsFullBoardPct']:.2f} pts",
        "",
        "## Checks",
        "",
        "| Status | Check | Detail |",
        "|---|---|---|",
    ]
    for item in report["checks"]:
        lines.append(f"| {item['status']} | {item['name']} | {item['detail']} |")
    lines.extend(
        [
            "",
            "## Negative Leakage Diagnostics",
            "",
            "| Test | Mean | P95 | P99 |",
            "|---|---:|---:|---:|",
        ]
    )
    for name, test in report["negativeLeakageTests"].items():
        if "meanAccuracyPct" in test:
            lines.append(
                f"| {name} | {pct_value(test.get('meanAccuracyPct'))} | {pct_value(test.get('p95AccuracyPct'))} | {pct_value(test.get('p99AccuracyPct'))} |"
            )
        else:
            lines.append(
                f"| {name} | {pct_value(test.get('accuracyPct'))} | - | - |"
            )
    cluster = report["clusterEvaluation"]
    lines.extend(
        [
            "",
            "## Cluster Evaluation",
            "",
            f"- Active slates: {cluster['activeSlates']}",
            f"- Winning slates: {cluster['winningSlates']}",
            f"- Losing slates: {cluster['losingSlates']}",
            f"- Worst day: {cluster['worstDay']['date']} at {pct_value(cluster['worstDay']['accuracyPct'])}",
            f"- Worst 7-day stretch: {cluster['worst7Day']['from']} to {cluster['worst7Day']['to']} at {pct_value(cluster['worst7Day']['accuracyPct'])}",
            f"- Worst 30-day stretch: {cluster['worst30Day']['from']} to {cluster['worst30Day']['to']} at {pct_value(cluster['worst30Day']['accuracyPct'])}",
            "",
            "## Claim Boundary",
            "",
            "- This audit checks the local historical walk-forward artifact for reproducibility, configuration, fold chronology, data hashes, and leakage diagnostics.",
            "- This is not independent third-party reproduction yet.",
            "- Odds, CLV, and ROI remain pending until historical market-line data is joined.",
            "- Live proof still requires locked-forward rows, market lines, settlement, and audit summaries.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    summary_path = root / args.summary
    selected_path = root / args.selected_csv
    board_path = root / args.board_csv
    daily_path = root / args.daily_csv
    backtest_script_path = root / args.backtest_script
    current_exporter_path = root / args.current_exporter
    date_shift_explain_path = root / args.date_shift_explain_json

    summary = load_json(summary_path)
    selected_rows = read_csv_rows(selected_path)
    board_rows = read_csv_rows(board_path)
    daily_rows = read_csv_rows(daily_path)
    date_shift_explain = load_optional_json(date_shift_explain_path)
    source_input = Path(summary.get("input") or "")

    checks: list[dict[str, Any]] = []
    checks.append(
        check(
            "PASS" if summary.get("modelId") == MODEL_ID and summary.get("modelVersion") == MODEL_VERSION else "FAIL",
            "MODEL_ID_AND_VERSION",
            f"{summary.get('modelId')} / {summary.get('modelVersion')}",
        )
    )
    config = summary.get("config") or {}
    config_mismatches = {key: {"expected": value, "actual": config.get(key)} for key, value in EXPECTED_CONFIG.items() if config.get(key) != value}
    checks.append(
        check(
            "PASS" if not config_mismatches else "FAIL",
            "SELECTOR_CONFIG_FROZEN",
            "Config matches Final V1 frozen selector." if not config_mismatches else f"Config mismatches: {config_mismatches}",
            {"config": config},
        )
    )

    folds_audit = audit_folds(summary)
    checks.append(
        check(
            "PASS" if not folds_audit["issues"] and folds_audit["foldCount"] > 0 else "FAIL",
            "WALK_FORWARD_TRAINING_WINDOWS",
            f"{folds_audit['foldCount']} folds; train windows precede test windows.",
            folds_audit,
        )
    )
    checks.append(
        check(
            "PASS" if summary.get("coveragePct") == 100.0 and summary.get("rowsScored") == summary.get("eligibleRows") else "WARN",
            "FULL_BOARD_COVERAGE",
            f"{summary.get('coveragePct')}% coverage across {summary.get('rowsScored')} scored rows.",
        )
    )

    selected_summary = summarize_correct(selected_rows)
    board_summary = summarize_correct(board_rows)
    summary_selected = ((summary.get("selected") or {}).get("overall") or {})
    checks.append(
        check(
            "PASS"
            if selected_summary["samples"] == summary_selected.get("samples")
            and selected_summary["wins"] == summary_selected.get("wins")
            and selected_summary["losses"] == summary_selected.get("losses")
            else "FAIL",
            "REPORTED_RESULTS_RECOMPUTE",
            f"Selected recompute {selected_summary['wins']}-{selected_summary['losses']} on {selected_summary['samples']} rows.",
            {"selectedCsv": selected_summary, "summaryJson": summary_selected},
        )
    )

    source_exists = source_input.exists()
    checks.append(
        check(
            "PASS" if source_exists else "FAIL",
            "SOURCE_INPUT_AVAILABLE",
            f"Historical source input {'exists' if source_exists else 'is missing'}: {source_input}",
        )
    )

    source_name = str(source_input).lower()
    checks.append(
        check(
            "PENDING",
            "THIRD_PARTY_RAW_DATA_REPLAY",
            "Current artifact is built from local generated V9/details exports; independent third-party raw data replay is not attached yet.",
            {"sourceInput": str(source_input), "sourceLooksLocal": "exports" in source_name},
        )
    )

    source_cols = set(board_rows[0].keys()) if board_rows else set()
    odds_cols = {"odds", "lineAtLock", "closingLine", "closingOdds", "clv", "roi", "profitLossUnits"}
    checks.append(
        check(
            "PASS" if source_cols.intersection(odds_cols) else "PENDING",
            "ODDS_CLV_ROI_COLUMNS",
            "Odds/CLV/ROI columns are present." if source_cols.intersection(odds_cols) else "Backtest outputs accuracy only; odds, CLV, and ROI are pending market-line joins.",
            {"foundColumns": sorted(source_cols.intersection(odds_cols))},
        )
    )

    code_text = backtest_script_path.read_text(encoding="utf-8") if backtest_script_path.exists() else ""
    timestamp_safe_markers = [
        'train_mask = eligible_top & df["gameDateEt"].lt(fold_dates[0])',
        'df.loc[test_mask, "metaProbCorrect"] = pipeline.predict_proba',
        "gate.attach_prior_reliability(df, dates, num_cols)",
        "gate.score_walk_forward(df, dates, folds",
    ]
    missing_markers = [marker for marker in timestamp_safe_markers if marker not in code_text]
    checks.append(
        check(
            "PASS" if not missing_markers else "WARN",
            "AS_OF_REPLAY_MARKERS",
            "Backtest source contains expanding-window and prior-date scoring markers."
            if not missing_markers
            else f"Missing static markers: {missing_markers}",
        )
    )

    score_only_cols = {"baseScore", "correlationPenalty", "finalScore", "estimatedAccuracyPriorPct"}
    postgame_cols = {"actualValue", "actualSide", "correct"}
    checks.append(
        check(
            "PASS" if score_only_cols.issubset(source_cols) and postgame_cols.issubset(source_cols) else "WARN",
            "POSTGAME_FIELDS_SEPARATED_FOR_GRADING",
            "Output contains score columns and postgame grading columns separately. Static audit cannot prove external as-of integrity.",
            {"scoreColumns": sorted(score_only_cols), "gradingColumns": sorted(postgame_cols)},
        )
    )

    random_baseline = random_board_baseline(board_rows, selected_summary["samples"], args.sample_trials)
    by_market = shuffled_by_bucket_baseline(selected_rows, board_rows, "market", args.sample_trials)
    by_slate = shuffled_by_bucket_baseline(selected_rows, board_rows, "date", args.sample_trials)
    by_player_market = shuffled_by_bucket_baseline(selected_rows, board_rows, ("playerName", "market"), args.sample_trials)
    same_market_random = shuffled_by_bucket_baseline(selected_rows, board_rows, "market", args.sample_trials)
    shuffled_player_ids = shuffled_player_ids_preserve_date_market(selected_rows, board_rows, args.sample_trials)
    shifted_plus_1 = shifted_selected_labels(selected_rows, 1)
    shifted_minus_1 = shifted_selected_labels(selected_rows, -1)
    shifted_plus_3 = shifted_selected_labels(selected_rows, 3)
    shifted_plus_7 = shifted_selected_labels(selected_rows, 7)
    negative_tests = {
        "random_board_sample": random_baseline,
        "random_same_market_outcomes": same_market_random,
        "shuffle_labels_by_market": by_market,
        "shuffle_labels_by_slate": by_slate,
        "shuffle_labels_by_player_market": by_player_market,
        "shuffle_player_ids_preserve_date_market": shuffled_player_ids,
        "shift_selected_labels_plus_1_date": {
            **shifted_plus_1,
            "diagnosticOnly": True,
            "note": "Selected-only date shifting is a stability diagnostic, not a strict label-randomization test.",
        },
        "shift_selected_labels_minus_1_date": {
            **shifted_minus_1,
            "diagnosticOnly": True,
            "note": "Selected-only date shifting is a stability diagnostic, not a strict label-randomization test.",
        },
        "shift_selected_labels_plus_3_dates": {
            **shifted_plus_3,
            "diagnosticOnly": True,
            "note": "Selected-only date shifting is a stability diagnostic, not a strict label-randomization test.",
        },
        "shift_selected_labels_plus_7_dates": {
            **shifted_plus_7,
            "diagnosticOnly": True,
            "note": "Selected-only date shifting is a stability diagnostic, not a strict label-randomization test.",
        },
    }
    selected_acc = selected_summary["accuracyPct"] or 0
    strict_negative_p99 = max(
        value.get("p99AccuracyPct") or 0
        for value in (random_baseline, by_market, by_slate, by_player_market, shuffled_player_ids)
    )
    checks.append(
        check(
            "PASS" if selected_acc > strict_negative_p99 else "WARN",
            "STRICT_NEGATIVE_LABEL_SHUFFLES",
            f"Selected accuracy {selected_acc:.2f}% vs strongest strict shuffle P99 {strict_negative_p99:.2f}%.",
            {
                "random_board_sample": random_baseline,
                "random_same_market_outcomes": same_market_random,
                "shuffle_labels_by_market": by_market,
                "shuffle_labels_by_slate": by_slate,
                "shuffle_labels_by_player_market": by_player_market,
                "shuffle_player_ids_preserve_date_market": shuffled_player_ids,
            },
        )
    )
    shifted_tests = [shifted_plus_1, shifted_minus_1, shifted_plus_3, shifted_plus_7]
    shifted_acc = max((item.get("accuracyPct") or 0) for item in shifted_tests)
    shifted_summary = {
        f"offset_{item['offsetDates']}": item
        for item in shifted_tests
    }
    date_shift_explanation = explain_date_shift_warning(date_shift_explain, selected_acc)
    selected_rank_shift_warns = shifted_acc >= selected_acc - 1
    date_shift_status = "WARN" if selected_rank_shift_warns and not date_shift_explanation["explained"] else "PASS"
    date_shift_name = "DATE_SHIFT_DIAGNOSTIC_EXPLAINED" if selected_rank_shift_warns and date_shift_explanation["explained"] else "DATE_SHIFT_DIAGNOSTIC"
    if selected_rank_shift_warns and date_shift_explanation["explained"]:
        date_shift_detail = (
            f"Selected-rank date shift stayed high at {shifted_acc:.2f}% vs actual {selected_acc:.2f}%, "
            f"but stronger same-player/same-market controls collapsed to {date_shift_explanation.get('samePlayerMarketAccuracyPct'):.2f}% "
            f"with {date_shift_explanation.get('coveragePct'):.2f}% coverage. Diagnostic retired as explained."
        )
    elif selected_rank_shift_warns:
        date_shift_detail = (
            f"Strongest selected-only date shift scored {shifted_acc:.2f}% vs actual selected {selected_acc:.2f}%. "
            "Treat as a stability warning, not proof of leakage."
        )
    else:
        date_shift_detail = (
            f"Strongest selected-only date shift scored {shifted_acc:.2f}% vs actual selected {selected_acc:.2f}%, "
            "below the warning threshold."
        )
    checks.append(
        check(
            date_shift_status,
            date_shift_name,
            date_shift_detail,
            {
                "selectedRankDateShift": shifted_summary,
                "samePlayerSameMarketExplanation": date_shift_explanation,
                "explainerArtifact": str(date_shift_explain_path),
            },
        )
    )

    checks.append(
        check(
            "PENDING",
            "INDEPENDENT_RERUN",
            "No external auditor reproduction bundle has been recorded yet.",
        )
    )

    hashes = {
        "summary": sha256_file(summary_path),
        "selectedCsv": sha256_file(selected_path),
        "boardCsv": sha256_file(board_path),
        "dailyCsv": sha256_file(daily_path),
        "sourceInput": sha256_file(source_input) if source_exists else None,
        "backtestScript": sha256_file(backtest_script_path),
        "currentExporter": sha256_file(current_exporter_path),
    }
    checks.append(
        check(
            "PASS" if all(value for key, value in hashes.items() if key != "currentExporter") else "FAIL",
            "DATA_AND_CODE_HASHES",
            "Data/code hashes recorded for reproducibility.",
            hashes,
        )
    )

    daily_summaries = [
        {
            "date": row["date"],
            "samples": int(float(row["samples"])),
            "wins": int(float(row["wins"])),
            "losses": int(float(row["losses"])),
            "accuracyPct": clean_float(row.get("accuracyPct")),
        }
        for row in daily_rows
    ]
    winning_slates = sum(1 for row in daily_summaries if row["wins"] > row["losses"])
    losing_slates = sum(1 for row in daily_summaries if row["wins"] < row["losses"])
    push_slates = len(daily_summaries) - winning_slates - losing_slates
    worst_day = min(daily_summaries, key=lambda row: row["accuracyPct"] if row["accuracyPct"] is not None else 999)
    cluster = {
        "activeSlates": len(daily_summaries),
        "winningSlates": winning_slates,
        "losingSlates": losing_slates,
        "breakEvenSlates": push_slates,
        "worstDay": worst_day,
        "worst7Day": rolling_windows(daily_rows, 7),
        "worst30Day": rolling_windows(daily_rows, 30),
        "playerConcentration": concentration(selected_rows, "playerName"),
        "teamConcentration": concentration(selected_rows, "teamCode"),
        "gameConcentration": concentration(selected_rows, "gameKey"),
        "marketConcentration": concentration(selected_rows, "market"),
    }

    counts = status_rollup(checks)
    if counts.get("FAIL", 0):
        overall_status = "FAIL"
    elif counts.get("WARN", 0):
        overall_status = "WARN"
    elif counts.get("PENDING", 0):
        overall_status = "PENDING"
    else:
        overall_status = "PASS"
    report = {
        "generatedAt": utc_now(),
        "modelId": summary.get("modelId"),
        "modelVersion": summary.get("modelVersion"),
        "result": {"overallStatus": overall_status, "counts": counts},
        "finalResults": {
            "coveragePct": summary.get("coveragePct"),
            "fullBoard": ((summary.get("fullBoard") or {}).get("overall") or board_summary),
            "candidatePool": ((summary.get("candidatePool") or {}).get("overall") or {}),
            "selected": selected_summary,
            "avgSelectedPerSlate": summary.get("avgSelectedPerSlate"),
            "selectedLiftVsFullBoardPct": summary.get("selectedLiftVsFullBoardPct"),
            "last30": {
                "fullBoard": ((summary.get("fullBoard") or {}).get("last30") or {}),
                "candidatePool": ((summary.get("candidatePool") or {}).get("last30") or {}),
                "selected": ((summary.get("selected") or {}).get("last30") or {}),
            },
            "last14": {
                "fullBoard": ((summary.get("fullBoard") or {}).get("last14") or {}),
                "candidatePool": ((summary.get("candidatePool") or {}).get("last14") or {}),
                "selected": ((summary.get("selected") or {}).get("last14") or {}),
            },
        },
        "checks": checks,
        "hashes": hashes,
        "negativeLeakageTests": negative_tests,
        "clusterEvaluation": cluster,
        "claimBoundary": {
            "backtestValidity": "Auditable local historical walk-forward artifact with hashes and negative diagnostics.",
            "notYetProven": [
                "Independent third-party raw-data replay",
                "Historical odds, CLV, and ROI grading",
                "External auditor rerun",
                "Live locked-forward proof",
            ],
        },
    }

    out_prefix = root / args.out_prefix
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = Path(f"{out_prefix}.json")
    md_path = Path(f"{out_prefix}.md")
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(markdown_report(report) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "overallStatus": overall_status,
                "counts": counts,
                "selectedAccuracyPct": selected_summary["accuracyPct"],
                "fullBoardAccuracyPct": report["finalResults"]["fullBoard"].get("accuracyPct"),
                "selectedPicks": selected_summary["samples"],
                "strictNegativeShuffleP99Pct": strict_negative_p99,
                "dateShiftStrongestDiagnosticPct": shifted_acc,
                "outputs": {"json": str(json_path), "md": str(md_path)},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
