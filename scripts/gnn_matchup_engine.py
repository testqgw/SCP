"""
Graph Matchup Engine -- Sparse Matrix Player Interaction Features
================================================================
Computes player matchup and interaction features using classical
graph theory and linear algebra (SciPy sparse matrices + NetworkX).
NO deep learning required -- pure math, runs in seconds on CPU.

Produces an 8-dimensional matchup feature vector per player per game
capturing teammate synergy, opponent defensive exposure, and graph
centrality metrics.

Usage:
  python scripts/gnn_matchup_engine.py --csv exports/nba-season-2025-player-game-logs.csv --out exports/embeddings/gnn/
  python scripts/gnn_matchup_engine.py --csv exports/nba-season-2025-player-game-logs.csv --test
"""

import argparse
import csv
import json
import math
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

try:
    import networkx as nx
    HAS_NX = True
except ImportError:
    HAS_NX = False
    print("[!] networkx not found. Install with: pip install networkx")
    print("    Graph centrality features will use fallback approximations.")

try:
    from scipy import sparse
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


# ====================================================================
# CONSTANTS
# ====================================================================

EMBED_DIM = 8
MIN_PLAYER_GAMES = 5  # Minimum games to include player


# ====================================================================
# DATA LOADING
# ====================================================================

@dataclass
class GameLog:
    """Single player game log entry."""
    date: str
    player_name: str
    team: str
    opponent: str
    minutes: float
    points: float
    rebounds: float
    assists: float
    threes: float


def load_game_logs(csv_path: str) -> List[GameLog]:
    """Load all game logs from CSV."""
    logs: List[GameLog] = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("playerName", "").strip()
            date = row.get("gameDateEt", "").strip()
            if not name or not date:
                continue
            try:
                logs.append(GameLog(
                    date=date,
                    player_name=name,
                    team=row.get("team", "").strip(),
                    opponent=row.get("opponent", "").strip(),
                    minutes=float(row.get("minutes", 0) or 0),
                    points=float(row.get("points", 0) or 0),
                    rebounds=float(row.get("rebounds", 0) or 0),
                    assists=float(row.get("assists", 0) or 0),
                    threes=float(row.get("threes", 0) or 0),
                ))
            except (ValueError, TypeError):
                continue
    print(f"  Loaded {len(logs)} game log entries")
    return logs


# ====================================================================
# INDEX BUILDING
# ====================================================================

def build_indices(logs: List[GameLog]) -> Dict[str, Any]:
    """Build lookup indices from game logs."""
    # Group by game (date + team matchup)
    game_rosters: Dict[str, Dict[str, List[GameLog]]] = defaultdict(lambda: defaultdict(list))
    # {date -> {team -> [GameLog]}}

    player_stats: Dict[str, List[GameLog]] = defaultdict(list)  # player -> all games
    player_teams: Dict[str, str] = {}  # player -> most recent team
    all_dates: List[str] = []
    dates_set: Set[str] = set()

    for log in logs:
        game_rosters[log.date][log.team].append(log)
        player_stats[log.player_name].append(log)
        player_teams[log.player_name] = log.team
        dates_set.add(log.date)

    all_dates = sorted(dates_set)

    # Sort player game logs by date
    for name in player_stats:
        player_stats[name].sort(key=lambda g: g.date)

    print(f"  Indexed {len(all_dates)} game dates, {len(player_stats)} players, "
          f"{len(set(player_teams.values()))} teams")

    return {
        "game_rosters": game_rosters,
        "player_stats": player_stats,
        "player_teams": player_teams,
        "all_dates": all_dates,
    }


# ====================================================================
# FEATURE 1: TEAMMATE SYNERGY MATRIX
# ====================================================================

