"""Fit the board-side calibration (lib/snapshot/boardSideCalibration.ts) from a season replay.

Input is the CSV from scripts/replay-board-side-season.ts. Every row is graded at its consensus line;
pushes are dropped. The report shows the shipped (frozen) model's holdout hit rate and a weekly
walk-forward refit for comparison. Both use only rows before each graded date. The in-season refit
strength (refitLambda) is chosen on the month before the holdout and then reported on the holdout.
The final coefficients are fit on every row and, with --write, replace the generated block in the TS
module.

python scripts/fit-board-side-calibration.py --replay board-side-replay.csv [--holdout-from 2026-01-01] [--write]
"""
import argparse
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss

MARKETS = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"]
SCALE = {"PTS": 6.0, "REB": 2.5, "AST": 2.0, "THREES": 1.2, "PRA": 8.0, "PA": 7.0, "PR": 7.0, "RA": 3.5}
MODULE = Path(__file__).resolve().parents[1] / "lib" / "snapshot" / "boardSideCalibration.ts"
BLOCK = re.compile(r"// <generated:board-side-calibration>\n.*?// </generated:board-side-calibration>\n", re.S)


def implied(odds: pd.Series) -> np.ndarray:
    odds = odds.astype(float).to_numpy()
    out = np.full(odds.shape, np.nan)
    neg, pos = odds <= -100, odds >= 100
    out[neg] = -odds[neg] / (-odds[neg] + 100)
    out[pos] = 100 / (odds[pos] + 100)
    return out


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df[df.actual != df.line].dropna(subset=["projection", "line", "actual"]).copy()
    df["over"] = (df.actual > df.line).astype(int)
    over, under = implied(df.overPrice), implied(df.underPrice)
    same_line = ((df.overLine == df.line) & (df.underLine == df.line)).to_numpy()
    total = over + under
    usable = same_line & np.isfinite(total) & (total > 0.98) & (total < 1.15)
    df["marketProbability"] = np.where(usable, over / np.where(usable, total, 1), np.nan)
    return df.sort_values(["dateEt", "playerId", "market"]).reset_index(drop=True)


def features(df: pd.DataFrame) -> np.ndarray:
    gap = (df.projection.to_numpy() - df.line.to_numpy()) / df.market.map(SCALE).to_numpy()
    probability = df.marketProbability.to_numpy()
    priced = np.isfinite(probability)
    clipped = np.clip(np.nan_to_num(probability, nan=0.5), 0.02, 0.98)
    return np.c_[gap, np.where(priced, np.log(clipped / (1 - clipped)), 0.0), priced.astype(float)]


def fit(X: np.ndarray, y: np.ndarray) -> LogisticRegression:
    return LogisticRegression(C=1.0, max_iter=1000).fit(X, y)


def predict(df: pd.DataFrame, X: np.ndarray, train: np.ndarray) -> np.ndarray:
    p = np.full(len(df), np.nan)
    for market in MARKETS:
        rows = (df.market == market).to_numpy()
        p[rows] = fit(X[rows & train], df.over.to_numpy()[rows & train]).predict_proba(X[rows])[:, 1]
    return p


def walk_forward(df: pd.DataFrame, X: np.ndarray, refit_days: int = 7) -> np.ndarray:
    p = np.full(len(df), np.nan)
    dates = df.dateEt.to_numpy()
    for market in MARKETS:
        rows = (df.market == market).to_numpy()
        model, fitted_on = None, None
        for date in sorted(set(dates[rows])):
            if fitted_on is None or (pd.Timestamp(date) - pd.Timestamp(fitted_on)).days >= refit_days:
                train = rows & (dates < date)
                if train.sum() >= 400:
                    model, fitted_on = fit(X[train], df.over.to_numpy()[train]), date
            today = rows & (dates == date)
            if model is not None:
                p[today] = model.predict_proba(X[today])[:, 1]
    return p


def hit(side: np.ndarray, y: np.ndarray, mask: np.ndarray) -> str:
    return f"{100 * (side[mask] == y[mask]).mean():6.2f}% (n={int(mask.sum()):,})"


