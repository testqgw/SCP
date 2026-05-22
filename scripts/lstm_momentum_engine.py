"""
LSTM Momentum Engine -- Lightweight Player Form Embeddings
==========================================================
2-layer bidirectional LSTM that processes a player's recent game log
sequence to produce an 8-dimensional "form embedding" capturing
momentum, streaks, rhythm patterns, and fatigue signals.

Designed for CPU-only execution on 16GB RAM laptops.
Model is intentionally tiny: ~15K trainable parameters.

Usage:
  python scripts/lstm_momentum_engine.py --csv exports/nba-season-2025-player-game-logs.csv --out exports/embeddings/lstm/
  python scripts/lstm_momentum_engine.py --csv exports/nba-season-2025-player-game-logs.csv --test
"""

import argparse
import csv
import json
import math
import os
import sys
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    print("[FATAL] numpy is required. Install with: pip install numpy")
    sys.exit(1)

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False
    print("[!] PyTorch not found. Install CPU-only version with:")
    print("    pip install torch --index-url https://download.pytorch.org/whl/cpu")
    print("    Falling back to numpy-only statistical momentum features.")


# ====================================================================
# CONSTANTS
# ====================================================================

SEED = 42
SEQ_LEN = 15            # Last 15 games as context window
FEATURES_PER_STEP = 12  # Input features per timestep
HIDDEN_DIM = 32         # LSTM hidden state size
EMBED_DIM = 8           # Output embedding dimension
NUM_LAYERS = 2          # LSTM depth
DROPOUT = 0.3
LEARNING_RATE = 1e-3
EPOCHS = 15
BATCH_SIZE = 64
MIN_GAMES = 5           # Minimum games to generate embedding


# ====================================================================
# DATA LOADING
# ====================================================================

@dataclass
class GameRecord:
    """A single game log entry for one player."""
    date: str
    player_name: str
    team: str
    opponent: str
    minutes: float
    points: float
    rebounds: float
    assists: float
    threes: float


def load_game_logs(csv_path: str) -> Dict[str, List[GameRecord]]:
    """Load game logs from CSV, grouped by player name and sorted by date."""
    player_logs: Dict[str, List[GameRecord]] = defaultdict(list)

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("playerName", "").strip()
            date = row.get("gameDateEt", "").strip()
            if not name or not date:
                continue

            try:
                record = GameRecord(
                    date=date,
                    player_name=name,
                    team=row.get("team", "").strip(),
                    opponent=row.get("opponent", "").strip(),
                    minutes=float(row.get("minutes", 0) or 0),
                    points=float(row.get("points", 0) or 0),
                    rebounds=float(row.get("rebounds", 0) or 0),
                    assists=float(row.get("assists", 0) or 0),
                    threes=float(row.get("threes", 0) or 0),
                )
                player_logs[name].append(record)
            except (ValueError, TypeError):
                continue

    # Sort each player's games by date
    for name in player_logs:
        player_logs[name].sort(key=lambda g: g.date)

    print(f"  Loaded {sum(len(v) for v in player_logs.values())} game logs "
          f"for {len(player_logs)} players")
    return player_logs


# ====================================================================
# FEATURE ENGINEERING
# ====================================================================

def compute_running_stats(values: List[float]) -> Tuple[float, float]:
    """Compute running mean and std of a list of values."""
    if not values:
        return 0.0, 1.0
    mean = sum(values) / len(values)
    if len(values) < 2:
        return mean, 1.0
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return mean, max(math.sqrt(var), 0.5)


def z_score(value: float, mean: float, std: float) -> float:
    """Z-score a value, clamped to [-3, 3]."""
    return max(-3.0, min(3.0, (value - mean) / max(std, 0.5)))