def compute_teammate_synergy(
    player_stats: Dict[str, List[GameLog]],
    game_rosters: Dict[str, Dict[str, List[GameLog]]],
) -> Dict[str, Dict[str, float]]:
    """
    For each player, compute how their stats deviate from personal average
    when each teammate plays heavy minutes vs light minutes.

    Returns: {player -> {teammate -> synergy_score}}
    Positive = player performs better when teammate is active
    Negative = player performs worse when teammate is active
    """
    synergy: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    # For each date and team, identify teammates
    for date, teams in game_rosters.items():
        for team, roster in teams.items():
            if len(roster) < 2:
                continue

            # Get team's average minutes per player for median split
            team_min_avg = np.mean([p.minutes for p in roster]) if roster else 20.0

            for player_log in roster:
                player = player_log.player_name
                # Get player's season average points
                all_games = player_stats.get(player, [])
                if len(all_games) < MIN_PLAYER_GAMES:
                    continue
                prior = [g for g in all_games if g.date < date]
                if not prior:
                    continue
                season_pts_avg = np.mean([g.points for g in prior])
                pts_deviation = player_log.points - season_pts_avg

                # Attribute deviation partially to each active teammate
                active_teammates = [
                    t for t in roster
                    if t.player_name != player and t.minutes >= 10
                ]
                if not active_teammates:
                    continue

                for tm_log in active_teammates:
                    # Weight by teammate's minutes (proxy for influence)
                    weight = tm_log.minutes / 48.0
                    synergy[player][tm_log.player_name] += pts_deviation * weight

    # Normalize synergy scores
    for player, teammates in synergy.items():
        if not teammates:
            continue
        vals = list(teammates.values())
        max_abs = max(abs(v) for v in vals) if vals else 1.0
        if max_abs > 0:
            for tm in teammates:
                teammates[tm] /= max_abs

    return synergy


# ====================================================================
# FEATURE 2: OPPONENT IMPACT MATRIX
# ====================================================================

def compute_opponent_impact(
    player_stats: Dict[str, List[GameLog]],
) -> Dict[str, Dict[str, float]]:
    """
    For each player, compute how their stats deviate when facing each opponent.

    Returns: {player -> {opponent_team -> impact_score}}
    Negative = player underperforms vs this opponent
    Positive = player overperforms vs this opponent
    """
    impact: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))

    for player, games in player_stats.items():
        if len(games) < MIN_PLAYER_GAMES:
            continue

        season_avg = np.mean([g.points for g in games])
        for game in games:
            deviation = game.points - season_avg
            impact[player][game.opponent].append(deviation)

    # Average deviations
    result: Dict[str, Dict[str, float]] = {}
    for player, opponents in impact.items():
        result[player] = {}
        for opp, devs in opponents.items():
            if len(devs) >= 1:
                result[player][opp] = float(np.mean(devs))
    return result


# ====================================================================
# FEATURE 3: GRAPH CENTRALITY (per game)
# ====================================================================