REFIT_LAMBDAS = [30000, 10000, 3000, 1000, 300, 100]


def map_fit(X: np.ndarray, y: np.ndarray, prior: np.ndarray, lam: float, iters: int = 25) -> np.ndarray:
    """Same objective as refitBoardSideMarkets: log-loss + lam/2 * ||beta - prior||^2 (beta[0] = intercept)."""
    Xi = np.c_[np.ones(len(X)), X]
    beta = prior.copy()
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Xi @ beta))
        grad = Xi.T @ (p - y) + lam * (beta - prior)
        hess = (Xi * (p * (1 - p))[:, None]).T @ Xi + lam * np.eye(len(beta))
        step = np.linalg.solve(hess, grad)
        beta -= step
        if np.abs(step).max() < 1e-8:
            break
    return beta


def in_season_refit(df: pd.DataFrame, X: np.ndarray, start: str, end: str, lam: float | None) -> tuple[np.ndarray, np.ndarray]:
    """Prior fit before `start`; then refit daily on rows from `start` only, as the board does in-season."""
    y = df.over.to_numpy()
    dates = df.dateEt.to_numpy()
    p = np.full(len(df), np.nan)
    for market in MARKETS:
        rows = (df.market == market).to_numpy()
        model = fit(X[rows & (dates < start)], y[rows & (dates < start)])
        prior = np.r_[model.intercept_, model.coef_[0]]
        beta = prior
        for date in sorted(set(dates[rows & (dates >= start) & (dates < end)])):
            season = rows & (dates >= start) & (dates < date)
            if lam is not None and season.any():
                beta = map_fit(X[season], y[season], prior, lam)
            today = rows & (dates == date)
            p[today] = 1 / (1 + np.exp(-(np.c_[np.ones(today.sum()), X[today]] @ beta)))
    return p, (dates >= start) & (dates < end)


def choose_refit_lambda(df: pd.DataFrame, X: np.ndarray, holdout_from: str) -> int:
    """Rehearse on the month before the holdout (prior: everything earlier); report the holdout once."""
    y = df.over.to_numpy()
    rehearsal_start = (pd.Timestamp(holdout_from) - pd.DateOffset(months=1)).strftime("%Y-%m-%d")
    print(f"\nIn-season refit, lambda rehearsal on {rehearsal_start}..{holdout_from}:")
    best = None
    for lam in REFIT_LAMBDAS:
        p, window = in_season_refit(df, X, rehearsal_start, holdout_from, lam)
        loss = log_loss(y[window], p[window])
        print(f"  lambda {lam:>6}  log-loss {loss:.5f}  hit {hit(p > 0.5, y, window)}")
        if best is None or loss < best[1]:
            best = (lam, loss)
    lam = best[0]
    frozen, window = in_season_refit(df, X, holdout_from, "9999-12-31", None)
    refit, _ = in_season_refit(df, X, holdout_from, "9999-12-31", lam)
    print(f"Holdout, season rows from {holdout_from} only: frozen prior {hit(frozen > 0.5, y, window)}  "
          f"daily refit (lambda {lam}) {hit(refit > 0.5, y, window)}")
    return lam


def probability_shrink(p: np.ndarray, y: np.ndarray) -> float:
    """Least-squares k in E[over] - 0.5 = k * (P(over) - 0.5); the side is unchanged by it."""
    centred = p - 0.5
    return float(np.clip(np.dot(centred, y - 0.5) / np.dot(centred, centred), 0.0, 1.0))


