from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MODEL_ID = "final-player-prop-model-v1"
MODEL_VERSION = "2026-05-04-meta-correlation-v1"
REQUIRED_RESULT_COLUMNS = {"playerName", "pts", "reb", "ast", "threes"}
MARKET_FORMULAS = {
    "PTS": ("pts",),
    "REB": ("reb",),
    "AST": ("ast",),
    "THREES": ("threes",),
    "PR": ("pts", "reb"),
    "PA": ("pts", "ast"),
    "RA": ("reb", "ast"),
    "PRA": ("pts", "reb", "ast"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit whether Final V1 has enough third-party as-of data to independently replay/regrade the backtest."
    )
    parser.add_argument("--selected-csv", default="exports/final-player-prop-model-v1-walk-forward-selected.csv")
    parser.add_argument("--market-proof-json", default="exports/final-player-prop-model-v1-market-proof.json")
    parser.add_argument(
        "--external-boxscores-csv",
        default="data/external/final-player-prop-model-v1/external-boxscores.csv",
        help="Third-party box-score file with date, playerName, pts, reb, ast, threes.",
    )
    parser.add_argument(
        "--manifest",
        default="data/external/final-player-prop-model-v1/asof-replay-manifest.json",
        help="Source manifest for external odds/stat data. Optional but required for a full PASS.",
    )
    parser.add_argument("--out-prefix", default="exports/final-player-prop-model-v1-third-party-asof-replay")
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


def read_csv(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_json(path: str | Path) -> dict[str, Any] | None:
    target = Path(path)
    if not target.exists():
        return None
    return json.loads(target.read_text(encoding="utf-8"))


def normalize_name(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace(".", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def clean_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def boolish(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y", "win"}


def pct(numerator: int | float, denominator: int | float) -> float | None:
    if denominator <= 0:
        return None
    return round(100.0 * numerator / denominator, 2)


def pct_fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.2f}%"


def round_or_none(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def check(status: str, name: str, detail: str, evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"status": status, "name": name, "detail": detail, "evidence": evidence or {}}


def result_for_side(side: str, line: float | None, actual: float | None) -> str:
    if line is None or actual is None:
        return "VOID"
    if actual == line:
        return "PUSH"
    if side.upper() == "OVER":
        return "WIN" if actual > line else "LOSS"
    if side.upper() == "UNDER":
        return "WIN" if actual < line else "LOSS"
    return "VOID"


def external_actual(row: dict[str, str], market: str) -> float | None:
    fields = MARKET_FORMULAS.get(market.upper())
    if not fields:
        return None
    total = 0.0
    for field in fields:
        value = clean_float(row.get(field))
        if value is None:
            return None
        total += value
    return total


def index_boxscores(rows: list[dict[str, str]]) -> dict[tuple[str, str], list[dict[str, str]]]:
    indexed: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        date = row.get("date") or row.get("gameDateEt") or row.get("slateDate") or ""
        player = row.get("playerName") or row.get("player") or ""
        if date and player:
            indexed[(date, normalize_name(player))].append(row)
    return indexed


def regrade_selected_with_boxscores(
    selected: list[dict[str, str]],
    boxscores: list[dict[str, str]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    box_index = index_boxscores(boxscores)
    rows: list[dict[str, Any]] = []
    matched = 0
    actual_agree = 0
    result_agree = 0
    external_wins = 0
    external_losses = 0
    external_pushes = 0

    for pick in selected:
        candidates = box_index.get((pick.get("date", ""), normalize_name(pick.get("playerName", ""))), [])
        team = (pick.get("teamCode") or "").upper()
        game_key = pick.get("gameKey") or ""
        preferred = [
            row
            for row in candidates
            if (not team or (row.get("teamCode") or row.get("team") or "").upper() == team)
            and (not game_key or not row.get("gameKey") or row.get("gameKey") == game_key)
        ]
        chosen = preferred[0] if preferred else (candidates[0] if candidates else None)
        market = pick.get("market", "").upper()
        model_actual = clean_float(pick.get("actualValue"))
        model_line = clean_float(pick.get("line"))
        external_value = external_actual(chosen, market) if chosen else None
        external_result = result_for_side(pick.get("side", ""), model_line, external_value)
        model_result = "WIN" if boolish(pick.get("correct")) else "LOSS"

        if chosen:
            matched += 1
        if model_actual is not None and external_value is not None and abs(model_actual - external_value) < 1e-9:
            actual_agree += 1
        if external_result in {"WIN", "LOSS"}:
            if external_result == "WIN":
                external_wins += 1
            else:
                external_losses += 1
            if external_result == model_result:
                result_agree += 1
        if external_result == "PUSH":
            external_pushes += 1

        rows.append(
            {
                "date": pick.get("date", ""),
                "playerName": pick.get("playerName", ""),
                "teamCode": pick.get("teamCode", ""),
                "gameKey": game_key,
                "market": market,
                "side": pick.get("side", ""),
                "line": model_line,
                "modelActualValue": model_actual,
                "externalActualValue": round_or_none(external_value, 4),
                "modelCorrect": boolish(pick.get("correct")),
                "externalResult": external_result if chosen else "MISSING",
                "actualValueAgrees": model_actual is not None and external_value is not None and abs(model_actual - external_value) < 1e-9,
                "resultAgrees": external_result == model_result if external_result in {"WIN", "LOSS"} else False,
                "externalProvider": (chosen or {}).get("provider") or (chosen or {}).get("source") or "",
                "externalSourceUrl": (chosen or {}).get("sourceUrl") or "",
            }
        )

    graded = external_wins + external_losses
    summary = {
        "selectedPicks": len(selected),
        "externalBoxscoreRows": len(boxscores),
        "matchedPicks": matched,
        "matchCoveragePct": pct(matched, len(selected)) or 0.0,
        "actualValueAgreementPct": pct(actual_agree, matched) if matched else None,
        "resultAgreementPct": pct(result_agree, graded) if graded else None,
        "externalWins": external_wins,
        "externalLosses": external_losses,
        "externalPushes": external_pushes,
        "externalAccuracyPct": pct(external_wins, graded),
    }
    return summary, rows


def validate_manifest(manifest: dict[str, Any] | None, manifest_path: Path) -> dict[str, Any]:
    if manifest is None:
        return {
            "status": "PENDING",
            "detail": "No as-of replay manifest exists yet.",
            "path": str(manifest_path.resolve()),
        }
    required = ["provider", "createdAtUtc", "lineFiles", "boxscoreFiles", "asOfPolicy"]
    missing = [field for field in required if not manifest.get(field)]
    if missing:
        return {
            "status": "WARN",
            "detail": "Manifest exists but is missing required fields.",
            "missing": missing,
            "path": str(manifest_path.resolve()),
        }
    return {
        "status": "PASS",
        "detail": "Manifest has required top-level provenance fields.",
        "path": str(manifest_path.resolve()),
    }


def write_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "date",
        "playerName",
        "teamCode",
        "gameKey",
        "market",
        "side",
        "line",
        "modelActualValue",
        "externalActualValue",
        "modelCorrect",
        "externalResult",
        "actualValueAgrees",
        "resultAgrees",
        "externalProvider",
        "externalSourceUrl",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def rollup_status(checks: list[dict[str, Any]]) -> str:
    statuses = {item["status"] for item in checks}
    if "FAIL" in statuses:
        return "FAIL"
    if "PENDING" in statuses:
        return "PENDING"
    if "WARN" in statuses:
        return "WARN"
    return "PASS"


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# Final V1 Third-Party As-Of Replay Audit",
        "",
        f"Generated: {report['generatedAt']}",
        f"Overall status: **{report['overallStatus']}**",
        "",
        "## Checks",
        "",
        "| Status | Check | Detail |",
        "|---|---|---|",
    ]
    for item in report["checks"]:
        lines.append(f"| {item['status']} | {item['name']} | {item['detail']} |")

    lines.extend(["", "## External Box-Score Replay", "", "| Metric | Value |", "|---|---:|"])
    box = report["externalBoxscoreReplay"]
    for key in [
        "selectedPicks",
        "externalBoxscoreRows",
        "matchedPicks",
        "matchCoveragePct",
        "actualValueAgreementPct",
        "resultAgreementPct",
        "externalAccuracyPct",
    ]:
        value = box.get(key)
        if key.endswith("Pct"):
            rendered = pct_fmt(value)
        else:
            rendered = str(value)
        lines.append(f"| {key} | {rendered} |")

    lines.extend(["", "## Interpretation", ""])
    lines.extend(f"- {item}" for item in report["interpretation"])
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    selected_path = Path(args.selected_csv)
    market_proof_path = Path(args.market_proof_json)
    boxscore_path = Path(args.external_boxscores_csv)
    manifest_path = Path(args.manifest)
    out_prefix = Path(args.out_prefix)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    checks: list[dict[str, Any]] = []
    selected = read_csv(selected_path) if selected_path.exists() else []
    checks.append(
        check(
            "PASS" if selected_path.exists() else "FAIL",
            "SELECTED_BACKTEST_FILE",
            "Selected-pick walk-forward file is present." if selected_path.exists() else "Selected-pick walk-forward file is missing.",
            {"path": str(selected_path.resolve()), "sha256": sha256_file(selected_path), "rows": len(selected)},
        )
    )

    market_proof = load_json(market_proof_path)
    if market_proof is None:
        checks.append(check("PENDING", "MARKET_PROOF_REPORT", "Run the market-proof command before this replay audit.", {"path": str(market_proof_path.resolve())}))
    else:
        market_metrics = market_proof.get("metrics", {})
        asof_coverage = market_metrics.get("asOfTimestampCoveragePct") or 0
        close_coverage = market_metrics.get("closingLineCoveragePct") or 0
        checks.append(
            check(
                "PASS" if market_metrics.get("strictValidOddsMatches", 0) else "WARN",
                "THIRD_PARTY_MARKET_LINES",
                "External market-line report exists and found strict line/odds matches."
                if market_metrics.get("strictValidOddsMatches", 0)
                else "Market-line report exists but found no strict line/odds matches.",
                market_metrics,
            )
        )
        checks.append(
            check(
                "PASS" if asof_coverage >= 95 else "PENDING",
                "MARKET_LINE_AS_OF_TIMESTAMPS",
                "Line timestamps cover enough matched rows."
                if asof_coverage >= 95
                else "Matched market lines do not yet prove as-of timing with snapshot/game-time timestamps.",
                {"asOfTimestampCoveragePct": asof_coverage},
            )
        )
        checks.append(
            check(
                "PASS" if close_coverage >= 80 else "PENDING",
                "CLOSING_LINE_CLV_FIELDS",
                "Closing lines/odds cover enough matched rows."
                if close_coverage >= 80
                else "Closing line/odds fields are missing or sparse, so CLV remains pending.",
                {"closingLineCoveragePct": close_coverage},
            )
        )

    manifest = load_json(manifest_path)
    manifest_status = validate_manifest(manifest, manifest_path)
    checks.append(check(manifest_status["status"], "AS_OF_REPLAY_MANIFEST", manifest_status["detail"], manifest_status))

    box_rows = read_csv(boxscore_path) if boxscore_path.exists() else []
    if not boxscore_path.exists():
        checks.append(
            check(
                "PENDING",
                "EXTERNAL_BOXSCORE_FILE",
                "External box-score file is missing; independent result replay cannot run yet.",
                {"path": str(boxscore_path.resolve())},
            )
        )
        box_summary = {
            "selectedPicks": len(selected),
            "externalBoxscoreRows": 0,
            "matchedPicks": 0,
            "matchCoveragePct": 0.0,
            "actualValueAgreementPct": None,
            "resultAgreementPct": None,
            "externalWins": 0,
            "externalLosses": 0,
            "externalPushes": 0,
            "externalAccuracyPct": None,
        }
        replay_rows: list[dict[str, Any]] = []
    else:
        fieldnames = set(box_rows[0].keys()) if box_rows else set()
        missing_columns = sorted(REQUIRED_RESULT_COLUMNS - fieldnames)
        if "date" not in fieldnames and "gameDateEt" not in fieldnames:
            missing_columns.append("date|gameDateEt")
        checks.append(
            check(
                "PASS" if not missing_columns else "FAIL",
                "EXTERNAL_BOXSCORE_SCHEMA",
                "External box-score schema has required stat fields."
                if not missing_columns
                else "External box-score file is missing required stat fields.",
                {"missingColumns": missing_columns, "path": str(boxscore_path.resolve()), "sha256": sha256_file(boxscore_path)},
            )
        )
        box_summary, replay_rows = regrade_selected_with_boxscores(selected, box_rows)
        checks.append(
            check(
                "PASS" if (box_summary["matchCoveragePct"] or 0) >= 95 else "WARN",
                "EXTERNAL_BOXSCORE_MATCH_COVERAGE",
                "External box-score rows cover nearly all selected picks."
                if (box_summary["matchCoveragePct"] or 0) >= 95
                else "External box-score rows do not yet cover enough selected picks.",
                box_summary,
            )
        )
        checks.append(
            check(
                "PASS" if (box_summary["actualValueAgreementPct"] or 0) >= 99 else "WARN",
                "EXTERNAL_RESULT_AGREEMENT",
                "External box-score recomputation agrees with internal actualValue fields."
                if (box_summary["actualValueAgreementPct"] or 0) >= 99
                else "External box-score recomputation does not yet fully agree with internal actualValue fields.",
                box_summary,
            )
        )

    report = {
        "generatedAt": utc_now(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "overallStatus": rollup_status(checks),
        "inputs": {
            "selectedCsv": str(selected_path.resolve()),
            "marketProofJson": str(market_proof_path.resolve()),
            "externalBoxscoresCsv": str(boxscore_path.resolve()),
            "manifest": str(manifest_path.resolve()),
        },
        "checks": checks,
        "statusCounts": dict(Counter(item["status"] for item in checks)),
        "externalBoxscoreReplay": box_summary,
        "interpretation": [
            "This command is intentionally strict: missing third-party box scores, missing as-of timestamps, or missing closing lines keep the audit PENDING.",
            "A PASS requires independent result replay plus market lines with timestamp evidence that the snapshots were available before game start.",
            "The command does not claim third-party as-of replay until external raw data and provenance are present.",
        ],
    }

    json_path = out_prefix.with_suffix(".json")
    md_path = out_prefix.with_suffix(".md")
    csv_path = out_prefix.with_suffix(".csv")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(markdown_report(report), encoding="utf-8")
    if replay_rows:
        write_rows(csv_path, replay_rows)

    print(
        json.dumps(
            {
                "overallStatus": report["overallStatus"],
                "statusCounts": report["statusCounts"],
                "externalBoxscoreReplay": box_summary,
                "outputs": {"json": str(json_path), "md": str(md_path), "csv": str(csv_path) if replay_rows else None},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