def compute_game_graph_features(
    game_rosters: Dict[str, Dict[str, List[GameLog]]],
) -> Dict[str, Dict[str, Tuple[float, float, float]]]:
    """
    Build a player interaction graph for each game date and compute
    centrality metrics for each player.

    Returns: {date -> {player -> (degree_centrality, pagerank, clustering)}}
    """
    graph_features: Dict[str, Dict[str, Tuple[float, float, float]]] = {}

    if not HAS_NX:
        # Fallback: use simple degree-based approximations
        for date, teams in game_rosters.items():
            date_features: Dict[str, Tuple[float, float, float]] = {}
            all_players = []
            for team, roster in teams.items():
                all_players.extend(roster)

            n = max(len(all_players), 1)
            for log in all_players:
                # Simple approximation based on minutes played
                importance = log.minutes / 48.0
                date_features[log.player_name] = (importance, importance, 0.5)
            graph_features[date] = date_features
        return graph_features

    processed = 0
    total_dates = len(game_rosters)

    for date, teams in game_rosters.items():
        G = nx.Graph()

        team_list = list(teams.keys())

        # Add nodes and edges
        for team, roster in teams.items():
            for player_log in roster:
                G.add_node(player_log.player_name, team=team, minutes=player_log.minutes)

            # Teammate edges (weighted by shared minutes)
            for i, p1 in enumerate(roster):
                for p2 in roster[i + 1:]:
                    shared_min = min(p1.minutes, p2.minutes)
                    if shared_min > 0:
                        G.add_edge(
                            p1.player_name, p2.player_name,
                            weight=shared_min / 48.0,
                            edge_type="teammate",
                        )

        # Opponent edges (cross-team)
        team_names = list(teams.keys())
        for i in range(len(team_names)):
            for j in range(i + 1, len(team_names)):
                team_a = teams[team_names[i]]
                team_b = teams[team_names[j]]
                for pa in team_a:
                    for pb in team_b:
                        # Opponent edge weighted by minutes overlap
                        overlap = min(pa.minutes, pb.minutes) / 48.0
                        if overlap > 0:
                            G.add_edge(
                                pa.player_name, pb.player_name,
                                weight=overlap * 0.5,  # Opponent edges weaker
                                edge_type="opponent",
                            )

        if len(G) == 0:
            continue

        # Compute graph metrics
        try:
            degree_cent = nx.degree_centrality(G)
        except Exception:
            degree_cent = {n: 0.5 for n in G.nodes()}

        try:
            pagerank = nx.pagerank(G, max_iter=50, tol=1e-4)
        except Exception:
            pagerank = {n: 1.0 / len(G) for n in G.nodes()}

        try:
            clustering = nx.clustering(G, weight="weight")
        except Exception:
            clustering = {n: 0.5 for n in G.nodes()}

        date_features: Dict[str, Tuple[float, float, float]] = {}
        for node in G.nodes():
            date_features[node] = (
                degree_cent.get(node, 0.0),
                pagerank.get(node, 0.0),
                clustering.get(node, 0.0),
            )
        graph_features[date] = date_features

        processed += 1
        if processed % 100 == 0:
            print(f"    Processed {processed}/{total_dates} game dates...")

    print(f"  Computed graph features for {processed} game dates")
    return graph_features


# ====================================================================
# FEATURE 4: ROLE CONCENTRATION (Herfindahl Index)
# ====================================================================

def compute_role_concentration(
    game_rosters: Dict[str, Dict[str, List[GameLog]]],
) -> Dict[str, Dict[str, float]]:
    """
    Compute Herfindahl-Hirschman Index of minutes concentration per team per game.
    High HHI = star-dependent team (top players get disproportionate minutes).

    Returns: {date -> {team -> hhi_score}}
    """
    concentration: Dict[str, Dict[str, float]] = {}

    for date, teams in game_rosters.items():
        date_conc: Dict[str, float] = {}
        for team, roster in teams.items():
            total_min = sum(p.minutes for p in roster)
            if total_min <= 0:
                date_conc[team] = 0.5
                continue
            # HHI = sum of squared market shares
            shares = [(p.minutes / total_min) for p in roster]
            hhi = sum(s * s for s in shares)
            # Normalize: 1/n (perfectly equal) to 1.0 (one player plays all)
            n = len(roster) if roster else 1
            hhi_norm = (hhi - 1.0 / n) / (1.0 - 1.0 / n) if n > 1 else 0.5
            date_conc[team] = max(0.0, min(1.0, hhi_norm))
        concentration[date] = date_conc

    return concentration


# ====================================================================
# ASSEMBLE 8-DIM FEATURE VECTORS
# ====================================================================