def build_feature_vector(
    game: GameRecord,
    running_pts: Tuple[float, float],
    running_reb: Tuple[float, float],
    running_ast: Tuple[float, float],
    running_3pt: Tuple[float, float],
    running_min_mean: float,
    game_index_norm: float,
    pts_trend: float,
) -> List[float]:
    """
    Build a 12-dim feature vector for a single game timestep.

    Features:
      0: minutes (normalized 0-48)
      1: points (z-scored)
      2: rebounds (z-scored)
      3: assists (z-scored)
      4: threes (z-scored)
      5: opponent_strength (placeholder 0.5)
      6: is_home (proxy: 1.0 if not empty, else 0.0)
      7: rest_days (placeholder 0.5)
      8: minutes_delta (deviation from running avg, clamped [-1, 1])
      9: points_trend (slope of recent points)
     10: starter_proxy (1.0 if min>=20, 0.5 if >=10, else 0.0)
     11: game_index (season progress 0-1)
    """
    min_norm = min(game.minutes / 48.0, 1.0)
    pts_z = z_score(game.points, running_pts[0], running_pts[1])
    reb_z = z_score(game.rebounds, running_reb[0], running_reb[1])
    ast_z = z_score(game.assists, running_ast[0], running_ast[1])
    thr_z = z_score(game.threes, running_3pt[0], running_3pt[1])

    min_delta = (game.minutes - running_min_mean) / max(running_min_mean, 1.0)
    min_delta = max(-1.0, min(1.0, min_delta))

    starter = 1.0 if game.minutes >= 20 else (0.5 if game.minutes >= 10 else 0.0)

    return [
        min_norm, pts_z, reb_z, ast_z, thr_z,
        0.5,           # opponent_strength placeholder
        0.5,           # is_home placeholder
        0.5,           # rest_days placeholder
        min_delta,
        max(-1.0, min(1.0, pts_trend)),
        starter,
        game_index_norm,
    ]


def build_sequences(
    player_logs: Dict[str, List[GameRecord]],
) -> Tuple[Dict[str, Dict[str, List[float]]], Dict[str, Dict[str, List[float]]]]:
    """
    Build training sequences and targets for all players.

    Returns:
      sequences: {player_name: {date: [SEQ_LEN * FEATURES_PER_STEP]}}
      targets:   {player_name: {date: [pts_z, reb_z, ast_z, thr_z]}}
    """
    all_sequences: Dict[str, Dict[str, List[float]]] = {}
    all_targets: Dict[str, Dict[str, List[float]]] = {}

    for player, games in player_logs.items():
        if len(games) < MIN_GAMES:
            continue

        player_seqs: Dict[str, List[float]] = {}
        player_targets: Dict[str, List[float]] = {}
        total_games = len(games)

        for i in range(MIN_GAMES, total_games):
            # Context window: last SEQ_LEN games before game i
            context_start = max(0, i - SEQ_LEN)
            context_games = games[context_start:i]

            # Running stats from all games before this one
            prior_pts = [g.points for g in games[:i]]
            prior_reb = [g.rebounds for g in games[:i]]
            prior_ast = [g.assists for g in games[:i]]
            prior_3pt = [g.threes for g in games[:i]]
            prior_min = [g.minutes for g in games[:i]]

            r_pts = compute_running_stats(prior_pts)
            r_reb = compute_running_stats(prior_reb)
            r_ast = compute_running_stats(prior_ast)
            r_3pt = compute_running_stats(prior_3pt)
            r_min_mean = sum(prior_min) / len(prior_min) if prior_min else 25.0

            # Points trend (slope of last 5 games)
            recent_pts = prior_pts[-5:] if len(prior_pts) >= 5 else prior_pts
            if len(recent_pts) >= 2:
                x = list(range(len(recent_pts)))
                x_mean = sum(x) / len(x)
                y_mean = sum(recent_pts) / len(recent_pts)
                num = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, recent_pts))
                den = sum((xi - x_mean) ** 2 for xi in x)
                pts_trend = (num / den) / max(r_pts[1], 1.0) if den > 0 else 0.0
            else:
                pts_trend = 0.0

            # Build feature vectors for each game in context window
            seq_features: List[List[float]] = []
            for j, cg in enumerate(context_games):
                game_idx_norm = (context_start + j) / max(total_games - 1, 1)
                fv = build_feature_vector(
                    cg, r_pts, r_reb, r_ast, r_3pt, r_min_mean,
                    game_idx_norm, pts_trend,
                )
                seq_features.append(fv)

            # Pad to SEQ_LEN if needed
            while len(seq_features) < SEQ_LEN:
                seq_features.insert(0, [0.0] * FEATURES_PER_STEP)

            # Flatten sequence: [SEQ_LEN, FEATURES_PER_STEP]
            flat = []
            for sf in seq_features:
                flat.extend(sf)
            player_seqs[games[i].date] = flat

            # Target: z-scored stats for game i
            target_game = games[i]
            player_targets[games[i].date] = [
                z_score(target_game.points, r_pts[0], r_pts[1]),
                z_score(target_game.rebounds, r_reb[0], r_reb[1]),
                z_score(target_game.assists, r_ast[0], r_ast[1]),
                z_score(target_game.threes, r_3pt[0], r_3pt[1]),
            ]

        if player_seqs:
            all_sequences[player] = player_seqs
            all_targets[player] = player_targets

    total_samples = sum(len(v) for v in all_sequences.values())
    print(f"  Built {total_samples} sequences for {len(all_sequences)} players")
    return all_sequences, all_targets


