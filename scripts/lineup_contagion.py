import numpy as np

class LineupContagionMatrix:
    """
    NBA zero-sum lineup usage and volume redistribution matrix.
    When primary playmakers are ruled OUT, this engine scales expected minutes,
    usage percentages, and projected statistical floors for remaining roster members.
    """
    def __init__(self):
        # Baseline database mock representing player attributes
        self.player_db = {
            "Giannis Antetokounmpo": {"pos": "F", "usage": 32.5, "min_base": 34.0, "pts_per_min": 0.88, "reb_per_min": 0.35, "ast_per_min": 0.18},
            "Damian Lillard": {"pos": "G", "usage": 28.0, "min_base": 35.0, "pts_per_min": 0.72, "reb_per_min": 0.12, "ast_per_min": 0.20},
            "Khris Middleton": {"pos": "F", "usage": 22.0, "min_base": 30.0, "pts_per_min": 0.55, "reb_per_min": 0.15, "ast_per_min": 0.16},
            "Brook Lopez": {"pos": "C", "usage": 16.5, "min_base": 30.5, "pts_per_min": 0.42, "reb_per_min": 0.16, "ast_per_min": 0.05},
            "Bobby Portis": {"pos": "F", "usage": 21.0, "min_base": 24.5, "pts_per_min": 0.58, "reb_per_min": 0.32, "ast_per_min": 0.06},
            "Pat Connaughton": {"pos": "G", "usage": 12.0, "min_base": 21.0, "pts_per_min": 0.33, "reb_per_min": 0.14, "ast_per_min": 0.08},
            "Malik Beasley": {"pos": "G", "usage": 14.0, "min_base": 26.0, "pts_per_min": 0.40, "reb_per_min": 0.11, "ast_per_min": 0.06}
        }

    def compute_redistribution(self, team_name: str, active_roster: list, inactive_players: list):
        """
        Calculates redistributed minutes and usage percentages for active roster.
        Usage rate must sum to a zero-sum team total (nominally ~100% of possessions).
        """
        print(f"\n--- Lineup Contagion Redistribution for {team_name} ---")
        print(f"Active Players: {', '.join(active_roster)}")
        print(f"Inactive Stars: {', '.join(inactive_players)}")
        
        # Calculate sum of base usage rates of inactive players to redistribute
        vacated_usage = 0.0
        vacated_minutes = 0.0
        
        for name in inactive_players:
            if name in self.player_db:
                vacated_usage += self.player_db[name]["usage"]
                vacated_minutes += self.player_db[name]["min_base"]
        
        print(f"Vacated Usage: {vacated_usage:.1f}% | Vacated Minutes: {vacated_minutes:.1f}")
        
        # Base stats for active players
        active_stats = {}
        total_active_base_usage = 0.0
        total_active_base_minutes = 0.0
        
        for name in active_roster:
            if name in self.player_db:
                active_stats[name] = self.player_db[name].copy()
                total_active_base_usage += active_stats[name]["usage"]
                total_active_base_minutes += active_stats[name]["min_base"]
                
        # Redistribute minutes (fill the 240 game minutes of a team slate)
        # Scale active minutes proportionally up to standard caps (e.g. 38 mins)
        minute_scale_factor = 240.0 / (total_active_base_minutes + 0.0001)
        # Cap minutes at 39 to ensure physical safety limits
        redistributed_minutes = {}
        for name, stats in active_stats.items():
            proposed_mins = stats["min_base"] * (1.0 + (vacated_minutes / 240.0) * (stats["usage"] / total_active_base_usage))
            redistributed_minutes[name] = min(39.0, round(proposed_mins, 1))
            
        # Redistribute usage proportionally based on active base usage share
        redistributed_usage = {}
        for name, stats in active_stats.items():
            share = stats["usage"] / (total_active_base_usage + 0.0001)
            new_usage = stats["usage"] + vacated_usage * share
            redistributed_usage[name] = round(new_usage, 2)
            
        # Calculate revised statistical projection adjustments
        print("\nRevised Projections under Lineup Contagion Matrix:")
        print(f"{'Player':<25} | {'Base Mins':<9} -> {'New Mins':<9} | {'Base Usage':<10} -> {'New Usage':<10} | {'Proj PTS':<8}")
        print("-" * 80)
        
        results = {}
        for name in active_roster:
            if name in active_stats:
                base_mins = active_stats[name]["min_base"]
                new_mins = redistributed_minutes[name]
                base_usg = active_stats[name]["usage"]
                new_usg = redistributed_usage[name]
                
                # Projections scale with minutes and usage shift
                # Base points: minutes * pts_per_min
                # Revised points: new_minutes * pts_per_min * (new_usage / base_usage)
                usage_scaler = new_usg / (base_usg + 0.0001)
                new_pts = round(new_mins * active_stats[name]["pts_per_min"] * usage_scaler, 2)
                base_pts = round(base_mins * active_stats[name]["pts_per_min"], 2)
                
                print(f"{name:<25} | {base_mins:<9} -> {new_mins:<9} | {base_usg:<10}% -> {new_usg:<10}% | {base_pts:<8} -> {new_pts:<8} ({new_pts - base_pts:+.2f})")
                
                results[name] = {
                    "minutes": new_mins,
                    "usage": new_usg,
                    "points": new_pts
                }
        return results

if __name__ == "__main__":
    matrix = LineupContagionMatrix()
    
    # Scenario: Damian Lillard is OUT.
    # Damian's massive 28.0% usage and 35 minutes must be redistributed among Giannis and the team!
    active_milwaukee = ["Giannis Antetokounmpo", "Khris Middleton", "Brook Lopez", "Bobby Portis", "Pat Connaughton", "Malik Beasley"]
    inactive_milwaukee = ["Damian Lillard"]
    
    matrix.compute_redistribution("Milwaukee Bucks", active_milwaukee, inactive_milwaukee)