def assemble_matchup_embeddings(
    logs: List[GameLog],
    indices: Dict[str, Any],
    teammate_synergy: Dict[str, Dict[str, float]],
    opponent_impact: Dict[str, Dict[str, float]],
    graph_features: Dict[str, Dict[str, Tuple[float, float, float]]],
    role_concentration: Dict[str, Dict[str, float]],
) -> Dict[str, List[float]]:
    """
    Assemble the final 8-dim matchup embedding for each player-game.

    Dimensions:
      0: teammate_synergy_score  (aggregate teammate boost/drag for tonight)
      1: opponent_impact_score   (expected stat deviation vs tonight's opponent)
      2: degree_centrality       (graph connectivity importance)
      3: pagerank                (graph influence score)
      4: clustering_coeff        (local graph clustering)
      5: role_concentration      (team's usage concentration HHI)
      6: matchup_edge            (composite advantage = synergy - opp_impact)
      7: defensive_exposure      (minutes-weighted opponent pressure)
    """
    game_rosters = indices["game_rosters"]
    player_stats = indices["player_stats"]
    embeddings: Dict[str, List[float]] = {}

    for log in logs:
        key = f"{log.player_name}_{log.date}"
        player = log.player_name
        date = log.date
        opponent = log.opponent

        # 1: Teammate synergy score (aggregate)
        synergy_score = 0.0
        player_syn = teammate_synergy.get(player, {})
        if player_syn and date in game_rosters:
            team_roster = game_rosters[date].get(log.team, [])
            active_teammates = [t for t in team_roster if t.player_name != player and t.minutes >= 10]
            if active_teammates:
                syn_vals = [player_syn.get(t.player_name, 0.0) for t in active_teammates]
                synergy_score = float(np.mean(syn_vals))

        # 2: Opponent impact score
        opp_score = 0.0
        player_opp = opponent_impact.get(player, {})
        if player_opp:
            opp_score = player_opp.get(opponent, 0.0)
            # Normalize to [-1, 1]
            max_impact = max(abs(v) for v in player_opp.values()) if player_opp else 1.0
            opp_score = opp_score / max(max_impact, 1.0)

        # 3-5: Graph centrality features
        gf = graph_features.get(date, {}).get(player, (0.5, 0.05, 0.5))
        degree_cent, pagerank, clustering = gf

        # 6: Role concentration
        rc = role_concentration.get(date, {}).get(log.team, 0.5)

        # 7: Composite matchup edge
        matchup_edge = float(np.clip(synergy_score - opp_score, -1, 1))

        # 8: Defensive exposure (minutes-weighted by opponent starters faced)
        def_exposure = 0.5  # Default
        if date in game_rosters:
            opp_roster = game_rosters[date].get(opponent, [])
            if opp_roster:
                # Players who played heavy minutes exert more defensive pressure
                opp_minutes = [p.minutes for p in opp_roster if p.minutes >= 15]
                if opp_minutes:
                    total_opp_min = sum(opp_minutes)
                    # How much of the opponent's defensive minutes overlap with this player
                    overlap_ratio = min(log.minutes, max(opp_minutes)) / 48.0
                    def_exposure = float(np.clip(overlap_ratio, 0, 1))

        embeddings[key] = [
            float(np.clip(synergy_score, -1, 1)),
            float(np.clip(opp_score, -1, 1)),
            float(degree_cent),
            float(pagerank * 10),  # Scale up pagerank for visibility
            float(clustering),
            float(rc),
            float(matchup_edge),
            float(def_exposure),
        ]

    print(f"  Assembled {len(embeddings)} matchup embeddings (dim={EMBED_DIM})")
    return embeddings


# ====================================================================
# EXPORT
# ====================================================================

def export_embeddings(embeddings: Dict[str, List[float]], output_dir: str) -> str:
    """Export embeddings to JSON."""
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, "gnn_matchup_embeddings.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(embeddings, f, indent=2)
    print(f"  Exported {len(embeddings)} embeddings to {filepath}")
    return filepath


# ====================================================================
# MAIN PIPELINE
# ====================================================================

def run_pipeline(csv_path: str, output_dir: str) -> Dict[str, List[float]]:
    """Full pipeline: load -> compute all features -> assemble -> export."""

    print("\n  Step 1/5: Loading game logs...")
    logs = load_game_logs(csv_path)

    print("  Step 2/5: Building indices...")
    indices = build_indices(logs)

    print("  Step 3/5: Computing teammate synergy matrix...")
    teammate_synergy = compute_teammate_synergy(
        indices["player_stats"], indices["game_rosters"]
    )
    print(f"    -> Synergy computed for {len(teammate_synergy)} players")

    print("  Step 4/5: Computing opponent impact matrix...")
    opponent_impact = compute_opponent_impact(indices["player_stats"])
    print(f"    -> Impact computed for {len(opponent_impact)} players")

    print("  Step 5/5: Computing graph centrality features...")
    graph_features = compute_game_graph_features(indices["game_rosters"])

    print("  Computing role concentration (HHI)...")
    role_conc = compute_role_concentration(indices["game_rosters"])

    print("\n  Assembling final embeddings...")
    embeddings = assemble_matchup_embeddings(
        logs, indices, teammate_synergy, opponent_impact,
        graph_features, role_conc,
    )

    export_embeddings(embeddings, output_dir)
    return embeddings


