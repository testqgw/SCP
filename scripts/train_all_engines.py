"""
Train All Engines -- Neural Feature Pipeline Orchestrator
=========================================================
Runs all three neural feature engines in sequence:
  1. NLP Context Engine  -> exports/nlp_signals/
  2. LSTM Momentum Engine -> exports/embeddings/lstm/
  3. Graph Matchup Engine -> exports/embeddings/gnn/

Then merges all feature vectors into a single enhanced feature file
for integration with the backtest pipeline.

Usage:
  python scripts/train_all_engines.py --csv exports/nba-season-2025-player-game-logs.csv
  python scripts/train_all_engines.py --csv exports/nba-season-2025-player-game-logs.csv --skip-nlp
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# ====================================================================
# IMPORTS (lazy -- each engine handles its own dep checking)
# ====================================================================

def run_engine(name: str, module_path: str, func_name: str, **kwargs) -> Any:
    """Dynamically import and run an engine module."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        print(f"  [!] Could not load {module_path}")
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    func = getattr(mod, func_name, None)
    if func is None:
        print(f"  [!] Function '{func_name}' not found in {module_path}")
        return None
    return func(**kwargs)


# ====================================================================
# MERGE ENGINE
# ====================================================================

def merge_all_features(
    nlp_path: Optional[str],
    lstm_path: Optional[str],
    gnn_path: Optional[str],
    output_dir: str,
) -> str:
    """
    Merge NLP (4-dim), LSTM (8-dim), and GNN (8-dim) feature vectors
    into a single JSON keyed by player_name_date.

    Output format:
    {
      "LeBron James_2025-12-01": {
        "nlp": [ir, ma, ac, sent],
        "lstm": [f0, f1, ..., f7],
        "gnn": [f0, f1, ..., f7],
        "combined": [nlp0..3, lstm0..7, gnn0..7]  // 20-dim total
      }
    }
    """
    print("\n" + "=" * 60)
    print("  MERGING ALL FEATURE VECTORS")
    print("=" * 60)

    # Load each feature file
    nlp_data: Dict[str, Any] = {}
    lstm_data: Dict[str, List[float]] = {}
    gnn_data: Dict[str, List[float]] = {}

    if nlp_path and os.path.exists(nlp_path):
        with open(nlp_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for key, val in raw.items():
            if "feature_vector" in val:
                nlp_data[key] = val["feature_vector"]
            else:
                nlp_data[key] = [
                    val.get("injury_risk", 0.0),
                    val.get("minutes_adj", 0.0),
                    val.get("availability_conf", 0.5),
                    val.get("sentiment_score", 0.0),
                ]
        print(f"  NLP signals: {len(nlp_data)} entries loaded")
    else:
        print(f"  NLP signals: not found ({nlp_path})")

    if lstm_path and os.path.exists(lstm_path):
        with open(lstm_path, "r", encoding="utf-8") as f:
            lstm_data = json.load(f)
        print(f"  LSTM embeddings: {len(lstm_data)} entries loaded")
    else:
        print(f"  LSTM embeddings: not found ({lstm_path})")

    if gnn_path and os.path.exists(gnn_path):
        with open(gnn_path, "r", encoding="utf-8") as f:
            gnn_data = json.load(f)
        print(f"  GNN embeddings: {len(gnn_data)} entries loaded")
    else:
        print(f"  GNN embeddings: not found ({gnn_path})")

    # Collect all unique keys
    all_keys: Set[str] = set()
    all_keys.update(nlp_data.keys())
    all_keys.update(lstm_data.keys())
    all_keys.update(gnn_data.keys())

    # Default feature vectors
    nlp_default = [0.02, 0.0, 0.5, 0.0]       # Neutral NLP (4-dim)
    lstm_default = [0.0] * 8                     # Zero LSTM (8-dim)
    gnn_default = [0.0, 0.0, 0.5, 0.05, 0.5, 0.5, 0.0, 0.5]  # Neutral GNN (8-dim)

    merged: Dict[str, Dict[str, Any]] = {}
    for key in sorted(all_keys):
        nlp_vec = nlp_data.get(key, nlp_default)
        lstm_vec = lstm_data.get(key, lstm_default)
        gnn_vec = gnn_data.get(key, gnn_default)

        # Combined 20-dim vector
        combined = list(nlp_vec) + list(lstm_vec) + list(gnn_vec)

        merged[key] = {
            "nlp": nlp_vec,
            "lstm": lstm_vec,
            "gnn": gnn_vec,
            "combined": combined,
        }

    # Count coverage
    has_nlp = sum(1 for k in merged if k in nlp_data)
    has_lstm = sum(1 for k in merged if k in lstm_data)
    has_gnn = sum(1 for k in merged if k in gnn_data)
    has_all = sum(1 for k in merged if k in nlp_data and k in lstm_data and k in gnn_data)

    print(f"\n  Coverage Report:")
    print(f"    Total keys:    {len(merged)}")
    print(f"    Has NLP:       {has_nlp} ({100*has_nlp/max(len(merged),1):.1f}%)")
    print(f"    Has LSTM:      {has_lstm} ({100*has_lstm/max(len(merged),1):.1f}%)")
    print(f"    Has GNN:       {has_gnn} ({100*has_gnn/max(len(merged),1):.1f}%)")
    print(f"    Has ALL THREE: {has_all} ({100*has_all/max(len(merged),1):.1f}%)")

    # Save
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, "enhanced_features.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(merged, f)  # No indent for speed (large file)

    size_mb = os.path.getsize(filepath) / 1024 / 1024
    print(f"\n  >> Exported to {filepath} ({size_mb:.1f} MB)")
    return filepath


# ====================================================================
# CLI
# ====================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Train All Engines -- Neural Feature Pipeline Orchestrator",
    )
    parser.add_argument("--csv", type=str,
        default="exports/nba-season-2025-player-game-logs.csv",
        help="Path to game logs CSV")
    parser.add_argument("--out", type=str,
        default="exports/",
        help="Base output directory")
    parser.add_argument("--skip-nlp", action="store_true",
        help="Skip NLP engine (if already run)")
    parser.add_argument("--skip-lstm", action="store_true",
        help="Skip LSTM engine (if already run)")
    parser.add_argument("--skip-gnn", action="store_true",
        help="Skip GNN engine (if already run)")
    parser.add_argument("--epochs", type=int, default=15,
        help="LSTM training epochs")

    args = parser.parse_args()

    print("\n" + "+" * 60)
    print("|    NEURAL FEATURE PIPELINE ORCHESTRATOR                  |")
    print("|    Training all three engines + merging features         |")
    print("+" * 60)

    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    base_out = args.out
    t_start = time.time()

    # ---- Phase 1: NLP Context Engine ----
    nlp_out_dir = os.path.join(base_out, "nlp_signals")
    nlp_output_file = os.path.join(nlp_out_dir, "nlp_backfill_signals.json")

    if not args.skip_nlp:
        print("\n" + "=" * 60)
        print("  PHASE 1/3: NLP Context Engine (Backfill)")
        print("=" * 60)
        t1 = time.time()

        nlp_script = os.path.join(scripts_dir, "nlp_context_engine.py")
        try:
            from scripts.nlp_context_engine import NLPContextEngine
            engine = NLPContextEngine(player_csv=args.csv)
            signals = engine.run_backfill(args.csv)
            engine.export_signals(signals, nlp_out_dir, filename="nlp_backfill_signals.json")
        except ImportError:
            # Fallback: run as subprocess
            os.system(f'python "{nlp_script}" --backfill --csv "{args.csv}" --out "{nlp_out_dir}"')

        print(f"  Phase 1 complete ({time.time() - t1:.1f}s)")
    else:
        print("\n  Skipping NLP engine (--skip-nlp)")

    # ---- Phase 2: LSTM Momentum Engine ----
    lstm_out_dir = os.path.join(base_out, "embeddings", "lstm")
    lstm_output_file = os.path.join(lstm_out_dir, "lstm_momentum_embeddings.json")

    if not args.skip_lstm:
        print("\n" + "=" * 60)
        print("  PHASE 2/3: LSTM Momentum Engine")
        print("=" * 60)
        t2 = time.time()

        lstm_script = os.path.join(scripts_dir, "lstm_momentum_engine.py")
        try:
            from scripts.lstm_momentum_engine import load_game_logs, train_lstm, export_embeddings
            player_logs = load_game_logs(args.csv)
            embeddings = train_lstm(player_logs, lstm_out_dir)
            if embeddings:
                export_embeddings(embeddings, lstm_out_dir)
        except ImportError:
            os.system(
                f'python "{lstm_script}" --csv "{args.csv}" '
                f'--out "{lstm_out_dir}" --epochs {args.epochs}'
            )

        print(f"  Phase 2 complete ({time.time() - t2:.1f}s)")
    else:
        print("\n  Skipping LSTM engine (--skip-lstm)")

    # ---- Phase 3: Graph Matchup Engine ----
    gnn_out_dir = os.path.join(base_out, "embeddings", "gnn")
    gnn_output_file = os.path.join(gnn_out_dir, "gnn_matchup_embeddings.json")

    if not args.skip_gnn:
        print("\n" + "=" * 60)
        print("  PHASE 3/3: Graph Matchup Engine")
        print("=" * 60)
        t3 = time.time()

        gnn_script = os.path.join(scripts_dir, "gnn_matchup_engine.py")
        try:
            from scripts.gnn_matchup_engine import run_pipeline
            run_pipeline(args.csv, gnn_out_dir)
        except ImportError:
            os.system(f'python "{gnn_script}" --csv "{args.csv}" --out "{gnn_out_dir}"')

        print(f"  Phase 3 complete ({time.time() - t3:.1f}s)")
    else:
        print("\n  Skipping GNN engine (--skip-gnn)")

    # ---- Phase 4: Merge All Features ----
    merge_out_dir = os.path.join(base_out, "enhanced")
    merged_path = merge_all_features(
        nlp_path=nlp_output_file,
        lstm_path=lstm_output_file,
        gnn_path=gnn_output_file,
        output_dir=merge_out_dir,
    )

    total_time = time.time() - t_start
    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE")
    print(f"  Total time: {total_time:.1f}s ({total_time/60:.1f} min)")
    print(f"  Output:     {merged_path}")
    print(f"{'='*60}")

    # Print feature dimension summary
    print(f"\n  Feature Dimensions:")
    print(f"    NLP Context:     4 dims (injury_risk, minutes_adj, availability_conf, sentiment)")
    print(f"    LSTM Momentum:   8 dims (form trajectory embedding)")
    print(f"    Graph Matchup:   8 dims (synergy, opponent, centrality, role)")
    print(f"    --------------------------------")
    print(f"    TOTAL COMBINED: 20 dims per player-date")

    print(f"\n  Next step: Integrate enhanced_features.json into")
    print(f"  backtest-final-player-prop-model-v1.py as additional classifier features.")

    print(f"\n[DONE] All engines trained and merged.")


if __name__ == "__main__":
    main()