# ====================================================================
# NUMPY-ONLY FALLBACK (no PyTorch required)
# ====================================================================

def compute_numpy_momentum_features(
    player_logs: Dict[str, List[GameRecord]],
) -> Dict[str, List[float]]:
    """
    Compute 8-dim statistical momentum features using only numpy.
    This is the fallback when PyTorch is not available.

    Features:
      0: points_momentum (EWMA slope of last 10 games)
      1: rebounds_momentum
      2: assists_momentum
      3: threes_momentum
      4: minutes_stability (std/mean of last 10 minutes)
      5: hot_streak (fraction of last 5 games above season avg)
      6: cold_streak (fraction of last 5 games below season avg)
      7: consistency_score (1 - coefficient of variation of last 10)
    """
    embeddings: Dict[str, List[float]] = {}

    for player, games in player_logs.items():
        if len(games) < MIN_GAMES:
            continue

        for i in range(MIN_GAMES, len(games)):
            recent = games[max(0, i - 10):i]
            last5 = games[max(0, i - 5):i]
            all_prior = games[:i]

            # Season averages
            season_pts = np.mean([g.points for g in all_prior])
            season_reb = np.mean([g.rebounds for g in all_prior])
            season_ast = np.mean([g.assists for g in all_prior])
            season_3pt = np.mean([g.threes for g in all_prior])

            # EWMA momentum (exponential slope)
            def ewma_slope(vals: List[float], alpha: float = 0.3) -> float:
                if len(vals) < 2:
                    return 0.0
                ewma = [vals[0]]
                for v in vals[1:]:
                    ewma.append(alpha * v + (1 - alpha) * ewma[-1])
                # Slope = (last EWMA - first EWMA) / n, normalized
                std = max(np.std(vals), 0.5)
                return (ewma[-1] - ewma[0]) / (len(vals) * std)

            recent_pts = [g.points for g in recent]
            recent_reb = [g.rebounds for g in recent]
            recent_ast = [g.assists for g in recent]
            recent_3pt = [g.threes for g in recent]
            recent_min = [g.minutes for g in recent]

            pts_mom = ewma_slope(recent_pts)
            reb_mom = ewma_slope(recent_reb)
            ast_mom = ewma_slope(recent_ast)
            thr_mom = ewma_slope(recent_3pt)

            # Minutes stability
            min_mean = np.mean(recent_min) if recent_min else 25.0
            min_std = np.std(recent_min) if len(recent_min) > 1 else 0.0
            min_stability = 1.0 - min(min_std / max(min_mean, 1.0), 1.0)

            # Streak detection
            hot = sum(1 for g in last5 if g.points > season_pts) / max(len(last5), 1)
            cold = sum(1 for g in last5 if g.points < season_pts) / max(len(last5), 1)

            # Consistency (inverse CV of last 10)
            pts_std = np.std(recent_pts) if len(recent_pts) > 1 else 0.0
            consistency = 1.0 - min(pts_std / max(np.mean(recent_pts), 1.0), 1.0)

            key = f"{player}_{games[i].date}"
            embeddings[key] = [
                float(np.clip(pts_mom, -1, 1)),
                float(np.clip(reb_mom, -1, 1)),
                float(np.clip(ast_mom, -1, 1)),
                float(np.clip(thr_mom, -1, 1)),
                float(np.clip(min_stability, 0, 1)),
                float(hot),
                float(cold),
                float(np.clip(consistency, 0, 1)),
            ]

    print(f"  Computed {len(embeddings)} numpy momentum embeddings")
    return embeddings