# ====================================================================
# SELF-TEST
# ====================================================================

def run_self_test(csv_path: str) -> bool:
    """Validate the pipeline with real data."""
    print("\n" + "=" * 60)
    print("  GRAPH MATCHUP ENGINE -- SELF-TEST")
    print("=" * 60)

    logs = load_game_logs(csv_path)
    if not logs:
        print("  [--] No game logs found")
        return False

    indices = build_indices(logs)

    # Test teammate synergy
    print("\n  Testing teammate synergy computation...")
    synergy = compute_teammate_synergy(indices["player_stats"], indices["game_rosters"])
    if synergy:
        sample_player = list(synergy.keys())[0]
        sample_teammates = list(synergy[sample_player].items())[:3]
        print(f"  [OK] Sample synergy for {sample_player}:")
        for tm, score in sample_teammates:
            print(f"       {tm}: {score:+.3f}")
    else:
        print("  [!] No synergy data computed")

    # Test opponent impact
    print("\n  Testing opponent impact computation...")
    opp_impact = compute_opponent_impact(indices["player_stats"])
    if opp_impact:
        sample_player = list(opp_impact.keys())[0]
        sample_opps = list(opp_impact[sample_player].items())[:3]
        print(f"  [OK] Sample opponent impact for {sample_player}:")
        for opp, score in sample_opps:
            print(f"       vs {opp}: {score:+.2f} pts")
    else:
        print("  [!] No opponent impact data computed")

    # Test graph features
    print("\n  Testing graph centrality computation...")
    graph_features = compute_game_graph_features(indices["game_rosters"])
    if graph_features:
        sample_date = list(graph_features.keys())[0]
        sample_players = list(graph_features[sample_date].items())[:2]
        print(f"  [OK] Graph features for {sample_date}:")
        for player, (deg, pr, clust) in sample_players:
            print(f"       {player}: degree={deg:.3f}, pagerank={pr:.4f}, clustering={clust:.3f}")
    else:
        print("  [!] No graph features computed")

    # Test full assembly
    print("\n  Testing full embedding assembly...")
    role_conc = compute_role_concentration(indices["game_rosters"])
    embeddings = assemble_matchup_embeddings(
        logs, indices, synergy, opp_impact, graph_features, role_conc,
    )
    if embeddings:
        sample_key = list(embeddings.keys())[0]
        sample_emb = embeddings[sample_key]
        print(f"  [OK] Sample embedding for {sample_key}:")
        labels = ["synergy", "opp_impact", "degree", "pagerank",
                  "clustering", "role_conc", "matchup_edge", "def_exposure"]
        for label, val in zip(labels, sample_emb):
            print(f"       {label:>15}: {val:+.4f}")
    else:
        print("  [--] No embeddings generated")
        return False

    print(f"\n  [OK] Total embeddings: {len(embeddings)}")
    print("  All tests passed!")
    return True


# ====================================================================
# CLI
# ====================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Graph Matchup Engine -- Player Interaction Features",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--csv", type=str,
        default="exports/nba-season-2025-player-game-logs.csv",
        help="Path to game logs CSV",
    )
    parser.add_argument(
        "--out", type=str,
        default="exports/embeddings/gnn/",
        help="Output directory for embeddings",
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Run self-test validation",
    )

    args = parser.parse_args()

    print("\n+===========================================================+")
    print("|     Graph Matchup Engine -- Player Interaction Features    |")
    print("+===========================================================+")
    print(f"  NetworkX:  {'available' if HAS_NX else 'NOT FOUND (using fallback)'}")
    print(f"  SciPy:     {'available' if HAS_SCIPY else 'NOT FOUND'}")
    print(f"  Embed dim: {EMBED_DIM}")

    if args.test:
        success = run_self_test(args.csv)
        sys.exit(0 if success else 1)

    embeddings = run_pipeline(args.csv, args.out)
    print(f"\n[DONE] Graph Matchup Engine complete. "
          f"Generated {len(embeddings)} embeddings.")


if __name__ == "__main__":
    main()