def report(df: pd.DataFrame, X: np.ndarray, holdout_from: str) -> float:
    y = df.over.to_numpy()
    hold = (df.dateEt >= holdout_from).to_numpy()
    tune = ~hold
    priced = np.isfinite(df.marketProbability.to_numpy())
    print(f"Rows {len(df):,} ({df.dateEt.min()}..{df.dateEt.max()}), overs {100 * y.mean():.2f}%, priced {100 * priced.mean():.1f}%")
    print(f"Holdout: dates >= {holdout_from}\n")
    frozen = predict(df, X, tune)
    rolling = walk_forward(df, X)
    rolling_side = np.where(np.isnan(rolling), frozen > 0.5, rolling > 0.5)
    rules = {
        "raw projection sign (old board side)": df.rawProjection.to_numpy() > df.line.to_numpy(),
        "corrected projection sign": df.projection.to_numpy() > df.line.to_numpy(),
        "always UNDER": np.zeros(len(df), bool),
        "calibrated, frozen before holdout (ships)": frozen > 0.5,
        "calibrated, weekly walk-forward refit": rolling_side,
    }
    print(f"{'Side rule':44} {'Holdout':>20} {'Holdout priced':>22} {'Holdout unpriced':>22}")
    for name, side in rules.items():
        print(f"{name:44} {hit(side, y, hold):>20} {hit(side, y, hold & priced):>22} {hit(side, y, hold & ~priced):>22}")
    favourite = df.marketProbability.to_numpy() > 0.5
    print(f"{'market favourite':44} {'':>20} {hit(favourite, y, hold & priced):>22}")
    shrink = probability_shrink(frozen[hold], y[hold])
    print(f"\nFrozen model calibration on the holdout (P of the chosen side), shrink k = {shrink:.3f}:")
    confidence = np.maximum(frozen, 1 - frozen)
    shrunk = 0.5 + shrink * (confidence - 0.5)
    side = frozen > 0.5
    for low, high in [(0.5, 0.52), (0.52, 0.55), (0.55, 0.6), (0.6, 0.65), (0.65, 1.01)]:
        band = hold & (confidence >= low) & (confidence < high)
        if band.any():
            print(f"  [{low:.2f}, {min(high, 1):.2f})  mean P {100 * confidence[band].mean():5.2f}%  "
                  f"shrunk {100 * shrunk[band].mean():5.2f}%  hit {hit(side, y, band)}")
    print("\nHoldout by market (frozen calibrated vs raw projection sign):")
    for market in MARKETS:
        rows = hold & (df.market == market).to_numpy()
        print(f"  {market:6} {hit(side, y, rows)}  raw {hit(rules['raw projection sign (old board side)'], y, rows)}")
    return shrink


def generated_block(df: pd.DataFrame, X: np.ndarray, version: str, shrink: float, refit_lambda: int) -> str:
    lines = [
        "// <generated:board-side-calibration>",
        "export const BOARD_SIDE_CALIBRATION = {",
        f'  version: "{version}",',
        f'  fitFrom: "{df.dateEt.min()}",',
        f'  fitTo: "{df.dateEt.max()}",',
        f"  rows: {len(df)},",
        f"  probabilityShrink: {shrink:.4f},",
        f"  refitLambda: {refit_lambda},",
        "  markets: {",
    ]
    for market in MARKETS:
        rows = (df.market == market).to_numpy()
        model = fit(X[rows], df.over.to_numpy()[rows])
        intercept = model.intercept_[0]
        gap, market_logit, priced = model.coef_[0]
        lines.append(
            f"    {market}: {{ scale: {SCALE[market]:g}, intercept: {intercept:.5f}, gap: {gap:.5f}, "
            f"marketLogit: {market_logit:.5f}, priced: {priced:.5f} }},"
        )
    lines += ["  } satisfies BoardSideMarkets,", "};", "// </generated:board-side-calibration>", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--holdout-from", default="2026-01-01")
    parser.add_argument("--version", default=None)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    df = load(args.replay)
    X = features(df)
    shrink = report(df, X, args.holdout_from)
    refit_lambda = choose_refit_lambda(df, X, args.holdout_from)
    block = generated_block(df, X, args.version or f"replay-{df.dateEt.min()}-{df.dateEt.max()}", shrink, refit_lambda)
    print("\n" + block)
    if args.write:
        source = MODULE.read_text(encoding="utf-8")
        if not BLOCK.search(source):
            raise SystemExit(f"Generated block not found in {MODULE}")
        MODULE.write_text(BLOCK.sub(lambda _: block, source, count=1), encoding="utf-8", newline="\n")
        print(f"Wrote {MODULE}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