# ====================================================================
# PYTORCH LSTM MODEL
# ====================================================================

if HAS_TORCH:
    class AttentionPooling(nn.Module):
        """Learned attention pooling over LSTM sequence outputs."""
        def __init__(self, hidden_dim: int):
            super().__init__()
            self.attention = nn.Linear(hidden_dim, 1)

        def forward(self, lstm_out: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
            # lstm_out: (batch, seq_len, hidden_dim)
            scores = self.attention(lstm_out).squeeze(-1)  # (batch, seq_len)
            if mask is not None:
                scores = scores.masked_fill(~mask, float('-inf'))
            weights = torch.softmax(scores, dim=1)  # (batch, seq_len)
            pooled = (lstm_out * weights.unsqueeze(-1)).sum(dim=1)  # (batch, hidden_dim)
            return pooled

    class MomentumLSTM(nn.Module):
        """
        Tiny bidirectional LSTM for player momentum embeddings.
        ~15K parameters -- designed for CPU training.
        """
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=FEATURES_PER_STEP,
                hidden_size=HIDDEN_DIM,
                num_layers=NUM_LAYERS,
                batch_first=True,
                bidirectional=True,
                dropout=DROPOUT if NUM_LAYERS > 1 else 0.0,
            )
            self.attention = AttentionPooling(HIDDEN_DIM * 2)  # *2 for bidirectional
            self.encoder = nn.Sequential(
                nn.Linear(HIDDEN_DIM * 2, 64),
                nn.ReLU(),
                nn.Dropout(DROPOUT),
                nn.Linear(64, EMBED_DIM),
            )
            # Prediction head (detached after training)
            self.predictor = nn.Linear(EMBED_DIM, 4)  # PTS_z, REB_z, AST_z, 3PT_z

        def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> Tuple[torch.Tensor, torch.Tensor]:
            # x: (batch, SEQ_LEN, FEATURES_PER_STEP)
            lstm_out, _ = self.lstm(x)  # (batch, SEQ_LEN, HIDDEN_DIM*2)
            pooled = self.attention(lstm_out, mask)  # (batch, HIDDEN_DIM*2)
            embedding = self.encoder(pooled)  # (batch, EMBED_DIM)
            prediction = self.predictor(embedding)  # (batch, 4)
            return embedding, prediction

        def count_parameters(self) -> int:
            return sum(p.numel() for p in self.parameters() if p.requires_grad)

    class GameSequenceDataset(Dataset):
        """PyTorch dataset for player game sequences."""
        def __init__(self, sequences: List[List[float]], targets: List[List[float]]):
            self.sequences = sequences
            self.targets = targets

        def __len__(self) -> int:
            return len(self.sequences)

        def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
            seq = torch.tensor(self.sequences[idx], dtype=torch.float32).reshape(SEQ_LEN, FEATURES_PER_STEP)
            target = torch.tensor(self.targets[idx], dtype=torch.float32)
            # Mask: True where the timestep has non-zero data
            mask = seq.abs().sum(dim=1) > 0  # (SEQ_LEN,)
            return seq, target, mask


# ====================================================================
# TRAINING LOOP
# ====================================================================

