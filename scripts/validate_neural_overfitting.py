import os
import json
import pandas as pd
import numpy as np
from datetime import datetime

def load_csv_data(csv_path):
    print(f"[INFO] Loading CSV backtest data from {csv_path}...")
    df = pd.read_csv(csv_path)
    
    # Map columns to match the validation script expectations
    if 'date' in df.columns and 'gameDateEt' not in df.columns:
        df['gameDateEt'] = df['date']
        
    if 'correct' in df.columns and 'finalCorrectBool' not in df.columns:
        # Convert True/False strings or booleans to 1/0
        df['finalCorrectBool'] = df['correct'].map({True: 1, False: 0, 'True': 1, 'False': 0, 1.0: 1, 0.0: 0})
        
    if 'modelAction' in df.columns and 'isSelected' not in df.columns:
        df['isSelected'] = df['modelAction'] == 'SELECTED'
        
    if 'teamCode' in df.columns and 'playerTeam' not in df.columns:
        df['playerTeam'] = df['teamCode']
        
    return df

def load_backtest_data(filepath):
    """Loads the detailed row-by-row outputs of the neural backtest."""
    # Check if a corresponding CSV exists
    if filepath.endswith('.json'):
        csv_path = filepath.replace('.json', '-board.csv')
        if os.path.exists(csv_path):
            print(f"[INFO] Found corresponding board CSV file: {csv_path}")
            return load_csv_data(csv_path)
        
        selected_csv_path = filepath.replace('.json', '-selected.csv')
        if os.path.exists(selected_csv_path):
            print(f"[INFO] Found corresponding selected CSV file: {selected_csv_path}")
            return load_csv_data(selected_csv_path)
            
    if filepath.endswith('.csv'):
        return load_csv_data(filepath)
        
    print(f"[INFO] Loading JSON backtest data from {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Extract the raw rows evaluated by the backtest
    rows = data.get('evaluated_rows', data.get('details', data))
    if isinstance(rows, list):
        return pd.DataFrame(rows)
    else:
        print("[WARNING] JSON contains summary statistics but no raw row details.")
        return pd.DataFrame()

def analyze_stability(df):
    print("=========================================================")
    print("ULTOPS NEURAL ENGINE SUBGROUP OVERFITTING AUDIT")
    print("=========================================================\n")
    
    if len(df) == 0:
        print("[ERROR] No backtest data found. Ensure you are pointing to a valid file.")
        return
        
    # 1. Ensure required columns and derive tracking features
    if 'gameDateEt' in df.columns:
        df['gameDate'] = pd.to_datetime(df['gameDateEt'])
        df['month'] = df['gameDate'].dt.strftime('%Y-%m (%B)')
    else:
        print("[ERROR] Missing 'gameDateEt' column for temporal analysis.")
        return
        
    # Ensure baseline calculation variables exist
    # 'finalCorrectBool' contains 1 for Win, 0 for Loss
    if 'finalCorrectBool' not in df.columns:
        # Fallback if names differ: create boolean from actual vs predicted side
        if 'actualSide' in df.columns and 'predictedSide' in df.columns:
            df['finalCorrectBool'] = (df['actualSide'] == df['predictedSide']).astype(int)
        else:
            print("[ERROR] Cannot resolve win/loss boolean target column.")
            return

    # Filter to look specifically at the 76.87% Selected Picks pool
    selected_df = df[df['isSelected'] == True].copy() if 'isSelected' in df.columns else df.copy()
    
    if len(selected_df) == 0:
        print("[WARNING] No selected high-confidence picks found. Auditing full board.")
        selected_df = df.copy()

    # ---------------------------------------------------------
    # MODULE 1: Temporal Calendar Month Drift Audit
    # ---------------------------------------------------------
    print("TEMPORAL STABILITY PROFILE (BY MONTH):")
    month_stats = selected_df.groupby('month').agg(
        Total_Picks=('finalCorrectBool', 'count'),
        Wins=('finalCorrectBool', 'sum'),
        Accuracy=('finalCorrectBool', 'mean')
    ).reset_index()
    
    for _, row in month_stats.iterrows():
        losses = row['Total_Picks'] - row['Wins']
        print(f"  * {row['month']}: {row['Accuracy']:.2%} hit rate ({int(row['Wins'])}W - {int(losses)}L) over {int(row['Total_Picks'])} plays")
    
    month_acc_std = month_stats['Accuracy'].std()
    print(f"  >>> Monthly Volatility (StdDev): {month_acc_std:.4f}")
    if month_acc_std > 0.06:
        print("  [RED] CRITICAL ALERT: High temporal variance! Your model may be over-indexing on early seasonal trends.")
    else:
        print("  [GREEN] PASS: Temporal performance is stable throughout the calendar lifecycle.")
    print("\n" + "-"*50 + "\n")

    # ---------------------------------------------------------
    # MODULE 2: Entity Structural Bias Audit (By Team)
    # ---------------------------------------------------------
    print("TEAM NETWORK STABILITY PROFILE (TOP 10 / BOTTOM 10 SAMPLE):")
    # Determine team tracking field (fallback if playerTeam vs teamAbbr varies)
    team_col = 'playerTeam' if 'playerTeam' in df.columns else ('teamAbbr' if 'teamAbbr' in df.columns else None)
    
    if team_col:
        team_stats = selected_df.groupby(team_col).agg(
            Total_Picks=('finalCorrectBool', 'count'),
            Wins=('finalCorrectBool', 'sum'),
            Accuracy=('finalCorrectBool', 'mean')
        ).reset_index()
        
        # Filter out low sample size teams to avoid mathematical noise
        valid_teams = team_stats[team_stats['Total_Picks'] >= 5].sort_values(by='Accuracy', ascending=False)
        
        print(f"  [TOP] Top 5 Most Profitable Team Nodes (min 5 plays):")
        for _, row in valid_teams.head(5).iterrows():
            losses = row['Total_Picks'] - row['Wins']
            print(f"    - {row[team_col]}: {row['Accuracy']:.2%} ({int(row['Wins'])}W - {int(losses)}L over {int(row['Total_Picks'])} plays)")
            
        print("\n  [BOTTOM] Bottom 5 Least Profitable Team Nodes (min 5 plays):")
        for _, row in valid_teams.tail(5).iterrows():
            losses = row['Total_Picks'] - row['Wins']
            print(f"    - {row[team_col]}: {row['Accuracy']:.2%} ({int(row['Wins'])}W - {int(losses)}L over {int(row['Total_Picks'])} plays)")
            
        team_acc_std = valid_teams['Accuracy'].std()
        print(f"\n  >>> Team Vector Volatility (StdDev): {team_acc_std:.4f}")
        
        # Calculate Coefficient of Variation to capture systemic clustering
        coef_of_variation = team_acc_std / valid_teams['Accuracy'].mean()
        if coef_of_variation > 0.15:
            print("  [RED] CRITICAL ALERT: Dense cluster overfitting! The GNN network is heavily biased toward specific team structures.")
        else:
            print("  [GREEN] PASS: Node structural properties show steady predictive distribution across leagues.")
    else:
        print("  [WARNING] Skipping Team Audit: Player or Team identifier column not found.")
    print("\n=========================================================")

if __name__ == "__main__":
    # Point this to your actual output path from the neural model v2 run
    BACKTEST_OUTPUT_PATH = "exports/final-player-prop-model-v1-neural-v2.json"
    
    try:
        backtest_df = load_backtest_data(BACKTEST_OUTPUT_PATH)
        analyze_stability(backtest_df)
    except FileNotFoundError:
        print(f"[ERROR] Could not find backtest summary file at {BACKTEST_OUTPUT_PATH}. Ensure your backtest script exports raw rows.")