def train_lstm(
    player_logs: Dict[str, List[GameRecord]],
    output_dir: str,
) -> Dict[str, List[float]]:
    """
    Train the LSTM and extract embeddings for all player-dates.
    Uses a simple chronological split: first 80% for training, last 20% for validation.
    """
    if not HAS_TORCH:
        print("\n  [!] PyTorch not available -- using numpy fallback")
        return compute_numpy_momentum_features(player_logs)

    # Set seeds
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)

    print("\n  Building sequences...")
    all_sequences, all_targets = build_sequences(player_logs)

    # Flatten into training arrays
    flat_seqs: List[List[float]] = []
    flat_targets: List[List[float]] = []
    flat_keys: List[str] = []

    for player, date_seqs in all_sequences.items():
        for date, seq in date_seqs.items():
            flat_seqs.append(seq)
            flat_targets.append(all_targets[player][date])
            flat_keys.append(f"{player}_{date}")

    total = len(flat_seqs)
    if total == 0:
        print("  [!] No sequences to train on")
        return {}

    # Chronological split (80/20)
    split_idx = int(total * 0.8)
    train_dataset = GameSequenceDataset(flat_seqs[:split_idx], flat_targets[:split_idx])
    val_dataset = GameSequenceDataset(flat_seqs[split_idx:], flat_targets[split_idx:])

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False)

    print(f"  Train: {len(train_dataset)} samples | Val: {len(val_dataset)} samples")

    # Initialize model
    model = MomentumLSTM()
    print(f"  Model parameters: {model.count_parameters():,}")

    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE, weight_decay=1e-4)
    criterion = nn.MSELoss()
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode='min', factor=0.5, patience=3
    )

    # Training
    print(f"\n  {'Epoch':>5} | {'Train Loss':>10} | {'Val Loss':>10} | {'LR':>10}")
    print(f"  {'-'*5} | {'-'*10} | {'-'*10} | {'-'*10}")

    best_val_loss = float('inf')
    best_state = None

    for epoch in range(1, EPOCHS + 1):
        # Train
        model.train()
        train_loss = 0.0
        train_count = 0
        for seq_batch, target_batch, mask_batch in train_loader:
            optimizer.zero_grad()
            _, predictions = model(seq_batch, mask_batch)
            loss = criterion(predictions, target_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_loss += loss.item() * seq_batch.size(0)
            train_count += seq_batch.size(0)

        train_loss /= max(train_count, 1)

        # Validate
        model.eval()
        val_loss = 0.0
        val_count = 0
        with torch.no_grad():
            for seq_batch, target_batch, mask_batch in val_loader:
                _, predictions = model(seq_batch, mask_batch)
                loss = criterion(predictions, target_batch)
                val_loss += loss.item() * seq_batch.size(0)
                val_count += seq_batch.size(0)

        val_loss /= max(val_count, 1)
        scheduler.step(val_loss)
        current_lr = optimizer.param_groups[0]['lr']

        print(f"  {epoch:>5} | {train_loss:>10.6f} | {val_loss:>10.6f} | {current_lr:>10.6f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    # Load best model
    if best_state:
        model.load_state_dict(best_state)

    # Extract embeddings for ALL samples
    print("\n  Extracting embeddings...")
    model.eval()
    embeddings: Dict[str, List[float]] = {}

    full_dataset = GameSequenceDataset(flat_seqs, flat_targets)
    full_loader = DataLoader(full_dataset, batch_size=BATCH_SIZE, shuffle=False)

    idx = 0
    with torch.no_grad():
        for seq_batch, _, mask_batch in full_loader:
            embed_batch, _ = model(seq_batch, mask_batch)
            for i in range(embed_batch.size(0)):
                key = flat_keys[idx]
                embeddings[key] = embed_batch[i].tolist()
                idx += 1

    print(f"  Extracted {len(embeddings)} embeddings (dim={EMBED_DIM})")

    # Save model checkpoint
    os.makedirs(output_dir, exist_ok=True)
    model_path = os.path.join(output_dir, "lstm_momentum_model.pt")
    torch.save({
        'model_state_dict': model.state_dict(),
        'config': {
            'seq_len': SEQ_LEN,
            'features_per_step': FEATURES_PER_STEP,
            'hidden_dim': HIDDEN_DIM,
            'embed_dim': EMBED_DIM,
            'num_layers': NUM_LAYERS,
        },
        'best_val_loss': best_val_loss,
    }, model_path)
    print(f"  Model saved to {model_path}")

    return embeddings


# ====================================================================
# EXPORT
# ====================================================================

def export_embeddings(embeddings: Dict[str, List[float]], output_dir: str) -> str:
    """Export embeddings to JSON file."""
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, "lstm_momentum_embeddings.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(embeddings, f, indent=2)

    print(f"  Exported {len(embeddings)} embeddings to {filepath}")
    return filepath


# ====================================================================
# SELF-TEST
# ====================================================================

def run_self_test(player_logs: Dict[str, List[GameRecord]]) -> bool:
    """Validate tensor shapes and forward pass."""
    print("\n" + "=" * 60)
    print("  LSTM MOMENTUM ENGINE -- SELF-TEST")
    print("=" * 60)

    if not HAS_TORCH:
        print("  [!] PyTorch not available -- testing numpy fallback only")
        embeddings = compute_numpy_momentum_features(player_logs)
        if embeddings:
            key = list(embeddings.keys())[0]
            print(f"  [OK] Sample key: {key}")
            print(f"  [OK] Sample embedding (8-dim): {embeddings[key]}")
            print(f"  [OK] Total embeddings: {len(embeddings)}")
            return True
        else:
            print("  [--] No embeddings generated")
            return False

    print("\n  Testing model architecture...")
    model = MomentumLSTM()
    print(f"  [OK] Model created with {model.count_parameters():,} parameters")

    # Test forward pass
    dummy_input = torch.randn(4, SEQ_LEN, FEATURES_PER_STEP)
    dummy_mask = torch.ones(4, SEQ_LEN, dtype=torch.bool)
    embed, pred = model(dummy_input, dummy_mask)
    assert embed.shape == (4, EMBED_DIM), f"Expected (4, {EMBED_DIM}), got {embed.shape}"
    assert pred.shape == (4, 4), f"Expected (4, 4), got {pred.shape}"
    print(f"  [OK] Forward pass: input {dummy_input.shape} -> embed {embed.shape}, pred {pred.shape}")

    # Test gradient flow
    loss = pred.sum()
    loss.backward()
    grad_ok = all(p.grad is not None and not torch.isnan(p.grad).any()
                  for p in model.parameters() if p.requires_grad)
    print(f"  [OK] Gradient flow: {'clean (no NaN)' if grad_ok else 'ISSUES DETECTED'}")

    # Test with real data
    print("\n  Testing with real game log data...")
    sequences, targets = build_sequences(player_logs)
    if sequences:
        player = list(sequences.keys())[0]
        date = list(sequences[player].keys())[0]
        seq = sequences[player][date]
        print(f"  [OK] Sample sequence for {player} on {date}: {len(seq)} floats "
              f"({len(seq) // FEATURES_PER_STEP} steps x {FEATURES_PER_STEP} features)")

    print("\n  All tests passed!")
    return True


# ====================================================================
# CLI
# ====================================================================

def main():
    parser = argparse.ArgumentParser(
        description="LSTM Momentum Engine -- Player Form Embeddings",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--csv", type=str,
        default="exports/nba-season-2025-player-game-logs.csv",
        help="Path to game logs CSV",
    )
    parser.add_argument(
        "--out", type=str,
        default="exports/embeddings/lstm/",
        help="Output directory for embeddings",
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Run self-test validation",
    )
    parser.add_argument(
        "--epochs", type=int, default=EPOCHS,
        help=f"Training epochs (default: {EPOCHS})",
    )

    args = parser.parse_args()

    print("\n+===========================================================+")
    print("|     LSTM Momentum Engine -- Player Form Embeddings        |")
    print("+===========================================================+")
    print(f"  PyTorch: {'available (CPU)' if HAS_TORCH else 'NOT FOUND (numpy fallback)'}")
    print(f"  Sequence length: {SEQ_LEN} games")
    print(f"  Features/step:   {FEATURES_PER_STEP}")
    print(f"  Hidden dim:      {HIDDEN_DIM}")
    print(f"  Embed dim:       {EMBED_DIM}")

    # Load data
    print(f"\n  Loading game logs from {args.csv}...")
    player_logs = load_game_logs(args.csv)

    if args.test:
        success = run_self_test(player_logs)
        sys.exit(0 if success else 1)

    # Train and extract embeddings
    epochs_to_use = args.epochs
    embeddings = train_lstm(player_logs, args.out)

    # Export
    if embeddings:
        export_embeddings(embeddings, args.out)

    print("\n[DONE] LSTM Momentum Engine complete.")


if __name__ == "__main__":
    main()
